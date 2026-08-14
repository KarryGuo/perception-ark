import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../services/api.js';
import { loadAmapSDK } from '../services/amap.js';

/**
 * WGS-84 转 GCJ-02 (火星坐标系)
 * 浏览器原生GPS返回WGS-84坐标,高德地图使用GCJ-02坐标,
 * 不转换会导致中国境内定位偏移100~500米,且与高德SDK结果交替更新时位置乱跳。
 */
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}
function wgs84ToGcj02(wgsLat, wgsLng) {
  if (outOfChina(wgsLat, wgsLng)) return { lat: wgsLat, lng: wgsLng };
  let dLat = transformLat(wgsLng - 105.0, wgsLat - 35.0);
  let dLng = transformLng(wgsLng - 105.0, wgsLat - 35.0);
  const radLat = wgsLat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return { lat: wgsLat + dLat, lng: wgsLng + dLng };
}

/**
 * 高德 AMap.Geolocation - GPS/基站定位(最精确,移动端首选,已转GCJ-02)
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
 * 注意: 浏览器返回WGS-84坐标,需转换为GCJ-02以匹配高德地图
 */
function locateByBrowserHigh() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('浏览器不支持定位'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
        resolve({
          lat: gcj.lat,
          lng: gcj.lng,
          accuracy: pos.coords.accuracy,
          source: 'browser-gps'
        });
      },
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
let globalLocation = null;
let globalListeners = new Set();
let globalInitStarted = false;
let globalWatchStarted = false;
const lastPosRef = { lat: null, lng: null, accuracy: Infinity, timestamp: 0 };
const preciseLocatedRef = { value: false };

function notifyListeners() {
  globalListeners.forEach(fn => fn(globalLocation));
}

/**
 * 应用新位置(直接设置,不再用回调式更新避免丢坐标)
 */
function setGlobalLocation(pos) {
  globalLocation = pos;
  notifyListeners();
}

/**
 * 应用位置(带稳定性过滤,防止跳动)
 * 规则:
 * 1. 第一次定位直接应用
 * 2. 已有精确定位(accuracy < 1000m)后,不再接受IP级(accuracy > 5000m)结果
 * 3. 新位置精度比旧位置差5倍以上时拒绝(放宽阈值,允许室内→室外精度变化)
 * 4. 移动距离 < 动态抖动阈值(基于精度,最低5米)视为抖动,但精度显著更好时更新精度
 * 5. 短时间(3秒)内位移异常大(>500米)视为漂移,拒绝(放宽,适应高速移动)
 * 6. 位置超过30秒未更新时,强制接受新位置(避免位置过期停滞)
 */
