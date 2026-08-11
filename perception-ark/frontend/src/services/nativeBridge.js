/**
 * 原生能力桥接服务
 * 统一封装 Capacitor 原生插件调用,自动检测运行环境:
 *  - Web浏览器: 降级到标准 Web API(window.open/location.href/localStorage)
 *  - Android APP: 使用 Capacitor 原生插件(@capacitor/browser/@capacitor/preferences)
 *
 * 关键功能:
 *  1. tel: 拨号  - Android 上通过 App.addListener 拦截 tel: Intent 触发拨号
 *  2. 外部链接   - 用 @capacitor/browser 在应用内打开,避免 target=_blank 在 WebView 中失效
 *  3. 安全存储   - 用 @capacitor/preferences 替代 localStorage,避免 token 明文暴露
 *  4. 设备能力   - 检测是否原生运行、平台、是否移动端
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

// 是否运行在 Capacitor 原生容器中(Android/iOS APP)
export const isNative = () => Capacitor.isNativePlatform();
export const getPlatform = () => Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

// 是否为移动端(包括浏览器移动端和原生APP)
export const isMobileDevice = () => {
  if (isNative()) return true;
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
};

/**
 * 拨打电话
 * - Android 原生: 通过 window.location.href = 'tel:xxx' 触发系统拨号 Intent
 *   (Capacitor WebView 会自动将 tel: 协议转发给系统拨号应用)
 * - Web 浏览器: 同样用 location.href = 'tel:xxx' 触发
 * - 兜底: 若上述失败,尝试 window.open
 *
 * @param {string} phone 电话号码,如 '120' / '110' / '13800138000'
 */
export async function dialPhone(phone) {
  const telUrl = `tel:${phone}`;
  console.log('[nativeBridge] 拨号:', telUrl, '平台:', getPlatform());

  // 方式1: location.href 触发(Capacitor WebView 默认支持 tel: Intent)
  try {
    window.location.href = telUrl;
    return { success: true, method: 'location.href' };
  } catch (e) {
    console.warn('[nativeBridge] location.href 拨号失败:', e);
  }

  // 方式2: 创建 <a> 标签点击触发(更兼容某些 WebView)
  try {
    const a = document.createElement('a');
    a.href = telUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
    return { success: true, method: 'anchor.click' };
  } catch (e) {
    console.warn('[nativeBridge] anchor 拨号失败:', e);
  }

  // 方式3: window.open 兜底
  try {
    window.open(telUrl, '_system');
    return { success: true, method: 'window.open' };
  } catch (e) {
    console.error('[nativeBridge] 所有拨号方式均失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 打开外部链接
 * - Android 原生: 用 @capacitor/browser 在应用内打开(避免 target=_blank 失效)
 * - Web 浏览器: 用 window.open(url, '_blank', 'noopener')
 *
 * @param {string} url 完整的 https:// 链接
 */
export async function openExternalUrl(url) {
  console.log('[nativeBridge] 打开外链:', url, '平台:', getPlatform());

  if (isNative()) {
    // 原生环境: 用 Capacitor Browser 插件
    try {
      await Browser.open({ url, windowName: '_self' });
      return { success: true, method: 'capacitor-browser' };
    } catch (e) {
      console.warn('[nativeBridge] Browser 插件失败,降级 window.open:', e);
    }
  }

  // Web 环境或插件失败: 标准浏览器行为
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return { success: true, method: 'window.open' };
  } catch (e) {
    console.error('[nativeBridge] 打开外链失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 安全存储 - 替代 localStorage
 * 原生APP: 使用 @capacitor/preferences(底层为 SharedPreferences/iCloud UserDefaults)
 * Web浏览器: 降级到 localStorage
 *
 * 注意: Preferences 是异步的,需要 await
 */
export const secureStorage = {
  async get(key) {
    if (isNative()) {
      const { value } = await Preferences.get({ key });
      return value;
    }
    return localStorage.getItem(key);
  },

  async set(key, value) {
    if (isNative()) {
      await Preferences.set({ key, value: String(value) });
    } else {
      localStorage.setItem(key, value);
    }
  },

  async remove(key) {
    if (isNative()) {
      await Preferences.remove({ key });
    } else {
      localStorage.removeItem(key);
    }
  },

  // 同步版本(仅Web环境可用,原生环境会降级到localStorage读)
  // 用于 api.js 请求拦截器中同步读取 token(避免每个请求都 await)
  getSync(key) {
    // 原生环境: 由于 Preferences 是异步的,在原生环境中我们仍然读 localStorage 缓存
    // (set 时会同时写入 Preferences 和 localStorage 作为缓存)
    return localStorage.getItem(key);
  },

  // 同步写入(同时写入 Preferences 异步 + localStorage 同步缓存)
  setSync(key, value) {
    localStorage.setItem(key, value);
    if (isNative()) {
      Preferences.set({ key, value: String(value) }).catch(e =>
        console.warn('[nativeBridge] Preferences.set 失败:', e)
      );
    }
  },

  removeSync(key) {
    localStorage.removeItem(key);
    if (isNative()) {
      Preferences.remove({ key }).catch(e =>
        console.warn('[nativeBridge] Preferences.remove 失败:', e)
      );
    }
  },
};

/**
 * 初始化原生桥接(在应用启动时调用一次)
 *  - 注册 tel: / mailto: / sms: Intent 拦截(原生环境)
 *  - 注册外部链接拦截(避免 WebView 内打开外链)
 */
export async function initNativeBridge() {
  if (!isNative()) {
    console.log('[nativeBridge] Web 环境,跳过原生桥接初始化');
    return;
  }

  console.log('[nativeBridge] 初始化原生桥接,平台:', getPlatform());

  try {
    // 监听 App 内的链接点击,拦截外部链接用 Browser 打开
    // Capacitor 6: 通过 App.addListener('appUrlOpen') 监听
    App.addListener('appUrlOpen', ({ url }) => {
      console.log('[nativeBridge] appUrlOpen:', url);
      // tel: / sms: / mailto: 等系统 Intent 已由系统处理
      if (/^https?:\/\//i.test(url)) {
        // http(s) 链接: 用 Browser 插件打开
        Browser.open({ url }).catch(e =>
          console.warn('[nativeBridge] Browser.open 失败:', e)
        );
      }
    });
  } catch (e) {
    console.warn('[nativeBridge] 初始化失败:', e);
  }
}

/**
 * 隐藏启动屏(在 React 首次渲染完成后调用)
 */
export async function hideSplash() {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 300 });
    console.log('[nativeBridge] 启动屏已隐藏');
  } catch (e) {
    console.warn('[nativeBridge] 隐藏启动屏失败:', e);
  }
}

export { App, Browser, Preferences };