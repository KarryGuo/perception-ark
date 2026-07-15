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

  // 启动摄像头
  const start = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器不支持摄像头API，请使用Chrome/Edge/Safari');
      }
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingModeRef.current, // 根据当前选择的前后摄像头
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => {});
      }
      setActive(true);
      console.log('[Camera] 摄像头已启动 facingMode:', facingModeRef.current);
      return true;
    } catch (err) {
      console.error('[Camera] 启动失败:', err);
      setError(err.message);
      setActive(false);
      return false;
    }
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
