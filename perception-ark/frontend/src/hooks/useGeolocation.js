import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../services/api.js';
import { loadAmapSDK } from '../services/amap.js';

/**
 * 高德 AMap.Geolocation - GPS/基站定位(最精确,移动端首选)
 */
function locateByAmapGeo() {
  return new Promise((resolve, reject) => {
    loadAmapSDK()
      .then((AMap) => {
        if (!AMap.Geolocation) {
          reject(new Error('Geolocation插件未加载'));
          return;
        }
        const geo = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
          convert: true,
          showButton: false,
          showMarker: false,
          showCircle: false
        });
        geo.getCurrentPosition((status, result) => {
          if (status === 'complete') {
            resolve({
              lat: result.position.getLat(),
              lng: result.position.getLng(),
              accuracy: result.accuracy || 50,
              source: 'amap-geo'
            });
          } else {
            reject(new Error(result.message || '高德GPS定位失败'));
          }
        });
      })
      .catch(reject);
  });
}

/**
 * 浏览器原生高精度定位(手机GPS,精度最高)
 */
function locateByBrowserHigh() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('浏览器不支持定位'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        source: 'browser-gps'
      }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

/**
 * AMap.CitySearch - IP定位(快速兜底,城市级精度)
 */
function locateByCitySearch() {
  return new Promise((resolve, reject) => {
    loadAmapSDK()
      .then((AMap) => {
        if (!AMap.CitySearch) {
          reject(new Error('CitySearch插件未加载'));
          return;
        }
        const citySearch = new AMap.CitySearch();
        citySearch.getLocalCity((status, result) => {
          if (status === 'complete' && result.bounds) {
            const center = result.bounds.getCenter();
            resolve({
              lat: center.getLat(),
              lng: center.getLng(),
              accuracy: 10000,
              source: 'amap-ip',
              city: result.city || '',
              province: result.province || ''
            });
          } else {
            reject(new Error(result || 'CitySearch定位失败'));
          }
        });
      })
      .catch(reject);
  });
}

/**
 * 逆地理编码获取真实地址(含省/市/区)
 */
async function reverseGeocode(lat, lng) {
  const res = await api.locationInfo(lat, lng);
  if (res.success && res.location?.address) {
    return {
      address: res.location.address,
      province: res.location.province,
      city: res.location.city,
      district: res.location.district,
      weather: res.weather
    };
  }
  return null;
}

/**
 * 计算两点距离(米)
 */
function distance(lat1, lng1, lat2, lng2) {
  const dLat = lat1 - lat2;
  const dLng = lng1 - lng2;
  return Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
}

// ==================== 全局单例 ====================
// 多组件(Web端Glasses + 移动端AppMobile)共享同一个定位状态,
// 避免重复发起定位 + 重复watchPosition导致地图跳动
let globalLocation = null;
let globalListeners = new Set();
let globalInitStarted = false;
let globalWatchStarted = false;
const lastPosRef = { lat: null, lng: null, accuracy: Infinity };
const preciseLocatedRef = { value: false };

function notifyListeners() {
  globalListeners.forEach(fn => fn(globalLocation));
}

function setGlobalLocation(pos) {
  globalLocation = pos;
  notifyListeners();
}

/**
 * 应用位置(带稳定性过滤,防止跳动)
 * 规则:
 * 1. 第一次定位直接应用
 * 2. 已有精确定位(accuracy < 1000m)后,不再接受IP级(accuracy > 5000m)结果
 * 3. 新位置与旧位置移动距离 > 20米 才更新(防止GPS抖动)
 * 4. 新位置精度必须优于旧位置,或同级别但移动了才更新
 */
