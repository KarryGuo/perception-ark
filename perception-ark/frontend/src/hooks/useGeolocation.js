import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../services/api.js';
import { loadAmapSDK } from '../services/amap.js';

/**
 * 通过高德 AMap.Geolocation 插件定位
 * 综合使用 GPS / 基站 / IP,且自动做 WGS84→GCJ02 坐标转换,
 * 比浏览器原生 navigator.geolocation 在桌面端更准确
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
            // CitySearch 返回城市中心和 bounds,精度为城市级
            const center = result.bounds.getCenter();
            resolve({
              lat: center.getLat(),
              lng: center.getLng(),
              accuracy: 10000, // 城市级精度
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
 * 方式2: 高德 Geolocation - GPS/基站定位(更精确,桌面端可能超时)
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
 * 方式3: 浏览器原生定位(最后兜底)
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
 * 定位策略(三级降级,确保桌面端不超时):
 * 1. AMap.CitySearch  - IP快速定位(1-2秒,城市级,不依赖浏览器权限,不会超时)
 * 2. AMap.Geolocation - GPS/基站定位(更精确,桌面端可能超时)
 * 3. 浏览器原生定位   - 最后兜底
 *
 * 先用IP定位快速拿到大致位置(地图+播报立即可用),
 * 同时后台尝试GPS精确定位,成功则替换为精确坐标。
 */
export function useGeolocation() {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const watchIdRef = useRef(null);
  const watchGeoRef = useRef(null); // 保存创建watchPosition的Geolocation实例,清理时需用同一实例
  const lastLatRef = useRef(null);
  const lastLngRef = useRef(null);
  const preciseLocatedRef = useRef(false); // 是否已获得精确定位

  const applyLocation = useLocationSetter(setLocation, lastLatRef, lastLngRef);

  const update = useCallback(() => {
    if (loading) return;
    setLoading(true);
    setError(null);

    (async () => {
      let pos = null;

      // 1. 优先 CitySearch IP定位(快速,不超时,桌面端首选)
      try {
        pos = await locateByCitySearch();
        console.log('[Geo] IP定位成功(城市级):', pos);
      } catch (ipErr) {
        console.warn('[Geo] IP定位失败:', ipErr.message);
      }

      if (pos) {
        // IP定位成功,立即应用(地图+播报立即可用)
        await applyLocation(pos);
        setLoading(false);

        // 后台尝试 GPS 精确定位(不阻塞UI)
        if (!preciseLocatedRef.current) {
          locateByAmapGeo()
            .then(async (precisePos) => {
              console.log('[Geo] GPS精确定位成功,替换IP定位:', precisePos);
              preciseLocatedRef.current = true;
              await applyLocation(precisePos);
            })
            .catch((err) => {
              console.warn('[Geo] GPS精确定位失败,保持IP定位结果:', err.message);
            });
        }
        return;
      }

      // 2. IP定位失败,尝试浏览器原生定位(最后兜底)
      try {
        pos = await locateByBrowser();
        console.log('[Geo] 浏览器定位成功:', pos);
        await applyLocation(pos);
      } catch (browserErr) {
        console.error('[Geo] 所有定位方式均失败:', browserErr.message);
        setError(browserErr.message);
      }
      setLoading(false);
    })();
  }, [loading, applyLocation]);

  // 持续监听位置变化(适配移动场景,提升定位精度)
  useEffect(() => {
    update();

    let cancelled = false;
    loadAmapSDK()
      .then((AMap) => {
        if (cancelled || !AMap.Geolocation) return;
        const geo = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
          convert: true
        });
        watchGeoRef.current = geo; // 保存实例供cleanup使用
        watchIdRef.current = geo.watchPosition((status, result) => {
          if (status === 'complete') {
            const lat = result.position.getLat();
            const lng = result.position.getLng();
            if (lastLatRef.current !== null) {
              const dLat = lat - lastLatRef.current;
              const dLng = lng - lastLngRef.current;
              const moved = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
              if (moved < 10) return;
            }
            lastLatRef.current = lat;
            lastLngRef.current = lng;
            preciseLocatedRef.current = true;
            setLocation((prev) => prev ? ({
              ...prev,
              lat, lng,
              accuracy: result.accuracy || prev.accuracy,
              source: 'amap-watch'
            }) : null);
          }
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      // 用创建watch的同一实例清除监听
      if (watchIdRef.current && watchGeoRef.current) {
        try { watchGeoRef.current.clearWatch(watchIdRef.current); } catch (e) {}
      }
      watchIdRef.current = null;
      watchGeoRef.current = null;
    };
  }, [update]);

  return { location, error, loading, update };
}
