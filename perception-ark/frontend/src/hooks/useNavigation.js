import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * 导航引导 Hook - 实时方向纠正与朝向检测
 *
 * 功能:
 * 1. 设备朝向检测 (DeviceOrientationEvent 罗盘 + GPS运动方向兜底)
 * 2. 导航进度监控 (沿路线步骤推进,距离下个转弯点)
 * 3. 偏离路线检测 (>30m 报警)
 * 4. 朝向纠正 (用户朝向与路线方向偏差>60° 时提醒)
 * 5. 转弯预告 (接近转弯点30m内播报)
 *
 * 所有播报均通过外部传入的 speak 函数,由调用方控制TTS抑制.
 */

// ===== 几何工具 =====

// 两点间距离(米,简化平面近似,适用于短距离)
function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = lat1 - lat2;
  const dLng = lng1 - lng2;
  return Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
}

// 计算方位角(0-360°, 正北=0, 顺时针)
function calculateBearing(lat1, lng1, lat2, lng2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 两个角度之间的最小差值(0-180°)
function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

// 方位角 → 中文方向(八方位)
function headingToDirection(heading) {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const idx = Math.round(heading / 45) % 8;
  return dirs[idx];
}

// 偏转方向: 用户需要向左还是向右转来对准路线方向
function turnDirection(userHeading, routeBearing) {
  let diff = routeBearing - userHeading;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff > 0 ? '右' : '左';
}

// 点到线段最近点(平面近似)
function nearestPointOnSegment(px, py, ax, ay, bx, by) {
  const apx = px - ax;
  const apy = py - ay;
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return { x: ax, y: ay, t: 0 };
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * abx, y: ay + t * aby, t };
}

