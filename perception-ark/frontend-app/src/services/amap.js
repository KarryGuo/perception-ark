/**
 * 高德地图 JS SDK 统一加载管理
 * 接入真实高德地图API，支持定位、逆地理编码、POI搜索、路径规划
 */
const AMAP_JS_KEY = (import.meta.env.VITE_AMAP_JS_KEY || '').trim();
const AMAP_SECURITY_CODE = (import.meta.env.VITE_AMAP_SECURITY_CODE || '').trim();

const IS_KEY_VALID = AMAP_JS_KEY.length > 0 &&
  !AMAP_JS_KEY.includes('your_') &&
  !AMAP_JS_KEY.includes('YOUR_') &&
  !AMAP_JS_KEY.includes('请填写') &&
  AMAP_JS_KEY !== 'undefined' &&
  AMAP_JS_KEY !== 'null';

let sdkLoadPromise = null;

export function loadAmapSDK(plugins = []) {
  if (!IS_KEY_VALID) {
    return Promise.reject(new Error('请配置高德地图API Key'));
  }

  if (window.AMap && window.AMap.Map) return Promise.resolve(window.AMap);
  if (sdkLoadPromise) return sdkLoadPromise;

  const defaultPlugins = [
    'AMap.Geolocation',
    'AMap.Geocoder',
    'AMap.PlaceSearch',
    'AMap.Walking'
  ];
  const allPlugins = [...new Set([...defaultPlugins, ...plugins])];

  sdkLoadPromise = new Promise((resolve, reject) => {
    if (AMAP_SECURITY_CODE) {
      window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
    }
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_JS_KEY}&plugin=${allPlugins.join(',')}`;
    script.async = true;
    script.onload = () => {
      let attempts = 0;
      const checkReady = () => {
        attempts++;
        if (window.AMap && window.AMap.Map) {
          resolve(window.AMap);
        } else if (attempts < 30) {
          setTimeout(checkReady, 100);
        } else {
          reject(new Error('高德地图SDK初始化超时'));
        }
      };
      checkReady();
    };
    script.onerror = () => reject(new Error('高德地图SDK加载失败，请检查网络或Key配置'));
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

/**
 * 使用高德地图进行定位
 * @returns {Promise<{lat: number, lng: number, address: string, accuracy: number}>}
 */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    loadAmapSDK()
      .then((AMap) => {
        const geolocation = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
          buttonPosition: 'RB',
          zoomToAccuracy: false,
          showButton: false,
          showMarker: false,
          showCircle: false
        });

        geolocation.getCurrentPosition((status, result) => {
          if (status === 'complete') {
            resolve({
              lat: result.position.lat,
              lng: result.position.lng,
              address: result.formattedAddress || '',
              accuracy: result.accuracy || 100,
              source: 'amap'
            });
          } else {
            reject(new Error(result.message || '定位失败'));
          }
        });
      })
      .catch(reject);
  });
}

/**
 * 逆地理编码：坐标转地址
 */
export function reverseGeocode(lat, lng) {
  return new Promise((resolve, reject) => {
    loadAmapSDK()
      .then((AMap) => {
        const geocoder = new AMap.Geocoder();
        geocoder.getAddress([lng, lat], (status, result) => {
          if (status === 'complete' && result.regeocode) {
            resolve(result.regeocode.formattedAddress || '');
          } else {
            reject(new Error('逆地理编码失败'));
          }
        });
      })
      .catch(reject);
  });
}

/**
 * POI搜索
 */
export function searchPOI(keyword, city = '全国') {
  return new Promise((resolve, reject) => {
    loadAmapSDK()
      .then((AMap) => {
        const placeSearch = new AMap.PlaceSearch({
          pageSize: 10,
          pageIndex: 1,
          city: city,
          citylimit: false
        });
        placeSearch.search(keyword, (status, result) => {
          if (status === 'complete' && result.poiList) {
            resolve(result.poiList.pois.map(poi => ({
              id: poi.id,
              name: poi.name,
              address: poi.address,
              lat: poi.location.lat,
              lng: poi.location.lng,
              distance: poi.distance
            })));
          } else {
            resolve([]);
          }
        });
      })
      .catch(reject);
  });
}

/**
 * 步行路径规划
 */
export function planWalkingRoute(startLat, startLng, endLat, endLng) {
  return new Promise((resolve, reject) => {
    loadAmapSDK()
      .then((AMap) => {
        const walking = new AMap.Walking({
          map: null,
          panel: false
        });
        walking.search(
          new AMap.LngLat(startLng, startLat),
          new AMap.LngLat(endLng, endLat),
          (status, result) => {
            if (status === 'complete' && result.routes && result.routes.length > 0) {
              const route = result.routes[0];
              const steps = route.steps.map((step, i) => ({
                instruction: step.instruction,
                distance: step.distance,
                duration: Math.ceil(step.time / 60),
                step: i + 1,
                polyline: step.path
              }));
              
              const allPaths = [];
              steps.forEach(s => {
                if (s.polyline) {
                  s.polyline.forEach(p => allPaths.push([p.lng, p.lat]));
                }
              });
              
              resolve({
                distance: route.distance,
                duration: Math.ceil(route.time / 60),
                steps,
                polyline: allPaths
              });
            } else {
              reject(new Error('路径规划失败'));
            }
          }
        );
      })
      .catch(reject);
  });
}

export { AMAP_JS_KEY, AMAP_SECURITY_CODE, IS_KEY_VALID };
