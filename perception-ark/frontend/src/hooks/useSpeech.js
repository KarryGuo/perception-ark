import { useEffect, useRef, useState, useCallback } from 'react';

// 已知中文男声/女声音色名称(跨平台匹配: Windows/macOS/iOS/Android)
const FEMALE_VOICE_KEYWORDS = ['Huihui', 'Yaoyao', 'Tingting', 'Xiaoxiao', 'Xiaoyi', 'Yunyang', 'Yunxia', 'Meijia', 'Sinji', 'Female', '女', 'Ting-Ting'];
const MALE_VOICE_KEYWORDS = ['Kangkang', 'Yunxi', 'Yunjian', 'Yunye', 'Lianna', 'Male', '男'];

/**
 * 按性别匹配中文语音: 优先匹配已知音色名,找不到则返回null(用音调模拟)
 */
function findVoiceByGender(voices, gender) {
  if (!voices || voices.length === 0) return null;
  const cnVoices = voices.filter(v => v.lang && v.lang.startsWith('zh'));
  const pool = cnVoices.length > 0 ? cnVoices : voices;
  const keywords = gender === 'male' ? MALE_VOICE_KEYWORDS : FEMALE_VOICE_KEYWORDS;
  for (const kw of keywords) {
    const found = pool.find(v => v.name && v.name.toLowerCase().includes(kw.toLowerCase()));
    if (found) return found;
  }
  return null;
}

/**
 * 语音合成 Hook (TTS) - 浏览器原生
 * 支持中文语音播报、流式分句播报
 * 音色/语速/性别从localStorage读取(设置页可调)
 * 优化: 预热语音引擎 + onend驱动队列,减少首次播报延迟
 */
