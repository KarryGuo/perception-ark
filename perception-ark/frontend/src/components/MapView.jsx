import { useEffect, useRef, useState } from 'react';
import { loadAmapSDK, AMAP_JS_KEY } from '../services/amap.js';

/**
 * 高德地图展示组件
 * - 自动定位用户位置
 * - 显示坐标、地址
 * - 接收路径规划结果时绘制路线
 * - 导航视角(navMode): 跟随朝向旋转+放大+居中,类似高德步行导航
 */
export default function MapView({ location, route, pois, className, navMode, heading, navInfo }) {
  const containerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const routePolylineRef = useRef(null);
  const poiMarkersRef = useRef([]);
  const [status, setStatus] = useState('loading');
  const [addr, setAddr] = useState('');

  // 导航模式状态跟踪(避免频繁切换地图参数)
  const navModeRef = useRef(false);
  const lastHeadingRef = useRef(null);

  // 初始化地图
  useEffect(() => {
    if (!AMAP_JS_KEY) {
      setStatus('nokey');
      return;
    }
    let cancelled = false;
    loadAmapSDK()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return;
        mapInstanceRef.current = new AMap.Map(containerRef.current, {
          zoom: 17,
          mapStyle: 'amap://styles/dark',
          viewMode: '3D',
          pitch: 45,
          rotation: -15,
          features: ['bg', 'road', 'building', 'point'],
          showLabel: true,
          expandZoomRange: true,
          zooms: [3, 20]
        });
        setStatus('ready');
        // 延迟触发resize,确保容器尺寸已就绪(全屏沉浸式布局需要)
        setTimeout(() => {
          if (mapInstanceRef.current) {
            try { mapInstanceRef.current.resize(); } catch(e) {}
          }
        }, 200);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[MapView]', err);
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
      // 卸载时销毁地图实例,避免内存泄漏
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.destroy(); } catch (e) {}
        mapInstanceRef.current = null;
        markerRef.current = null;
        routePolylineRef.current = null;
      }
    };
  }, []);

  // 导航视角切换: 进入navMode时调整地图参数,退出时恢复
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance) return;
    if (navMode && !navModeRef.current) {
      // 进入导航视角: 放大+增大俯视角度
      navModeRef.current = true;
      try {
        mapInstance.setZoom(19);
        mapInstance.setPitch(60);
      } catch(e) {}
    } else if (!navMode && navModeRef.current) {
      // 退出导航视角: 恢复默认
      navModeRef.current = false;
      try {
        mapInstance.setZoom(17);
        mapInstance.setPitch(45);
        mapInstance.setRotation(-15);
      } catch(e) {}
    }
  }, [navMode]);

  // 导航视角: 跟随用户朝向旋转地图(heading变化>5°才更新,防止抖动)
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !navMode || heading == null) return;
    if (lastHeadingRef.current != null) {
      const diff = Math.abs(heading - lastHeadingRef.current);
      const minDiff = Math.min(diff, 360 - diff);
      if (minDiff < 5) return; // 小于5°不更新
    }
    lastHeadingRef.current = heading;
    try {
      mapInstance.setRotation(heading);
    } catch(e) {}
  }, [heading, navMode]);

  // 位置变化时更新标记和中心点
  // 导航视角: marker使用方向箭头,每次位置变化都setCenter(紧随用户)
  // 普通模式: marker用绿色圆点,setCenter有阈值过滤(防抖动)
  const lastCenterRef = useRef(null);
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !location?.lat || !location?.lng) return;
    const AMap = window.AMap;
    if (!AMap) return;

    const lnglat = new AMap.LngLat(location.lng, location.lat);

    // 导航视角: 替换为方向箭头marker(每次进入navMode重建)
    if (navModeRef.current) {
      // 移除旧marker,创建方向箭头
      if (markerRef.current) {
        try { mapInstance.remove(markerRef.current); } catch(e) {}
        markerRef.current = null;
      }
      // 方向箭头(屏幕固定向上,配合地图旋转=用户朝向)
      markerRef.current = new AMap.Marker({
        position: lnglat,
        content: '<div style="width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-bottom:28px solid #00FFA3;filter:drop-shadow(0 0 10px #00FFA3) drop-shadow(0 0 3px #fff);margin-top:-14px;"></div>',
        anchor: 'bottom-center',
        offset: new AMap.Pixel(0, 0)
      });
      mapInstance.add(markerRef.current);
      // 导航视角: 每次都setCenter(紧随用户位置)
      mapInstance.setCenter(lnglat);
    } else {
      // 普通模式: 绿色圆点marker
      if (markerRef.current) {
        // 检查是否已是绿色圆点(从navMode切换回来时需要重建)
        const isArrow = markerRef.current.getContent && markerRef.current.getContent().includes('border-bottom');
        if (isArrow) {
          try { mapInstance.remove(markerRef.current); } catch(e) {}
          markerRef.current = null;
        }
      }
      if (markerRef.current) {
        markerRef.current.setPosition(lnglat);
      } else {
        markerRef.current = new AMap.Marker({
          position: lnglat,
          content: '<div style="width:18px;height:18px;border-radius:50%;background:#00FFA3;box-shadow:0 0 16px #00FFA3,0 0 4px #fff;border:3px solid #fff;"></div>',
          anchor: 'center'
        });
        mapInstance.add(markerRef.current);
      }

      // setCenter有阈值过滤(10米,防止GPS抖动导致地图频繁跳动)
      if (lastCenterRef.current) {
        const dLat = location.lat - lastCenterRef.current.lat;
        const dLng = location.lng - lastCenterRef.current.lng;
        const moved = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
        if (moved >= 10) {
          lastCenterRef.current = { lat: location.lat, lng: location.lng };
          mapInstance.setCenter(lnglat);
        }
      } else {
        lastCenterRef.current = { lat: location.lat, lng: location.lng };
        mapInstance.setCenter(lnglat);
      }
    }

    if (location.address) setAddr(location.address);
  }, [location?.lat, location?.lng, navMode]);

  // 路径规划结果绘制
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !window.AMap) return;
    if (routePolylineRef.current) {
      mapInstance.remove(routePolylineRef.current);
      routePolylineRef.current = null;
    }
    if (route && route.length > 1) {
      const AMap = window.AMap;
      const path = route.map(p => new AMap.LngLat(p[0], p[1]));
      routePolylineRef.current = new AMap.Polyline({
        path,
        strokeColor: '#00FFA3',
        strokeWeight: 6,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
        showDir: true // 显示路线方向箭头
      });
      mapInstance.add(routePolylineRef.current);
      // 导航视角不自动fitView(保持跟随用户的放大视图)
      if (!navModeRef.current) {
        mapInstance.setFitView([routePolylineRef.current], false, [80, 80, 80, 80]);
      }
    }
  }, [route]);

  // POI列表标记绘制(附近搜索结果)
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !window.AMap) return;
    // 清除旧标记
    poiMarkersRef.current.forEach(m => { try { mapInstance.remove(m); } catch(e){} });
    poiMarkersRef.current = [];

    if (pois && pois.length > 0) {
      const AMap = window.AMap;
      const colors = ['#FFB627', '#00FFA3', '#7B61FF', '#FF2E7E', '#00E5FF'];
      pois.forEach((poi, i) => {
        const color = colors[i % colors.length];
        const marker = new AMap.Marker({
          position: new AMap.LngLat(poi.lng, poi.lat),
          content: `<div style="display:flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(8,11,20,0.9);border:1px solid ${color};border-radius:20px;color:${color};font-size:12px;font-weight:600;white-space:nowrap;backdrop-filter:blur(8px);box-shadow:0 2px 8px rgba(0,0,0,0.4);">${i+1}. ${poi.name}</div>`,
          anchor: 'bottom-center',
          offset: new AMap.Pixel(0, -4)
        });
        mapInstance.add(marker);
        poiMarkersRef.current.push(marker);
      });
      // 自动缩放显示所有标记
      mapInstance.setFitView(poiMarkersRef.current, false, [60, 60, 60, 60]);
    }
  }, [pois]);

  // 导航信息卡片(转弯预告+距离+朝向)
  const maneuverIcon = (instruction) => {
    if (!instruction) return '🧭';
    if (/左转|向左/.test(instruction)) return '⬅️';
    if (/右转|向右/.test(instruction)) return '➡️';
    if (/掉头|转身/.test(instruction)) return '🔄';
    if (/直行|继续|前行/.test(instruction)) return '⬆️';
    if (/到达|目的地/.test(instruction)) return '🏁';
    return '🧭';
  };

  return (
    <div className={`map-view ${className || ''} ${navMode ? 'nav-mode' : ''}`}>
      <div className="map-container" ref={containerRef}></div>

      {status === 'loading' && (
        <div className="map-overlay-info"><span className="map-spinner"></span>地图加载中...</div>
      )}
      {status === 'nokey' && (
        <div className="map-overlay-info map-fallback">
          <div className="mf-icon">🗺️</div>
          <div className="mf-title">地图展示模式</div>
          <div className="mf-tip">
            {location
              ? `${location.lat?.toFixed(4) || '--'}, ${location.lng?.toFixed(4) || '--'}`
              : '正在定位...'}
          </div>
          {addr && <div className="mf-addr">{addr}</div>}
          <div className="mf-hint">配置 VITE_AMAP_JS_KEY 后显示真实地图</div>
        </div>
      )}
      {status === 'error' && (
        <div className="map-overlay-info map-fallback">
          <div className="mf-icon">⚠️</div>
          <div className="mf-title">地图加载失败</div>
          <div className="mf-tip">请检查网络或API Key</div>
        </div>
      )}

      {location && status === 'ready' && !navMode && (
        <div className="map-coord-badge">
          <span className="mc-dot"></span>
          <span>{location.lat?.toFixed(5)}, {location.lng?.toFixed(5)}</span>
        </div>
      )}

      {/* 导航视角信息卡片: 转弯方向+距离+朝向偏差 */}
      {navMode && navInfo && status === 'ready' && (
        <div className="map-nav-card" role="status" aria-live="polite">
          <div className="mnc-main">
            <span className="mnc-icon">{maneuverIcon(navInfo.nextManeuverInstruction)}</span>
            <div className="mnc-info">
              {navInfo.distanceToNextManeuver != null && (
                <div className="mnc-distance">
                  {navInfo.distanceToNextManeuver < 1000
                    ? `${navInfo.distanceToNextManeuver}米`
                    : `${(navInfo.distanceToNextManeuver / 1000).toFixed(1)}公里`}
                </div>
              )}
              <div className="mnc-instruction">
                {navInfo.nextManeuverInstruction || navInfo.currentInstruction || '沿路线前行'}
              </div>
            </div>
          </div>
          {navInfo.destination && (
            <div className="mnc-dest">🧭 目的地: {navInfo.destination}</div>
          )}
          <div className="mnc-meta">
            {navInfo.heading != null && (
              <span className={`mnc-chip ${navInfo.headingDeviation > 60 ? 'warn' : ''}`}>
                🧭 朝向{headingToDir(navInfo.heading)}
                {navInfo.headingDeviation != null && navInfo.headingDeviation > 60 && ` ⚠偏差${navInfo.headingDeviation}°`}
              </span>
            )}
            {navInfo.offRoute && <span className="mnc-chip danger">⚠ 已偏离路线</span>}
            {navInfo.remainingDistance != null && (
              <span className="mnc-chip">剩余{navInfo.remainingDistance < 1000 ? `${navInfo.remainingDistance}米` : `${(navInfo.remainingDistance / 1000).toFixed(1)}公里`}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 方位角→中文方向(与useNavigation一致)
function headingToDir(heading) {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const idx = Math.round(heading / 45) % 8;
  return dirs[idx];
}
