import { useState, useRef, useCallback, useEffect } from 'react';
import { useSpeechRecognition, useSpeechSynthesis } from './useSpeech.js';
import { api } from '../services/api.js';

const WAKE_WORD = '小舟小舟';

/**
 * 小舟智能助手 Hook
 *
 * 工作流程:
 * 1. 开机自检: 获取位置 → 查询天气 → 生成问候语 → TTS播报 → 进入待唤醒模式
 * 2. 待唤醒模式: 持续ASR监听,检测到"小舟小舟"进入对话模式
 * 3. 对话模式: 8秒内连续识别用户指令,调用后端 /api/assistant/chat
 * 4. 超时后回到待唤醒模式
 */
export function useAssistant({ location, onAgentAction, onWeatherReady, enabled = true } = {}) {
  const [active, setActive] = useState(false);         // 是否在对话模式
  const [listening, setListening] = useState(false);   // 是否在监听唤醒词
  const [thinking, setThinking] = useState(false);     // 是否在等待AI回复
  const [booting, setBooting] = useState(false);       // 是否在开机自检播报中
  const [messages, setMessages] = useState([]);        // 对话消息列表
  // sessionId持久化: 页面刷新后从sessionStorage恢复,保持多轮对话连续性
  const sessionIdRef = useRef(sessionStorage.getItem('ark_session_id') || '');
  const dialogueTimeoutRef = useRef(null);
  const wakeModeRef = useRef(false);                   // true=待唤醒监听, false=对话中或未启动
  const lastTranscriptRef = useRef('');
  const asrActiveRef = useRef(false);                  // 当前是否应该保持ASR运行
  // TTS播报回声抑制: TTS播报期间停止ASR,播报结束后延迟恢复,避免麦克风捕获TTS输出形成回声循环
  const ttsMutedRef = useRef(false);
  // 用户说话停顿检测: final结果后等待1.5秒无新输入才发送,避免用户还没说完就被打断
  const speechPauseTimerRef = useRef(null);
  // 当前累计的用户输入(final+interim,用于实时显示和最终发送)
  const pendingTextRef = useRef('');
  const [pendingText, setPendingText] = useState('');  // 用于UI实时显示用户正在说的话

  const tts = useSpeechSynthesis();
  const asr = useSpeechRecognition();

  const addMessage = useCallback((role, text) => {
    setMessages(prev => [...prev.slice(-19), {
      role, text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    }]);
  }, []);

  // ===== TTS播报回声抑制: TTS播报时停止ASR,播报结束后延迟恢复 =====
  useEffect(() => {
    if (tts.speaking) {
      // TTS开始播报 - 立即停止ASR,标记静音
      ttsMutedRef.current = true;
      if (asr.listening) {
        asr.stop();
      }
    } else if (ttsMutedRef.current) {
      // TTS播报结束 - 延迟800ms恢复ASR(等回声完全消散)
      ttsMutedRef.current = false;
      const timer = setTimeout(() => {
        if (asrActiveRef.current && !booting && !thinking && !tts.speaking) {
          if (!asr.listening) {
            asr.start();
          }
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [tts.speaking]);

  // ===== 开机自检: 获取位置+天气,生成问候语,播报后进入待唤醒模式 =====
  const bootGreeting = useCallback(async () => {
    if (booting) return;
    setBooting(true);
    try {
      let greeting = '';
      let weatherInfo = null;

      if (location?.lat && location?.lng) {
        try {
          const result = await api.locationInfo(location.lat, location.lng);
          if (result.weather) {
            weatherInfo = result.weather;
            greeting = buildGreeting(result.weather, result.location);
          }
        } catch (err) {
          console.warn('[小舟] 位置/天气查询失败:', err.message);
        }
      }

      // 降级: 无位置或查询失败时使用默认问候
      if (!greeting) {
        greeting = buildGreeting(null, null);
      }

      // 播报问候
      addMessage('assistant', greeting);
      tts.speak(greeting, { rate: 0.95 });

      // 通知外部天气数据已就绪
      if (onWeatherReady && weatherInfo) {
        onWeatherReady(weatherInfo);
      }
    } catch (err) {
      console.error('[小舟] 开机自检失败:', err);
    } finally {
      setBooting(false);
      // 播报结束后进入待唤醒模式
      setTimeout(() => {
        enterWakeMode();
      }, 1500);
    }
  }, [booting, location, addMessage, tts, onWeatherReady]);

  // 生成问候语
  function buildGreeting(weather, loc) {
    const now = new Date();
    const hour = now.getHours();
    let period = '晚上好';
    if (hour < 6) period = '凌晨好';
    else if (hour < 11) period = '早上好';
    else if (hour < 13) period = '中午好';
    else if (hour < 18) period = '下午好';

    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

    if (weather && weather.dayWeather) {
      // 完整行政区划: 省 + 市 + 区/县(视障用户需要明确知道自己所在区县)
      const province = (loc && loc.province) || '';
      const city = (loc && loc.city) || '';
      const district = (loc && loc.district) || '';
      const locText = [province, city, district].filter(Boolean).join('');
      const tempText = weather.dayTemp ? `温度${weather.dayTemp}度` : '';
      const weatherText = weather.dayWeather || '';
      let tips = '';
      if (/晴|阳光|太阳/.test(weatherText) && weather.dayTemp && parseInt(weather.dayTemp) > 25) {
        tips = '太阳较大，外出注意防晒';
      } else if (/雨/.test(weatherText)) {
        tips = '有雨，记得带伞';
      } else if (/雪/.test(weatherText)) {
        tips = '有雪，注意保暖防滑';
      } else if (weather.dayTemp && parseInt(weather.dayTemp) < 5) {
        tips = '气温较低，注意保暖';
      } else if (weather.dayTemp && parseInt(weather.dayTemp) > 32) {
        tips = '气温较高，注意防暑补水';
      }

      return `主人，${period}。现在是${dateStr}，您当前位于${locText}，今天${weatherText}，${tempText}${tips ? '，' + tips : ''}。有什么需要随时可以通过"小舟小舟"唤醒我。`;
    }

    return `主人，${period}。现在是${dateStr}。有什么需要随时可以通过"小舟小舟"唤醒我。`;
  }

  // ===== 进入待唤醒模式: 启动持续ASR监听 =====
  const enterWakeMode = useCallback(() => {
    wakeModeRef.current = true;
    asrActiveRef.current = true;
    setListening(true);
    setActive(false);
    if (asr.supported && !asr.listening) {
      asr.start();
    }
  }, [asr]);

  // ===== 发送文本到后端 =====
  const sendText = useCallback(async (text) => {
    if (!text.trim()) return;
    addMessage('user', text);
    setThinking(true);
    console.log('[小舟] 发送消息:', text, '位置:', location?.lat, location?.lng);
    try {
      const result = await api.assistantChat(text, {
        sessionId: sessionIdRef.current,
        location
      });
      console.log('[小舟] 收到回复:', result.intent, result.action, result.reply?.slice(0, 40));
      if (result.sessionId) {
        sessionIdRef.current = result.sessionId;
        sessionStorage.setItem('ark_session_id', result.sessionId);
      }
      if (result.reply) {
        addMessage('assistant', result.reply);
        tts.speak(result.reply);
      }
      if (result.action && onAgentAction) {
        onAgentAction({ action: result.action, intent: result.intent, entity: result.entity });
      }
    } catch (err) {
      console.error('[小舟] 发送失败:', err);
      const errMsg = `抱歉，我遇到了问题: ${err.message}`;
      addMessage('assistant', errMsg);
      tts.speak(errMsg);
    } finally {
      setThinking(false);
    }
  }, [addMessage, location, onAgentAction, tts]);

  // ===== 进入对话模式 =====
  const enterDialogue = useCallback(() => {
    setActive(true);
    wakeModeRef.current = false;
    tts.speak('我在，请说。');
    addMessage('assistant', '我在，请说。');
    if (dialogueTimeoutRef.current) clearTimeout(dialogueTimeoutRef.current);
    dialogueTimeoutRef.current = setTimeout(() => {
      // 超时回到待唤醒模式
      enterWakeMode();
    }, 12000);
  }, [addMessage, tts, enterWakeMode]);

  // ===== 主动发送(键盘/按钮) =====
  const send = useCallback((text) => {
    if (dialogueTimeoutRef.current) {
      clearTimeout(dialogueTimeoutRef.current);
      dialogueTimeoutRef.current = setTimeout(() => {
        enterWakeMode();
      }, 12000);
    }
    sendText(text);
  }, [sendText, enterWakeMode]);

  // ===== 处理ASR转录: 区分final和interim,停顿1.5秒后才发送 =====
  // final结果: 用户说完了一句话(有停顿),累计到pendingText,启动停顿计时器
  // interim结果: 用户正在说,只更新UI显示,不发送
  // 停顿计时器: 1.5秒内无新final结果,认为用户说完了,发送pendingText
  useEffect(() => {
    // TTS播报回声抑制
    if (ttsMutedRef.current || tts.speaking) return;

    // ===== 处理final结果(transcript变化) =====
    if (asr.transcript && asr.transcript !== lastTranscriptRef.current) {
      lastTranscriptRef.current = asr.transcript;
      const finalText = asr.transcript.trim();
      if (!finalText) return;

      // 开机播报中不响应
      if (booting) return;

      // 累计final文本
      pendingTextRef.current = pendingTextRef.current
        ? pendingTextRef.current + finalText
        : finalText;
      setPendingText(pendingTextRef.current);

      // 待唤醒模式: 检测唤醒词(立即响应,不需要停顿)
      if (wakeModeRef.current) {
        if (pendingTextRef.current.includes(WAKE_WORD) ||
            pendingTextRef.current.includes('小周小周') ||
            pendingTextRef.current.includes('小猪小猪') ||
            pendingTextRef.current.includes('小舟')) {
          // 清空pending,进入对话
          pendingTextRef.current = '';
          setPendingText('');
          if (speechPauseTimerRef.current) {
            clearTimeout(speechPauseTimerRef.current);
            speechPauseTimerRef.current = null;
          }
          enterDialogue();
          return;
        }
        // 待唤醒模式但不包含唤醒词 - 清空pending继续监听
        pendingTextRef.current = '';
        setPendingText('');
        return;
      }

      // 对话模式: 启动停顿计时器,1.5秒后发送
      if (active) {
        if (speechPauseTimerRef.current) {
          clearTimeout(speechPauseTimerRef.current);
        }
        speechPauseTimerRef.current = setTimeout(() => {
          const textToSend = pendingTextRef.current.trim();
          pendingTextRef.current = '';
          setPendingText('');
          speechPauseTimerRef.current = null;
          if (textToSend.length >= 2) {
            // 重置对话超时
            if (dialogueTimeoutRef.current) {
              clearTimeout(dialogueTimeoutRef.current);
              dialogueTimeoutRef.current = setTimeout(() => {
                enterWakeMode();
              }, 12000);
            }
            sendText(textToSend);
          }
        }, 1500);
      }
    }
  }, [asr.transcript, enterDialogue, sendText, active, booting, enterWakeMode, tts.speaking]);

  // ===== interim实时显示: 用户正在说话时更新UI =====
  useEffect(() => {
    if (ttsMutedRef.current || tts.speaking) return;
    if (active && asr.interim) {
      // interim和已确认的final合并显示
      setPendingText((pendingTextRef.current ? pendingTextRef.current : '') + asr.interim);
    }
  }, [asr.interim, active, tts.speaking]);

  // ===== 持续监听: ASR结束后自动重启(待唤醒或对话模式中) =====
  useEffect(() => {
    if (!enabled) return;
    if (!asr.supported) return;
    if (!asrActiveRef.current) return;
    if (booting) return;

    // ASR结束(单次识别完成或超时) - 自动重启
    // 但TTS播报期间不重启(由TTS回声抑制useEffect负责在播报结束后恢复)
    if (!asr.listening && !thinking && !ttsMutedRef.current && !tts.speaking) {
      const timer = setTimeout(() => {
        if (asrActiveRef.current && !asr.listening && !thinking && !booting && !ttsMutedRef.current && !tts.speaking) {
          asr.start();
        }
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [asr.listening, asr.supported, thinking, enabled, booting, asr, tts.speaking]);

  // ===== 启动时: 等待位置就绪后开机自检 =====
  // 修复闭包陷阱: 原useEffect依赖[enabled]只执行一次,bootGreeting捕获的是首次location(null)
  // 改为监听location变化,location就绪(定位成功或失败回退)后才触发bootGreeting
  const bootedRef = useRef(false);
  useEffect(() => {
    if (!enabled || bootedRef.current) return;
    if (location) {
      // location已就绪(定位成功或失败后的默认值),0.5秒后boot
      bootedRef.current = true;
      const timer = setTimeout(() => bootGreeting(), 500);
      return () => clearTimeout(timer);
    }
    // 兜底: 9秒后强制boot(useGeolocation超时8秒后会设置默认位置,加1秒余量)
    const timer = setTimeout(() => {
      if (bootedRef.current) return;
      bootedRef.current = true;
      bootGreeting();
    }, 9000);
    return () => clearTimeout(timer);
  }, [enabled, location]); // 依赖location,确保bootGreeting闭包能拿到最新值

  // ===== 手动开关 =====
  const startListening = useCallback(() => {
    enterWakeMode();
  }, [enterWakeMode]);

  const stopListening = useCallback(() => {
    asrActiveRef.current = false;
    wakeModeRef.current = false;
    setListening(false);
    setActive(false);
    if (asr.listening) asr.stop();
    if (dialogueTimeoutRef.current) clearTimeout(dialogueTimeoutRef.current);
  }, [asr]);

  const clearMessages = useCallback(async () => {
    setMessages([]);
    if (sessionIdRef.current) {
      try { await api.assistantClear(sessionIdRef.current); } catch (e) {}
    }
  }, []);

  // 手动重新触发开机播报
  const reboot = useCallback(() => {
    if (asr.listening) asr.stop();
    setActive(false);
    wakeModeRef.current = false;
    asrActiveRef.current = false;
    setListening(false);
    bootGreeting();
  }, [asr, bootGreeting]);

  return {
    active,
    listening,
    thinking,
    booting,
    messages,
    pendingText,                                      // 用户正在说的话(实时显示)
    lastTranscript: asr.transcript,
    send,
    clear: clearMessages,
    startListening,
    stopListening,
    reboot,
    supported: asr.supported && tts.supported,
    sessionId: sessionIdRef.current,
    bootGreeting
  };
}
