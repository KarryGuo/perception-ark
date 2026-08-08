import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentPosition as amapGetCurrentPosition, reverseGeocode, IS_KEY_VALID } from '../services/amap.js';

/**
 * 地理位置Hook
 * 定位优先级: 高德SDK定位 → 浏览器原生定位
 * 不再使用MOCK虚拟定位，需要配置高德Key或授予浏览器定位权限
 */
export function useGeolocation() {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const watchIdRef = useRef(null);
  const locationRef = useRef(null);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const requestLocation = useCallback(async (showLoading = true) => {
    if (showLoading) setLocating(true);
    setError(null);

    let result = null;
    let lastError = null;

    // 1. 优先使用高德SDK定位（如果Key已配置）
    if (IS_KEY_VALID) {
      try {
        result = await amapGetCurrentPosition();
        console.log('[Geo] 高德定位成功:', result.lat.toFixed(5), result.lng.toFixed(5));
      } catch (err) {
        console.warn('[Geo] 高德定位失败:', err.message);
        lastError = err;
      }
    }

    // 2. 降级使用浏览器原生定位
    if (!result && navigator.geolocation) {
      try {
        result = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                address: '',
                source: 'browser'
              });
            },
            (err) => {
              let msg = '浏览器定位失败';
              switch (err.code) {
                case 1: msg = '定位权限被拒绝，请在设置中允许位置访问'; break;
                case 2: msg = '位置信息不可用，请检查设备GPS'; break;
                case 3: msg = '定位超时，请重试'; break;
              }
              reject(new Error(msg));
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
          );
        });
        console.log('[Geo] 浏览器定位成功:', result.lat.toFixed(5), result.lng.toFixed(5));
      } catch (err) {
        console.warn('[Geo] 浏览器定位失败:', err.message);
        lastError = err;
      }
    }

    if (result) {
      // 逆地理编码获取地址
      if (!result.address && IS_KEY_VALID) {
        try {
          const addr = await reverseGeocode(result.lat, result.lng);
          result.address = addr;
        } catch (e) {
          console.warn('[Geo] 逆地理编码失败:', e.message);
        }
      }
      setLocation(result);
      if (showLoading) setLocating(false);
      setLoading(false);
      return result;
    } else {
      const errMsg = lastError?.message || '无法获取位置，请检查定位权限或网络';
      setError(errMsg);
      if (showLoading) setLocating(false);
      setLoading(false);
      return null;
    }
  }, []);

  // 持续监听位置变化
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('您的浏览器不支持地理定位');
      setLoading(false);
      return;
    }

    // 首次定位
    requestLocation(true);

    // 持续监听
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const newLoc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          address: locationRef.current?.address || '',
          source: 'browser-watch'
        };
        
        // 如果地址为空且高德Key可用，尝试逆地理编码
        if (!newLoc.address && IS_KEY_VALID) {
          try {
            newLoc.address = await reverseGeocode(newLoc.lat, newLoc.lng);
          } catch (e) {}
        }
        
        setLocation(newLoc);
        setError(null);
        setLoading(false);
      },
      (err) => {
        // 监听错误不覆盖已有位置
        if (!locationRef.current) {
          let msg = '定位失败';
          switch (err.code) {
            case 1: msg = '定位权限被拒绝'; break;
            case 2: msg = '位置不可用'; break;
            case 3: msg = '定位超时'; break;
          }
          setError(msg);
          setLoading(false);
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [requestLocation]);

  return {
    location,
    error,
    loading,
    locating,
    refresh: () => requestLocation(true),
    isKeyConfigured: IS_KEY_VALID
  };
}