// 解析高德polyline字符串 "lng,lat;lng,lat;..." → [[lng,lat],...]
function parsePolyline(polyline) {
  if (!polyline) return [];
  return polyline.split(';').filter(p => p).map(p => {
    const [lng, lat] = p.split(',').map(parseFloat);
    return [lng, lat];
  }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
}

// 数字小数点转中文"点"(TTS播报"1.5米"会读成"1 5米")
function normalizeForTTS(text) {
  return typeof text === 'string' ? text.replace(/(\d+)\.(\d+)/g, '$1点$2') : text;
}

// ===== Hook =====

export function useNavigation({ location, speak, stopSpeak, ttsSpeaking, onArrive }) {
  const [navState, setNavState] = useState({
    active: false,
    destination: null,
    steps: [],
    currentStepIndex: 0,
    distanceToNextManeuver: null,
    nextManeuverInstruction: null,
    offRoute: false,
    heading: null,
    routeBearing: null,
    headingDeviation: null,
    totalDistance: 0,
    remainingDistance: null,
  });

  // 朝向
  const headingRef = useRef(null);
  const compassActiveRef = useRef(false);

  // 导航数据
  const routeCoordsRef = useRef([]);     // 完整路线坐标 [[lng,lat],...]
  const stepsRef = useRef([]);           // 步骤(含起止坐标)
  const currentStepRef = useRef(0);      // 当前步骤索引
  const destinationRef = useRef(null);   // 目的地名称
  const totalDistanceRef = useRef(0);    // 总距离(米)

  // 播报去重/节流
  const lastCorrectionTimeRef = useRef(0);       // 上次方向纠正播报
  const lastOffRouteTimeRef = useRef(0);         // 上次偏离播报
  const lastManeuverAnnouncedRef = useRef(-1);   // 已播报的转弯预告步骤索引
  const lastProgressTimeRef = useRef(0);          // 上次进度播报

  // 监控定时器
  const monitorRef = useRef(null);
  const navActiveRef = useRef(false);

  // TTS状态同步引用(避免闭包陈旧)
  const ttsSpeakingRef = useRef(false);
  useEffect(() => { ttsSpeakingRef.current = !!ttsSpeaking; }, [ttsSpeaking]);

  // 位置同步引用
  const locationRef = useRef(null);
  useEffect(() => { locationRef.current = location; }, [location]);

  // speak引用(避免闭包陈旧)
  const speakRef = useRef(speak);
  useEffect(() => { speakRef.current = speak; }, [speak]);
  const onArriveRef = useRef(onArrive);
  useEffect(() => { onArriveRef.current = onArrive; }, [onArrive]);

  // ===== 1. 设备朝向检测 =====

  const handleOrientation = useCallback((event) => {
    // iOS: webkitCompassHeading (已补偿,正北=0,顺时针)
    if (typeof event.webkitCompassHeading === 'number' && !isNaN(event.webkitCompassHeading)) {
      headingRef.current = event.webkitCompassHeading;
      compassActiveRef.current = true;
      return;
    }
    // Android/标准: alpha (0-360, 需要根据屏幕方向补偿)
    if (typeof event.alpha === 'number' && !isNaN(event.alpha)) {
      // alpha是设备绕Z轴旋转角度,需要转换成正北方位角
      // 简化: alpha=0时设备顶部指向正北(设备水平放置时)
      // 屏幕朝上时: heading = 360 - alpha
      let h = 360 - event.alpha;
      if (h >= 360) h -= 360;
      headingRef.current = h;
      compassActiveRef.current = true;
    }
  }, []);

  // 请求iOS罗盘权限(需用户交互触发)
  const requestCompassPermission = useCallback(async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation, true);
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    } else if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      // Android/桌面: 无需权限
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
      return true;
    }
    return false;
  }, [handleOrientation]);

  // 初始化罗盘监听(Android/桌面自动,iOS需用户交互后调用requestCompassPermission)
  useEffect(() => {
    // Android/桌面直接监听
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission !== 'function' &&
        'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
    };
  }, [handleOrientation]);

  // GPS运动方向兜底(罗盘不可用或精度差时,根据连续定位推算行进方向)
  const lastGpsPosRef = useRef(null);
  useEffect(() => {
    if (!location?.lat || !location?.lng) return;
    // 罗盘已激活时不覆盖(罗盘精度更高)
    if (compassActiveRef.current) return;

    if (lastGpsPosRef.current) {
      const dist = distanceMeters(location.lat, location.lng, lastGpsPosRef.current.lat, lastGpsPosRef.current.lng);
      // 移动>3米才推算方向(过滤GPS抖动)
      if (dist > 3) {
        const bearing = calculateBearing(
          lastGpsPosRef.current.lat, lastGpsPosRef.current.lng,
          location.lat, location.lng
        );
        // 平滑: 与上次heading做加权平均(减少跳变)
        if (headingRef.current != null) {
          let diff = bearing - headingRef.current;
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;
          headingRef.current = (headingRef.current + diff * 0.5 + 360) % 360;
        } else {
          headingRef.current = bearing;
        }
      }
    }
    lastGpsPosRef.current = { lat: location.lat, lng: location.lng };
  }, [location?.lat, location?.lng]);

  // ===== 2. 导航监控逻辑 =====

  // 找到路线上离用户最近的点及所属步骤
  const findNearestOnRoute = useCallback((lat, lng) => {
    const coords = routeCoordsRef.current;
    const steps = stepsRef.current;
    if (coords.length < 2) return null;

    let minDist = Infinity;
    let nearestIdx = 0;
    let nearestPoint = null;

    for (let i = 0; i < coords.length - 1; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[i + 1];
      const np = nearestPointOnSegment(lng, lat, lng1, lat1, lng2, lat2);
      const d = distanceMeters(lat, lng, np.y, np.x);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
        nearestPoint = np;
      }
    }

    // 确定所属步骤: 根据nearestIdx在steps中的位置
    let stepIdx = 0;
    let coordCount = 0;
    for (let i = 0; i < steps.length; i++) {
      const stepCoordCount = steps[i].coords ? steps[i].coords.length : 0;
      if (nearestIdx < coordCount + Math.max(stepCoordCount - 1, 1)) {
        stepIdx = i;
        break;
      }
      coordCount += Math.max(stepCoordCount - 1, 1);
      stepIdx = i;
    }

    return { distance: minDist, segmentIdx: nearestIdx, stepIdx, point: nearestPoint };
  }, []);

  // 导航监控循环(每3秒)
  const monitorNavigation = useCallback(() => {
    if (!navActiveRef.current) return;
    const loc = locationRef.current;
    if (!loc?.lat || !loc?.lng) return;

    const coords = routeCoordsRef.current;
    const steps = stepsRef.current;
    if (coords.length < 2 || steps.length === 0) return;

    // 1. 找到路线上最近点
    const nearest = findNearestOnRoute(loc.lat, loc.lng);
    if (!nearest) return;

    const now = Date.now();

    // 2. 更新当前步骤
    if (nearest.stepIdx !== currentStepRef.current) {
      currentStepRef.current = nearest.stepIdx;
    }
    const curStepIdx = currentStepRef.current;
    const curStep = steps[curStepIdx];

    // 3. 计算到下一个转弯点的距离
    // 转弯点 = 当前步骤的终点(step.polyline最后一个坐标)
    let distanceToManeuver = null;
    let nextManeuverInstruction = null;
    if (curStep && curStep.endCoord) {
      distanceToManeuver = distanceMeters(loc.lat, loc.lng, curStep.endCoord[1], curStep.endCoord[0]);
      // 下一个步骤的指令作为转弯提示
      if (curStepIdx < steps.length - 1) {
        nextManeuverInstruction = steps[curStepIdx + 1].instruction;
      }
    }

    // 4. 计算路线方向(当前步骤的bearing)
    let routeBearing = null;
    if (curStep && curStep.startCoord && curStep.endCoord) {
      routeBearing = calculateBearing(
        curStep.startCoord[1], curStep.startCoord[0],
        curStep.endCoord[1], curStep.endCoord[0]
      );
    }

    // 5. 朝向偏差
    const userHeading = headingRef.current;
    let headingDeviation = null;
    if (userHeading != null && routeBearing != null) {
      headingDeviation = angleDiff(userHeading, routeBearing);
    }

    // 6. 偏离路线检测
    const offRoute = nearest.distance > 30;

    // 7. 更新状态(UI)
    setNavState(prev => ({
      ...prev,
      currentStepIndex: curStepIdx,
      distanceToNextManeuver: distanceToManeuver != null ? Math.round(distanceToManeuver) : null,
      nextManeuverInstruction,
      offRoute,
      heading: userHeading,
      routeBearing,
      headingDeviation: headingDeviation != null ? Math.round(headingDeviation) : null,
      remainingDistance: Math.round(nearest.distance + (totalDistanceRef.current - (curStep?.cumulativeDistance || 0))),
    }));

    // ===== 8. 语音播报(TTS抑制时不播报) =====
    if (ttsSpeakingRef.current) return;

    // 8a. 到达目的地检测(距离终点<15米)
    const lastStep = steps[steps.length - 1];
    if (lastStep && lastStep.endCoord) {
      const distToEnd = distanceMeters(loc.lat, loc.lng, lastStep.endCoord[1], lastStep.endCoord[0]);
      if (distToEnd < 15) {
        navActiveRef.current = false;
        if (monitorRef.current) { clearInterval(monitorRef.current); monitorRef.current = null; }
        const arriveText = `您已到达${destinationRef.current || '目的地'}。导航结束。`;
        speakRef.current?.(normalizeForTTS(arriveText));
        onArriveRef.current?.();
        setNavState(prev => ({ ...prev, active: false }));
        return;
      }
    }

    // 8b. 偏离路线播报(每12秒一次)
    if (offRoute && now - lastOffRouteTimeRef.current > 12000) {
      lastOffRouteTimeRef.current = now;
      const dir = userHeading != null && routeBearing != null
        ? `，路线在您的${turnDirection(userHeading, routeBearing)}前方，请向${turnDirection(userHeading, routeBearing)}调整`
        : '';
      speakRef.current?.(normalizeForTTS(`您已偏离路线${dir}。请回到规划路线。`));
      return;
    }

    // 8c. 转弯预告: 距离转弯点<25米且本步骤未播报过
    if (distanceToManeuver != null && distanceToManeuver < 25 &&
        lastManeuverAnnouncedRef.current !== curStepIdx &&
        curStepIdx < steps.length - 1) {
      lastManeuverAnnouncedRef.current = curStepIdx;
      const turnText = `前方${Math.round(distanceToManeuver)}米，${nextManeuverInstruction || '请注意方向'}。`;
      speakRef.current?.(normalizeForTTS(turnText));
      return;
    }

    // 8d. 朝向纠正: 偏差>60° 且不在转弯预告窗口(每8秒一次)
    if (headingDeviation != null && headingDeviation > 60 &&
        (distanceToManeuver == null || distanceToManeuver > 25) &&
        !offRoute &&
        now - lastCorrectionTimeRef.current > 8000) {
      lastCorrectionTimeRef.current = now;
      const userDir = headingToDirection(userHeading);
      const routeDir = headingToDirection(routeBearing);
      const turnDir = turnDirection(userHeading, routeBearing);
      const correctionText = `方向提醒：您当前朝向${userDir}，路线方向是${routeDir}，请向${turnDir}转约${Math.round(headingDeviation)}度调整。`;
      speakRef.current?.(normalizeForTTS(correctionText));
      return;
    }
  }, [findNearestOnRoute]);

  // ===== 3. 启动/停止导航 =====

  const startNavigation = useCallback((route, destination) => {
    if (!route?.polyline) return;

    // 解析完整路线坐标
    const coords = parsePolyline(route.polyline);
    routeCoordsRef.current = coords;

    // 解析各步骤坐标(含起止点)
    const steps = (route.steps || []).map((s, i) => {
      const stepCoords = parsePolyline(s.polyline);
      return {
        ...s,
        coords: stepCoords,
        startCoord: stepCoords[0] || null,
        endCoord: stepCoords[stepCoords.length - 1] || null,
      };
    });
    stepsRef.current = steps;
    currentStepRef.current = 0;
    destinationRef.current = destination || route.target?.name || '目的地';
    totalDistanceRef.current = route.distance || 0;

    // 重置播报节流
    lastCorrectionTimeRef.current = 0;
    lastOffRouteTimeRef.current = 0;
    lastManeuverAnnouncedRef.current = -1;
    lastProgressTimeRef.current = 0;

    navActiveRef.current = true;
    setNavState({
      active: true,
      destination: destinationRef.current,
      steps,
      currentStepIndex: 0,
      distanceToNextManeuver: null,
      nextManeuverInstruction: steps.length > 1 ? steps[1].instruction : null,
      offRoute: false,
      heading: headingRef.current,
      routeBearing: null,
      headingDeviation: null,
      totalDistance: route.distance || 0,
      remainingDistance: route.distance || 0,
    });

    // 启动监控循环(每3秒)
    if (monitorRef.current) clearInterval(monitorRef.current);
    monitorRef.current = setInterval(monitorNavigation, 3000);
  }, [monitorNavigation]);

  const stopNavigation = useCallback(() => {
    navActiveRef.current = false;
    if (monitorRef.current) { clearInterval(monitorRef.current); monitorRef.current = null; }
    routeCoordsRef.current = [];
    stepsRef.current = [];
    currentStepRef.current = 0;
    setNavState(prev => ({ ...prev, active: false }));
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (monitorRef.current) clearInterval(monitorRef.current);
    };
  }, []);

  return {
    navState,
    heading: headingRef.current,
    startNavigation,
    stopNavigation,
    requestCompassPermission,
  };
}
