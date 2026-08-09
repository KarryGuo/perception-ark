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
        // WGS-84 → GCJ-02 转换,防止与高德SDK坐标系不一致导致位置偏移
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
// 多组件(Web端Glasses + 移动端AppMobile)共享同一个定位状态,
// 避免重复发起定位 + 重复watchPosition导致地图跳动
let globalLocation = null;
let globalListeners = new Set();
let globalInitStarted = false;
let globalWatchStarted = false;
const lastPosRef = { lat: null, lng: null, accuracy: Infinity, timestamp: 0 };
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
 * 3. 新位置与旧位置移动距离 > 30米 且 精度优于(或同级别)旧位置 才更新(防止GPS抖动)
 * 4. 新位置精度比旧位置差3倍以上时拒绝(防止低精度结果拉偏位置)
 * 5. 短时间(10秒)内位移异常大(>500米)视为漂移,拒绝
 */
async function applyLocation(pos) {
  // 第一次定位直接应用
  if (lastPosRef.lat === null) {
    lastPosRef.lat = pos.lat;
    lastPosRef.lng = pos.lng;
    lastPosRef.accuracy = pos.accuracy;
    lastPosRef.timestamp = Date.now();
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

  // 新位置精度比旧位置差3倍以上时拒绝(防止低精度结果拉偏位置)
  if (pos.accuracy > lastPosRef.accuracy * 3 && lastPosRef.accuracy !== Infinity) {
    return;
  }

  // 移动距离过滤: <30米视为抖动(防止地图跳动)
  const moved = distance(pos.lat, pos.lng, lastPosRef.lat, lastPosRef.lng);
  if (moved < 30) {
    // 即使没移动,如果精度显著更好也更新精度信息
    if (pos.accuracy < lastPosRef.accuracy * 0.5) {
      lastPosRef.accuracy = pos.accuracy;
      setGlobalLocation(prev => prev ? { ...prev, accuracy: pos.accuracy } : null);
    }
    return;
  }

  // 短时间(10秒)内位移异常大(>500米)视为GPS漂移,拒绝
  const now = Date.now();
  const elapsed = now - (lastPosRef.timestamp || now);
  if (elapsed < 10000 && moved > 500) {
    return;
  }

  // 移动了 > 30米,接受新位置
  lastPosRef.lat = pos.lat;
  lastPosRef.lng = pos.lng;
  lastPosRef.accuracy = pos.accuracy;
  lastPosRef.timestamp = now;
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
 * 降频策略: maximumAge=10000 允许10秒缓存,减少GPS唤醒频率,降低耗电
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
        timeout: 20000,
        maximumAge: 10000,
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
        // WGS-84 → GCJ-02 转换,防止与高德坐标系不一致导致位置乱跳
        const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
        applyLocation({ lat: gcj.lat, lng: gcj.lng, accuracy: pos.coords.accuracy || 100, source: 'browser-watch' });
      },
      () => {},
      // maximumAge=10000: 允许使用10秒内的缓存位置,减少GPS硬件唤醒,降低耗电
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 }
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
    lastPosRef.timestamp = 0;
    preciseLocatedRef.value = false;
    globalInitStarted = false;
    initLocation().finally(() => setLoading(false));
  }, []);

  return { location, error, loading, update };
}
