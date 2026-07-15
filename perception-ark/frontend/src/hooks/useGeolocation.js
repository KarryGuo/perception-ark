import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../services/api.js';
import { loadAmapSDK } from '../services/amap.js';

/**
 * 通过高德 AMap.Geolocation 插件定位
 * 综合使用 GPS / 基站 / IP,且自动做 WGS84→GCJ02 坐标转换,
 * 比浏览器原生 navigator.geolocation 在桌面端更准确
 */
/**
 * 方式1: 高德 Geolocation - GPS/基站定位(最精确,移动端首选)
 * 使用 GeoLocation 优先策略,提高定位精度
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
 * 方式2: 浏览器原生高精度定位(手机GPS,精度最高)
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
 * 方式3: AMap.CitySearch - IP定位(快速兜底,城市级精度)
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
 * 方式4: 浏览器原生定位(低精度兜底)
 */
function locateByBrowser() {
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
        source: 'browser'
      }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
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
 * 应用位置并异步获取详细地址
 */
function useLocationSetter(setLocation, lastLatRef, lastLngRef) {
  return useCallback(async (pos) => {
    // 先用坐标设置位置(地图可以立即显示)
    setLocation({
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      address: `${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`,
      source: pos.source,
      province: pos.province || '',
      city: pos.city || ''
    });
    lastLatRef.current = pos.lat;
    lastLngRef.current = pos.lng;

    // 异步调用后端逆地理编码获取真实地址(含省市区)
    try {
      const geo = await reverseGeocode(pos.lat, pos.lng);
      if (geo) {
        setLocation({
          lat: pos.lat,
          lng: pos.lng,
          accuracy: pos.accuracy,
          source: pos.source,
          address: geo.address,
          province: geo.province,
          city: geo.city,
          district: geo.district,
          weather: geo.weather
        });
        console.log('[Geo] 逆地理编码成功:', geo.province, geo.city, geo.district, geo.address);
      }
    } catch (err) {
      console.warn('[Geo] 逆地理编码失败,保持坐标地址:', err.message);
    }
  }, [setLocation]);
}

/**
 * 地理位置 Hook
 *
 * 定位策略(精度优先,并行竞速):
 * 1. 同时发起: AMap.Geolocation(GPS/基站) + 浏览器原生GPS + AMap.CitySearch(IP)
 * 2. IP最快返回(1-2秒,城市级±10km) → 立即应用作为初始位置
 * 3. GPS成功返回(5-10秒,街道级±50m) → 替换为精确位置
 * 4. 浏览器GPS作为补充(精度可能更高)
 * 5. 持续watchPosition追踪移动
 */
