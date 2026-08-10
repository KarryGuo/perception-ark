import { useEffect, useRef, useState } from 'react';
import { loadAmapSDK, AMAP_JS_KEY } from '../services/amap.js';

/**
 * 家属端实时位置小地图
 * - 显示视障人员实时位置(精确坐标)
 * - 自动居中跟随
 * - 轨迹历史(可选)
 * - 状态指示(在线/离线/活动状态)
 */
export default function FamilyMap({ location, activity, online }) {
  const containerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const [status, setStatus] = useState('loading');

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
          zoom: 16,
          mapStyle: 'amap://styles/dark',
          viewMode: '2D',
          features: ['bg', 'road', 'building', 'point'],
          showLabel: true
        });
        setStatus('ready');
        setTimeout(() => {
          if (mapInstanceRef.current) {
            try { mapInstanceRef.current.resize(); } catch(e) {}
          }
        }, 200);
      })
      .catch(() => setStatus('error'));
    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.destroy(); } catch(e) {}
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 位置变化时更新标记
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !window.AMap) return;
    if (!location?.lat || !location?.lng) return;

    const AMap = window.AMap;
    const lnglat = new AMap.LngLat(location.lng, location.lat);

    // 活动状态对应的marker颜色
    const activityColors = {
      walking: '#00FFA3',     // 行走中-绿色
      navigating: '#00E5FF',  // 导航中-青色
      fallen: '#FF2E7E',      // 跌倒-红色
      idle: '#FFB627',        // 待机-橙色
      waiting: '#FFB627',
      reading: '#7B61FF'      // 阅读中-紫色
    };
    const color = activityColors[activity] || '#00FFA3';
    const isEmergency = activity === 'fallen';
    const pulseRadius = isEmergency ? 22 : 14;

    // 移除旧marker,创建新marker
    if (markerRef.current) {
      try { mapInstance.remove(markerRef.current); } catch(e) {}
    }
    markerRef.current = new AMap.Marker({
      position: lnglat,
      content: `<div style="position:relative;width:40px;height:40px;">
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:${pulseRadius*2}px;height:${pulseRadius*2}px;border-radius:50%;background:${color};opacity:0.2;animation:famPulse 2s ease-out infinite;"></div>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:${color};box-shadow:0 0 12px ${color},0 0 3px #fff;border:2px solid #fff;"></div>
      </div>`,
      anchor: 'center',
      offset: new AMap.Pixel(0, 0)
    });
    mapInstance.add(markerRef.current);

    // 精度圈(模拟GPS精度)
    if (accuracyCircleRef.current) {
      try { mapInstance.remove(accuracyCircleRef.current); } catch(e) {}
    }
    accuracyCircleRef.current = new AMap.Circle({
      center: lnglat,
      radius: 30,
      strokeColor: color,
      strokeWeight: 1,
      strokeOpacity: 0.4,
      fillColor: color,
      fillOpacity: 0.08
    });
    mapInstance.add(accuracyCircleRef.current);

    // 居中
    mapInstance.setCenter(lnglat);

    // 注入脉冲动画CSS(仅一次)
    if (!document.getElementById('fam-map-pulse')) {
      const style = document.createElement('style');
      style.id = 'fam-map-pulse';
      style.textContent = `@keyframes famPulse { 0%{transform:translate(-50%,-50%) scale(0.6);opacity:0.6} 100%{transform:translate(-50%,-50%) scale(1.4);opacity:0} }`;
      document.head.appendChild(style);
    }
  }, [location?.lat, location?.lng, activity]);

  // 组件UI
  if (status === 'loading') {
    return (
      <div className="fam-map-container">
        <div className="fam-map-loading">
          <span className="fam-map-spinner"></span>
          <span>地图加载中...</span>
        </div>
      </div>
    );
  }

  if (status === 'nokey' || status === 'error') {
    // 降级显示: 文字+外链
    return (
      <div className="fam-map-container fam-map-fallback">
        <div className="fam-map-fallback-icon">📍</div>
        <div className="fam-map-fallback-addr">{location?.address || '等待定位...'}</div>
        {location?.lat && location?.lng && (
          <div className="fam-map-fallback-coord">
            {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
          </div>
        )}
        {location?.lat && location?.lng && (
          <a
            href={`https://uri.amap.com/marker?position=${location.lng},${location.lat}&name=被守护人位置`}
            target="_blank" rel="noopener noreferrer"
            className="fam-map-fallback-link"
          >🗺️ 在高德地图中查看</a>
        )}
      </div>
    );
  }

  return (
    <div className="fam-map-container">
      <div className="fam-map-canvas" ref={containerRef}></div>
      {/* 状态徽章 */}
      <div className={`fam-map-status ${online ? 'online' : 'offline'} ${activity === 'fallen' ? 'emergency' : ''}`}>
        <span className="fam-map-status-dot"></span>
        <span className="fam-map-status-text">
          {activity === 'fallen' ? '⚠ 已跌倒' :
           activity === 'walking' ? '行走中' :
           activity === 'navigating' ? '导航中' :
           activity === 'reading' ? '阅读中' :
           online ? '在线' : '离线'}
        </span>
      </div>
      {/* 地址条 */}
      {location?.address && (
        <div className="fam-map-addr-bar">
          <span className="fam-map-addr-icon">📍</span>
          <span className="fam-map-addr-text">{location.address}</span>
        </div>
      )}
    </div>
  );
}