export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [voice, setVoice] = useState(null);
  const utterQueueRef = useRef([]);
  const currentUtterRef = useRef(null);
  // 停止标志: stop()后阻止所有pending的playNext继续推进
  const stoppedRef = useRef(false);
  // 跟踪所有playNext的setTimeout,stop()时全部清除
  const playNextTimersRef = useRef([]);
  // 音色性别: 'male' | 'female' | null(无偏好,用具体voice)
  const genderRef = useRef(null);
  // generation机制: 每次 speak/stop 都递增,旧 utterance 的 onend 只在 generation 匹配时才驱动 playNext
  // 根本修复: stop() 后即使新的 speak() 重置了 stoppedRef,旧 onend 也不会继续播放旧队列
  const generationRef = useRef(0);

  // 从localStorage读取用户设置的语速和音色
  const getSavedRate = () => {
    const r = parseFloat(localStorage.getItem('ark_tts_rate'));
    return isNaN(r) ? 0.95 : r;
  };
  const getSavedGender = () => localStorage.getItem('ark_tts_gender') || '';
  const getSavedVoice = (voices) => {
    const name = localStorage.getItem('ark_tts_voice') || '';
    if (!name || !voices) return null;
    return voices.find(v => v.name === name) || null;
  };

  // 根据性别计算音调(找不到对应音色时用音调模拟性别特征)
  // 女声柔美: pitch 1.2; 男声阳光: pitch 0.8
  const getPitchForGender = () => {
    const g = genderRef.current || getSavedGender();
    if (g === 'female') return 1.2;
    if (g === 'male') return 0.8;
    return 1.0;
  };

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      console.warn('[TTS] 浏览器不支持语音合成');
      return;
    }
    setSupported(true);

    // 加载中文语音(预热: 多次重试确保voices已就绪,减少首次播报延迟)
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return; // 还没就绪,等onvoiceschanged

      // 优先用户设置的具体音色
      const saved = getSavedVoice(voices);
      if (saved) {
        setVoice(saved);
        return;
      }
      // 按性别匹配
      const gender = getSavedGender();
      if (gender) {
        genderRef.current = gender;
        const matched = findVoiceByGender(voices, gender);
        if (matched) {
          setVoice(matched);
          return;
        }
      }
      // 默认中文语音
      const cnVoice = voices.find(v => v.lang === 'zh-CN')
        || voices.find(v => v.lang.startsWith('zh'))
        || voices[0];
      if (cnVoice) setVoice(cnVoice);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    // 预热: 部分浏览器首次speak会有较长延迟,主动触发一次空加载加速引擎初始化
    try {
      const warmup = new SpeechSynthesisUtterance('');
      warmup.volume = 0;
      window.speechSynthesis.speak(warmup);
    } catch (e) {}

    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // 外部可调用以切换音色(设置页调用)
  const setVoiceByName = useCallback((name) => {
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(vv => vv.name === name);
    if (v) {
      setVoice(v);
      genderRef.current = null;
      localStorage.setItem('ark_tts_voice', name);
      localStorage.removeItem('ark_tts_gender');
    } else if (name === '') {
      localStorage.removeItem('ark_tts_voice');
      localStorage.removeItem('ark_tts_gender');
      genderRef.current = null;
      // 恢复默认中文音色
      const cn = voices.find(v => v.lang === 'zh-CN') || voices.find(v => v.lang.startsWith('zh'));
      if (cn) setVoice(cn);
    }
  }, []);

  // 按性别切换音色: 女声柔美 / 男声阳光
  const setVoiceByGender = useCallback((gender) => {
    const voices = window.speechSynthesis.getVoices() || [];
    const matched = findVoiceByGender(voices, gender);
    if (matched) {
      setVoice(matched);
      localStorage.setItem('ark_tts_gender', gender);
      localStorage.removeItem('ark_tts_voice'); // 性别优先于具体音色
    } else {
      // 找不到对应音色,仅设置性别标记,用音调模拟
      localStorage.setItem('ark_tts_gender', gender);
      localStorage.removeItem('ark_tts_voice');
    }
    genderRef.current = gender;
  }, []);

  const speak = useCallback((text, options = {}) => {
    if (!supported || !text) return;
    const { urgent = false, onEnd, rate } = options;

    // 数字小数点转中文"点"(如"1.5米"→"1点5米"),否则TTS会读成"1 5米"导致视障者误解
    // 仅转换距离/尺寸相关的数字小数点,不影响其他文本
    const normalizedText = typeof text === 'string'
      ? text.replace(/(\d+)\.(\d+)/g, '$1点$2')
      : text;

    // 新的 speak 调用: 递增 generation,使之前所有 utterance 的 onend 失效
    const myGeneration = ++generationRef.current;
    // 重置停止标志(允许本次播报的 playNext 推进)
    stoppedRef.current = false;

    // 如果之前 stop() 调用过 pause(),需要 resume 才能播放新的
    try { window.speechSynthesis.resume(); } catch (e) {}

    // 紧急播报 - 立即中断当前播报
    if (urgent) {
      window.speechSynthesis.cancel();
      utterQueueRef.current = [];
      playNextTimersRef.current.forEach(t => clearTimeout(t));
      playNextTimersRef.current = [];
    }

    // 分句(避免长文本被截断)
    const sentences = normalizedText.match(/[^。！？!?.]+[。！？!?.]?/g) || [normalizedText];

    // 语速优先级: 调用方传入 > localStorage设置 > 紧急/默认
    const finalRate = rate || getSavedRate();
    // 音调: 性别模拟(女声柔美高音调 / 男声阳光低音调)
    const basePitch = getPitchForGender();

    sentences.forEach((sentence, idx) => {
      const trimmed = sentence.trim();
      if (!trimmed) return;

      const utter = new SpeechSynthesisUtterance(trimmed);
      if (voice) utter.voice = voice;
      utter.lang = 'zh-CN';
      utter.rate = urgent ? Math.min(finalRate * 1.1, 1.5) : finalRate;
      utter.pitch = urgent ? Math.min(basePitch * 1.2, 1.5) : basePitch;
      utter.volume = urgent ? 1.0 : 0.9;

      if (idx === 0) setSpeaking(true);

      utter.onstart = () => {
        if (idx === 0) setSpeaking(true);
        currentUtterRef.current = utter;
      };

      utter.onend = () => {
        // 关键: 只有当前 generation 的 utterance 才驱动 playNext
        // stop() 或新的 speak() 都会递增 generation,使旧 onend 失效
        if (myGeneration !== generationRef.current) return;
        // onend 触发后清除所有兜底定时器(当前 utterance 已正常结束)
        playNextTimersRef.current.forEach(t => clearTimeout(t));
        playNextTimersRef.current = [];
        if (idx === sentences.length - 1) {
          setSpeaking(false);
          currentUtterRef.current = null;
          if (onEnd) onEnd();
        }
        // onend驱动下一句(比轮询更快,减少播报延迟)
        playNext();
      };

      utter.onerror = () => {
        if (myGeneration !== generationRef.current) return;
        setSpeaking(false);
        currentUtterRef.current = null;
      };

      utterQueueRef.current.push(utter);
    });

    // 依次播放(onend驱动为主 + 兜底轮询为辅)
    // 关键修复: 兜底轮询仅在浏览器未在播放时才推进队列
    // 避免提前将utterance排入浏览器队列导致Chrome speechSynthesis队列混乱
    const playNext = () => {
      // 关键: generation 不匹配时直接返回,阻止旧 speak 的 playNext 继续推进
      if (myGeneration !== generationRef.current) return;
      if (stoppedRef.current) return;
      const next = utterQueueRef.current.shift();
      if (next) {
        window.speechSynthesis.speak(next);
        // 兜底轮询: 部分Chrome版本onend不触发,3秒后检查是否需要推进
        // 仅在浏览器未在播放时才推进(避免打断正在播放的utterance)
        const timer = setTimeout(() => {
          if (myGeneration !== generationRef.current) return;
          if (stoppedRef.current) return;
          if (!window.speechSynthesis.speaking) {
            playNext();
          }
        }, 3000);
        playNextTimersRef.current.push(timer);
      }
    };
    if (!window.speechSynthesis.speaking) playNext();
  }, [supported, voice]);

  const stop = useCallback(() => {
    if (!supported) return;
    // 递增 generation: 使所有正在播放/队列中的 utterance 的 onend 失效
    // 这是根本修复: 即使后续有新的 speak() 重置 stoppedRef,旧 onend 也不会驱动 playNext
    generationRef.current++;
    stoppedRef.current = true;
    playNextTimersRef.current.forEach(t => clearTimeout(t));
    playNextTimersRef.current = [];
    utterQueueRef.current = [];

    try { window.speechSynthesis.pause(); } catch (e) {}
    try { window.speechSynthesis.cancel(); } catch (e) {}

    setTimeout(() => {
      try { window.speechSynthesis.cancel(); } catch (e) {}
      setTimeout(() => {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }, 80);
    }, 50);

    setSpeaking(false);
  }, [supported]);

  return { speak, stop, speaking, supported, setVoiceByName, setVoiceByGender, voice };
}

