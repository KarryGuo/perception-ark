import { useEffect, useRef, useState } from 'react';
import { loadAmapSDK, AMAP_JS_KEY } from '../services/amap.js';

/**
 * 高德地图展示组件
 * - 自动定位用户位置
 * - 显示坐标、地址
 * - 接收路径规划结果时绘制路线
 */
export default function MapView({ location, route, pois, className }) {
  const containerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const routePolylineRef = useRef(null);
  const poiMarkersRef = useRef([]);
  const [status, setStatus] = useState('loading');
  const [addr, setAddr] = useState('');

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

  // 位置变化时更新中心点和标记
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !location?.lat || !location?.lng) return;
    const AMap = window.AMap;
    if (!AMap) return;

    const lnglat = new AMap.LngLat(location.lng, location.lat);
    mapInstance.setCenter(lnglat);

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

    if (location.address) setAddr(location.address);
  }, [location]);

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
        strokeWeight: 5,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
      });
      mapInstance.add(routePolylineRef.current);
      mapInstance.setFitView([routePolylineRef.current], false, [80, 80, 80, 80]);
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

  return (
    <div className={`map-view ${className || ''}`}>
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

      {location && status === 'ready' && (
        <div className="map-coord-badge">
          <span className="mc-dot"></span>
          <span>{location.lat?.toFixed(5)}, {location.lng?.toFixed(5)}</span>
        </div>
      )}
    </div>
  );
}
