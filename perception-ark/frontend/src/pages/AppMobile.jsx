import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useCamera } from '../hooks/useCamera.js';
import { useSpeechSynthesis } from '../hooks/useSpeech.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';

/**
 * H5移动端APP页 - 精简版
 * 聚焦视障用户核心需求: 识物 + 导航
 * 大按钮、简洁布局、语音反馈为主
 */
export default function AppMobile() {
  const { user, logout } = useAuth();
  const [subtitle, setSubtitle] = useState('点击下方按钮开始使用');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [navInput, setNavInput] = useState('');

  const { speak, stop: stopSpeak } = useSpeechSynthesis();
  const camera = useCamera();
  const { location } = useGeolocation();

  // WebSocket接收后端事件
  const handleWsEvent = useCallback((event) => {
    switch (event.type) {
      case 'speak':
        if (event.text) speak(event.text, { urgent: event.urgent });
        break;
      case 'subtitle':
        setSubtitle(event.text);
        break;
    }
  }, [speak]);
  const { connected } = useWebSocket(handleWsEvent);

  const showToast = useCallback((text) => {
    setToast(text);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const captureImage = useCallback(async () => {
    if (!camera.active) {
      showToast('请先开启摄像头');
      speak('请先开启摄像头');
      return null;
    }
    const file = await camera.capture();
    if (!file) showToast('拍照失败');
    return file;
  }, [camera, showToast, speak]);

  // 识物: 场景描述
  const handleScene = useCallback(async () => {
    setBusy(true);
    setSubtitle('正在识别场景...');
    try {
      const img = await captureImage();
      if (!img) return;
      await api.scene(img, '请用一段话描述当前场景,包括前方物体、路面状况、可能的障碍。专为视障者设计,50字以内。');
    } catch (err) {
      showToast(`识别失败: ${err.message}`);
      speak(`识别失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, showToast, speak]);

  // 识物: 文字识别
  const handleOCR = useCallback(async () => {
    setBusy(true);
    setSubtitle('正在读取文字...');
    try {
      const img = await captureImage();
      if (!img) return;
      await api.social(img, 'ocr');
    } catch (err) {
      showToast(`识别失败: ${err.message}`);
      speak(`识别失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, showToast, speak]);

  // 识物: 人脸识别
  const handleFace = useCallback(async () => {
    setBusy(true);
    setSubtitle('正在识别面前的人...');
    try {
      const img = await captureImage();
      if (!img) return;
      await api.social(img, 'face');
    } catch (err) {
      showToast(`识别失败: ${err.message}`);
      speak(`识别失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, showToast, speak]);

  // 识物: 安全扫描
  const handleSafety = useCallback(async () => {
    setBusy(true);
    setSubtitle('正在安全扫描...');
    try {
      const img = await captureImage();
      if (!img) return;
      await api.safety(img, 'scan');
    } catch (err) {
      showToast(`扫描失败: ${err.message}`);
      speak(`扫描失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, showToast, speak]);

  // 导航
  const handleNavigate = useCallback(async (dest) => {
    const destination = (dest || navInput).trim();
    if (!destination) {
      showToast('请输入目的地');
      speak('请告诉我您要去哪里');
      return;
    }
    setBusy(true);
    setSubtitle(`正在规划到${destination}的路线...`);
    try {
      await api.navigate(destination, location?.lat, location?.lng);
      setNavInput('');
    } catch (err) {
      showToast(`导航失败: ${err.message}`);
      speak(`导航失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [navInput, location, showToast, speak]);

  // 摄像头开关
  const toggleCamera = useCallback(() => {
    if (camera.active) {
      camera.stop();
      showToast('摄像头已关闭');
    } else {
      camera.start().then(ok => {
        if (!ok) {
          showToast(camera.error || '摄像头启动失败');
          speak('摄像头启动失败');
        }
      });
    }
  }, [camera, showToast, speak]);

  // 显示位置信息
  useEffect(() => {
    if (location?.address) {
      const parts = [location.province, location.city, location.district].filter(Boolean).join('');
      if (parts) {
        setSubtitle(`当前位置: ${parts}`);
      }
    }
  }, [location]);

  return (
    <div className="app-mobile">
      {/* 顶部状态栏 */}
      <div className="app-mobile-header">
        <h1>感知方舟</h1>
        <div className="app-mobile-status">
          <span className={`dot ${connected ? 'green' : 'red'}`}></span>
          <span>{connected ? '在线' : '离线'}</span>
          {user && <span>· {user.username}</span>}
          <a href="#/" style={{ color: 'var(--ink-muted)', marginLeft: 8, fontSize: '.75rem', textDecoration: 'none' }}>Web端</a>
        </div>
      </div>

      {/* 摄像头预览 */}
      <div className="app-mobile-camera">
        <video ref={camera.videoRef} playsInline muted style={{ display: camera.active ? 'block' : 'none' }} />
        {!camera.active && (
          <div className="app-mobile-cam-placeholder">
            <div className="icon">📷</div>
            <div>摄像头未开启</div>
            <div style={{ fontSize: '.75rem', marginTop: 4 }}>点击下方"摄像头"按钮启用</div>
          </div>
        )}
      </div>

      {/* 语音播报区 */}
      <div className="app-mobile-subtitle" aria-live="polite">
        <div className="ams-label">语音播报</div>
        <div className="ams-text">{subtitle}</div>
      </div>

      {/* 导航输入 */}
      <div className="app-mobile-nav-input">
        <input
          type="text"
          value={navInput}
          onChange={e => setNavInput(e.target.value)}
          placeholder="输入目的地,如五一广场"
          aria-label="导航目的地"
          onKeyDown={e => e.key === 'Enter' && handleNavigate()}
        />
        <button onClick={() => handleNavigate()} disabled={busy}>导航</button>
      </div>

      {/* 功能按钮 */}
      <div className="app-mobile-actions">
        <button className="app-mobile-btn" onClick={toggleCamera}>
          <span className="amb-icon">{camera.active ? '📹' : '📷'}</span>
          <span className="amb-label">{camera.active ? '关闭摄像头' : '开启摄像头'}</span>
        </button>
        <button className="app-mobile-btn primary" onClick={handleScene} disabled={busy || !camera.active}>
          <span className="amb-icon">👁️</span>
          <span className="amb-label">场景描述</span>
        </button>
        <button className="app-mobile-btn" onClick={handleOCR} disabled={busy || !camera.active}>
          <span className="amb-icon">📖</span>
          <span className="amb-label">读取文字</span>
        </button>
        <button className="app-mobile-btn" onClick={handleFace} disabled={busy || !camera.active}>
          <span className="amb-icon">👤</span>
          <span className="amb-label">识别面孔</span>
        </button>
        <button className="app-mobile-btn danger" onClick={handleSafety} disabled={busy || !camera.active}>
          <span className="amb-icon">🛡️</span>
          <span className="amb-label">安全扫描</span>
        </button>
        <button className="app-mobile-btn" onClick={() => { stopSpeak(); setSubtitle('已停止播报'); }} disabled={busy}>
          <span className="amb-icon">⏹️</span>
          <span className="amb-label">停止播报</span>
        </button>
      </div>

      {/* Toast提示 */}
      {toast && <div className="app-mobile-toast">{toast}</div>}
    </div>
  );
}
