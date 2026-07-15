import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useCamera } from '../hooks/useCamera.js';
import { useSpeechSynthesis, useSpeechRecognition } from '../hooks/useSpeech.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';
import MapView from '../components/MapView.jsx';

/**
 * 感知方舟 · 移动端APP (沉浸式全屏版)
 * - 识别: 全屏摄像头背景 + 浮动透明按钮 + 聊天浮层
 * - 导航: 全屏3D地图 + 浮动工具栏 + 底部输入
 * - SOS:  全屏背景 + 浮动紧急按钮 + 联系人列表
 */
export default function AppMobile() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('recognize');
  const [messages, setMessages] = useState([]);
  const [subtitle, setSubtitle] = useState('点击下方按钮或按住说话开始使用');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [navInput, setNavInput] = useState('');
  const [mapRoute, setMapRoute] = useState(null);
  const [mapPois, setMapPois] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [torchOn, setTorchOn] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [showFavorites, setShowFavorites] = useState(false); // 导航页收藏浮层
  const [activeMode, setActiveMode] = useState(null); // null | 'analyze' | 'travel' | 'read' | 'traffic'
  const [showTextInput, setShowTextInput] = useState(false); // 识别页文字输入模式

  const { speak, stop: stopSpeak } = useSpeechSynthesis();
  const asr = useSpeechRecognition();
  const camera = useCamera();
  const { location } = useGeolocation();

  const messagesEndRef = useRef(null);
  const isPressingRef = useRef(null);
  const modeIntervalRef = useRef(null); // 连续分析定时器

  // 摄像头强制开启
  useEffect(() => {
    if (!camera.active && !camera.error) camera.start();
  }, [camera.active, camera.error]);

  // WebSocket事件
  const handleWsEvent = useCallback((event) => {
    switch (event.type) {
      case 'speak':
        if (event.text) speak(event.text, { urgent: event.urgent });
        break;
      case 'subtitle':
        setSubtitle(event.text);
        addMessage('assistant', event.text);
        break;
      case 'poi_list':
        if (event.pois?.length > 0) {
          setMapPois(event.pois);
          setMapRoute(null);
          const top3 = event.pois.slice(0, 3);
          let text = `附近找到${event.pois.length}个结果。`;
          top3.forEach((p, i) => { text += `第${i+1}个，${p.name}，${p.distance}米。`; });
          text += '说"去第一个"开始导航。';
          setSubtitle(text);
          addMessage('assistant', text);
        }
        break;
      case 'route':
        setMapPois([]);
        if (event.polyline) {
          try {
            const coords = event.polyline.split(';').filter(p => p).map(p => {
              const [lng, lat] = p.split(',').map(parseFloat);
              return [lng, lat];
            }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
            if (coords.length > 1) {
              setMapRoute(coords);
              addMessage('assistant', `路线已规划：${event.distance}米，约${event.duration}分钟。`);
            }
          } catch (e) {}
        }
        break;
    }
  }, [speak]);

  const { connected } = useWebSocket(handleWsEvent);

  const addMessage = useCallback((role, text) => {
    setMessages(prev => [...prev.slice(-30), { role, text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }]);
  }, []);

  const showToast = useCallback((text) => {
    setToast(text);
    setTimeout(() => setToast(''), 2500);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 语音指令切换tab
  useEffect(() => {
    if (!asr.transcript) return;
    const text = asr.transcript;
    if (/打开识别|识别模式|切换识别/.test(text)) { switchTab('recognize'); asr.stop(); }
    else if (/打开导航|导航模式|切换导航/.test(text)) { switchTab('navigate'); asr.stop(); }
    else if (/紧急呼救|SOS|救命|呼救/.test(text)) { switchTab('sos'); asr.stop(); }
  }, [asr.transcript]);

  useEffect(() => {
    api.familyContacts().then(r => setContacts(r.contacts || [])).catch(() => {});
    api.familyUsers().then(r => setFavorites(r.users || [])).catch(() => {});
  }, []);

  const switchTab = useCallback((tab) => {
    setActiveTab(tab);
    const names = { recognize: '识别', navigate: '导航', sos: '紧急呼救' };
    showToast(`已切换到${names[tab]}`);
  }, [showToast]);

  // ===== 按住说话 =====
  const handlePressStart = useCallback(() => {
    isPressingRef.current = true;
    if (!asr.supported) { showToast('当前浏览器不支持语音识别'); return; }
    asr.start();
    setSubtitle('正在聆听...');
  }, [asr, showToast]);

  const handlePressEnd = useCallback(() => {
    isPressingRef.current = false;
    if (asr.listening) asr.stop();
    setTimeout(() => setSubtitle('点击下方按钮或按住说话开始使用'), 1000);
  }, [asr]);

  useEffect(() => {
    if (!asr.transcript || isPressingRef.current === null) return;
    const text = asr.transcript.trim();
    if (!text) return;
    if (/打开识别|识别模式/.test(text)) { switchTab('recognize'); return; }
    if (/打开导航|导航模式/.test(text)) { switchTab('navigate'); return; }
    if (/紧急呼救|SOS|救命/.test(text)) { switchTab('sos'); return; }
    addMessage('user', text);
    if (activeTab === 'recognize') handleRecognizeCommand(text);
    else if (activeTab === 'navigate') handleNavigateCommand(text);
  }, [asr.transcript]);

  // ===== 识别页功能 =====
  const captureImage = useCallback(async () => {
    if (!camera.active) { showToast('摄像头未开启'); speak('摄像头未开启'); return null; }
    return await camera.capture();
  }, [camera, showToast, speak]);

  const handleRecognizeCommand = useCallback(async (text) => {
    setBusy(true);
    try {
      const img = await captureImage();
      if (!img) { setBusy(false); return; }
      if (/快速分析|分析|描述/.test(text)) await api.scene(img, '请用一段话描述当前场景,包括前方物体、路面状况、可能的障碍。专为视障者设计,50字以内。');
      else if (/阅读|文字|读/.test(text)) await api.social(img, 'ocr');
      else if (/红绿灯|红灯|绿灯|信号灯/.test(text)) await api.safety(img, 'scan');
      else await api.scene(img, '请用一段话描述当前场景,专为视障者设计,50字以内。');
    } catch (err) {
      addMessage('assistant', `识别失败: ${err.message}`);
      speak(`识别失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [captureImage, addMessage, speak]);

  // ===== 模式切换(开启/关闭连续分析) =====
  const modeNames = { analyze: '快速分析', travel: '出行模式', read: '阅读文字', traffic: '红绿灯识别' };
  const modeHints = {
    analyze: '正在分析当前场景',
    travel: '正在检测前方障碍物',
    read: '正在识别文字内容',
    traffic: '正在识别红绿灯状态'
  };

  const toggleMode = useCallback((mode) => {
    setActiveMode(prev => {
      if (prev === mode) {
        // 关闭当前模式
        speak(`${modeNames[mode]}已关闭`);
        showToast(`${modeNames[mode]}已关闭`);
        return null;
      } else {
        // 开启新模式(如果之前有模式,先关闭)
        if (prev) {
          speak(`${modeNames[prev]}已关闭`);
        }
        speak(`${modeNames[mode]}已开启，${modeHints[mode]}`);
        showToast(`${modeNames[mode]}已开启`);
        addMessage('user', `开启${modeNames[mode]}`);
        return mode;
      }
    });
  }, [speak, showToast, addMessage]);

  // 连续分析循环 - 当activeMode不为null时,每5秒抓拍并分析一次
  useEffect(() => {
    if (!activeMode) {
      if (modeIntervalRef.current) {
        clearInterval(modeIntervalRef.current);
        modeIntervalRef.current = null;
      }
      return;
    }

    let running = false;
    const runOnce = async () => {
      if (running) return;
      running = true;
      try {
        const img = await camera.capture();
        if (!img) { running = false; return; }

        let res;
        if (activeMode === 'analyze') {
          res = await api.scene(img, '请用一段话描述当前场景,包括前方主要物体及大致距离。专为视障者设计,50字以内。');
        } else if (activeMode === 'travel') {
          res = await api.safety(img, 'scan');
        } else if (activeMode === 'read') {
          res = await api.social(img, 'ocr');
        } else if (activeMode === 'traffic') {
          res = await api.safety(img, 'scan');
        }

        if (res?.success && res.result) {
          const text = typeof res.result === 'string' ? res.result : String(res.result);
          addMessage('assistant', text);
          speak(text);
          setSubtitle(text);

          // 出行模式: 检测到危险时手机震动
          if (activeMode === 'travel' && /危险|障碍|靠近|前方有|小心|注意|当心|车辆|电动车/.test(text)) {
            if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
          }
        }
      } catch (err) {
        console.error('[Mode] 分析失败:', err.message);
      } finally {
        running = false;
      }
    };

    // 立即执行一次,然后每5秒执行
    runOnce();
    modeIntervalRef.current = setInterval(runOnce, 5000);

    return () => {
      if (modeIntervalRef.current) {
        clearInterval(modeIntervalRef.current);
        modeIntervalRef.current = null;
      }
    };
  }, [activeMode, camera, addMessage, speak]);

  // 切换tab时关闭连续分析模式
  useEffect(() => {
    if (activeTab !== 'recognize' && activeMode) {
      setActiveMode(null);
    }
  }, [activeTab, activeMode]);

  // ===== 导航页功能 =====
  const handleNavigateCommand = useCallback(async (text) => {
    setBusy(true);
    try { await api.navigate(text, location?.lat, location?.lng); }
    catch (err) { addMessage('assistant', `导航失败: ${err.message}`); speak(`导航失败: ${err.message}`); }
    finally { setBusy(false); }
  }, [location, addMessage, speak]);

  // ===== 文本输入提交(必须在handleRecognizeCommand/handleNavigateCommand之后定义) =====
  const handleTextInputSubmit = useCallback((text) => {
    if (/打开识别|识别模式/.test(text)) { switchTab('recognize'); return; }
    if (/打开导航|导航模式/.test(text)) { switchTab('navigate'); return; }
    if (/紧急呼救|SOS|救命/.test(text)) { switchTab('sos'); return; }
    addMessage('user', text);
    if (activeTab === 'recognize') handleRecognizeCommand(text);
    else if (activeTab === 'navigate') handleNavigateCommand(text);
  }, [activeTab, switchTab, addMessage, handleRecognizeCommand, handleNavigateCommand]);

  const handleNavigate = useCallback(async (dest) => {
    const destination = (dest || navInput).trim();
    if (!destination) { showToast('请输入目的地'); speak('请告诉我您要去哪里'); return; }
    setBusy(true);
    addMessage('user', `导航到${destination}`);
    try { await api.navigate(destination, location?.lat, location?.lng); setNavInput(''); }
    catch (err) { addMessage('assistant', `导航失败: ${err.message}`); speak(`导航失败: ${err.message}`); }
    finally { setBusy(false); }
  }, [navInput, location, addMessage, showToast, speak]);

  // ===== SOS紧急呼救 =====
  const handleSos = useCallback(async () => {
    setBusy(true);
    addMessage('user', '🆘 紧急呼救');
    try {
      await api.fall(location?.lat, location?.lng);
      addMessage('assistant', '已发送SOS紧急呼救，紧急联系人将收到您的位置信息。');
    } catch (err) {
      addMessage('assistant', `SOS发送失败: ${err.message}`);
      speak(`SOS发送失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [location, addMessage, speak]);

  // ===== 闪光灯 =====
  const toggleTorch = useCallback(async () => {
    try {
      const track = camera.stream?.getVideoTracks()[0];
      if (!track) return;
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (!capabilities.torch) { showToast('当前设备不支持闪光灯'); return; }
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
      showToast(torchOn ? '闪光灯已关' : '闪光灯已开');
    } catch (err) { showToast('闪光灯切换失败'); }
  }, [camera, torchOn, showToast]);

  return (
    <div className="am-app">
      {/* ===== 全屏背景层 ===== */}
      <div className="am-bg-layer">
        <video ref={camera.videoRef} playsInline muted autoPlay
          className="am-bg-video"
          style={{ display: activeTab === 'recognize' ? 'block' : 'none' }}
        />
        {activeTab === 'navigate' && (
          <MapView location={location} route={mapRoute} pois={mapPois} className="am-bg-map" />
        )}
        {activeTab === 'sos' && (
          <div className="am-bg-sos" />
        )}
        {/* 暗化遮罩(提升文字可读性) */}
        <div className="am-overlay" />
      </div>

      {/* ===== 顶部浮动Tab栏 ===== */}
      <div className="am-top-tabs">
        <button className={`am-tab-pill ${activeTab === 'recognize' ? 'active' : ''}`} onClick={() => switchTab('recognize')}>
          <span>识别</span>
        </button>
        <button className={`am-tab-pill ${activeTab === 'navigate' ? 'active' : ''}`} onClick={() => switchTab('navigate')}>
          <span>导航</span>
        </button>
        <button className={`am-tab-pill danger ${activeTab === 'sos' ? 'active' : ''}`} onClick={() => switchTab('sos')}>
          <span>SOS</span>
        </button>
      </div>

      {/* ===== 顶部浮动工具栏 ===== */}
      <div className="am-top-tools">
        <div className="am-status">
          <span className={`am-dot ${connected ? 'on' : 'off'}`} />
          <span className="am-status-text">{connected ? '在线' : '离线'}</span>
        </div>
        <div className="am-tools-right">
          {activeTab === 'recognize' && (
            <>
              <button className="am-icon-btn" onClick={() => camera.active ? camera.stop() : camera.start()} title="摄像头">📹</button>
              <button className="am-icon-btn" onClick={async () => { await camera.switchCamera(); showToast(camera.facingMode === 'user' ? '前置摄像头' : '后置摄像头'); }} title="切换">🔄</button>
              <button className={`am-icon-btn ${torchOn ? 'on' : ''}`} onClick={toggleTorch} title="闪光灯">🔦</button>
            </>
          )}
          {activeTab === 'navigate' && (
            <>
              <button className="am-icon-btn" onClick={() => setShowFavorites(!showFavorites)} title="收藏">⭐</button>
              <button className="am-icon-btn" onClick={() => showToast('已获取位置')} title="定位">📍</button>
            </>
          )}
          {activeTab === 'sos' && (
            <button className="am-icon-btn" onClick={() => showToast('设置')} title="设置">⚙️</button>
          )}
        </div>
      </div>

      {/* ===== 主内容浮层 ===== */}
      <div className="am-content-layer">
        {/* 导航页 - 收藏浮层 */}
        {activeTab === 'navigate' && showFavorites && favorites.length > 0 && (
          <div className="am-fav-panel">
            <div className="am-fav-title">⭐ 收藏位置</div>
            <div className="am-fav-list">
              {favorites.map((fav, i) => (
                <button key={i} className="am-fav-item" onClick={() => { handleNavigate(fav.name); setShowFavorites(false); }}>
                  📍 {fav.name || fav.username}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* SOS页 - 联系人浮层 */}
        {activeTab === 'sos' && (
          <div className="am-sos-panel">
            <div className="am-sos-contacts-card">
              <div className="am-contacts-title">紧急联系人</div>
              {contacts.length === 0 ? (
                <div className="am-contacts-empty">
                  <div>暂无联系人</div>
                  <div className="hint">请在Web端家属管理中添加</div>
                </div>
              ) : (
                contacts.map((c, i) => (
                  <div key={i} className="am-contact-item">
                    <div className="am-contact-info">
                      <div className="name">{c.name}</div>
                      <div className="relation">{c.relation || '紧急联系人'}</div>
                    </div>
                    <a href={`tel:${c.phone}`} className="am-contact-call">📞 呼叫</a>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===== 底部浮动操作区 ===== */}
      <div className="am-bottom-zone">
        {/* SOS页 - 大圆按钮 */}
        {activeTab === 'sos' && (
          <div className="am-sos-bottom">
            <button className="am-sos-circle" onClick={handleSos} disabled={busy}>
              <span className="icon">🆘</span>
              <span className="text">{busy ? '发送中' : '紧急呼救'}</span>
            </button>
            <div className="am-sos-tip">点击立即向紧急联系人发送位置</div>
          </div>
        )}

        {/* 识别页 - 识别记录 + 四个模式按钮 + 输入框 */}
        {activeTab === 'recognize' && (
          <div className="am-recognize-bottom">
            {/* 识别记录显示(按钮上方) */}
            <div className="am-msg-list">
              {messages.slice(-5).map((msg, i) => (
                <div key={i} className={`am-msg ${msg.role}`}>
                  <div className="am-msg-bubble">{msg.text}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* 四个模式按钮一行 */}
            <div className="am-quick-row">
              <button className={`am-quick-icon ${activeMode === 'analyze' ? 'active' : ''}`} onClick={() => toggleMode('analyze')}>
                <span className="icon">⚡</span><span className="label">分析</span>
              </button>
              <button className={`am-quick-icon ${activeMode === 'travel' ? 'active' : ''}`} onClick={() => toggleMode('travel')}>
                <span className="icon">🚶</span><span className="label">出行</span>
              </button>
              <button className={`am-quick-icon ${activeMode === 'read' ? 'active' : ''}`} onClick={() => toggleMode('read')}>
                <span className="icon">📖</span><span className="label">阅读</span>
              </button>
              <button className={`am-quick-icon ${activeMode === 'traffic' ? 'active' : ''}`} onClick={() => toggleMode('traffic')}>
                <span className="icon">🚦</span><span className="label">红绿灯</span>
              </button>
            </div>

            {/* 统一输入框: 按住说话 / 文字输入 切换 */}
            <div className="am-input-box">
              {showTextInput ? (
                <>
                  <input
                    type="text"
                    className="am-input-box-field"
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    placeholder="输入文字指令..."
                    onKeyDown={e => { if (e.key === 'Enter' && textInput.trim()) { handleTextInputSubmit(textInput.trim()); setTextInput(''); } }}
                    autoFocus
                  />
                  <button className="am-input-box-send" onClick={() => { if (textInput.trim()) { handleTextInputSubmit(textInput.trim()); setTextInput(''); } }}>发送</button>
                </>
              ) : (
                <button
                  className={`am-input-box-press ${asr.listening ? 'listening' : ''}`}
                  onMouseDown={handlePressStart} onMouseUp={handlePressEnd}
                  onTouchStart={handlePressStart} onTouchEnd={handlePressEnd}
                >
                  <span className="icon">🎤</span><span>{asr.listening ? '松开发送' : '按住说话'}</span>
                </button>
              )}
              <button className="am-input-box-toggle" onClick={() => setShowTextInput(!showTextInput)} title={showTextInput ? '语音输入' : '文字输入'}>
                {showTextInput ? '🎤' : '⌨️'}
              </button>
            </div>
          </div>
        )}

        {/* 导航页 - 输入框+按住说话 */}
        {activeTab === 'navigate' && (
          <div className="am-navigate-bottom">
            <div className="am-input-row">
              <input
                type="text"
                className="am-input"
                value={navInput}
                onChange={e => setNavInput(e.target.value)}
                placeholder="输入目的地,如五一广场"
                onKeyDown={e => e.key === 'Enter' && handleNavigate()}
              />
              <button className="am-input-send" onClick={() => handleNavigate()} disabled={busy}>搜索</button>
            </div>
            <button
              className={`am-press-btn ${asr.listening ? 'listening' : ''}`}
              onMouseDown={handlePressStart} onMouseUp={handlePressEnd}
              onTouchStart={handlePressStart} onTouchEnd={handlePressEnd}
            >
              <span className="icon">🎤</span><span>{asr.listening ? '松开发送' : '按住说话'}</span>
            </button>
          </div>
        )}

        {/* 字幕条(识别和导航共用) */}
        {activeTab !== 'sos' && (
          <div className="am-subtitle-bar" aria-live="polite">{subtitle}</div>
        )}
      </div>

      {/* Toast */}
      {toast && <div className="am-toast">{toast}</div>}
    </div>
  );
}