async function applyLocation(pos) {
  // 第一次定位直接应用
  if (lastPosRef.lat === null) {
    lastPosRef.lat = pos.lat;
    lastPosRef.lng = pos.lng;
    lastPosRef.accuracy = pos.accuracy;
    if (pos.accuracy < 1000) preciseLocatedRef.value = true;

    setGlobalLocation({
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      address: `${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`,
      source: pos.source,
      province: pos.province || '',
      city: pos.city || ''
    });

    // 异步逆地理编码
    try {
      const geo = await reverseGeocode(pos.lat, pos.lng);
      if (geo && lastPosRef.lat === pos.lat) {
        setGlobalLocation({
          lat: pos.lat,
          lng: pos.lng,
          accuracy: pos.accuracy,
          address: geo.address,
          province: geo.province,
          city: geo.city,
          district: geo.district,
          weather: geo.weather,
          source: pos.source
        });
      }
    } catch (err) {
      console.warn('[Geo] 逆地理编码失败:', err.message);
    }
    return;
  }

  // 已有精确定位后,拒绝IP级结果(防止跳回城市中心)
  if (preciseLocatedRef.value && pos.accuracy > 5000) {
    return;
  }

  // 移动距离过滤: <20米视为抖动(防止地图跳动)
  const moved = distance(pos.lat, pos.lng, lastPosRef.lat, lastPosRef.lng);
  if (moved < 20) {
    // 即使没移动,如果精度显著更好也更新精度信息
    if (pos.accuracy < lastPosRef.accuracy * 0.5) {
      lastPosRef.accuracy = pos.accuracy;
      setGlobalLocation(prev => prev ? { ...prev, accuracy: pos.accuracy } : null);
    }
    return;
  }

  // 移动了 > 20米,接受新位置
  lastPosRef.lat = pos.lat;
  lastPosRef.lng = pos.lng;
  lastPosRef.accuracy = pos.accuracy;
  if (pos.accuracy < 1000) preciseLocatedRef.value = true;

  setGlobalLocation(prev => prev ? {
    ...prev,
    lat: pos.lat,
    lng: pos.lng,
    accuracy: pos.accuracy,
    source: pos.source
  } : {
    lat: pos.lat,
    lng: pos.lng,
    accuracy: pos.accuracy,
    address: `${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`,
    source: pos.source
  });
}

/**
 * 初始定位(并行竞速,只接受最佳结果)
 */
async function initLocation() {
  if (globalInitStarted) return;
  globalInitStarted = true;

  const tasks = [];

  // Task 1: AMap.Geolocation (GPS/基站, 最精确)
  tasks.push(
    locateByAmapGeo()
      .then(async (pos) => {
        console.log('[Geo] AMap GPS定位成功:', pos);
        await applyLocation(pos);
      })
      .catch(err => console.warn('[Geo] AMap GPS失败:', err.message))
  );

  // Task 2: 浏览器原生GPS
  tasks.push(
    locateByBrowserHigh()
      .then(async (pos) => {
        console.log('[Geo] 浏览器GPS定位成功:', pos);
        await applyLocation(pos);
      })
      .catch(err => console.warn('[Geo] 浏览器GPS失败:', err.message))
  );

  // Task 3: CitySearch IP定位(快速兜底)
  tasks.push(
    locateByCitySearch()
      .then(async (pos) => {
        console.log('[Geo] IP定位成功:', pos);
        await applyLocation(pos);
      })
      .catch(err => console.warn('[Geo] IP定位失败:', err.message))
  );

  await Promise.allSettled(tasks);
}

/**
 * 启动持续监听(只启动一次,全局共享)
 */
function startWatch() {
  if (globalWatchStarted) return;
  globalWatchStarted = true;

  // AMap.Geolocation watchPosition
  loadAmapSDK()
    .then((AMap) => {
      if (!AMap.Geolocation) return;
      const geo = new AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
        convert: true
      });
      geo.watchPosition((status, result) => {
        if (status === 'complete') {
          const lat = result.position.getLat();
          const lng = result.position.getLng();
          const accuracy = result.accuracy || 50;
          applyLocation({ lat, lng, accuracy, source: 'amap-watch' });
        }
      });
    })
    .catch(() => {});

  // 浏览器原生watchPosition
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy || 100;
        applyLocation({ lat, lng, accuracy, source: 'browser-watch' });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
  }
}

/**
 * 地理位置 Hook (全局单例版)
 * - 多组件共享同一个定位状态,不会重复发起定位
 * - 20米移动阈值过滤GPS抖动,防止地图跳动
 * - 精确定位后拒绝IP级结果,防止跳回城市中心
 */
export function useGeolocation() {
  const [location, setLocalLocation] = useState(globalLocation);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!globalLocation);

  // 订阅全局位置更新
  useEffect(() => {
    const listener = (pos) => {
      setLocalLocation(pos);
      if (pos) setLoading(false);
    };
    globalListeners.add(listener);

    // 首次挂载: 如果全局还没开始定位,启动
    if (!globalInitStarted) {
      setLoading(true);
      initLocation().finally(() => setLoading(false));
    }

    // 启动持续监听
    startWatch();

    return () => {
      globalListeners.delete(listener);
    };
  }, []);

  // 手动刷新定位
  const update = useCallback(() => {
    setLoading(true);
    // 重置状态,允许重新定位
    lastPosRef.lat = null;
    lastPosRef.lng = null;
    lastPosRef.accuracy = Infinity;
    preciseLocatedRef.value = false;
    globalInitStarted = false;
    initLocation().finally(() => setLoading(false));
  }, []);

  return { location, error, loading, update };
}
