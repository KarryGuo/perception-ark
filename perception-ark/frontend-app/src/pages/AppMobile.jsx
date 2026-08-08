import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth, useCamera, useGeolocation, useAssistant, useSpatialAudio, useWebSocket } from '../hooks';
import { api } from '../services/api.js';
import MapView from '../components/MapView.jsx';

// 线上版本快捷按钮（顺序与线上版本一致：分析/出行/阅读/红绿灯/寻物）
const QUICK_MODES = [
  { id: 'quick', icon: '⚡', label: '分析' },
  { id: 'travel', icon: '🚶', label: '出行' },
  { id: 'read', icon: '📖', label: '阅读' },
  { id: 'traffic', icon: '🚦', label: '红绿灯' },
  { id: 'find', icon: '🔍', label: '寻物', extra: 'find' },
];

export default function AppMobile() {
  const { user } = useAuth();
  const camera = useCamera();
  const geo = useGeolocation();
  const spatial = useSpatialAudio();
  const [activeTab, setActiveTab] = useState('recognize');
  const [navInput, setNavInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [inputMode, setInputMode] = useState('voice'); // 'voice' | 'text'
  const [navMode, setNavMode] = useState('voice'); // 导航输入模式
  const [sosCountdown, setSosCountdown] = useState(0);
  const [sosActive, setSosActive] = useState(false);
  const [mapRoute, setMapRoute] = useState(null);
  const [mapPois, setMapPois] = useState([]);
  const [navigating, setNavigating] = useState(false);
  const [navStep, setNavStep] = useState(null);
  const [activeMode, setActiveMode] = useState(null);
  const [findTarget, setFindTarget] = useState('');
  const [findDialogOpen, setFindDialogOpen] = useState(false);
  const [findInput, setFindInput] = useState('');
  const [recognitionResult, setRecognitionResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [subtitle, setSubtitle] = useState('');
  const [toast, setToast] = useState('');
  const [persistentError, setPersistentError] = useState(null);
  const continuousTimerRef = useRef(null);
  const sosTimerRef = useRef(null);
  const sosStartRef = useRef(0);
  const toastTimerRef = useRef(null);

  // 副标题显示（用于TTS播报内容、唤醒提示等）
  const showSubtitle = useCallback((text, autoClear = true) => {
    setSubtitle(text);
    if (autoClear && toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    if (autoClear) {
      toastTimerRef.current = setTimeout(() => setSubtitle(''), 5000);
    }
  }, []);

  // Toast 提示（不使用TTS,避免ASR捕获）
  const showToast = useCallback((text) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2500);
  }, []);

  const assistant = useAssistant({
    location: geo.location,
    enabled: true,
    onAgentAction: handleAgentAction,
    onWeatherReady: (w) => {
      // 天气信息已在 assistant 内部播报
    },
  });

  const handleWSEvent = useCallback((event) => {
    if (event.type === 'navigation_step' && activeTab === 'navigate') {
      setNavStep(event);
      if (event.direction && event.text) {
        spatial.speakDirectional(event.text, event.direction, { urgent: true });
      }
    }
    if (event.type === 'safety_alert') {
      spatial.speak(event.message, { urgent: true, rate: 1.1 });
      showSubtitle(event.message);
    }
  }, [activeTab, spatial, showSubtitle]);

  const ws = useWebSocket(handleWSEvent);

  function handleAgentAction(action) {
    if (action?.action === 'navigate' && action.entity?.destination) {
      setActiveTab('navigate');
      setNavInput(action.entity.destination);
      startNavigation(action.entity.destination);
    } else if (action?.action === 'scene_recognize') {
      setActiveTab('recognize');
      captureAndRecognize();
    } else if (action?.action === 'sos') {
      setActiveTab('sos');
      triggerSOS();
    } else if (action?.action === 'start_mode' && action.mode) {
      startQuickMode(action.mode);
    }
  }

  // ===== 快捷模式 =====
  function startQuickMode(modeId, target) {
    stopContinuousMode();
    if (modeId === 'find') {
      const obj = target || findTarget;
      if (!obj) {
        setFindDialogOpen(true);
        return;
      }
      setFindTarget(obj);
      setActiveMode('find');
      showSubtitle(`开始寻找${obj}`);
      startContinuousRecognition('find', obj);
      return;
    }
    setActiveMode(modeId);
    const labels = {
      quick: '快速分析模式已开启',
      travel: '出行模式已开启',
      read: '阅读模式已开启',
      traffic: '红绿灯识别已开启',
    };
    showSubtitle(labels[modeId] || '');
    startContinuousRecognition(modeId);
  }

  function stopContinuousMode() {
    if (continuousTimerRef.current) {
      clearInterval(continuousTimerRef.current);
      continuousTimerRef.current = null;
    }
    if (activeMode) {
      showSubtitle('模式已关闭');
    }
    setActiveMode(null);
  }

  function startContinuousRecognition(type, target) {
    const interval = type === 'traffic' ? 2500 : type === 'travel' ? 2500 : 5000;
    const doRecognize = async () => {
      if (isProcessing) return;
      try {
        const imageFile = await camera.capture(1024);
        if (!imageFile) return;
        let prompt = '';
        if (type === 'find' && target) prompt = `find_object:${target}`;
        else if (type === 'read') prompt = 'read_text';
        else if (type === 'traffic') prompt = 'traffic_light';
        else if (type === 'travel') prompt = 'obstacle_detection';
        const result = await api.scene(imageFile, prompt);
        if (result.shouldSpeak && result.description) {
          spatial.speak(result.description, { rate: type === 'travel' || type === 'traffic' ? 1.1 : 0.95 });
          showSubtitle(result.description);
        }
        setRecognitionResult(result);
      } catch (e) {
        // 静默继续
      }
    };
    doRecognize();
    continuousTimerRef.current = setInterval(doRecognize, interval);
  }

  function handleQuickModeClick(modeId) {
    if (activeMode === modeId) {
      stopContinuousMode();
    } else {
      startQuickMode(modeId);
    }
  }

  // ===== Tab 切换 =====
  const switchTab = useCallback((tab) => {
    if (tab === activeTab) return;
    if (activeTab === 'recognize') {
      camera.stop();
      stopContinuousMode();
    }
    setActiveTab(tab);
    setRecognitionResult(null);
    setSubtitle('');
    if (tab === 'recognize') {
      setTimeout(() => camera.start(), 100);
    } else if (tab === 'navigate') {
      camera.stop();
    } else if (tab === 'sos') {
      camera.stop();
      stopContinuousMode();
    }
  }, [activeTab, camera]);

  useEffect(() => {
    camera.start();
    // 首次访问默认开启大字体模式
    if (!localStorage.getItem('ark_large_font_set')) {
      document.body.classList.add('ark-large-font');
      localStorage.setItem('ark_large_font', '1');
      localStorage.setItem('ark_large_font_set', '1');
    } else if (localStorage.getItem('ark_large_font') === '1') {
      document.body.classList.add('ark-large-font');
    }
    return () => {
      camera.stop();
      stopContinuousMode();
      document.body.classList.remove('ark-large-font');
    };
  }, []);

  // 摄像头错误处理
  useEffect(() => {
    if (camera.error && activeTab === 'recognize') {
      setPersistentError(camera.error);
    }
  }, [camera.error, activeTab]);

  // 位置上报
  useEffect(() => {
    if (geo.location && ws.connected) {
      api.location(geo.location.lat, geo.location.lng, geo.location.address).catch(() => {});
    }
  }, [geo.location, ws.connected]);

  async function captureAndRecognize() {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const imageFile = await camera.capture(1024);
      if (!imageFile) throw new Error('无法获取摄像头画面');
      const result = await api.scene(imageFile, '');
      setRecognitionResult(result);
      if (result.description) {
        spatial.speak(result.description, { rate: 0.95 });
        showSubtitle(result.description);
      }
    } catch (err) {
      setRecognitionResult({ error: err.message || '识别失败' });
      showToast('识别失败，请重试');
    } finally {
      setIsProcessing(false);
    }
  }

  async function startNavigation(dest) {
    if (!dest) {
      showToast('请输入目的地');
      return;
    }
    if (!geo.location) {
      showToast('请先等待定位完成');
      return;
    }
    setIsProcessing(true);
    try {
      const response = await api.navigate(dest, geo.location.lat, geo.location.lng);
      const result = response?.result || response;

      if (result?.mode === 'select' && result?.pois?.length > 0) {
        setMapPois(result.pois.map(p => [p.lng, p.lat, p.name]));
        setMapRoute(null);
        setNavigating(false);
        showSubtitle(`找到${result.pois.length}个结果，说"去第一个"开始导航`);
        return;
      }

      let routePath = null;
      if (typeof result?.polyline === 'string' && result.polyline.length > 0) {
        routePath = result.polyline.split(';').filter(s => s).map(pair => {
          const [lng, lat] = pair.split(',').map(Number);
          return [lng, lat];
        });
      } else if (Array.isArray(result?.steps) && result.steps.length > 0) {
        const allPoints = [];
        result.steps.forEach(s => {
          if (typeof s.polyline === 'string') {
            s.polyline.split(';').filter(Boolean).forEach(pair => {
              const [lng, lat] = pair.split(',').map(Number);
              if (!isNaN(lng) && !isNaN(lat)) allPoints.push([lng, lat]);
            });
          }
        });
        if (allPoints.length >= 2) routePath = allPoints;
      }

      if (routePath && routePath.length >= 2) {
        setMapRoute(routePath);
        setMapPois([]);
        setNavigating(true);
        const distText = result?.distance ? `${result.distance}米` : '未知距离';
        const durText = result?.duration ? `${result.duration}分钟` : '一段时间';
        const intro = `已为您规划到${dest}的路线，全程约${distText}，预计${durText}`;
        spatial.speak(intro, { rate: 0.95 });
        showSubtitle(intro);
      } else if (result?.error) {
        showToast(result.error);
      } else {
        showToast('未找到合适路线');
      }
    } catch (err) {
      showToast('导航失败，请检查网络');
    } finally {
      setIsProcessing(false);
    }
  }

  function stopNavigation() {
    setNavigating(false);
    setMapRoute(null);
    setNavStep(null);
    spatial.stop();
    showSubtitle('导航已结束');
  }

  function handleNavSubmit(e) {
    e?.preventDefault();
    if (navInput.trim()) startNavigation(navInput.trim());
  }

  // ===== SOS =====
  function handleSOSPressStart() {
    sosStartRef.current = Date.now();
    setSosCountdown(3);
    sosTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - sosStartRef.current) / 1000;
      const remaining = Math.max(0, 3 - Math.floor(elapsed));
      setSosCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(sosTimerRef.current);
        triggerSOS();
      }
    }, 100);
  }

  function handleSOSPressEnd() {
    clearInterval(sosTimerRef.current);
    if (sosCountdown > 0) {
      setSosCountdown(0);
    }
  }

  async function triggerSOS() {
    clearInterval(sosTimerRef.current);
    setSosActive(true);
    setSosCountdown(0);
    try {
      await api.sosTrigger(geo.location?.lat, geo.location?.lng);
      const msg = '紧急呼救已发送！已通知您的紧急联系人和附近的救援人员。请保持冷静，等待救援。';
      spatial.speak(msg, { urgent: true, rate: 0.9 });
      showSubtitle(msg);
    } catch (err) {
      showToast('呼救发送失败，请大声呼救');
    }
  }

  function cancelSOS() {
    setSosActive(false);
    setSosCountdown(0);
    api.sosCancel().catch(() => {});
    showSubtitle('呼救已取消');
  }

  // ===== 聊天输入 =====
  function handleSendChat() {
    const text = chatInput.trim();
    if (!text) return;
    assistant.send(text);
    setChatInput('');
  }

  function toggleInputMode() {
    setInputMode(m => m === 'voice' ? 'text' : 'voice');
  }

  function toggleNavMode() {
    setNavMode(m => m === 'voice' ? 'text' : 'voice');
  }

  // ===== 寻物弹窗 =====
  function confirmFind() {
    const t = findInput.trim();
    if (!t) return;
    setFindTarget(t);
    setFindDialogOpen(false);
    setFindInput('');
    startQuickMode('find', t);
  }

  function openSettings() {
    window.location.hash = '#/settings';
  }

  function toggleCamera() {
    if (camera.active) {
      camera.stop();
    } else {
      camera.start();
    }
  }

  return (
    <div className="am-app">
      {/* 背景层 */}
      <div className="am-bg-layer">
        <video
          ref={camera.videoRef}
          playsInline
          muted
          autoPlay
          className="am-bg-video"
          style={{ display: activeTab === 'recognize' ? 'block' : 'none' }}
        />
        {activeTab === 'navigate' && (
          <MapView
            key="nav-map"
            location={geo.location}
            route={mapRoute}
            pois={mapPois}
            destination={navInput || undefined}
            className="am-bg-map"
            active={activeTab === 'navigate'}
          />
        )}
        {activeTab === 'sos' && <div className="am-bg-sos" />}
        <div className="am-overlay" />
      </div>

      {/* 顶部 Tab */}
      <div className="am-top-tabs" role="tablist" aria-label="主导航">
        <button
          className={`am-tab-pill ${activeTab === 'recognize' ? 'active' : ''}`}
          onClick={() => switchTab('recognize')}
          role="tab"
          aria-selected={activeTab === 'recognize'}
          aria-label="识别模式"
        >
          <span>识别</span>
        </button>
        <button
          className={`am-tab-pill ${activeTab === 'navigate' ? 'active' : ''}`}
          onClick={() => switchTab('navigate')}
          role="tab"
          aria-selected={activeTab === 'navigate'}
          aria-label="导航模式"
        >
          <span>导航</span>
        </button>
        <button
          className={`am-tab-pill danger ${activeTab === 'sos' ? 'active' : ''}`}
          onClick={() => switchTab('sos')}
          role="tab"
          aria-selected={activeTab === 'sos'}
          aria-label="紧急呼救"
        >
          <span>SOS</span>
        </button>
      </div>

      {/* 顶部工具栏（右上角竖排） */}
      <div className="am-top-tools">
        <div className="am-status" aria-live="polite">
          <span className={`am-dot ${ws.connected ? 'on' : 'off'}`} />
          <span className="am-status-text">{ws.connected ? '在线' : '离线'}</span>
        </div>
        <button
          className={`am-icon-btn ${camera.active ? 'on' : ''}`}
          onClick={toggleCamera}
          aria-label={camera.active ? '关闭摄像头' : '开启摄像头'}
          title="摄像头开关"
        >
          {camera.active ? '📹' : '📵'}
        </button>
        <button className="am-icon-btn" aria-label="切换前后摄像头" title="切换摄像头">🔄</button>
        <button className="am-icon-btn" aria-label="闪光灯开关" title="闪光灯">🔦</button>
        <button className="am-icon-btn" onClick={openSettings} aria-label="打开设置" title="设置">⚙️</button>
      </div>

      {/* 持久错误横幅 */}
      {persistentError && (
        <div className="am-error-banner" role="alert">
          <span>{persistentError}</span>
          <button onClick={() => setPersistentError(null)} aria-label="关闭">×</button>
        </div>
      )}

      {/* 内容层（导航提示等浮层） */}
      <div className="am-content-layer">
        {activeTab === 'navigate' && navStep && (
          <div className="am-subtitle-bar" style={{ margin: '0 14px 10px' }}>
            <div style={{ fontWeight: 700, color: 'var(--bio-emerald)', marginBottom: 4 }}>
              {navStep.direction || '直行'}
            </div>
            <div>{navStep.text || '继续前行'}</div>
            {navStep.distance && <div style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: 4 }}>{navStep.distance}</div>}
          </div>
        )}

        {activeTab === 'navigate' && isProcessing && (
          <div className="am-loading" style={{ justifyContent: 'center', padding: '20px' }}>
            <div className="am-spinner small" />
            <span>正在规划路线...</span>
          </div>
        )}

        {activeTab === 'navigate' && geo.location && (
          <div className="am-subtitle-bar" style={{ margin: '0 14px 10px' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>当前位置</div>
            <div style={{ marginTop: 4 }}>
              {geo.location.address || `${geo.location.lat.toFixed(5)}, ${geo.location.lng.toFixed(5)}`}
            </div>
          </div>
        )}
      </div>

      {/* 底部区域 */}
      <div className="am-bottom-zone">
        {/* 识别模式底部 */}
        {activeTab === 'recognize' && (
          <div className="am-recognize-bottom">
            {/* 消息列表 */}
            <div className="am-msg-list" aria-live="polite">
              {assistant.messages.slice(-6).map((msg, i) => (
                <div key={i} className={`am-msg ${msg.role}`}>
                  <div className="am-msg-avatar" />
                  <div className="am-msg-content">
                    {msg.time && <div className="am-msg-time">{msg.time}</div>}
                    <div className="am-msg-bubble">{msg.text}</div>
                  </div>
                </div>
              ))}
              {recognitionResult?.error && (
                <div className="am-msg assistant">
                  <div className="am-msg-avatar" />
                  <div className="am-msg-content">
                    <div className="am-msg-bubble" style={{ background: 'rgba(255,46,126,0.12)', borderColor: 'rgba(255,46,126,0.25)' }}>
                      {recognitionResult.error}
                    </div>
                  </div>
                </div>
              )}
              {isProcessing && (
                <div className="am-msg assistant">
                  <div className="am-msg-avatar" />
                  <div className="am-msg-content">
                    <div className="am-msg-bubble">
                      <span className="am-spinner small" style={{ marginRight: 8, verticalAlign: 'middle' }} />
                      正在分析场景...
                    </div>
                  </div>
                </div>
              )}
              {assistant.booting && (
                <div className="am-msg assistant">
                  <div className="am-msg-avatar" />
                  <div className="am-msg-content">
                    <div className="am-msg-bubble">小舟启动中...</div>
                  </div>
                </div>
              )}
              {assistant.thinking && (
                <div className="am-msg assistant">
                  <div className="am-msg-avatar" />
                  <div className="am-msg-content">
                    <div className="am-msg-bubble">
                      <span className="am-spinner small" style={{ marginRight: 8, verticalAlign: 'middle' }} />
                      小舟思考中...
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 寻物状态条 */}
            {activeMode === 'find' && findTarget && (
              <div className="am-find-status">正在寻找：{findTarget}</div>
            )}

            {/* 副标题（TTS播报内容显示） */}
            {subtitle && !assistant.pendingText && (
              <div className="am-subtitle-bar" aria-live="assertive">{subtitle}</div>
            )}

            {/* 用户实时语音输入显示 */}
            {assistant.pendingText && (
              <div className="am-subtitle-bar" style={{ background: 'rgba(0,255,163,0.08)', borderColor: 'rgba(0,255,163,0.2)' }} aria-live="assertive">
                {assistant.pendingText}
              </div>
            )}

            {/* 唤醒提示 */}
            {assistant.listening && !assistant.active && !assistant.booting && !subtitle && (
              <div className="am-subtitle-bar" style={{ opacity: 0.7 }}>说「小舟小舟」唤醒我</div>
            )}
            {assistant.active && !assistant.pendingText && !subtitle && (
              <div className="am-subtitle-bar" style={{ background: 'rgba(0,229,255,0.08)', borderColor: 'rgba(0,229,255,0.2)' }}>
                正在聆听...
              </div>
            )}

            {/* 快捷按钮行 */}
            <div className="am-quick-row">
              {QUICK_MODES.map(mode => (
                <button
                  key={mode.id}
                  className={`am-quick-icon ${activeMode === mode.id ? 'active' : ''} ${mode.extra || ''}`}
                  onClick={() => handleQuickModeClick(mode.id)}
                  aria-label={mode.label}
                  aria-pressed={activeMode === mode.id}
                >
                  <span className="icon">{mode.icon}</span>
                  <span className="label">{mode.label}</span>
                </button>
              ))}
            </div>

            {/* 输入框 */}
            <div className="am-input-box">
              {inputMode === 'voice' ? (
                <button
                  className={`am-input-box-press ${assistant.active ? 'listening' : ''}`}
                  onClick={() => assistant.startListening()}
                  aria-label="按住说话"
                >
                  <span className="icon">🎤</span>
                  <span>{assistant.active ? '正在聆听...' : '按住说话'}</span>
                </button>
              ) : (
                <input
                  type="text"
                  className="am-input-box-field"
                  placeholder='输入消息或说"小舟小舟"唤醒...'
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                  aria-label="聊天输入"
                  autoComplete="nope"
                  name="chat-msg-recognize"
                />
              )}
              <button
                className="am-input-box-toggle"
                onClick={toggleInputMode}
                aria-label={inputMode === 'voice' ? '切换到文字输入' : '切换到语音输入'}
                title={inputMode === 'voice' ? '切到文字' : '切到语音'}
              >
                {inputMode === 'voice' ? '⌨️' : '🎤'}
              </button>
            </div>
          </div>
        )}

        {/* 导航模式底部 */}
        {activeTab === 'navigate' && (
          <div className="am-navigate-bottom">
            {navigating && (
              <button
                className="am-sos-cancel-btn"
                onClick={stopNavigation}
                style={{ background: 'rgba(255,46,126,0.12)', borderColor: 'rgba(255,46,126,0.3)', color: 'var(--bio-magenta)' }}
              >
                结束导航
              </button>
            )}

            <div className="am-nav-input-box">
              {navMode === 'voice' ? (
                <button
                  className={`am-nav-press-btn ${assistant.active ? 'listening' : ''}`}
                  onClick={() => assistant.startListening()}
                  aria-label="语音输入目的地"
                >
                  <span className="icon">🎤</span>
                  <span>{assistant.active ? '正在聆听...' : '说出目的地'}</span>
                </button>
              ) : (
                <input
                  type="text"
                  className="am-nav-input-field"
                  placeholder="输入目的地，如：人民广场"
                  value={navInput}
                  onChange={e => setNavInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleNavSubmit()}
                  aria-label="目的地输入"
                  autoComplete="nope"
                  name="nav-dest"
                />
              )}
              {navMode === 'text' && (
                <button
                  className="am-nav-send-btn"
                  onClick={handleNavSubmit}
                  disabled={isProcessing || !navInput.trim()}
                  aria-label="开始导航"
                >
                  导航
                </button>
              )}
              <button
                className="am-nav-toggle-btn"
                onClick={toggleNavMode}
                aria-label={navMode === 'voice' ? '切换到文字输入' : '切换到语音输入'}
                title={navMode === 'voice' ? '切到文字' : '切到语音'}
              >
                {navMode === 'voice' ? '⌨️' : '🎤'}
              </button>
            </div>

            {geo.loading && (
              <div className="am-loading" style={{ padding: '12px' }}>
                <div className="am-spinner small" />
                <span>定位中...</span>
              </div>
            )}

            {geo.error && !geo.location && (
              <div className="am-subtitle-bar" style={{ background: 'rgba(255,46,126,0.12)', borderColor: 'rgba(255,46,126,0.25)', color: 'var(--bio-magenta)' }}>
                {geo.error}
              </div>
            )}
          </div>
        )}

        {/* SOS 模式底部 */}
        {activeTab === 'sos' && (
          <div className="am-sos-bottom">
            <div className="am-subtitle-bar" style={{ background: 'rgba(255,46,126,0.1)', borderColor: 'rgba(255,46,126,0.3)' }}>
              {sosCountdown > 0
                ? `${sosCountdown}秒后发送呼救...`
                : sosActive
                  ? '呼救已发送，保持冷静等待救援'
                  : '长按下方按钮3秒发送紧急呼救'}
            </div>
            <button
              className="am-sos-circle"
              onMouseDown={handleSOSPressStart}
              onMouseUp={handleSOSPressEnd}
              onMouseLeave={handleSOSPressEnd}
              onTouchStart={handleSOSPressStart}
              onTouchEnd={handleSOSPressEnd}
              disabled={sosActive}
              aria-label="长按发送SOS"
            >
              <span className="icon">🆘</span>
              <span className="text">{sosCountdown > 0 ? sosCountdown : 'SOS'}</span>
            </button>
            <div className="am-sos-tip">
              {sosActive
                ? '救援人员正在赶来，请保持冷静'
                : '紧急情况下长按3秒触发呼救'}
            </div>
            {sosActive && sosCountdown === 0 && (
              <button className="am-sos-cancel-btn" onClick={cancelSOS}>
                取消呼救（误触）
              </button>
            )}
            <div className="am-sos-help-tip">呼救将发送您的位置给紧急联系人</div>
          </div>
        )}
      </div>

      {/* Toast 提示（不使用TTS） */}
      {toast && <div className="am-toast" role="status">{toast}</div>}

      {/* 寻物弹窗 */}
      {findDialogOpen && (
        <div className="am-find-panel" onClick={() => setFindDialogOpen(false)}>
          <div className="am-find-card" onClick={e => e.stopPropagation()}>
            <div className="am-find-title">寻找物品</div>
            <div className="am-find-hint">请输入要寻找的物品名称</div>
            <div className="am-find-input-row">
              <input
                type="text"
                className="am-find-input"
                placeholder="如：钥匙、水杯、手机"
                value={findInput}
                onChange={e => setFindInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmFind()}
                autoFocus
                autoComplete="nope"
                name="find-target"
              />
            </div>
            <div className="am-find-actions">
              <button className="am-find-cancel" onClick={() => setFindDialogOpen(false)}>
                取消
              </button>
              <button className="am-find-confirm" onClick={confirmFind} disabled={!findInput.trim()}>
                开始寻找
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