/**
 * 语音识别 Hook (ASR) - Web Speech API
 * 支持中文连续识别
 */
export function useSpeechRecognition() {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [transcript, setTranscript] = useState('');        // 最终识别文本(仅final)
  const [interim, setInterim] = useState('');              // 临时识别文本(用户正在说)
  const recognitionRef = useRef(null);
  // ASR实际运行状态ref(避免React state异步更新导致重复start)
  const asrRunningRef = useRef(false);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('[ASR] 浏览器不支持语音识别(建议Chrome/Edge)');
      return;
    }
    setSupported(true);

    const recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;       // 连续模式,允许多个final结果
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      // final结果累计到transcript(触发sendText)
      if (finalText) {
        setTranscript(prev => (prev ? prev + finalText : finalText));
        setInterim('');
      } else if (interimText) {
        // 临时结果只更新interim,不触发发送
        setInterim(interimText);
      }
    };

    recognition.onend = () => {
      setListening(false);
      asrRunningRef.current = false;
    };

    recognition.onerror = (e) => {
      // no-speech是正常超时,不打印; not-allowed需要提示用户
      if (e.error === 'no-speech' || e.error === 'aborted') {
        // 静默处理,不打印
      } else {
        console.error('[ASR] 识别错误:', e.error);
      }
      setListening(false);
      asrRunningRef.current = false;
      if (e.error === 'not-allowed') {
        alert('请允许使用麦克风权限以启用语音识别');
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.stop(); } catch (e) {}
      asrRunningRef.current = false;
    };
  }, []);

  const start = useCallback(() => {
    if (!supported || !recognitionRef.current) return false;
    // 防重入: 如果recognition已经在运行,不重复start
    if (asrRunningRef.current) return false;
    setTranscript('');
    setInterim('');
    try {
      recognitionRef.current.start();
      asrRunningRef.current = true;
      setListening(true);
      return true;
    } catch (err) {
      // InvalidStateError: recognition尚未完全释放,实际未启动成功
      asrRunningRef.current = false;
      setListening(false);
      return false;
    }
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported || !recognitionRef.current) return;
    try { recognitionRef.current.stop(); } catch (e) {}
    asrRunningRef.current = false;
    setListening(false);
  }, [supported]);

  const reset = useCallback(() => {
    setTranscript('');
    setInterim('');
  }, []);

  return { start, stop, reset, listening, transcript, interim, supported };
}