export function useGeolocation() {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const watchIdRef = useRef(null);
  const watchGeoRef = useRef(null);
  const browserWatchIdRef = useRef(null);
  const lastLatRef = useRef(null);
  const lastLngRef = useRef(null);
  const preciseLocatedRef = useRef(false);
  const bestAccuracyRef = useRef(Infinity); // 记录最佳精度,只接受更精确的更新

  const applyLocation = useLocationSetter(setLocation, lastLatRef, lastLngRef);

  const applyIfBetter = useCallback(async (pos) => {
    // 只接受精度更高的定位结果
    if (pos.accuracy < bestAccuracyRef.current) {
      bestAccuracyRef.current = pos.accuracy;
      await applyLocation(pos);
      if (pos.accuracy < 1000) {
        preciseLocatedRef.current = true;
      }
    }
  }, [applyLocation]);

  const update = useCallback(() => {
    if (loading) return;
    setLoading(true);
    setError(null);
    bestAccuracyRef.current = Infinity;

    (async () => {
      // 策略: IP定位先返回作为初始位置, GPS在后台异步替换为精确位置
      const tasks = [];

      // Task 1: AMap.Geolocation (GPS/基站, 5-10秒, ±50m)
      tasks.push(
        locateByAmapGeo()
          .then(async (pos) => {
            console.log('[Geo] AMap GPS定位成功:', pos);
            await applyIfBetter(pos);
          })
          .catch(err => console.warn('[Geo] AMap GPS失败:', err.message))
      );

      // Task 2: 浏览器原生高精度GPS (移动端最佳精度)
      tasks.push(
        locateByBrowserHigh()
          .then(async (pos) => {
            console.log('[Geo] 浏览器GPS定位成功:', pos);
            await applyIfBetter(pos);
          })
          .catch(err => console.warn('[Geo] 浏览器GPS失败:', err.message))
      );

      // Task 3: CitySearch IP定位 (1-2秒, ±10km, 快速兜底)
      tasks.push(
        locateByCitySearch()
          .then(async (pos) => {
            console.log('[Geo] IP定位成功:', pos);
            await applyIfBetter(pos);
          })
          .catch(err => console.warn('[Geo] IP定位失败:', err.message))
      );

      // 等待所有任务完成(最快1-2秒,最慢10秒)
      await Promise.allSettled(tasks);

      // 如果所有方式都失败,尝试低精度浏览器定位
      if (!preciseLocatedRef.current && !lastLatRef.current) {
        try {
          const pos = await locateByBrowser();
          console.log('[Geo] 浏览器低精度定位:', pos);
          await applyLocation(pos);
        } catch (err) {
          console.error('[Geo] 所有定位方式均失败:', err.message);
          setError(err.message);
        }
      }
      setLoading(false);
    })();
  }, [loading, applyLocation, applyIfBetter]);

  // 持续监听位置变化(双源watchPosition,提升移动场景精度)
  useEffect(() => {
    update();

    let cancelled = false;

    // Source 1: AMap.Geolocation watchPosition
    loadAmapSDK()
      .then((AMap) => {
        if (cancelled || !AMap.Geolocation) return;
        const geo = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
          convert: true
        });
        watchGeoRef.current = geo;
        watchIdRef.current = geo.watchPosition((status, result) => {
          if (status === 'complete') {
            const lat = result.position.getLat();
            const lng = result.position.getLng();
            const accuracy = result.accuracy || 50;
            // 抖动过滤: 移动距离<5米视为抖动
            if (lastLatRef.current !== null) {
              const dLat = lat - lastLatRef.current;
              const dLng = lng - lastLngRef.current;
              const moved = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
              if (moved < 5) return;
            }
            lastLatRef.current = lat;
            lastLngRef.current = lng;
            preciseLocatedRef.current = true;
            bestAccuracyRef.current = Math.min(bestAccuracyRef.current, accuracy);
            setLocation((prev) => prev ? ({
              ...prev,
              lat, lng,
              accuracy,
              source: 'amap-watch'
            }) : null);
          }
        });
      })
      .catch(() => {});

    // Source 2: 浏览器原生watchPosition (移动端GPS精度更高)
    if (navigator.geolocation) {
      browserWatchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return;
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy || 100;
          // 抖动过滤
          if (lastLatRef.current !== null) {
            const dLat = lat - lastLatRef.current;
            const dLng = lng - lastLngRef.current;
            const moved = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
            if (moved < 5) return;
          }
          lastLatRef.current = lat;
          lastLngRef.current = lng;
          preciseLocatedRef.current = true;
          // 只接受更高精度的更新
          if (accuracy < bestAccuracyRef.current) {
            bestAccuracyRef.current = accuracy;
            setLocation((prev) => prev ? ({
              ...prev,
              lat, lng,
              accuracy,
              source: 'browser-watch'
            }) : null);
            console.log('[Geo] 浏览器watch更新:', lat.toFixed(5), lng.toFixed(5), '±' + accuracy.toFixed(0) + 'm');
          }
        },
        (err) => {
          // 静默处理watch错误
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    }

    return () => {
      cancelled = true;
      if (watchIdRef.current && watchGeoRef.current) {
        try { watchGeoRef.current.clearWatch(watchIdRef.current); } catch (e) {}
      }
      if (browserWatchIdRef.current) {
        try { navigator.geolocation.clearWatch(browserWatchIdRef.current); } catch (e) {}
      }
      watchIdRef.current = null;
      watchGeoRef.current = null;
      browserWatchIdRef.current = null;
    };
  }, [update]);

  return { location, error, loading, update };
}
