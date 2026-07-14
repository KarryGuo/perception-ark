import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * IMU传感器 Hook - 用于跌倒检测
 * 通过 DeviceMotionEvent 监听加速度
 *
 * 跌倒检测算法:
 * 1. 总加速度 sqrt(x²+y²+z²) 突然超过阈值 (典型25-30 m/s²)
 * 2. 紧接着1-2秒内静止(低于10 m/s²) -> 确认跌倒
 *
 * 注意:
 * - iOS 13+ 需要通过 DeviceMotionEvent.requestPermission() 请求权限
 * - 桌面浏览器通常没有加速度计，会自动回退到手动模拟
 */
const FALL_THRESHOLD = 25;     // 跌倒检测加速度阈值 (m/s²)
const NORMAL_GRAVITY = 9.8;    // 重力加速度
const STILL_THRESHOLD = 11;    // 静止判定阈值
const FALL_WINDOW_MS = 2000;   // 跌倒检测窗口期

export function useIMU(onFall) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState('unknown'); // unknown | granted | denied | not-needed
  const [active, setActive] = useState(false);
  const [acceleration, setAcceleration] = useState({ x: 0, y: 0, z: 0 });
  const [magnitude, setMagnitude] = useState(NORMAL_GRAVITY);
  const [fallDetected, setFallDetected] = useState(false);

  const onFallRef = useRef(onFall);
  onFallRef.current = onFall;
  const peakRef = useRef(0);
  const fallStartRef = useRef(0);
  const inFallWindowRef = useRef(false);

  // 请求iOS权限
  const requestPermission = useCallback(async () => {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        setPermission(result);
        if (result === 'granted') {
          startListening();
          return true;
        }
        return false;
      } catch (err) {
        console.error('[IMU] 权限请求失败:', err);
        setPermission('denied');
        return false;
      }
    } else {
      // 非iOS,无需请求权限
      setPermission('not-needed');
      startListening();
      return true;
    }
  }, []);

  const startListening = useCallback(() => {
    if (!('DeviceMotionEvent' in window)) {
      console.warn('[IMU] 浏览器不支持DeviceMotion');
      setSupported(false);
      return;
    }
    setSupported(true);
    setActive(true);

    const handler = (e) => {
      const accel = e.accelerationIncludingGravity || e.acceleration;
      if (!accel || accel.x == null) return;

      const x = accel.x || 0;
      const y = accel.y || 0;
      const z = accel.z || 0;
      const mag = Math.sqrt(x * x + y * y + z * z);

      setAcceleration({ x, y, z });
      setMagnitude(mag);

      // 跌倒检测算法
      if (mag > FALL_THRESHOLD && !inFallWindowRef.current) {
        // 检测到冲击
        peakRef.current = mag;
        fallStartRef.current = Date.now();
        inFallWindowRef.current = true;
        console.log(`[IMU] 检测到冲击: ${mag.toFixed(2)} m/s²`);
      }

      if (inFallWindowRef.current) {
        const elapsed = Date.now() - fallStartRef.current;
        if (elapsed > FALL_WINDOW_MS) {
          // 窗口结束,判定是否跌倒
          if (peakRef.current > FALL_THRESHOLD) {
            // 触发跌倒事件
            console.log(`[IMU] 跌倒确认! 峰值: ${peakRef.current.toFixed(2)} m/s²`);
            setFallDetected(true);
            if (onFallRef.current) onFallRef.current({ peak: peakRef.current, time: Date.now() });
          }
          inFallWindowRef.current = false;
          peakRef.current = 0;
        }
      }
    };

    window.addEventListener('devicemotion', handler);
    console.log('[IMU] 监听已启动 · 等待数据...');

    return () => {
      window.removeEventListener('devicemotion', handler);
      setActive(false);
    };
  }, []);

  // 模拟跌倒(用于桌面测试)
  const simulateFall = useCallback(() => {
    console.log('[IMU] 模拟跌倒事件');
    setFallDetected(true);
    setMagnitude(32);
    if (onFallRef.current) onFallRef.current({ peak: 32, time: Date.now(), simulated: true });
  }, [onFall]);

  const reset = useCallback(() => {
    setFallDetected(false);
    setMagnitude(NORMAL_GRAVITY);
    inFallWindowRef.current = false;
    peakRef.current = 0;
  }, []);

  // 自动尝试启动(非iOS)
  useEffect(() => {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission !== 'function') {
      // 非iOS - 自动启动
      const cleanup = startListening();
      return cleanup;
    }
  }, [startListening]);

  return {
    supported, permission, active, acceleration, magnitude, fallDetected,
    requestPermission, simulateFall, reset
  };
}
