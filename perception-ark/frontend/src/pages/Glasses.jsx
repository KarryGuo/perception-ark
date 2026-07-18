import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useCamera } from '../hooks/useCamera.js';
import { useSpeechSynthesis } from '../hooks/useSpeech.js';
import { useIMU } from '../hooks/useIMU.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useAssistant } from '../hooks/useAssistant.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';
import AssistantWidget from '../components/AssistantWidget.jsx';
import MapView from '../components/MapView.jsx';
import LVAProcess from '../components/LVAProcess.jsx';

const AGENTS = {
  1: { id: 'A01', name: '场景感知', color: '#00FFA3', icon: '👁️' },
  2: { id: 'A02', name: '导航引导', color: '#FFB627', icon: '🧭' },
  3: { id: 'A03', name: '安全预警', color: '#FF2E7E', icon: '🛡️' },
  4: { id: 'A04', name: '社交辅助', color: '#7B61FF', icon: '💬' },
  5: { id: 'A05', name: '环境记忆', color: '#00E5FF', icon: '🧠' }
};

export default function Glasses() {
  const { user, logout } = useAuth();
  // ===== 状态 =====
  const [agentStates, setAgentStates] = useState({
    1: { active: false, output: '等待启动 · 每10秒输出环境描述' },
    2: { active: false, output: '语音输入目的地后启动导航' },
    3: { active: false, output: '按需激活 · 检测车辆/障碍物 · 跌倒由IMU自动触发' },
    4: { active: false, output: '按需激活 · OCR · 人脸识别' },
    5: { active: false, output: '学习常用路线 · 熟人面孔 · 生活偏好' }
  });
  const [logs, setLogs] = useState([]);
  const [subtitle, setSubtitle] = useState({ text: '等待播报...', priority: false });
  const [alert, setAlert] = useState({ show: false, text: '' });
  const [sos, setSos] = useState({ show: false, title: '', sub: '' });
  const [toast, setToast] = useState({ show: false, text: '' });
  const [stats, setStats] = useState({ traeConfigured: false, preemptionCount: 0 });
  const [voiceInput, setVoiceInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [weather, setWeather] = useState(null);
  const [mapLocation, setMapLocation] = useState(null);
  const [mapRoute, setMapRoute] = useState(null);
  const [mapPois, setMapPois] = useState(null);

  const bootingRef = useRef(false);

  // ===== Hooks =====
  const { speak, stop: stopSpeak, speaking, supported: ttsSupported } = useSpeechSynthesis();
  const camera = useCamera();
  const { location } = useGeolocation();

  // ===== 摄像头强制开启(识物功能依赖) =====
  useEffect(() => {
    if (!camera.active && !camera.error) {
      camera.start();
    }
  }, [camera.active, camera.error]);

  // ===== 小舟智能助手 =====
  // onAgentAction回调: 小舟意图识别后,前端直接调用对应Agent API(不依赖WebSocket推送)
  // 使用ref存放最新的action handler,避免闭包陷阱
  const agentActionHandlerRef = useRef(null);
  const handleAgentAction = useCallback((actionInfo) => {
    if (agentActionHandlerRef.current) {
      agentActionHandlerRef.current(actionInfo);
    }
  }, []);
  const handleWeatherReady = useCallback((w) => setWeather(w), []);
  const assistant = useAssistant({
    location,
    onAgentAction: handleAgentAction,
    onWeatherReady: handleWeatherReady
  });

  // 系统进入后自动精确定位: 位置变化时更新地图
  useEffect(() => {
    if (location?.lat && location?.lng) {
      setMapLocation(location);
    }
  }, [location]);

  // 同步小舟开机播报状态
  useEffect(() => {
    bootingRef.current = assistant.booting;
  }, [assistant.booting]);

  // ===== WebSocket: 接收后端事件 =====
  const handleWsEvent = useCallback((event) => {
    // 调试日志: 确认事件到达前端
    console.log('[WS Event]', event.type, event.agentId || event.title || event.text?.slice(0, 30) || '');
    if (bootingRef.current &&
        (event.type === 'speak' || event.type === 'subtitle')) {
      return;
    }
    switch (event.type) {
      case 'log':
        setLogs(prev => [...prev.slice(-49), {
          time: new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour12: false }),
          agent: event.agentId?.toLowerCase() || 'sys',
          text: event.message,
          level: event.level
        }]);
        break;
      case 'agent_state':
        setAgentStates(prev => ({
          ...prev,
          [event.agentId.slice(1)]: { active: event.active, output: event.output || prev[event.agentId.slice(1)]?.output || '' }
        }));
        break;
      case 'speak':
        if (event.text) speak(event.text, { urgent: event.urgent });
        break;
      case 'subtitle':
        setSubtitle({ text: event.text, priority: event.priority });
        break;
      case 'route':
        console.log('[Route] 收到路线事件, polyline长度:', event.polyline?.length || 0);
        // 收到路线规划结果时清空POI标记
        setMapPois(null);
        if (event.polyline) {
          try {
            const coords = event.polyline.split(';')
              .filter(p => p)
              .map(p => {
                const [lng, lat] = p.split(',').map(parseFloat);
                return [lng, lat];
              })
              .filter(c => !isNaN(c[0]) && !isNaN(c[1]));
            console.log('[Route] 解析坐标点数:', coords.length, '前2个:', coords.slice(0, 2));
            if (coords.length > 1) {
              setMapRoute(coords);
              showToast(`🧭 路线已规划: ${event.distance}米, 约${event.duration}分钟`);
            }
          } catch (e) {
            console.error('[Route] 解析失败:', e);
          }
        }
        break;
      case 'alert':
        setAlert({ show: true, text: event.text });
        setTimeout(() => setAlert({ show: false, text: '' }), 4000);
        break;
      case 'sos':
        setSos({ show: true, title: event.title, sub: event.sub });
        setTimeout(() => setSos(prev => ({ ...prev, show: false })), 8000);
        break;
      case 'preemption':
        showToast(`⚡ 优先级抢占: ${event.preemptedBy} 抢占 ${event.preempted}`);
        break;
      case 'location':
        break;
      case 'poi_list':
        // 附近搜索结果: 地图上显示多个POI标记
        console.log('[POI] 收到附近搜索结果:', event.pois?.length || 0, '个');
        if (event.pois && event.pois.length > 0) {
          setMapPois(event.pois);
          setMapRoute(null); // 清空旧路线
          showToast(`📍 附近找到${event.pois.length}个结果，说"去第一个"开始导航`);
        }
        break;
    }
  }, [speak]);

  const { connected: wsConnected } = useWebSocket(handleWsEvent);

  // 加载系统状态
  useEffect(() => {
    api.stats().then(s => setStats(s)).catch(() => {});
    const interval = setInterval(() => {
      api.stats().then(s => setStats(s)).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // 小舟助手 ASR 转录同步: 实时显示用户正在说的话
  useEffect(() => {
    if (assistant.active && assistant.pendingText) {
      setVoiceInput(assistant.pendingText);
    } else if (assistant.active && !assistant.pendingText && assistant.lastTranscript) {
      setVoiceInput(assistant.lastTranscript);
    }
  }, [assistant.pendingText, assistant.lastTranscript, assistant.active]);

  // ===== 辅助函数 =====
  const showToast = useCallback((text) => {
    setToast({ show: true, text });
    setTimeout(() => setToast({ show: false, text: '' }), 2500);
  }, []);

  const captureImage = useCallback(async () => {
    if (!camera.active) {
      showToast('请先启动摄像头');
      speak('请先启动摄像头');
      return null;
    }
    const file = await camera.capture();
    if (!file) showToast('拍照失败,请重试');
    return file;
  }, [camera, showToast, speak]);

  // ===== Agent调用 =====
  const handleSceneAgent = useCallback(async () => {
    setBusy(true);
    try {
      const img = await captureImage();
      if (!img) return;
      await api.scene(img, '请用一段话描述当前场景，包括：路面状况、前方主要物体及大致距离、场景类型。专为视障者设计。50-100字。');
    } catch (err) {
      // 错误只显示在toast,不speak(避免TTS音频被小舟助手麦克风捕获形成回声循环)
      showToast(`场景感知失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, showToast]);

  const handleNavigation = useCallback(async (destination) => {
    const dest = (destination || voiceInput || '').trim();
    if (!dest) {
      showToast('请告诉我目的地');
      return;
    }
    setBusy(true);
    try {
      await api.navigate(dest, location?.lat, location?.lng);
      if (voiceInput) setVoiceInput('');
    } catch (err) {
      // 错误只显示,不speak(避免回声循环)
      showToast(`导航失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [voiceInput, location, showToast]);

  const handleSafety = useCallback(async () => {
    setBusy(true);
    try {
      const img = await captureImage();
      await api.safety(img, 'scan');
    } catch (err) {
      showToast(`安全扫描失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, showToast]);

  const handleOCR = useCallback(async () => {
    setBusy(true);
    try {
      const img = await captureImage();
      if (!img) return;
      await api.social(img, 'ocr');
    } catch (err) {
      showToast(`OCR识别失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, showToast]);

  const handleFace = useCallback(async () => {
    setBusy(true);
    try {
      const img = await captureImage();
      if (!img) return;
      await api.social(img, 'face');
    } catch (err) {
      showToast(`人脸识别失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, showToast]);

  const handleMemory = useCallback(async () => {
    setBusy(true);
    try {
      await api.memory('检索最近记忆');
    } catch (err) {
      showToast(`记忆检索失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [showToast]);

  // ===== 小舟action回调: 收到action后前端直接调用对应Agent API =====
  // 不依赖WebSocket事件推送,确保地图路线绘制和Agent调用可靠执行
  const handleAgentActionImpl = useCallback(async (actionInfo) => {
    const { action, entity } = actionInfo;
    console.log('[Agent Action] 前端直接调用:', action, entity);
    try {
      switch (action) {
        case 'navigate': {
          // 导航: 直接调用api.navigate,解析polyline绘制路线
          const dest = (entity || '').trim();
          if (!dest) {
            speak('请告诉我您要去哪里');
            showToast('请告诉我目的地');
            break;
          }
          const result = await api.navigate(dest, location?.lat, location?.lng);
          if (result.success && result.result?.polyline) {
            const coords = result.result.polyline.split(';')
              .filter(p => p)
              .map(p => {
                const [lng, lat] = p.split(',').map(parseFloat);
                return [lng, lat];
              })
              .filter(c => !isNaN(c[0]) && !isNaN(c[1]));
            if (coords.length > 1) {
              setMapRoute(coords);
              showToast(`🧭 已规划到${dest}的路线: ${result.result.distance}米, 约${result.result.duration}分钟`);
            }
          }
          break;
        }
        case 'scene': {
          const img = await captureImage();
          if (img) await api.scene(img, `请描述当前场景,专为视障者设计`);
          break;
        }
        case 'safety': {
          const img = await captureImage();
          if (img) await api.safety(img, 'scan');
          break;
        }
        case 'ocr': {
          const img = await captureImage();
          if (img) await api.social(img, 'ocr');
          break;
        }
        case 'face': {
          const img = await captureImage();
          if (img) await api.social(img, 'face');
          break;
        }
        case 'memory': {
          await api.memory(entity || '检索最近记忆');
          break;
        }
        case 'fall': {
          await api.fall(location?.lat, location?.lng);
          break;
        }
      }
    } catch (err) {
      console.error('[Agent Action] 调用失败:', action, err.message);
      // 错误只显示,不speak(避免TTS音频被小舟助手麦克风捕获形成回声循环)
      showToast(`能力调用失败: ${err.message}`);
    }
  }, [location, captureImage, showToast]);

  // 用useEffect同步ref,避免渲染过程中修改ref(React 18并发渲染安全)
  useEffect(() => {
    agentActionHandlerRef.current = handleAgentActionImpl;
  }, [handleAgentActionImpl]);

  // ===== 跌倒检测回调(由真实IMU触发) =====
  const handleFallRef = useRef(null);
  const handleFallImpl = useCallback(async () => {
    setBusy(true);
    try {
      await api.fall(location?.lat, location?.lng);
    } catch (err) {
      // 错误只显示,不speak(避免回声循环)
      showToast(`跌倒告警失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [location, showToast]);

  useEffect(() => {
    handleFallRef.current = handleFallImpl;
  }, [handleFallImpl]);

  const imu = useIMU(useCallback((event) => {
    if (event.simulated) {
      showToast('🎯 模拟跌倒触发');
    } else {
      showToast(`⚠ 检测到冲击 ${event.peak.toFixed(1)} m/s²`);
    }
    if (handleFallRef.current) handleFallRef.current();
  }, [showToast]));

  const handleVoiceCommand = useCallback(async () => {
    if (!voiceInput.trim()) {
      showToast('请输入或说出指令，或唤醒小舟"小舟小舟"');
      return;
    }
    setBusy(true);
    try {
      const img = camera.active ? await camera.capture() : null;
      await api.voice(voiceInput, img, location);
      setVoiceInput('');
    } catch (err) {
      // 错误只显示,不speak(避免回声循环)
      showToast(`指令执行失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [voiceInput, camera, location, showToast]);

  // ===== 摄像头开关 =====
  const toggleCamera = useCallback(async () => {
    // 摄像头强制开启: 只允许重启,不允许关闭
    if (camera.active) {
      camera.stop();
      setTimeout(() => camera.start(), 300);
    } else {
      const ok = await camera.start();
      if (!ok) showToast(camera.error || '摄像头启动失败');
    }
  }, [camera, showToast]);

  // ===== 渲染 =====
  return (
    <>
      <div className="ambient"></div>

      {/* Top Bar */}
      <nav className="topbar">
        <div className="topbar-left">
          <a href="#/" className="topbar-brand">PerceptionArk</a>
          <span className="topbar-tag">感知方舟</span>
          <span className="topbar-trae">⚡ TRAE Powered · {stats.traeConfigured ? 'LIVE' : '未连接'}</span>
        </div>
        <div className="topbar-right">
          <div className="tb-stat" title="WebSocket连接状态">
            <span className={`dot ${wsConnected ? 'green' : 'red'}`}></span>
            <span>{wsConnected ? '在线' : '离线'}</span>
          </div>
          {user ? (
            <>
              <span className="tb-stat" style={{ color: 'var(--bio-cyan)' }}>{user.username}</span>
              <a href="#/guide" className="tb-link">说明</a>
              <a href="#/app" className="tb-link">APP端</a>
              <a href="#/family" className="tb-link">家属端</a>
              <a href="#/" className="tb-link" onClick={logout} style={{ color: 'var(--bio-magenta)' }}>退出</a>
            </>
          ) : (
            <>
              <a href="#/guide" className="tb-link">说明</a>
              <a href="#/app" className="tb-link">APP端</a>
              <a href="#/family" className="tb-link">家属端</a>
              <a href="#/login" className="tb-link">登录</a>
            </>
          )}
        </div>
      </nav>

      {/* Main */}
      <div className="main">
        {/* LEFT: Camera & Voice & LVA */}
        <div className="cam-panel">
          <div className="panel-label">Glasses Camera Input · 眼镜摄像头</div>
          <div className="cam-frame">
            <video className="cam-video" ref={camera.videoRef} playsInline muted style={{ display: camera.active ? 'block' : 'none' }} />
            {!camera.active && (
              <div className="cam-error">
                <div className="ce-icon">📷</div>
                <div className="ce-text">摄像头未启动<br/>点击下方按钮启用真实摄像头输入</div>
              </div>
            )}
            <div className="cam-overlay">
              <div className="cam-corners"><span></span></div>
            </div>
            {camera.active && (
              <>
                <div className="cam-status">
                  <span className="rec-dot"></span>
                  <span>LIVE · 1280×720</span>
                </div>
                <div className="cam-label">
                  <span>SCENE: REAL_INPUT</span>
                  <span>30fps</span>
                </div>
              </>
            )}
          </div>

          <div className="cam-actions">
            <button className={`cam-btn primary ${camera.active ? '' : 'danger'}`} onClick={toggleCamera}>
              {camera.active ? '🔄 重启摄像头' : '▶ 启动摄像头'}
            </button>
            <button className="cam-btn" onClick={() => captureImage().then(f => f && showToast('📸 已抓拍一帧'))} disabled={!camera.active}>
              📸 拍照
            </button>
          </div>

          {/* IMU Monitor */}
          <div className="panel-label">IMU 传感器 · 跌倒检测</div>
          <div className="imu-monitor">
            <div className="imu-row">
              <span>加速度: <span className="imu-val">{imu.magnitude.toFixed(2)} m/s²</span></span>
              <span>{imu.supported ? '✓ 已连接' : '✗ 不支持'}</span>
            </div>
            <div className="imu-bar">
              <div className="imu-bar-fill" style={{ width: `${Math.min(100, (imu.magnitude / 35) * 100)}%` }}></div>
            </div>
            {imu.fallDetected && (
              <div className="imu-row" style={{ color: 'var(--bio-magenta)', marginTop: 4 }}>
                ⚠ 检测到跌倒！已自动发送SOS告警
              </div>
            )}
          </div>

          {/* Subtitle */}
          <div className={`subtitle-bar ${subtitle.text === '等待播报...' ? 'empty' : ''} ${subtitle.priority ? 'priority' : ''}`}>
            <span className="sb-icon">{subtitle.priority ? '⚠️' : '🔊'}</span>
            <span className="sb-text">{subtitle.text}</span>
          </div>

          {/* Voice Input */}
          <div className="panel-label">Voice Command · 语音指令</div>
          <div className="voice-input">
            <input
              type="text"
              value={voiceInput}
              onChange={e => setVoiceInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleVoiceCommand()}
              placeholder="输入指令，如：带我去超市"
              disabled={busy}
            />
            <button
              className="voice-btn"
              onClick={() => assistant.active ? assistant.send(voiceInput) : assistant.startListening()}
              title="语音输入由小舟助手统一管理，点击唤醒小舟"
            >
              {assistant.active ? '📨 发给小舟' : '🎤 唤醒小舟'}
            </button>
            <button className="voice-btn" onClick={handleVoiceCommand} disabled={busy}>发送</button>
          </div>
          <div className="voice-hint">
            试试："带我去超市" · "读一下菜单" · "前面是谁" · "安全检查"<br/>
            TTS: {ttsSupported ? '✓' : '✗'} · 小舟: {assistant.listening ? '🎧 待唤醒' : assistant.active ? '💬 对话中' : assistant.booting ? '🔄 开机中' : '○ 待启动'}
            {!assistant.supported && <span style={{color: 'var(--bio-magenta)'}}> · ⚠ 浏览器不支持语音</span>}
          </div>

          {/* LVA 推理过程 */}
          <div className="panel-label">LVA · 视觉推理流水线</div>
          <LVAProcess
            cameraActive={camera.active}
            onCaptureFrame={captureImage}
            activeAgent={Object.entries(agentStates).find(([_, v]) => v.active)?.[0]}
            externalBusy={busy}
            sceneOutput={agentStates[1]?.output}
            routeInfo={agentStates[2]?.output}
          />
        </div>

        {/* CENTER: 地图展示 */}
        <div className="map-panel">
          <MapView location={mapLocation} route={mapRoute} pois={mapPois} className="map-stage" />

          {weather && (
            <div className="map-weather-overlay">
              <div className="mw-city">{weather.city || '当前城市'}</div>
              <div className="mw-temp">{weather.dayTemp || '--'}°</div>
              <div className="mw-text">{weather.dayWeather || '--'}</div>
              <div className="mw-detail">{weather.dayWind}风{weather.dayPower}级 · 湿度{weather.humidity || '--'}%</div>
            </div>
          )}

          <div className="map-log-strip">
            <span className="mls-label">SYS LOG</span>
            <div className="mls-content">
              {logs.length === 0 ? '系统就绪，等待指令...' : logs.slice(-3).map((l, i) => `[${l.agent}] ${l.text}`).join('  ·  ')}
            </div>
          </div>
        </div>

        {/* RIGHT: Agent Panels */}
        <div className="agents-panel">
          <div className="panel-label">Orchestrator · 模型编排联动</div>
          <div className="orch-mini">
            <div className="orch-mini-stage">
              <svg className="orch-mini-lines" viewBox="0 0 200 200" preserveAspectRatio="none">
                <path className={`orch-line ${agentStates[1].active ? 'active' : ''}`} d="M100 100 L100 30" stroke="#00FFA3" />
                <path className={`orch-line ${agentStates[2].active ? 'active' : ''}`} d="M100 100 L165 67" stroke="#FFB627" />
                <path className={`orch-line ${agentStates[3].active ? 'active' : ''}`} d="M100 100 L140 157" stroke="#FF2E7E" />
                <path className={`orch-line ${agentStates[4].active ? 'active' : ''}`} d="M100 100 L60 157" stroke="#7B61FF" />
                <path className={`orch-line ${agentStates[5].active ? 'active' : ''}`} d="M100 100 L35 67" stroke="#00E5FF" />
              </svg>
              <div className={`orch-mini-hub ${Object.values(agentStates).some(a => a.active) ? 'active' : ''}`}>
                <span className="orch-mini-hub-text">ORCH</span>
              </div>
              {Object.entries(AGENTS).map(([id, agent]) => (
                <div key={id} className={`orch-mini-node n${id} ${agentStates[id].active ? 'active' : ''}`}>
                  <span className="omn-icon">{agent.icon}</span>
                  <span className="omn-name">{agent.name}</span>
                  <span className="omn-id">{agent.id}</span>
                </div>
              ))}
            </div>
            <div className="orch-mini-legend">
              {Object.entries(AGENTS).map(([id, agent]) => (
                <div key={id} className={`oml-item ${agentStates[id].active ? 'active' : ''}`}>
                  <span className="oml-dot" style={{ background: agent.color }}></span>
                  <span className="oml-id">{agent.id}</span>
                  <span className="oml-name">{agent.name}</span>
                  <span className="oml-status">{agentStates[id].active ? '● 运行' : '○ 待命'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel-label">Agent Status · 五智能体状态</div>
          {Object.entries(AGENTS).map(([id, agent]) => (
            <div key={id} className={`agent-card c${id} ${agentStates[id].active ? 'active' : ''}`}>
              <div className="ac-head">
                <div className="ac-head-left">
                  <span className="ac-id">A0{id}·P{id === '3' ? '0' : id === '1' ? '1' : id === '2' ? '2' : '3'}</span>
                  <span className="ac-name">{agent.name}</span>
                </div>
                <span className="ac-status">
                  {agentStates[id].active ? 'ACTIVE' : 'STANDBY'}
                </span>
              </div>
              <div className="ac-output">
                {agentStates[id].output || <span className="placeholder">等待启动...</span>}
              </div>
            </div>
          ))}

          <div className="panel-label">Actions · 功能操作</div>
          {busy && (
            <div className="subtitle-bar" style={{ marginBottom: 8, background: 'rgba(0,229,255,0.06)', borderColor: 'rgba(0,229,255,0.2)' }}>
              <span className="sb-icon">⏳</span>
              <span className="sb-text">正在处理，请稍候...</span>
            </div>
          )}
          {!camera.active && (
            <div className="subtitle-bar empty" style={{ marginBottom: 8, fontSize: '.72rem' }}>
              <span className="sb-icon">📷</span>
              <span className="sb-text">摄像头未启用，视觉类功能不可用（导航/记忆不受影响）</span>
            </div>
          )}
          <div className="action-bar">
            <button className="action-btn ab1" onClick={handleSceneAgent} disabled={busy || !camera.active}>👁️ 场景描述</button>
            <button className="action-btn ab2" onClick={() => handleNavigation()} disabled={busy}>🧭 开始导航</button>
            <button className="action-btn ab3" onClick={handleSafety} disabled={busy || !camera.active}>🛡️ 安全扫描</button>
            <button className="action-btn ab4" onClick={handleOCR} disabled={busy || !camera.active}>📖 读取文字</button>
            <button className="action-btn ab5" onClick={handleMemory} disabled={busy}>🧠 记忆检索</button>
            <button className="action-btn ab4" onClick={handleFace} disabled={busy || !camera.active}>👤 人脸识别</button>
          </div>

          <div className="panel-label">System Stats · 系统统计</div>
          <div className="imu-monitor">
            <div className="imu-row">
              <span>TRAE: <span className="imu-val">{stats.traeConfigured ? '✓ 已连接' : '未连接'}</span></span>
              <span>抢占: <span className="imu-val">{stats.preemptionCount || 0}</span></span>
            </div>
            <div className="imu-row" style={{ marginTop: 4 }}>
              <span>路线记忆: <span className="imu-val">{stats.routes || 0}</span></span>
              <span>熟人: <span className="imu-val">{stats.faces || 0}</span></span>
              <span>习惯: <span className="imu-val">{stats.habits || 0}</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Overlays */}
      <div className="speaking-bar">
        <div className="sb-fill" style={{ width: speaking ? '100%' : '0%' }}></div>
      </div>
      <div className={`alert-overlay ${alert.show ? 'show' : ''}`}>
        <div className="alert-text">⚠ {alert.text}</div>
      </div>
      <div className={`sos-overlay ${sos.show ? 'show' : ''}`}>
        <div className="sos-content">
          <div className="sos-title">{sos.title}</div>
          <div className="sos-sub">{sos.sub}</div>
        </div>
      </div>
      <div className={`toast ${toast.show ? 'show' : ''}`}>{toast.text}</div>
      <AssistantWidget assistant={assistant} />
    </>
  );
}
