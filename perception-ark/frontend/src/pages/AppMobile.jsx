import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useCamera } from '../hooks/useCamera.js';
import { useSpeechSynthesis, useSpeechRecognition } from '../hooks/useSpeech.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useSpatialAudio } from '../hooks/useSpatialAudio.js';
import { api } from '../services/api.js';
import MapView from '../components/MapView.jsx';

const WAKE_WORDS = ['小舟小舟', '小周小周', '小舟'];

export default function AppMobile() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('recognize');
  const [messages, setMessages] = useState([]);
  const [subtitle, setSubtitle] = useState('');
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
  const [activeMode, setActiveMode] = useState(null); // null | 'analyze' | 'travel' | 'read' | 'traffic' | 'find'
  const [showTextInput, setShowTextInput] = useState(false); // 识别页文字输入模式
  const [findTarget, setFindTarget] = useState(''); // 寻物目标
  const [showFindInput, setShowFindInput] = useState(false); // 寻物目标输入浮层
  const [navHistory, setNavHistory] = useState(() => { // 导航历史搜索记录
    try { return JSON.parse(localStorage.getItem('ark_nav_history') || '[]'); }
    catch { return []; }
  });
  const [showNavHistory, setShowNavHistory] = useState(false); // 历史搜索浮层
  const [poiSuggestions, setPoiSuggestions] = useState([]); // POI搜索建议(输入联想)
  const [poiLoading, setPoiLoading] = useState(false); // POI搜索加载中
  const [ttsRate, setTtsRate] = useState(() => parseFloat(localStorage.getItem('ark_tts_rate')) || 0.95);
  const [navInputMode, setNavInputMode] = useState(false); // 导航页: false=按住说话, true=文字输入
  const [voiceWakeActive, setVoiceWakeActive] = useState(true); // 语音唤醒免手动开关
  const [wakeDialogue, setWakeDialogue] = useState(false); // 唤醒后对话模式
  const [firstUse, setFirstUse] = useState(() => !localStorage.getItem('ark_first_use_done'));
  const [tutorialStep, setTutorialStep] = useState(0);
  const [persistentError, setPersistentError] = useState(null); // 持久错误显示
  const [trafficLightFast, setTrafficLightFast] = useState(null); // 前端快速红绿灯检测结果
  const trafficCanvasRef = useRef(null);
  const wakeListeningRef = useRef(false);
  const wakeAsrRef = useRef(null);
  const dialogueTimeoutRef = useRef(null);
  const wakePendingRef = useRef('');
  const handleVoiceInputRef = useRef(null);

  const { speak, stop: stopSpeak, speaking: ttsSpeaking, setVoiceByName, voice: currentVoice } = useSpeechSynthesis();
  const spatialAudio = useSpatialAudio();
  const asr = useSpeechRecognition();
  const camera = useCamera();
  const { location } = useGeolocation();

  const messagesEndRef = useRef(null);
  const isPressingRef = useRef(null);
  const modeIntervalRef = useRef(null); // 连续分析定时器
  const isProcessingRef = useRef(false); // 命令处理中标志(防止TTS音频被ASR重新拾取导致循环)
  const poiSearchTimerRef = useRef(null);
  const wakeStartRef = useRef(null);
  const wakeStopRef = useRef(null);

  const vibrateSafety = useCallback((urgent, distance) => {
    if (!navigator.vibrate) return;
    if (urgent) {
      navigator.vibrate([300, 80, 300, 80, 300, 80, 500]);
    } else if (distance != null && distance <= 2) {
      navigator.vibrate([150, 80, 150]);
    } else {
      navigator.vibrate(80);
    }
  }, []);

  const detectTrafficLightFast = useCallback((imageFile) => {
    return new Promise((resolve) => {
      if (!imageFile) { resolve(null); return; }
      const img = new Image();
      const url = URL.createObjectURL(imageFile);
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (!trafficCanvasRef.current) trafficCanvasRef.current = document.createElement('canvas');
        const canvas = trafficCanvasRef.current;
        const cw = 120, ch = 90;
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        try {
          const data = ctx.getImageData(0, 0, cw, ch).data;
          let rCount=0, yCount=0, gCount=0;
          for (let i=0; i<data.length; i+=4) {
            const r=data[i], g=data[i+1], b=data[i+2];
            const brightness = (r+g+b)/3;
            if (brightness < 90) continue;
            if (r > 190 && g < 110 && b < 110) rCount++;
            else if (r > 180 && g > 140 && b < 90) yCount++;
            else if (r < 110 && g > 160 && b < 110) gCount++;
          }
          const total = rCount + yCount + gCount;
          if (total < 25) { resolve(null); return; }
          if (rCount > gCount*1.5 && rCount > yCount*1.2) resolve({color:'red', fast:true});
          else if (gCount > rCount*1.3 && gCount > yCount*1.2) resolve({color:'green', fast:true});
          else resolve(null);
        } catch(e) { resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }, []);

  const completeTutorial = useCallback(() => {
    localStorage.setItem('ark_first_use_done', '1');
    setFirstUse(false);
  }, []);

  const startWakeListener = useCallback(() => {
    if (!voiceWakeActive || wakeListeningRef.current) return;
    try {
      const WakeRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!WakeRecognition) return;
      const recognition = new WakeRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      wakeAsrRef.current = recognition;
      wakePendingRef.current = '';
      recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          interim += e.results[i][0].transcript;
        }
        const text = interim.replace(/\s/g, '');
        const detected = WAKE_WORDS.find(w => text.includes(w));
        if (detected) {
          try { recognition.stop(); } catch(ex) {}
          wakeListeningRef.current = false;
          setWakeDialogue(true);
          spatialAudio.beep('正前方', 0.12, 880);
          speak('我在，请说', { rate: 1.05, onEnd: () => {
            setTimeout(() => {
              const CmdRec = window.SpeechRecognition || window.webkitSpeechRecognition;
              if (!CmdRec) return;
              const cmdRec = new CmdRec();
              cmdRec.lang = 'zh-CN';
              cmdRec.continuous = false;
              cmdRec.interimResults = true;
              cmdRec.maxAlternatives = 1;
              let gotResult = false;
              cmdRec.onresult = (ev) => {
                for (let i = ev.resultIndex; i < ev.results.length; i++) {
                  const t = ev.results[i][0].transcript.trim();
                  if (ev.results[i].isFinal && t) {
                    gotResult = true;
                    handleVoiceInputRef.current?.(t);
                    setWakeDialogue(false);
                    setTimeout(() => wakeStartRef.current?.(), 800);
                  } else {
                    setSubtitle(`👂 ${t}`);
                  }
                }
              };
              cmdRec.onerror = () => {
                setWakeDialogue(false); setSubtitle('');
                setTimeout(() => wakeStartRef.current?.(), 1000);
              };
              cmdRec.onend = () => {
                if (!gotResult) {
                  setWakeDialogue(false); setSubtitle('');
                  setTimeout(() => wakeStartRef.current?.(), 1000);
                }
              };
              cmdRec.start();
              if (dialogueTimeoutRef.current) clearTimeout(dialogueTimeoutRef.current);
              dialogueTimeoutRef.current = setTimeout(() => {
                try { cmdRec.abort(); } catch(ex) {}
                setWakeDialogue(false); setSubtitle('');
                wakeStartRef.current?.();
              }, 8000);
            }, 300);
          }});
          setSubtitle('🎤 我在，请说...');
          wakePendingRef.current = '';
        }
      };
      recognition.onerror = () => {
        wakeListeningRef.current = false;
        setTimeout(() => { if (voiceWakeActive) wakeStartRef.current?.(); }, 3000);
      };
      recognition.onend = () => {
        wakeListeningRef.current = false;
        if (voiceWakeActive && !wakeDialogue) {
          setTimeout(() => wakeStartRef.current?.(), 800);
        }
      };
      recognition.start();
      wakeListeningRef.current = true;
    } catch (e) {
      console.warn('[Wake] 唤醒词初始化失败:', e);
    }
  }, [voiceWakeActive, speak, spatialAudio]);

  const stopWakeListener = useCallback(() => {
    if (wakeAsrRef.current) {
      try { wakeAsrRef.current.abort(); } catch(e) {}
      wakeAsrRef.current = null;
    }
    wakeListeningRef.current = false;
    if (dialogueTimeoutRef.current) { clearTimeout(dialogueTimeoutRef.current); dialogueTimeoutRef.current = null; }
  }, []);

  useEffect(() => {
    wakeStartRef.current = startWakeListener;
    wakeStopRef.current = stopWakeListener;
  }, [startWakeListener, stopWakeListener]);

  // 大字体默认开启
  useEffect(() => {
    if (localStorage.getItem('ark_large_font') === null) {
      localStorage.setItem('ark_large_font', 'true');
      document.body.classList.add('ark-large-font');
    } else if (localStorage.getItem('ark_large_font') === 'true') {
      document.body.classList.add('ark-large-font');
    }
    if (localStorage.getItem('ark_high_contrast') === 'true') document.body.classList.add('ark-high-contrast');
  }, []);

  // 摄像头启动(带降级处理)
  const startCamera = useCallback(async () => {
    if (camera.active) return true;
    const ok = await camera.start();
    if (!ok) {
      setPersistentError(camera.error || '摄像头无法启动，请检查权限，可使用纯语音模式');
      speak('摄像头未授权，将使用纯语音模式。您仍可通过语音使用导航和紧急呼救。', { rate: 0.9 });
      return false;
    }
    setPersistentError(null);
    return true;
  }, [camera, speak]);

  // 摄像头首次启动(首次引导后或非首次)
  useEffect(() => {
    if (firstUse) return;
    if (!camera.active && !camera.error) {
      startCamera();
    }
  }, [firstUse, camera.active, camera.error, startCamera]);

  // 首次使用引导教程步骤文本
  const tutorialSteps = [
    { title: '欢迎使用感知方舟', text: '感知方舟是专为视障朋友设计的智能出行助手。我将引导您完成基础设置。', speakText: '欢迎使用感知方舟。感知方舟是专为视障朋友设计的智能出行助手。我将引导您完成基础设置。' },
    { title: '语音唤醒', text: '您无需动手操作，只需说出"小舟小舟"即可随时唤醒我，说出您的需求。', speakText: '您无需动手操作。只需说出小舟小舟，即可随时唤醒我，说出您的需求。' },
    { title: '三大核心功能', text: '识别模式帮您了解周围环境和寻找物品；导航模式带您到达目的地；紧急呼救在需要时自动通知亲友。', speakText: '识别模式帮您了解周围环境和寻找物品。导航模式带您到达目的地。紧急呼救在需要时自动通知亲友。' },
    { title: '空间感知与安全', text: '我会通过空间音效提示危险方向，通过不同震动强度提示距离。越近震动越急促。', speakText: '我会通过空间音效提示危险方向，通过不同震动强度提示距离。越近震动越急促。' },
    { title: '开始使用', text: '设置已完成。请授权摄像头权限以获得最佳体验。现在请说出"小舟小舟"开始使用吧！', speakText: '设置已完成。请授权摄像头权限以获得最佳体验。现在请说出小舟小舟开始使用吧！' }
  ];

  // 启动语音唤醒监听(非首次使用且非引导中)
  useEffect(() => {
    if (firstUse) return;
    const t = setTimeout(() => wakeStartRef.current?.(), 1500);
    return () => {
      clearTimeout(t);
      wakeStopRef.current?.();
      if (dialogueTimeoutRef.current) clearTimeout(dialogueTimeoutRef.current);
    };
  }, [firstUse]);

  // 引导教程语音
  useEffect(() => {
    if (!firstUse) return;
    const step = tutorialSteps[tutorialStep];
    if (step) {
      setTimeout(() => speak(step.speakText, { rate: 0.9 }), 500);
    }
  }, [firstUse, tutorialStep, speak]);

  // ===== 摇一摇开启出行模式 (定义提前到 showToast 之后) =====
  // (见下方)

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
      case 'sos_call_120':
        addMessage('assistant', `🚨 已为您拨打120急救电话。位置: ${event.location || '未知'}。请保持冷静，救援正在路上。`);
        setSubtitle('🚨 正在拨打120...');
        if (navigator.vibrate) navigator.vibrate([1000, 200, 1000, 200, 1000, 200, 2000]);
        setTimeout(() => {
          try { window.location.href = 'tel:120'; }
          catch (e) { console.warn('[SOS] tel:120 跳转失败:', e); }
        }, 2000);
        break;
      case 'safety_result':
        if (!event.safe) {
          if (navigator.vibrate) {
            if (event.urgent) navigator.vibrate([300, 80, 300, 80, 300, 80, 500]);
            else if (event.distance <= 2) navigator.vibrate([150, 80, 150]);
            else navigator.vibrate(80);
          }
          const dir = event.direction || '正前方';
          const distText = event.distance != null ? `${event.distance}米` : '附近';
          const speakText = event.urgent
            ? `危险！${dir}约${distText}有${event.object}，立即停止！`
            : `注意，${dir}约${distText}有${event.object}。`;
          spatialAudio.speakDirectional(speakText, dir, { urgent: !!event.urgent });
          setSubtitle(event.urgent ? `🚨 ${speakText}` : `⚠️ ${speakText}`, !!event.urgent);
        }
        break;
      case 'agent_log':
        break;
    }
  }, [speak, spatialAudio]);

  const { connected } = useWebSocket(handleWsEvent);

  const addMessage = useCallback((role, text) => {
    setMessages(prev => [...prev.slice(-30), { role, text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }]);
  }, []);

  const showToast = useCallback((text) => {
    setToast(text);
    setTimeout(() => setToast(''), 2500);
  }, []);

  // ===== 摇一摇开启出行模式 =====
  useEffect(() => {
    let lastShake = 0;
    const threshold = 18; // 摇动阈值
    let lastX = 0, lastY = 0, lastZ = 0;
    let initialized = false;

    const handleMotion = (e) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc || acc.x == null) return;
      if (!initialized) {
        lastX = acc.x; lastY = acc.y; lastZ = acc.z;
        initialized = true;
        return;
      }
      const delta = Math.abs(acc.x - lastX) + Math.abs(acc.y - lastY) + Math.abs(acc.z - lastZ);
      lastX = acc.x; lastY = acc.y; lastZ = acc.z;
      const now = Date.now();
      if (delta > threshold && now - lastShake > 1500) {
        lastShake = now;
        // 仅在识别页且未开启出行模式时触发
        if (activeTab === 'recognize' && activeMode !== 'travel') {
          speak('检测到摇动，已开启出行模式');
          showToast('摇一摇 → 出行模式');
          navigator.vibrate?.([50, 30, 50]);
          setActiveMode('travel');
        }
      }
    };

    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [activeTab, activeMode, speak, showToast]);

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
    setShowFindInput(false);
    setShowNavHistory(false);
    setPoiSuggestions([]);
    setPoiLoading(false);
    if (poiSearchTimerRef.current) { clearTimeout(poiSearchTimerRef.current); poiSearchTimerRef.current = null; }
    const names = { recognize: '识别', navigate: '导航', sos: '紧急呼救' };
    showToast(`已切换到${names[tab]}`);
  }, [showToast]);

  // ===== 按住说话 =====
  const handlePressStart = useCallback(() => {
    // 先停止TTS播报,防止麦克风拾取TTS音频形成回声循环
    stopSpeak();
    isProcessingRef.current = false;
    isPressingRef.current = true;
    if (!asr.supported) { showToast('当前浏览器不支持语音识别'); return; }
    asr.start();
    setSubtitle('正在聆听...');
  }, [asr, showToast, stopSpeak]);

  const handlePressEnd = useCallback(() => {
    isPressingRef.current = false;
    if (asr.listening) asr.stop();
    setTimeout(() => setSubtitle(''), 1000);
  }, [asr]);

  useEffect(() => {
    if (!asr.transcript || isPressingRef.current === null) return;
    // 防护1: TTS正在播报时不处理ASR结果(避免回声循环)
    if (ttsSpeaking) return;
    // 防护2: 正在处理上一条命令时不处理新结果
    if (isProcessingRef.current) return;
    const text = asr.transcript.trim();
    if (!text) return;
    // 立即清空transcript,防止重复处理
    asr.reset();
    if (/打开识别|识别模式/.test(text)) { switchTab('recognize'); return; }
    if (/打开导航|导航模式/.test(text)) { switchTab('navigate'); return; }
    if (/紧急呼救|SOS|救命/.test(text)) { switchTab('sos'); return; }

    // ===== SOS应答检测(任意页面,说"我没事"/"我很好"/"我没事了"取消120拨打) =====
    if (/我没事|我很好|我没事了|我没事啦|我好的|我OK|我安全/.test(text)) {
      handleSosRespond();
      return;
    }
    // 主动取消SOS(说"取消SOS"/"取消呼救")
    if (/取消SOS|取消呼救|取消急救|取消紧急/.test(text)) {
      handleSosCancel();
      return;
    }

    // ===== 导航意图检测(仅在识别页触发跳转) =====
    // 排除含"过/来/回/出"+"去"的误触发(过去/过来/回去/出去)
    if (activeTab === 'recognize') {
      let navDestination = null;

      // 模式1: 明确的导航指令 "导航到XX" / "导航XX" / "带我去XX" / "我要去XX" / "我要导航去XX"
      if (/^(导航[到去]?|带我去|我要去|我要导航[到去]?|帮我导航[到去]?)/.test(text)) {
        navDestination = text.replace(/^(导航[到去]?|带我去|我要去|我要导航[到去]?|帮我导航[到去]?)/, '').trim();
      }
      // 模式2: "X去YY" X不能是过来回出
      else {
        const m = text.match(/([^过来回出])去(.+)/);
        if (m) navDestination = m[2].trim();
      }
      // 模式3: 含"怎么走/怎么去/路线/如何到达"等导航相关关键词
      if (!navDestination && /怎么走|怎么去|路线|怎么到达|如何去|如何到达/.test(text)) {
        const m = text.match(/^(.+?)怎么[走去]/) || text.match(/^(.+?)路线/) || text.match(/^(.+?)(?:怎么|如何)到达/);
        navDestination = m ? m[1].replace(/^(去|到|我要去|我想去|请带我去|带我去)/, '').trim() : text;
      }
      // 模式4: "XX在哪" / "XX在哪里"
      if (!navDestination && /^(.+?)在哪$|^(.+?)在哪里$|^(.+?)在哪个位置$/.test(text)) {
        const m = text.match(/^(.+?)在哪$|^(.+?)在哪里$|^(.+?)在哪个位置$/);
        navDestination = m ? m[1].replace(/^(请问|请告诉我|我想知道)/, '').trim() : null;
      }
      // 模式5: "找XX" / "搜索XX"
      if (!navDestination && /^(找|找一下|查找|搜索|查一下)(.+)$/.test(text)) {
        const m = text.match(/^(?:找|找一下|查找|搜索|查一下)(.+)$/);
        navDestination = m ? m[1].trim() : null;
      }
      // 模式6: "附近XX" / "附近的XX"
      if (!navDestination && /^附近(?:的)?(.+)$/.test(text)) {
        const m = text.match(/^附近(?:的)?(.+)$/);
        navDestination = m ? m[1].trim() : null;
      }

      // 导航意图命中: 跳转到导航页并开始导航
      if (navDestination && navDestination.length >= 1) {
        addMessage('user', text);
        isProcessingRef.current = true;
        switchTab('navigate');
        speak(`好的，正在为您导航到${navDestination}`);
        // 延迟调用导航,等tab切换完成MapView挂载
        setTimeout(() => {
          handleNavigate(navDestination);
        }, 600);
        return;
      }
    }

    addMessage('user', text);
    // 防护3: 标记处理中,阻止后续ASR结果触发
    isProcessingRef.current = true;
    if (activeTab === 'recognize') handleRecognizeCommand(text);
    else if (activeTab === 'navigate') handleNavigateCommand(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asr.transcript, ttsSpeaking]);

  // ===== 识别页功能 =====
  const captureImage = useCallback(async () => {
    if (!camera.active) { showToast('摄像头未开启'); speak('摄像头未开启'); return null; }
    return await camera.capture();
  }, [camera, showToast, speak]);

  // ===== 带重试的API调用(应对Render免费版冷启动/超时) =====
  const callWithRetry = useCallback(async (fn, retries = 2) => {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === retries) throw err;
        // 首次失败可能是冷启动,等待2秒后重试
        if (i === 0) setSubtitle('服务启动中，请稍候...');
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }, []);

  const handleRecognizeCommand = useCallback(async (text) => {
    setBusy(true);
    setSubtitle('正在思考...');
    try {
      const img = await captureImage().catch(() => null);
      let resultText = '';
      if (/快速分析|分析|描述|前面有什么|前方|场景/.test(text)) {
        // 场景分析智能体 - 需要图片
        if (!img) {
          resultText = '摄像头未开启，无法分析前方场景，请先开启摄像头。';
        } else {
          const res = await callWithRetry(() => api.scene(img, '你是视障用户的眼睛。请用一段话描述当前场景,必须包含:\n1.前方主要物体名称\n2.物体的方位(左前方/正前方/右前方/左方/右方)\n3.物体到你的估算距离(单位米,1-5米范围)\n格式示例:"正前方2米有桌椅,右前方3米有门"。40字以内,专为视障者设计,只描述前方可见的主要物体和距离。'));
          if (res?.success && res.result) resultText = String(res.result);
        }
      } else if (/阅读|文字|读/.test(text)) {
        // OCR文字识别智能体
        if (!img) {
          resultText = '摄像头未开启，无法识别文字。';
        } else {
          const res = await callWithRetry(() => api.social(img, 'ocr'));
          if (res?.success && res.result) resultText = String(res.result);
        }
      } else if (/红绿灯|红灯|绿灯|信号灯/.test(text)) {
        // 安全预警智能体 - 红绿灯识别
        if (!img) {
          resultText = '摄像头未开启，无法识别红绿灯。';
        } else {
          const res = await callWithRetry(() => api.safety(img, 'scan'));
          if (res?.success && res.result) resultText = String(res.result);
        }
      } else {
        // 通用问答 - 调用小舟智能助手(意图识别+多轮对话,支持纯文字+可选图片)
        const loc = location ? { lat: location.lat, lng: location.lng } : null;
        const res = await callWithRetry(() => api.assistantChat(text, { imageFile: img, location: loc }));
        if (res?.success && res.reply) resultText = res.reply;
      }
      // 统一处理回复
      if (resultText) {
        addMessage('assistant', resultText);
        speak(resultText);
        setSubtitle(resultText);
      } else {
        // API返回空结果: 只显示不播报(避免TTS音频被ASR拾取形成循环)
        const fallback = '抱歉，暂无回复，请稍后再试。';
        addMessage('assistant', fallback);
        setSubtitle(fallback);
      }
    } catch (err) {
      // 网络错误/超时: 只显示在聊天中,不播报(避免回声循环)
      const isNetworkErr = /ERR_HTTP2|NETWORK|Failed to fetch|fetch/i.test(err.message);
      const errText = isNetworkErr
        ? '网络连接异常，服务可能正在启动中，请稍后再试。'
        : `处理失败: ${err.message}`;
      addMessage('assistant', errText);
      setSubtitle(errText);
    } finally {
      setBusy(false);
      // 延迟重置处理标志: 等待TTS播报结束后才允许新的ASR结果
      // 防止TTS音频被ASR拾取→生成新transcript→触发新回复→循环
      setTimeout(() => { isProcessingRef.current = false; }, 3000);
    }
  }, [captureImage, addMessage, speak, location, callWithRetry]);

  // ===== 模式切换(开启/关闭连续分析) =====
  const modeNames = { analyze: '快速分析', travel: '出行模式', read: '阅读文字', traffic: '红绿灯识别', find: '寻物模式' };
  const modeHints = {
    analyze: '正在分析当前场景',
    travel: '正在检测前方障碍物',
    read: '正在识别文字内容',
    traffic: '正在识别红绿灯状态',
    find: '正在寻找物品'
  };

  const toggleMode = useCallback((mode) => {
    // 寻物模式特殊处理: 需要先说出/输入要找的物品
    if (mode === 'find') {
      setActiveMode(prev => {
        if (prev === 'find') {
          // 关闭寻物
          speak('寻物模式已关闭');
          showToast('寻物模式已关闭');
          setFindTarget('');
          return null;
        } else {
          // 开启寻物 - 先弹出输入框
          if (prev) {
            speak(`${modeNames[prev]}已关闭`);
          }
          setShowFindInput(true);
          speak('请说出或输入要找的物品');
          return null; // 等用户输入目标后再设为find
        }
      });
      return;
    }

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

  // 寻物目标确认后开始寻找
  const startFindMode = useCallback((target) => {
    const t = target.trim();
    if (!t) { showToast('请说出要找的物品'); return; }
    setFindTarget(t);
    setActiveMode('find');
    setShowFindInput(false);
    speak(`开始寻找${t}，找到后会告诉您方位和距离。说结束寻找或再次点击寻物按钮可退出`);
    showToast(`寻找：${t}`);
    addMessage('user', `寻找${t}`);
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
    let failCount = 0;
    const runOnce = async () => {
      if (running) return;
      running = true;
      try {
        const img = await camera.capture();
        if (!img) { running = false; return; }

        if (activeMode === 'traffic') {
          const fastResult = await detectTrafficLightFast(img);
          if (fastResult) {
            const colorText = fastResult.color === 'red' ? '红灯' : fastResult.color === 'green' ? '绿灯' : '黄灯';
            const fastSpeak = `前方${colorText}`;
            setTrafficLightFast(fastResult);
            setSubtitle(`🚦 ${fastSpeak}`);
            if (fastResult.color === 'red') {
              speak(fastSpeak, { urgent: true });
              if (navigator.vibrate) navigator.vibrate([300, 80, 300, 80, 300]);
            }
            running = false;
            return;
          }
        }

        let res;
        if (activeMode === 'analyze') {
          res = await api.scene(img, '你是视障用户的眼睛。请用一段话描述当前场景,必须包含:\n1.前方主要物体名称\n2.物体的方位(左前方/正前方/右前方/左方/右方)\n3.物体到你的估算距离(单位米,1-5米范围)\n格式示例:"正前方2米有桌椅,右前方3米有门"。40字以内,专为视障者设计,只描述前方可见的主要物体和距离。');
        } else if (activeMode === 'travel') {
          res = await api.safety(img, 'travel');
        } else if (activeMode === 'read') {
          res = await api.social(img, 'ocr');
        } else if (activeMode === 'traffic') {
          res = await api.safety(img, 'traffic');
        } else if (activeMode === 'find') {
          res = await api.scene(img, `请在画面中寻找"${findTarget}"。如果找到,请用以下格式回答:"找到了,在[左前方/正前方/右前方/左方/右方]约[X]米处"。如果没找到,请只回答"未找到"。30字以内。`);
        }

        if (res?.success && res.result) {
          failCount = 0;
          const raw = res.result;
          let parsed = null;
          if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw); } catch(e) { parsed = null; }
          } else if (typeof raw === 'object') {
            parsed = raw;
          }

          if ((activeMode === 'travel' || activeMode === 'traffic') && parsed && typeof parsed === 'object' && 'safe' in parsed) {
            setTrafficLightFast(null);
            if (parsed.safe) {
              if (parsed.traffic_light === 'green') setSubtitle('🚦 绿灯，可以通行');
              else if (activeMode === 'traffic') setSubtitle('🚦 路口安全');
              else setSubtitle('🛡️ 前方安全');
            } else {
              const dir = parsed.direction || '正前方';
              const distText = parsed.distance != null ? `${parsed.distance}米` : '附近';
              let displayText;
              if (parsed.traffic_light) {
                const cText = parsed.traffic_light === 'red' ? '红灯，请停下' : parsed.traffic_light === 'green' ? '绿灯，可以通行' : '黄灯，请谨慎';
                displayText = `🚦 ${cText}`;
              } else {
                displayText = parsed.urgent
                  ? `🚨 危险！${dir}约${distText}有${parsed.object}，${parsed.action || '立即停止'}！`
                  : `⚠️ 注意，${dir}约${distText}有${parsed.object}。`;
              }
              setSubtitle(displayText, !!parsed.urgent);
              if (!connected) {
                spatialAudio.speakDirectional(parsed.traffic_light ? displayText.replace(/^[🚦⚠️🚨]\s*/, '') : displayText.replace(/^[⚠️🚨]\s*/, ''), dir, { urgent: !!parsed.urgent });
                if (navigator.vibrate) {
                  if (parsed.urgent) navigator.vibrate([300, 80, 300, 80, 300, 80, 500]);
                  else if (parsed.distance <= 2) navigator.vibrate([150, 80, 150]);
                  else navigator.vibrate(80);
                }
              }
            }
          } else {
            const text = typeof raw === 'string' ? raw : String(raw);
            addMessage('assistant', text);

            if (activeMode === 'find') {
              if (/找到了|已找到/.test(text)) {
                const dirMatch = text.match(/在(左前方|正前方|右前方|左方|右方)/);
                const dir = dirMatch ? dirMatch[1] : '正前方';
                spatialAudio.speakDirectional(text, dir, { urgent: true });
                setSubtitle(`🔍 ${text}`);
                if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200, 100, 500]);
              } else {
                setSubtitle(`🔍 正在寻找${findTarget}...`);
              }
            } else if (activeMode === 'travel') {
              const isDanger = /警告|危险|障碍|靠近|前方有|小心|注意|当心|车辆|台阶|坑|施工|围栏|柱子|墙|立即停止/.test(text);
              const distMatch = text.match(/约?\s*([0-9]+(?:\.[0-9]+)?)\s*米/);
              const distance = distMatch ? parseFloat(distMatch[1]) : null;
              const isUrgent = /警告|立即停止/.test(text) || (distance != null && distance <= 1);
              const dirMatch = text.match(/(左前方|正前方|右前方|左方|右方)/);
              const dir = dirMatch ? dirMatch[1] : '正前方';
              if (isDanger) {
                spatialAudio.speakDirectional(text, dir, { urgent: isUrgent });
                setSubtitle(`⚠️ ${text}`);
                if (navigator.vibrate) {
                  if (isUrgent) navigator.vibrate([300, 80, 300, 80, 300, 80, 500]);
                  else if (distance != null && distance <= 2) navigator.vibrate([150, 80, 150]);
                  else navigator.vibrate(80);
                }
              } else {
                speak(text);
                setSubtitle(text);
              }
            } else {
              speak(text);
              setSubtitle(text);
            }
          }
        } else {
          failCount++;
          if (!res?.success) {
            console.warn('[Mode] API调用失败:', res);
          }
        }
      } catch (err) {
        console.error('[Mode] 分析失败:', err.message);
        failCount++;
      } finally {
        running = false;
        if (failCount >= 3) {
          const modeName = modeNames[activeMode] || '当前模式';
          showToast(`${modeName}已关闭（服务异常）`);
          addMessage('assistant', `${modeName}已关闭，服务异常，请稍后再试。`);
          setActiveMode(null);
          setPersistentError(`${modeName}服务暂时异常，请检查网络后重试`);
          failCount = 0;
        }
      }
    };

    const interval = (activeMode === 'travel' || activeMode === 'traffic') ? 2500 : 5000;
    runOnce();
    modeIntervalRef.current = setInterval(runOnce, interval);

    return () => {
      if (modeIntervalRef.current) {
        clearInterval(modeIntervalRef.current);
        modeIntervalRef.current = null;
      }
    };
  }, [activeMode, camera, addMessage, speak, findTarget]);

  // 切换tab时关闭连续分析模式
  useEffect(() => {
    if (activeTab !== 'recognize' && activeMode) {
      setActiveMode(null);
    }
  }, [activeTab, activeMode]);

  // ===== 导航页功能 =====
  // 从API返回值中提取polyline绘制路线到地图
  const drawRouteFromResult = useCallback((result) => {
    if (!result || typeof result !== 'object') return;
    if (result.polyline) {
      try {
        const coords = result.polyline.split(';').filter(p => p).map(p => {
          const [lng, lat] = p.split(',').map(parseFloat);
          return [lng, lat];
        }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
        if (coords.length > 1) {
          setMapRoute(coords);
          setMapPois([]);
        }
      } catch (e) { console.error('[Nav] 路线绘制失败:', e); }
    }
  }, []);

  // 格式化导航结果为可读文本
  const formatNavResult = useCallback((result) => {
    if (typeof result === 'string') return result;
    if (!result) return null;
    if (result.error) return result.error;  // 后端返回的错误详情
    if (result.distance != null && result.duration != null) {
      const firstStep = result.steps?.[0]?.instruction || '';
      return `路线已规划：距离${result.distance}米，预计步行${result.duration}分钟。${firstStep ? firstStep + '。' : ''}`;
    }
    if (result.target) {
      return `已找到目的地：${result.target.name}。`;
    }
    return JSON.stringify(result);
  }, []);

  const handleNavigateCommand = useCallback(async (text) => {
    setBusy(true);
    setSubtitle('正在规划路线...');
    try {
      const res = await callWithRetry(() => api.navigate(text, location?.lat, location?.lng));
      if (res?.success && res.result) {
        drawRouteFromResult(res.result);
        const resultText = formatNavResult(res.result);
        addMessage('assistant', resultText);
        speak(resultText);
        setSubtitle(`🧭 ${resultText}`);
      }
    } catch (err) {
      const isNetworkErr = /ERR_HTTP2|NETWORK|Failed to fetch|fetch/i.test(err.message);
      const errText = isNetworkErr ? '网络连接异常，服务可能正在启动中，请稍后再试。' : `导航失败: ${err.message}`;
      addMessage('assistant', errText); setSubtitle(errText);
    }
    finally {
      setBusy(false);
      setTimeout(() => { isProcessingRef.current = false; }, 3000);
    }
  }, [location, addMessage, speak, callWithRetry, drawRouteFromResult, formatNavResult]);

  // ===== 导航执行(必须在handleTextInputSubmit之前定义) =====
  const handleNavigate = useCallback(async (dest) => {
    const destination = (dest || navInput).trim();
    if (!destination) { showToast('请输入目的地'); speak('请告诉我您要去哪里'); return; }
    setBusy(true);
    setSubtitle('正在规划路线...');
    addMessage('user', `导航到${destination}`);
    // 保存到历史搜索记录(去重,最多保留10条)
    setNavHistory(prev => {
      const filtered = prev.filter(item => item !== destination);
      const updated = [destination, ...filtered].slice(0, 10);
      localStorage.setItem('ark_nav_history', JSON.stringify(updated));
      return updated;
    });
    setShowNavHistory(false);
    setPoiSuggestions([]);
    setPoiLoading(false);
    if (poiSearchTimerRef.current) { clearTimeout(poiSearchTimerRef.current); poiSearchTimerRef.current = null; }
    try {
      const res = await api.navigate(destination, location?.lat, location?.lng);
      setNavInput('');
      if (res?.success && res.result) {
        drawRouteFromResult(res.result);
        const resultText = formatNavResult(res.result);
        addMessage('assistant', resultText);
        speak(resultText);
        setSubtitle(`🧭 ${resultText}`);
      }
    }
    catch (err) {
      const isNetworkErr = /ERR_HTTP2|NETWORK|Failed to fetch|fetch/i.test(err.message);
      const errText = isNetworkErr ? '网络连接异常，服务可能正在启动中，请稍后再试。' : `导航失败: ${err.message}`;
      addMessage('assistant', errText); setSubtitle(errText);
    }
    finally { setBusy(false); }
  }, [navInput, location, addMessage, showToast, speak, drawRouteFromResult, formatNavResult]);

  // ===== POI搜索建议(类似高德输入联想) =====
  // 清空POI建议
  const clearPoiSuggestions = useCallback(() => {
    setPoiSuggestions([]);
    setPoiLoading(false);
    if (poiSearchTimerRef.current) { clearTimeout(poiSearchTimerRef.current); poiSearchTimerRef.current = null; }
  }, []);

  // 输入变化时触发debounce搜索(300ms防抖)
  const handleNavInputChange = useCallback((value) => {
    setNavInput(value);
    // 清除上一次定时器
    if (poiSearchTimerRef.current) clearTimeout(poiSearchTimerRef.current);
    const keyword = value.trim();
    if (!keyword) { setPoiSuggestions([]); setPoiLoading(false); return; }
    setPoiLoading(true);
    poiSearchTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.poiSearch(keyword, location?.lat, location?.lng);
        if (res?.success) setPoiSuggestions(res.pois || []);
        else setPoiSuggestions([]);
      } catch (err) {
        setPoiSuggestions([]);
      } finally {
        setPoiLoading(false);
      }
    }, 300);
  }, [location]);

  // 点击POI建议项 → 直接开始导航
  const handlePoiSelect = useCallback((poi) => {
    clearPoiSuggestions();
    setNavInput('');
    setShowNavHistory(false);
    handleNavigate(poi.name);
  }, [clearPoiSuggestions, handleNavigate]);

  // ===== 文本输入提交(必须在handleRecognizeCommand/handleNavigateCommand/handleNavigate之后定义) =====
  const handleTextInputSubmit = useCallback((text) => {
    if (/打开识别|识别模式/.test(text)) { switchTab('recognize'); return; }
    if (/打开导航|导航模式/.test(text)) { switchTab('navigate'); return; }
    if (/紧急呼救|SOS|救命/.test(text)) { switchTab('sos'); return; }

    // ===== 导航意图检测(同语音逻辑) =====
    if (activeTab === 'recognize') {
      let navDestination = null;
      if (/^(导航[到去]?|带我去|我要去|我要导航[到去]?|帮我导航[到去]?)/.test(text)) {
        navDestination = text.replace(/^(导航[到去]?|带我去|我要去|我要导航[到去]?|帮我导航[到去]?)/, '').trim();
      } else {
        const m = text.match(/([^过来回出])去(.+)/);
        if (m) navDestination = m[2].trim();
      }
      if (/怎么走|怎么去|路线|怎么到达|如何去|如何到达/.test(text) && !navDestination) {
        const m = text.match(/^(.+?)怎么[走去]/) || text.match(/^(.+?)路线/) || text.match(/^(.+?)(?:怎么|如何)到达/);
        navDestination = m ? m[1].replace(/^(去|到|我要去|我想去|请带我去|带我去)/, '').trim() : text;
      }
      if (!navDestination && /^(.+?)在哪$|^(.+?)在哪里$|^(.+?)在哪个位置$/.test(text)) {
        const m = text.match(/^(.+?)在哪$|^(.+?)在哪里$|^(.+?)在哪个位置$/);
        navDestination = m ? m[1].replace(/^(请问|请告诉我|我想知道)/, '').trim() : null;
      }
      if (!navDestination && /^(找|找一下|查找|搜索|查一下)(.+)$/.test(text)) {
        const m = text.match(/^(?:找|找一下|查找|搜索|查一下)(.+)$/);
        navDestination = m ? m[1].trim() : null;
      }
      if (!navDestination && /^附近(?:的)?(.+)$/.test(text)) {
        const m = text.match(/^附近(?:的)?(.+)$/);
        navDestination = m ? m[1].trim() : null;
      }

      if (navDestination && navDestination.length >= 1) {
        addMessage('user', text);
        switchTab('navigate');
        speak(`好的，正在为您导航到${navDestination}`);
        setTimeout(() => handleNavigate(navDestination), 600);
        return;
      }
    }

    addMessage('user', text);
    if (activeTab === 'recognize') handleRecognizeCommand(text);
    else if (activeTab === 'navigate') handleNavigateCommand(text);
  }, [activeTab, switchTab, addMessage, handleRecognizeCommand, handleNavigateCommand, handleNavigate]);

  // ===== SOS紧急呼救(新流程: 立即发送位置 → 60秒后询问 → 再60秒无应答拨120) =====
  const handleSos = useCallback(async () => {
    setBusy(true);
    addMessage('user', '🆘 紧急呼救');
    if (navigator.vibrate) navigator.vibrate([500, 100, 500, 100, 500]);
    try {
      const res = await api.sosTrigger(location?.lat, location?.lng);
      if (res?.success && res.result?.triggered) {
        const r = res.result;
        if (!r.contactConfigured) {
          addMessage('assistant', '⚠️ 尚未设置紧急联系人，位置已同步到云端。请在家属端绑定紧急联系人。');
        } else {
          addMessage('assistant', `🆘 SOS已发送。位置: ${r.location}。紧急联系人已通知。60秒后将询问您的情况，如无应答将自动拨打120。`);
        }
        showToast('SOS已发送，60秒后将询问情况');
      } else {
        addMessage('assistant', 'SOS发送失败，请稍后再试或直接拨打120。');
      }
    } catch (err) {
      // 不speak(避免TTS音频被ASR拾取形成回声循环),只显示在聊天中
      addMessage('assistant', `SOS发送失败: ${err.message}`);
    } finally { setBusy(false); }
  }, [location, addMessage, showToast]);

  // ===== 用户语音应答SOS(说"我没事"/"我很好"等) → 取消120拨打 =====
  const handleSosRespond = useCallback(async () => {
    try {
      const res = await api.sosRespond();
      if (res?.success && res.result?.responded) {
        addMessage('assistant', '✓ 已确认您安全，120拨打已取消。');
        showToast('已取消120拨打');
      }
    } catch (err) {
      console.warn('[SOS] 应答失败:', err);
    }
  }, [addMessage, showToast]);

  // ===== 主动取消SOS =====
  const handleSosCancel = useCallback(async () => {
    try {
      await api.sosCancel();
      addMessage('assistant', '✓ 已取消SOS紧急呼救。');
      showToast('SOS已取消');
    } catch (err) {
      console.warn('[SOS] 取消失败:', err);
    }
  }, [addMessage, showToast]);

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

  // ===== 设置页跳转 =====
  const goSettings = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(10);
    window.location.hash = '#/settings';
  }, []);

  // 清除导航历史
  const handleClearNavHistory = useCallback(() => {
    localStorage.removeItem('ark_nav_history');
    setNavHistory([]);
    showToast('历史记录已清除');
  }, [showToast]);

  // ===== 按钮点击震动反馈 =====
  const vibrateClick = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(10);
  }, []);

  const nextTutorialStep = useCallback(() => {
    if (tutorialStep < 4) {
      setTutorialStep(prev => prev + 1);
    } else {
      localStorage.setItem('ark_first_use_done', '1');
      setFirstUse(false);
      startCamera();
      setTimeout(() => startWakeListener(), 1000);
      speak('欢迎使用感知方舟，我是您的智能助手小舟。说出小舟小舟即可唤醒我。', { rate: 0.9 });
    }
  }, [tutorialStep, startCamera, startWakeListener, speak]);

  const handleVoiceInput = useCallback((text) => {
    if (!text) return;
    const clean = text.trim();
    if (!clean) return;
    stopSpeak();
    spatialAudio.stop();
    if (dialogueTimeoutRef.current) { clearTimeout(dialogueTimeoutRef.current); dialogueTimeoutRef.current = null; }
    if (/打开识别|识别模式/.test(clean)) { switchTab('recognize'); speak('已切换到识别模式'); return; }
    if (/打开导航|导航模式/.test(clean)) { switchTab('navigate'); speak('已切换到导航模式'); return; }
    if (/紧急呼救|SOS|救命|求救/.test(clean)) { switchTab('sos'); speak('已进入紧急呼救'); handleSos(); return; }
    if (/我没事|我很好|我没事了|我安全|我好的/.test(clean)) { handleSosRespond(); return; }
    if (/取消SOS|取消呼救|取消急救/.test(clean)) { handleSosCancel(); return; }
    if (/打开摄像头|开启摄像头/.test(clean)) { startCamera(); speak('正在开启摄像头'); return; }
    if (/关闭摄像头/.test(clean)) { camera.stop(); speak('摄像头已关闭'); return; }
    if (/停止|别说了|安静|闭嘴|停一下/.test(clean)) { stopSpeak(); spatialAudio.stop(); setSubtitle(''); return; }
    if (/帮助|怎么用|使用说明|教程|引导/.test(clean)) { setTutorialStep(0); setFirstUse(true); return; }

    const modeMap = { '出行模式': 'travel', '开始出行': 'travel', '开启出行': 'travel', '出行': 'travel', '红绿灯识别': 'traffic', '红绿灯': 'traffic', '快速分析': 'analyze', '分析': 'analyze', '阅读': 'read', '阅读模式': 'read', '朗读': 'read', '寻物': 'find' };
    for (const [kw, mode] of Object.entries(modeMap)) {
      if (clean.includes(kw)) {
        if (activeMode === mode) { setActiveMode(null); speak('已关闭'); }
        else if (mode === 'find') { setFindTarget(''); setShowFindInput(true); speak('请告诉我要找什么物品'); }
        else { setActiveMode(mode); speak(`已开启${kw}`); }
        return;
      }
    }
    if (/关闭(模式|分析|检测|出行|红绿灯)/.test(clean)) { setActiveMode(null); setShowFindInput(false); speak('已关闭'); return; }

    if (activeTab === 'recognize' || activeTab === 'navigate') {
      let navDestination = null;
      if (/^(导航[到去]?|带我去|我要去|我要导航[到去]?|帮我导航[到去]?)/.test(clean)) {
        navDestination = clean.replace(/^(导航[到去]?|带我去|我要去|我要导航[到去]?|帮我导航[到去]?)/, '').trim();
      } else {
        const m = clean.match(/([^过来回出])去(.+)/);
        if (m) navDestination = m[2].trim();
      }
      if (!navDestination && /怎么走|怎么去|路线|怎么到达|如何去/.test(clean)) {
        const m = clean.match(/^(.+?)怎么[走去]/) || clean.match(/^(.+?)路线/);
        navDestination = m ? m[1].replace(/^(去|到|我要去|我想去|请带我去|带我去)/, '').trim() : clean;
      }
      if (!navDestination && /^(.+?)在哪/.test(clean)) {
        const m = clean.match(/^(.+?)在哪/);
        navDestination = m ? m[1].replace(/^(请问|请告诉我)/, '').trim() : null;
      }
      if (!navDestination && /^(找|找一下|查找|搜索|查一下)(.+)$/.test(clean)) {
        const m = clean.match(/^(?:找|找一下|查找|搜索|查一下)(.+)$/);
        navDestination = m ? m[1].trim() : null;
      }
      if (!navDestination && /^附近(?:的)?(.+)$/.test(clean)) {
        const m = clean.match(/^附近(?:的)?(.+)$/);
        navDestination = m ? m[1].trim() : null;
      }
      if (navDestination && navDestination.length >= 1 && navDestination.length < 50) {
        addMessage('user', clean);
        if (activeTab !== 'navigate') switchTab('navigate');
        speak(`好的，正在为您导航到${navDestination}`);
        setTimeout(() => handleNavigate(navDestination), 600);
        return;
      }
    }

    addMessage('user', clean);
    isProcessingRef.current = true;
    if (activeTab === 'recognize') handleRecognizeCommand(clean);
    else if (activeTab === 'navigate') handleNavigateCommand(clean);
  }, [switchTab, handleSos, handleSosRespond, handleSosCancel, startCamera, camera, activeMode, activeTab, addMessage, speak, stopSpeak, spatialAudio, handleNavigate, handleRecognizeCommand, handleNavigateCommand]);

  useEffect(() => {
    handleVoiceInputRef.current = handleVoiceInput;
  }, [handleVoiceInput]);

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
      <div className="am-top-tabs" role="tablist" aria-label="主导航">
        <button className={`am-tab-pill ${activeTab === 'recognize' ? 'active' : ''}`} onClick={() => switchTab('recognize')} role="tab" aria-selected={activeTab === 'recognize'} aria-label="识别模式">
          <span>识别</span>
        </button>
        <button className={`am-tab-pill ${activeTab === 'navigate' ? 'active' : ''}`} onClick={() => switchTab('navigate')} role="tab" aria-selected={activeTab === 'navigate'} aria-label="导航模式">
          <span>导航</span>
        </button>
        <button className={`am-tab-pill danger ${activeTab === 'sos' ? 'active' : ''}`} onClick={() => switchTab('sos')} role="tab" aria-selected={activeTab === 'sos'} aria-label="紧急呼救">
          <span>SOS</span>
        </button>
      </div>

      {/* ===== 左上角浮动工具栏 (竖向排列) ===== */}
      <div className="am-top-tools">
        <div className="am-status">
          <span className={`am-dot ${connected ? 'on' : 'off'}`} />
          <span className="am-status-text">{connected ? '在线' : '离线'}</span>
        </div>
        {activeTab === 'recognize' && (
          <>
            <button className="am-icon-btn" onClick={() => { vibrateClick(); if (camera.active) { camera.stop(); setPersistentError(null); } else startCamera(); }} title="摄像头开关" aria-label={camera.active ? '关闭摄像头' : '开启摄像头'}>📹</button>
            <button className="am-icon-btn" onClick={async () => { vibrateClick(); await camera.switchCamera(); showToast(camera.facingMode === 'user' ? '前置摄像头' : '后置摄像头'); }} title="切换摄像头" aria-label="切换前后摄像头">🔄</button>
            <button className={`am-icon-btn ${torchOn ? 'on' : ''}`} onClick={() => { vibrateClick(); toggleTorch(); }} title="闪光灯开关" aria-label={torchOn ? '关闭闪光灯' : '开启闪光灯'}>🔦</button>
          </>
        )}
        {activeTab === 'navigate' && (
          <>
            <button className="am-icon-btn" onClick={() => { vibrateClick(); setShowFavorites(!showFavorites); }} title="收藏位置" aria-label="收藏的位置">⭐</button>
            <button className="am-icon-btn" onClick={() => { vibrateClick(); showToast('已获取位置'); }} title="定位" aria-label="获取当前位置">📍</button>
          </>
        )}
        <button className="am-icon-btn" onClick={goSettings} title="设置" aria-label="打开设置">⚙️</button>
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

        {/* 识别页 - 寻物目标输入浮层已移至底部(am-app直接子元素,避免z-index层级问题) */}

        {/* 导航页 - 历史搜索浮层 */}
        {activeTab === 'navigate' && showNavHistory && navHistory.length > 0 && (
          <div className="am-history-panel">
            <div className="am-history-header">
              <span className="am-history-title">🕐 历史搜索</span>
              <button className="am-history-clear" onClick={handleClearNavHistory}>清空</button>
            </div>
            <div className="am-history-list">
              {navHistory.map((item, i) => (
                <button key={i} className="am-history-item" onClick={() => handleNavigate(item)}>
                  <span className="am-history-icon">📍</span>
                  <span className="am-history-text">{item}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== 底部浮动操作区 ===== */}
      <div className="am-bottom-zone">
        {/* SOS页 - 大圆按钮 + 取消按钮 */}
        {activeTab === 'sos' && (
          <div className="am-sos-bottom">
            <button className="am-sos-circle" onClick={handleSos} disabled={busy}>
              <span className="icon">🆘</span>
              <span className="text">{busy ? '发送中' : '紧急呼救'}</span>
            </button>
            <div className="am-sos-tip">点击立即向紧急联系人发送位置</div>
            <button className="am-sos-cancel-btn" onClick={handleSosCancel}>
              取消SOS
            </button>
            <div className="am-sos-help-tip">说"我没事"可取消120拨打</div>
          </div>
        )}

        {/* 识别页 - 识别记录 + 五个模式按钮 + 输入框 */}
        {activeTab === 'recognize' && (
          <div className="am-recognize-bottom">
            {/* 识别记录显示(按钮上方) - 聊天式左右分栏 */}
            <div className="am-msg-list">
              {messages.slice(-20).map((msg, i) => {
                const isUser = msg.role === 'user';
                const showTime = i === 0 || messages[messages.length - 20 + i - 1]?.time !== msg.time;
                return (
                  <div key={i} className={`am-msg ${isUser ? 'user' : 'assistant'}`}>
                    <div className="am-msg-avatar">{isUser ? '👤' : ''}</div>
                    <div className="am-msg-content">
                      {showTime && <div className="am-msg-time">{msg.time}</div>}
                      <div className="am-msg-bubble">{msg.text}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* 寻物模式提示条 */}
            {activeMode === 'find' && findTarget && (
              <div className="am-find-status">🔍 正在寻找：{findTarget}</div>
            )}

            {/* 五个模式按钮一行 */}
            <div className="am-quick-row">
              <button className={`am-quick-icon ${activeMode === 'analyze' ? 'active' : ''}`} onClick={() => { vibrateClick(); toggleMode('analyze'); }}>
                <span className="icon">⚡</span><span className="label">分析</span>
              </button>
              <button className={`am-quick-icon ${activeMode === 'travel' ? 'active' : ''}`} onClick={() => { vibrateClick(); toggleMode('travel'); }}>
                <span className="icon">🚶</span><span className="label">出行</span>
              </button>
              <button className={`am-quick-icon ${activeMode === 'read' ? 'active' : ''}`} onClick={() => { vibrateClick(); toggleMode('read'); }}>
                <span className="icon">📖</span><span className="label">阅读</span>
              </button>
              <button className={`am-quick-icon ${activeMode === 'traffic' ? 'active' : ''}`} onClick={() => { vibrateClick(); toggleMode('traffic'); }}>
                <span className="icon">🚦</span><span className="label">红绿灯</span>
              </button>
              <button className={`am-quick-icon find ${activeMode === 'find' ? 'active' : ''}`} onClick={() => { vibrateClick(); toggleMode('find'); }}>
                <span className="icon">🔍</span><span className="label">寻物</span>
              </button>
            </div>

            {/* 统一输入框: 左侧按住说话/文本输入 + 右侧切换icon, 同一圆角矩形 */}
            <div className="am-input-box">
              {/* 左侧: 按住说话 / 文本输入框 */}
              {showTextInput ? (
                <input
                  type="text"
                  className="am-input-box-field"
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  placeholder="输入文字指令..."
                  onKeyDown={e => { if (e.key === 'Enter' && textInput.trim()) { handleTextInputSubmit(textInput.trim()); setTextInput(''); } }}
                  name="ark-recognize-input-off"
                  autoComplete="nope"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                />
              ) : (
                <button
                  className={`am-input-box-press ${asr.listening ? 'listening' : ''}`}
                  onMouseDown={handlePressStart} onMouseUp={handlePressEnd}
                  onTouchStart={handlePressStart} onTouchEnd={handlePressEnd}
                >
                  <span className="icon">🎤</span><span>{asr.listening ? '松开发送' : '按住说话'}</span>
                </button>
              )}

              {/* 右侧: 切换icon (键盘↔麦克风) */}
              <button
                className="am-input-box-toggle"
                onClick={() => { vibrateClick(); setShowTextInput(!showTextInput); }}
                title={showTextInput ? '切回语音' : '切到文字'}
              >
                {showTextInput ? '🎤' : '⌨️'}
              </button>
            </div>
          </div>
        )}

        {/* 导航页 - 统一输入框(与识别页同设计): 左侧按住说话/文本输入 + 右侧切换icon */}
        {activeTab === 'navigate' && (
          <div className="am-navigate-bottom">
            {/* POI搜索建议浮层(输入时显示,优先于历史搜索) */}
            {navInputMode && poiSuggestions.length > 0 && (
              <div className="am-poi-panel">
                <div className="am-poi-header">
                  <span className="am-poi-title">🔍 搜索结果</span>
                  {poiLoading && <span className="am-poi-loading">搜索中...</span>}
                </div>
                <div className="am-poi-list">
                  {poiSuggestions.map((poi, i) => (
                    <button key={i} className="am-poi-item" onMouseDown={(e) => { e.preventDefault(); handlePoiSelect(poi); }}>
                      <span className="am-poi-icon">📍</span>
                      <div className="am-poi-info">
                        <div className="am-poi-name">{poi.name}</div>
                        <div className="am-poi-meta">
                          {poi.city && <span className="am-poi-city">{poi.city}</span>}
                          {poi.address && <span className="am-poi-addr">{poi.address}</span>}
                        </div>
                      </div>
                      {poi.distance != null && poi.distance > 0 && (
                        <span className="am-poi-dist">{poi.distance < 1000 ? `${poi.distance}m` : `${(poi.distance/1000).toFixed(1)}km`}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="am-input-box">
              {/* 左侧: 文本输入框 / 按住说话 */}
              {navInputMode ? (
                <input
                  type="text"
                  className="am-input-box-field"
                  value={navInput}
                  onChange={e => handleNavInputChange(e.target.value)}
                  onFocus={() => { if (!navInput.trim()) setShowNavHistory(true); }}
                  onBlur={() => setTimeout(() => { setShowNavHistory(false); }, 200)}
                  placeholder="输入目的地,如五一广场"
                  onKeyDown={e => { if (e.key === 'Enter' && navInput.trim()) { clearPoiSuggestions(); handleNavigate(); setNavInputMode(false); } }}
                  name="ark-navigate-input-off"
                  autoComplete="nope"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                />
              ) : (
                <button
                  className={`am-input-box-press ${asr.listening ? 'listening' : ''}`}
                  onMouseDown={handlePressStart} onMouseUp={handlePressEnd}
                  onTouchStart={handlePressStart} onTouchEnd={handlePressEnd}
                >
                  <span className="icon">🎤</span><span>{asr.listening ? '松开发送' : '按住说话'}</span>
                </button>
              )}

              {/* 右侧: 切换icon (键盘↔麦克风) */}
              <button
                className="am-input-box-toggle"
                onClick={() => { vibrateClick(); setNavInputMode(!navInputMode); if (!navInputMode) { setNavInput(''); clearPoiSuggestions(); } }}
                title={navInputMode ? '切回语音' : '切到文字'}
              >
                {navInputMode ? '🎤' : '⌨️'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===== 寻物目标输入浮层(全屏遮罩,放在am-app直接子元素确保z-index最高) ===== */}
      {showFindInput && (
        <div className="am-find-panel" onClick={() => { setShowFindInput(false); setFindTarget(''); speak('已取消'); }}>
          <div className="am-find-card" onClick={e => e.stopPropagation()}>
            <div className="am-find-title">🔍 寻物模式</div>
            <div className="am-find-hint">请说出或输入要找的物品，如：钥匙、手机、水杯</div>
            <div className="am-find-input-row">
              <input
                type="text"
                className="am-find-input"
                placeholder="输入物品名称..."
                value={findTarget}
                onChange={e => setFindTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && findTarget.trim()) startFindMode(findTarget); }}
                name="ark-find-input-off"
                autoComplete="nope"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
              />
              <button
                className={`am-find-voice ${asr.listening ? 'listening' : ''}`}
                onMouseDown={handlePressStart} onMouseUp={handlePressEnd}
                onTouchStart={handlePressStart} onTouchEnd={handlePressEnd}
                title="按住说出物品名"
              >🎤</button>
            </div>
            <div className="am-find-actions">
              <button className="am-find-cancel" onClick={() => { setShowFindInput(false); setFindTarget(''); speak('已取消'); }}>取消</button>
              <button className="am-find-confirm" onClick={() => startFindMode(findTarget)}>开始寻找</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="am-toast" role="status" aria-live="polite">{toast}</div>}

      {/* 实时字幕条(常驻显示) */}
      {subtitle && (
        <div className={`am-subtitle-bar ${subtitle.includes('🚨') ? 'urgent' : subtitle.includes('⚠️') ? 'warning' : ''}`} role="status" aria-live="assertive" aria-atomic="true">
          {subtitle}
        </div>
      )}

      {/* 语音唤醒状态指示器 */}
      {voiceWakeActive && !firstUse && (
        <div className={`am-wake-indicator ${wakeDialogue ? 'active' : ''}`} aria-label={wakeDialogue ? '正在聆听' : '语音唤醒已就绪，说小舟小舟唤醒'}>
          <span className="am-wake-dot" />
          <span className="am-wake-text">{wakeDialogue ? '聆听中...' : '🎙️ 说"小舟小舟"唤醒'}</span>
        </div>
      )}

      {/* 红绿灯快速检测指示 */}
      {trafficLightFast && activeMode === 'traffic' && (
        <div className={`am-traffic-light-overlay ${trafficLightFast.color}`} role="alert" aria-live="assertive">
          <div className="am-tl-circle" />
          <div className="am-tl-text">{trafficLightFast.color === 'red' ? '红灯 停下' : trafficLightFast.color === 'green' ? '绿灯 通行' : '黄灯 谨慎'}</div>
        </div>
      )}

      {/* 持久错误提示条 */}
      {persistentError && (
        <div className="am-error-banner" role="alert">
          <span className="am-error-icon">⚠️</span>
          <span className="am-error-text">{persistentError}</span>
          <button className="am-error-dismiss" onClick={() => setPersistentError(null)} aria-label="关闭提示">✕</button>
        </div>
      )}

      {/* 首次使用引导教程浮层 */}
      {firstUse && (
        <div className="am-tutorial-overlay" role="dialog" aria-modal="true" aria-label="使用引导">
          <div className="am-tutorial-card">
            <div className="am-tutorial-step-indicator">
              {tutorialSteps.map((_, i) => (
                <div key={i} className={`am-tutorial-dot ${i === tutorialStep ? 'active' : ''} ${i < tutorialStep ? 'done' : ''}`} />
              ))}
            </div>
            <div className="am-tutorial-icon">{['👋','🎤','🧭','🔊','🚀'][tutorialStep]}</div>
            <h2 className="am-tutorial-title">{tutorialSteps[tutorialStep]?.title}</h2>
            <p className="am-tutorial-text">{tutorialSteps[tutorialStep]?.text}</p>
            <div className="am-tutorial-actions">
              {tutorialStep > 0 && (
                <button className="am-tutorial-btn secondary" onClick={() => setTutorialStep(prev => prev - 1)} aria-label="上一步">上一步</button>
              )}
              <button className="am-tutorial-btn primary" onClick={nextTutorialStep} aria-label={tutorialStep === 4 ? '开始使用' : '下一步'}>
                {tutorialStep === 4 ? '开始使用' : '下一步'}
              </button>
            </div>
            <button className="am-tutorial-skip" onClick={() => { completeTutorial(); startCamera(); setTimeout(() => startWakeListener(), 1000); speak('已跳过教程，欢迎使用感知方舟。说出小舟小舟即可唤醒我。', { rate: 0.9 }); }} aria-label="跳过教程">跳过</button>
          </div>
        </div>
      )}
    </div>
  );
}
