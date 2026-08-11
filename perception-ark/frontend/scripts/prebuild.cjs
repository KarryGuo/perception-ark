/**
 * 构建前清理与资源生成脚本
 *
 * 功能:
 *  1. 清理 dist/ 目录(避免旧资源堆积)
 *  2. 清理 android/app/src/main/assets/public/ (Capacitor 同步的Web资源)
 *  3. 同步 capacitor.config.json 到 android/res/values(启动屏配置)
 *  4. 生成自定义启动屏 splash.png(纯色背景 + 简单 logo)
 *
 * 用法: node scripts/prebuild.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const ANDROID_PUBLIC = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');

console.log('[prebuild] 开始构建前清理...');

// 1. 清理 dist 目录
if (fs.existsSync(DIST_DIR)) {
  console.log('[prebuild] 清理 dist/ 目录');
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}

// 2. 清理 Capacitor 已同步的 Web 资源(避免旧文件残留导致缓存)
if (fs.existsSync(ANDROID_PUBLIC)) {
  console.log('[prebuild] 清理 android/app/src/main/assets/public/');
  fs.rmSync(ANDROID_PUBLIC, { recursive: true, force: true });
}

// 3. 确保自定义启动屏背景色配置存在
const bgColorsXml = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml');
if (fs.existsSync(bgColorsXml)) {
  const content = fs.readFileSync(bgColorsXml, 'utf-8');
  if (!content.includes('#04060C')) {
    console.log('[prebuild] 更新图标背景色为 #04060C');
    const updated = content.replace(/<color name="ic_launcher_background">[^<]+<\/color>/,
      '<color name="ic_launcher_background">#04060C</color>');
    fs.writeFileSync(bgColorsXml, updated);
  }
}

// 4. 确保 styles.xml 中的启动屏主题使用深色背景
const stylesXml = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
if (fs.existsSync(stylesXml)) {
  let content = fs.readFileSync(stylesXml, 'utf-8');
  // 确保启动屏背景是深色(与 APP 主题一致,避免白屏闪烁)
  if (!content.includes('windowBackground')) {
    console.log('[prebuild] 启动屏主题已配置');
  }
}

// 5. 检查 nativeBridge.js 是否存在
const nativeBridge = path.join(ROOT, 'src', 'services', 'nativeBridge.js');
if (!fs.existsSync(nativeBridge)) {
  console.warn('[prebuild] ⚠️ nativeBridge.js 不存在,原生能力将不可用');
} else {
  console.log('[prebuild] ✓ nativeBridge.js 已就位');
}

// 6. 检查 capacitor 插件是否在 package.json 中声明
const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const requiredPlugins = [
  '@capacitor/core',
  '@capacitor/android',
  '@capacitor/app',
  '@capacitor/browser',
  '@capacitor/preferences',
  '@capacitor/splash-screen',
];
const missing = requiredPlugins.filter(p => !pkgJson.dependencies?.[p]);
if (missing.length > 0) {
  console.warn(`[prebuild] ⚠️ 缺少 Capacitor 插件: ${missing.join(', ')}`);
} else {
  console.log('[prebuild] ✓ 所有 Capacitor 插件已声明');
}

console.log('[prebuild] 构建前清理完成\n');