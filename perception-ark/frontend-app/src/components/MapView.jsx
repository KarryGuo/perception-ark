import { useEffect, useRef, useState, useCallback } from 'react';
import { loadAmapSDK, IS_KEY_VALID, reverseGeocode } from '../services/amap.js';

const USER_MARKER_STYLE = `
  position: relative;
  width: 22px;
  height: 22px;
`;

const USER_MARKER_PULSE = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 52px;
  height: 52px;
  margin: -26px 0 0 -26px;
  border-radius: 50%;
  background: rgba(10, 132, 255, 0.12);
  border: 2px solid rgba(10, 132, 255, 0.3);
  animation: userPulse 2s ease-out infinite;
`;

const USER_MARKER_DOT = `
  position: absolute;
  top: 50%;
  left: 50%;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: #0a84ff;
  border: 3px solid #ffffff;
  box-shadow: 0 2px 12px rgba(10, 132, 255, 0.5);
`;

export default function MapView({ location, route, pois, className, destination, active }) {
  const containerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const userMarkerRef = useRef(null);
  const routePolylineRef = useRef(null);
  const destMarkerRef = useRef(null);
  const poiMarkersRef = useRef([]);
  const geocodeDebounceRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [addr, setAddr] = useState('');

  useEffect(() => {
    if (location?.address) {
      setAddr(location.address);
      return;
    }
    if (location?.lat && location?.lng && mapReady) {
      if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current);
      geocodeDebounceRef.current = setTimeout(async () => {
        try {
          const res = await reverseGeocode(location.lng, location.lat);
          if (res?.address) setAddr(res.address);
        } catch (e) {
          console.warn('[MapView] Reverse geocode failed:', e);
        }
      }, 800);
    }
    return () => {
      if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current);
    };
  }, [location?.lat, location?.lng, location?.address, mapReady]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!IS_KEY_VALID) {
      setLoadError('no-key');
      return;
    }

    let cancelled = false;

    loadAmapSDK()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return;

        const startLat = location?.lat || 39.9042;
        const startLng = location?.lng || 116.4074;

        mapInstanceRef.current = new AMap.Map(containerRef.current, {
          zoom: 17,
          center: [startLng, startLat],
          mapStyle: 'amap://styles/dark',
          viewMode: '2D',
          features: ['bg', 'road', 'building', 'point'],
          showLabel: true,
          expandZoomRange: true,
          zooms: [3, 20]
        });

        createUserMarker(AMap, startLat, startLng);
        setMapReady(true);

        setTimeout(() => {
          if (mapInstanceRef.current && !cancelled) {
            try { mapInstanceRef.current.resize(); } catch (e) {}
          }
        }, 250);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[MapView] Map load failed:', err);
          setLoadError(err.message || '地图加载失败');
        }
      });

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.destroy(); } catch (e) {}
        mapInstanceRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  const createUserMarker = useCallback((AMap, lat, lng) => {
    if (!mapInstanceRef.current) return;

    const markerContent = document.createElement('div');
    markerContent.style.cssText = USER_MARKER_STYLE;
    markerContent.innerHTML = `
      <style>
        @keyframes userPulse {
          0% { transform: scale(0.8); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      </style>
      <div style="${USER_MARKER_PULSE}"></div>
      <div style="${USER_MARKER_DOT}"></div>
    `;

    userMarkerRef.current = new AMap.Marker({
      position: [lng, lat],
      content: markerContent,
      offset: new AMap.Pixel(-11, -11),
      zIndex: 200,
      clickable: false
    });
    mapInstanceRef.current.add(userMarkerRef.current);
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !location?.lat || !location?.lng) return;
    const AMap = window.AMap;
    if (!AMap) return;

    const lnglat = new AMap.LngLat(location.lng, location.lat);
    
    if (userMarkerRef.current) {
      userMarkerRef.current.setPosition(lnglat);
    } else {
      createUserMarker(AMap, location.lat, location.lng);
    }

    mapInstanceRef.current.panTo(lnglat, 300);
  }, [location?.lat, location?.lng, createUserMarker]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const AMap = window.AMap;
    if (!AMap) return;

    if (routePolylineRef.current) {
      mapInstanceRef.current.remove(routePolylineRef.current);
      routePolylineRef.current = null;
    }

    if (destMarkerRef.current) {
      mapInstanceRef.current.remove(destMarkerRef.current);
      destMarkerRef.current = null;
    }

    poiMarkersRef.current.forEach(m => {
      try { mapInstanceRef.current.remove(m); } catch (e) {}
    });
    poiMarkersRef.current = [];

    if (!route || route.length < 2) return;

    const path = route.map(p => new AMap.LngLat(p[0], p[1]));
    
    routePolylineRef.current = new AMap.Polyline({
      path: path,
      strokeColor: '#0a84ff',
      strokeWeight: 7,
      strokeOpacity: 0.95,
      lineJoin: 'round',
      lineCap: 'round',
      showDir: true,
      zIndex: 50
    });
    mapInstanceRef.current.add(routePolylineRef.current);

    const end = route[route.length - 1];
    if (destination) {
      const destContent = document.createElement('div');
      destContent.style.cssText = 'display: flex; flex-direction: column; align-items: center;';
      destContent.innerHTML = `
        <div style="background: #1a1a1a; color: #ffffff; padding: 8px 14px; border-radius: 10px; font-size: 14px; font-weight: 600; white-space: nowrap; box-shadow: 0 4px 16px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); margin-bottom: -1px;">${destination}</div>
        <div style="width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 9px solid #1a1a1a;"></div>
      `;
      
      destMarkerRef.current = new AMap.Marker({
        position: [end[0], end[1]],
        content: destContent,
        offset: new AMap.Pixel(-45, -50),
        zIndex: 100
      });
      mapInstanceRef.current.add(destMarkerRef.current);
    }

    const allPoints = [...path];
    if (userMarkerRef.current) {
      allPoints.unshift(userMarkerRef.current.getPosition());
    }
    mapInstanceRef.current.setFitView(allPoints, false, [80, 80, 80, 80], 300);
  }, [route, destination]);

  useEffect(() => {
    if (active && mapInstanceRef.current) {
      setTimeout(() => {
        try { mapInstanceRef.current?.resize(); } catch (e) {}
      }, 200);
    }
  }, [active]);

  if (!IS_KEY_VALID) {
    return (
      <div className={`map-view ${className || ''}`} style={{ background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '40px 32px', maxWidth: '320px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(10,132,255,0.12)', margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0a84ff" strokeWidth="1.8" strokeLinecap="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              <line x1="8" y1="2" x2="8" y2="18"/>
              <line x1="16" y1="6" x2="16" y2="22"/>
            </svg>
          </div>
          <div style={{ fontSize: '17px', fontWeight: '600', color: '#fff', marginBottom: '12px' }}>配置高德地图 API Key</div>
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.6' }}>
            请在 <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>.env.development</code> 中配置<br/>
            <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>VITE_AMAP_JS_KEY</code>
          </div>
        </div>
      </div>
    );
  }

  if (loadError && loadError !== 'no-key') {
    return (
      <div className={`map-view ${className || ''}`} style={{ background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '40px 32px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255,69,58,0.12)', margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff453a" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div style={{ fontSize: '17px', fontWeight: '600', color: '#fff', marginBottom: '8px' }}>地图加载失败</div>
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>{loadError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`map-view ${className || ''}`} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div 
        ref={containerRef} 
        style={{ width: '100%', height: '100%', opacity: mapReady ? 1 : 0, transition: 'opacity 0.3s ease' }}
      />

      {mapReady && location && (
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          background: 'rgba(20, 20, 20, 0.88)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '12px',
          padding: '12px 16px',
          border: '1px solid rgba(255,255,255,0.08)',
          zIndex: 10,
          maxWidth: 'calc(100% - 24px)'
        }}>
          {addr && (
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#fff', lineHeight: '1.3', marginBottom: addr ? '6px' : '0' }}>{addr}</div>
          )}
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', fontFamily: 'SF Mono, Menlo, monospace' }}>
            {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
            {location.accuracy && <span style={{ marginLeft: '8px' }}>±{Math.round(location.accuracy)}m</span>}
          </div>
        </div>
      )}

      {mapReady && destination && route && (
        <div style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          background: 'rgba(10, 132, 255, 0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '10px',
          padding: '8px 14px',
          zIndex: 10,
          fontSize: '13px',
          fontWeight: '600',
          color: '#fff'
        }}>
          导航中
        </div>
      )}

      {!mapReady && !loadError && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          background: '#0d1117'
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: '3px solid rgba(10, 132, 255, 0.2)',
            borderTopColor: '#0a84ff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
          }} />
          <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', fontWeight: '500' }}>加载地图中...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}
