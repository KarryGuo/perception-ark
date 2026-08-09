import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 摄像头 Hook - getUserMedia
 * 支持: 实时视频流 + 抓拍图片 + 前后摄像头切换
 */
export function useCamera() {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);
  const [facingMode, setFacingMode] = useState('environment'); // environment=后置, user=前置
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const facingModeRef = useRef('environment');

  // 启动摄像头(带降级回退: facingMode不存在时依次回退到任意摄像头)
  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = '当前浏览器不支持摄像头API，请使用Chrome/Edge/Safari';
      setError(msg);
      return false;
    }
    // 降级约束链: 后置摄像头 → 前置摄像头 → 任意摄像头
    // 同时降低分辨率到640x480(AI分析足够,显著降低发烫和耗电)
    const constraintChain = [
      { video: { facingMode: facingModeRef.current, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { facingMode: facingModeRef.current === 'environment' ? 'user' : 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: true, audio: false }
    ];
    let s = null;
    let lastErr = null;
    for (const constraints of constraintChain) {
      try {
        s = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        lastErr = err;
        // NotFoundError/OverconstrainedError: 该facingMode不可用,尝试下一个约束
        if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError' || err.name === 'NotReadableError') {
          continue;
        }
        // NotAllowedError: 用户拒绝授权,无需继续尝试
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          break;
        }
      }
    }
    if (!s) {
      const err = lastErr || new Error('摄像头启动失败');
      console.error('[Camera] 启动失败:', err);
      // 给出更友好的错误提示
      let friendly = err.message || '摄像头无法启动';
      if (err.name === 'NotAllowedError') friendly = '摄像头权限被拒绝，请在浏览器设置中允许摄像头权限';
      else if (err.name === 'NotFoundError') friendly = '未检测到摄像头设备';
      else if (err.name === 'NotReadableError') friendly = '摄像头被其他程序占用，请关闭后重试';
      setError(friendly);
      setActive(false);
      return false;
    }
    setStream(s);
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      await videoRef.current.play().catch(() => {});
    }
    setActive(true);
    console.log('[Camera] 摄像头已启动 facingMode:', facingModeRef.current);
    return true;
  }, []);

  // 切换前后摄像头
  const switchCamera = useCallback(async () => {
    const next = facingModeRef.current === 'environment' ? 'user' : 'environment';
    facingModeRef.current = next;
    setFacingMode(next);
    // 先停止当前流
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
    setActive(false);
    // 重新启动
    return await start();
  }, [stream, start]);

  // 停止摄像头
  const stop = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    console.log('[Camera] 摄像头已停止');
  }, [stream]);

  // 抓拍当前帧
  const capture = useCallback(async (maxWidth = 800) => {
    if (!videoRef.current || !active) return null;
    const video = videoRef.current;

    // 等待video流就绪(videoWidth>0),最多等待1.5秒
    let waitCount = 0;
    while ((!video.videoWidth || !video.videoHeight) && waitCount < 15) {
      await new Promise(r => setTimeout(r, 100));
      waitCount++;
    }

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;

    // 等比例缩放
    let targetW = w, targetH = h;
    if (w > maxWidth) {
      targetW = maxWidth;
      targetH = Math.round(h * maxWidth / w);
    }
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, targetW, targetH);

    // 转为Blob
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
        resolve(file);
      }, 'image/jpeg', 0.85);
    });
  }, [active]);

  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [stream]);

  return { videoRef, stream, error, active, start, stop, capture, switchCamera, facingMode };
}
