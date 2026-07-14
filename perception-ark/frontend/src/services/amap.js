/**
 * 高德地图 JS SDK 统一加载管理
 * 全局共享同一个加载Promise,避免重复加载
 */
const AMAP_JS_KEY = import.meta.env.VITE_AMAP_JS_KEY || '';
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE || '';

let sdkLoadPromise = null;

export function loadAmapSDK() {
  if (window.AMap && window.AMap.Map) return Promise.resolve(window.AMap);
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise((resolve, reject) => {
    if (AMAP_SECURITY_CODE) {
      window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
    }
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_JS_KEY}&plugin=AMap.Geolocation,AMap.CitySearch`;
    script.async = true;
    script.onload = () => {
      let attempts = 0;
      const checkReady = () => {
        attempts++;
        if (window.AMap && window.AMap.Map) {
          resolve(window.AMap);
        } else if (attempts < 20) {
          setTimeout(checkReady, 100);
        } else {
          reject(new Error('高德地图JS SDK初始化超时'));
        }
      };
      checkReady();
    };
    script.onerror = () => reject(new Error('高德地图JS SDK加载失败'));
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

export { AMAP_JS_KEY, AMAP_SECURITY_CODE };