async function applyLocation(pos) {
  const now = Date.now();

  // 第一次定位直接应用
  if (lastPosRef.lat === null) {
    lastPosRef.lat = pos.lat;
    lastPosRef.lng = pos.lng;
    lastPosRef.accuracy = pos.accuracy;
    lastPosRef.timestamp = now;
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

  // 位置过期检测:超过30秒未更新,强制接受新位置(避免停滞)
  const elapsedSinceLastUpdate = now - (lastPosRef.timestamp || now);
  const isStale = elapsedSinceLastUpdate > 30000;

  // 已有精确定位后,拒绝IP级结果(防止跳回城市中心) - 过期时除外
  if (!isStale && preciseLocatedRef.value && pos.accuracy > 5000) {
    return;
  }

  // 新位置精度比旧位置差5倍以上时拒绝(放宽阈值,适应室内外切换) - 过期时除外
  if (!isStale && pos.accuracy > lastPosRef.accuracy * 5 && lastPosRef.accuracy !== Infinity) {
    return;
  }

  // 动态抖动阈值:基于精度计算,最低5米(精度越好阈值越小)
  const jitterThreshold = Math.max(5, Math.min(15, (pos.accuracy || 50) * 0.3));
  const moved = distance(pos.lat, pos.lng, lastPosRef.lat, lastPosRef.lng);

  // 移动距离 < 动态抖动阈值视为抖动(防止地图跳动) - 过期时除外
  if (!isStale && moved < jitterThreshold) {
    // 即使没移动,如果精度显著更好也更新精度信息
    if (pos.accuracy < lastPosRef.accuracy * 0.5) {
      lastPosRef.accuracy = pos.accuracy;
      if (globalLocation) {
        setGlobalLocation({ ...globalLocation, accuracy: pos.accuracy });
      }
    }
    return;
  }

  // 短时间(3秒)内位移异常大(>500米)视为GPS漂移,拒绝(放宽,适应高速移动)
  if (elapsedSinceLastUpdate < 3000 && moved > 500) {
    return;
  }

  // 接受新位置
  lastPosRef.lat = pos.lat;
  lastPosRef.lng = pos.lng;
  lastPosRef.accuracy = pos.accuracy;
  lastPosRef.timestamp = now;
  if (pos.accuracy < 1000) preciseLocatedRef.value = true;

  setGlobalLocation(globalLocation ? {
    ...globalLocation,
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

  tasks.push(
    locateByAmapGeo()
      .then(async (pos) => {
        console.log('[Geo] AMap GPS定位成功:', pos);
        await applyLocation(pos);
      })
      .catch(err => console.warn('[Geo] AMap GPS失败:', err.message))
  );

  tasks.push(
    locateByBrowserHigh()
      .then(async (pos) => {
        console.log('[Geo] 浏览器GPS定位成功:', pos);
        await applyLocation(pos);
      })
      .catch(err => console.warn('[Geo] 浏览器GPS失败:', err.message))
  );

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
 * 优化: maximumAge=0(禁用缓存,获取实时位置),降低延迟
 */
function startWatch() {
  if (globalWatchStarted) return;
  globalWatchStarted = true;

  // AMap.Geolocation watchPosition (返回GCJ-02,无需转换)
  loadAmapSDK()
    .then((AMap) => {
      if (!AMap.Geolocation) return;
      const geo = new AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 8000,
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

  // 浏览器原生watchPosition (返回WGS-84,需转GCJ-02)
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      (pos) => {
        const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
        applyLocation({ lat: gcj.lat, lng: gcj.lng, accuracy: pos.coords.accuracy || 100, source: 'browser-watch' });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
}

/**
 * 强制刷新定位(导航/POI搜索前调用,确保位置最新)
 * 三层竞速: 高德GPS → 浏览器GPS → IP定位兜底
 */
async function forceRefreshLocation() {
  try {
    // 第一层: 高德GPS定位 + 第二层: 浏览器原生定位(并行竞速,取先返回的)
    const pos = await locateByAmapGeo().catch(() => null) || await locateByBrowserHigh().catch(() => null);
    if (pos) {
      // 强制应用: 重置lastPosRef以跳过移动阈值过滤
      lastPosRef.lat = null;
      lastPosRef.lng = null;
      lastPosRef.accuracy = Infinity;
      lastPosRef.timestamp = 0;
      preciseLocatedRef.value = false;
      await applyLocation(pos);
      return pos;
    }
    // 第三层: IP定位兜底(城市级精度,确保在GPS不可用时不返回null)
    console.warn('[Geo] GPS定位失败,尝试IP定位兜底...');
    const ipPos = await locateByCitySearch().catch(() => null);
    if (ipPos) {
      lastPosRef.lat = null;
      lastPosRef.lng = null;
      lastPosRef.accuracy = Infinity;
      lastPosRef.timestamp = 0;
      preciseLocatedRef.value = false;
      await applyLocation(ipPos);
      return ipPos;
    }
  } catch (err) {
    console.warn('[Geo] 强制刷新定位失败:', err.message);
  }
  return null;
}

/**
 * 地理位置 Hook (全局单例版)
 */
export function useGeolocation() {
  const [location, setLocalLocation] = useState(globalLocation);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!globalLocation);

  useEffect(() => {
    const listener = (pos) => {
      setLocalLocation(pos);
      if (pos) setLoading(false);
    };
    globalListeners.add(listener);

    if (!globalInitStarted) {
      setLoading(true);
      initLocation().finally(() => setLoading(false));
    }

    startWatch();

    return () => {
      globalListeners.delete(listener);
    };
  }, []);

  // 手动刷新定位
  const update = useCallback(() => {
    setLoading(true);
    lastPosRef.lat = null;
    lastPosRef.lng = null;
    lastPosRef.accuracy = Infinity;
    lastPosRef.timestamp = 0;
    preciseLocatedRef.value = false;
    globalInitStarted = false;
    initLocation().finally(() => setLoading(false));
  }, []);

  // 强制精确定位(导航前调用)
  const forceLocate = useCallback(async () => {
    setLoading(true);
    const pos = await forceRefreshLocation();
    setLoading(false);
    return pos;
  }, []);

  return { location, error, loading, update, forceLocate };
}
