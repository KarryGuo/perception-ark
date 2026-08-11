/**
 * 离线缓存服务
 *
 * 用于在网络不可用时提供基础功能:
 *  - 常用路线缓存(导航历史,可离线查看路线起终点和距离)
 *  - 紧急联系人缓存(SOS 时即使离线也能显示家属电话)
 *  - 最近识别结果缓存(可选,提供基础回看)
 *
 * 存储策略:
 *  - 原生APP: @capacitor/preferences(异步,SharedPreferences)
 *  - Web浏览器: localStorage(同步)
 *  - 通过 secureStorage 双写保证一致性
 *
 * 数据格式: 每条记录包含 { id, type, data, timestamp }
 *  - type: 'route' | 'contact' | 'recognition'
 *  - data: 路线/联系人/识别结果的具体内容
 *  - timestamp: 缓存时间戳(用于 TTL 过期)
 */

import { secureStorage } from './nativeBridge.js';

const CACHE_PREFIX = 'ark_offline_';
const MAX_ITEMS = 50; // 每类最多缓存 50 条
const TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 天过期(与家属端状态事件一致)

/**
 * 读取缓存(同步,从 localStorage)
 * @param {string} type 'route' | 'contact' | 'recognition'
 * @returns {Array} 缓存项数组(已过滤过期)
 */
export function getCachedItems(type) {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${type}`);
    if (!raw) return [];
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    // 过滤过期项
    const now = Date.now();
    return items.filter(item => (now - item.timestamp) < TTL_MS);
  } catch (e) {
    console.warn(`[offlineCache] 读取 ${type} 缓存失败:`, e);
    return [];
  }
}

/**
 * 写入缓存(同步双写 localStorage + Preferences)
 * @param {string} type
 * @param {Object} data 要缓存的数据
 * @returns {Object} 写入的缓存项(含 id 和 timestamp)
 */
export function addCachedItem(type, data) {
  try {
    const items = getCachedItems(type);
    const newItem = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      data,
      timestamp: Date.now(),
    };
    // 新项插到头部,超出上限截断
    const updated = [newItem, ...items].slice(0, MAX_ITEMS);
    const json = JSON.stringify(updated);
    localStorage.setItem(`${CACHE_PREFIX}${type}`, json);
    // 原生环境同步到 Preferences(异步)
    secureStorage.setSync(`${CACHE_PREFIX}${type}`, json);
    return newItem;
  } catch (e) {
    console.warn(`[offlineCache] 写入 ${type} 缓存失败:`, e);
    return null;
  }
}

/**
 * 删除单条缓存
 */
export function removeCachedItem(type, id) {
  try {
    const items = getCachedItems(type);
    const updated = items.filter(item => item.id !== id);
    const json = JSON.stringify(updated);
    localStorage.setItem(`${CACHE_PREFIX}${type}`, json);
    secureStorage.setSync(`${CACHE_PREFIX}${type}`, json);
    return true;
  } catch (e) {
    console.warn(`[offlineCache] 删除 ${type} 缓存失败:`, e);
    return false;
  }
}

/**
 * 清空指定类型缓存
 */
export function clearCache(type) {
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${type}`);
    secureStorage.removeSync(`${CACHE_PREFIX}${type}`);
    return true;
  } catch (e) {
    console.warn(`[offlineCache] 清空 ${type} 缓存失败:`, e);
    return false;
  }
}

/**
 * 清空所有离线缓存
 */
export function clearAllCache() {
  ['route', 'contact', 'recognition'].forEach(clearCache);
}

/**
 * 缓存路线(导航成功后调用)
 * @param {Object} route { destination, distance, duration, startLat, startLng, endLat, endLng }
 */
export function cacheRoute(route) {
  return addCachedItem('route', route);
}

/**
 * 缓存紧急联系人(家属绑定后调用)
 * @param {Object} contact { name, phone, relation }
 */
export function cacheContact(contact) {
  // 联系人去重(按手机号)
  const existing = getCachedItems('contact');
  const filtered = existing.filter(item => item.data?.phone !== contact.phone);
  const json = JSON.stringify([
    { id: `contact_${Date.now()}`, type: 'contact', data: contact, timestamp: Date.now() },
    ...filtered,
  ].slice(0, MAX_ITEMS));
  localStorage.setItem(`${CACHE_PREFIX}contact`, json);
  secureStorage.setSync(`${CACHE_PREFIX}contact`, json);
}

/**
 * 获取缓存的联系人列表(用于离线 SOS 拨号)
 */
export function getCachedContacts() {
  return getCachedItems('contact').map(item => item.data);
}

/**
 * 获取缓存的路线列表(用于离线查看导航历史)
 */
export function getCachedRoutes() {
  return getCachedItems('route').map(item => item.data);
}

/**
 * 判断是否离线(网络不可用)
 */
export function isOffline() {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}