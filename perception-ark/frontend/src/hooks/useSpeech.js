import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 语音合成 Hook (TTS) - 浏览器原生
 * 支持中文语音播报、流式分句播报
 * 音色/语速从localStorage读取(设置页可调)
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

  // 从localStorage读取用户设置的语速和音色(设置页可调)
  const getSavedRate = () => {
    const r = parseFloat(localStorage.getItem('ark_tts_rate'));
    return isNaN(r) ? 0.95 : r;
  };
  const getSavedVoice = (voices) => {
    const name = localStorage.getItem('ark_tts_voice') || '';
    if (!name || !voices) return null;
    return voices.find(v => v.name === name) || null;
  };

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      console.warn('[TTS] 浏览器不支持语音合成');
      return;
    }
    setSupported(true);

    // 加载中文语音
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      // 优先使用用户设置的音色,否则默认中文语音
      const saved = getSavedVoice(voices);
      if (saved) {
        setVoice(saved);
        console.log('[TTS] 已加载用户音色:', saved.name);
        return;
      }
      const cnVoice = voices.find(v => v.lang === 'zh-CN')
        || voices.find(v => v.lang.startsWith('zh'))
        || voices[0];
      if (cnVoice) {
        setVoice(cnVoice);
        console.log('[TTS] 已选择语音:', cnVoice.name, cnVoice.lang);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

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
      localStorage.setItem('ark_tts_voice', name);
    }
  }, []);

  const speak = useCallback((text, options = {}) => {
    if (!supported || !text) return;
    const { urgent = false, onEnd, rate } = options;

    // 任何新的speak都重置停止标志
    stoppedRef.current = false;

    // 如果之前 stop() 调用过 pause(),需要 resume 才能播放新的
    try { window.speechSynthesis.resume(); } catch (e) {}

    // 紧急播报 - 立即中断当前播报
    if (urgent) {
      window.speechSynthesis.cancel();
      utterQueueRef.current = [];
      // 清除所有pending的playNext定时器
      playNextTimersRef.current.forEach(t => clearTimeout(t));
      playNextTimersRef.current = [];
    }

    // 分句(避免长文本被截断)
    const sentences = text.match(/[^。！？!?.]+[。！？!?.]?/g) || [text];

    // 语速优先级: 调用方传入 > localStorage设置 > 紧急/默认
    const finalRate = rate || getSavedRate();

    sentences.forEach((sentence, idx) => {
      const trimmed = sentence.trim();
      if (!trimmed) return;

      const utter = new SpeechSynthesisUtterance(trimmed);
      if (voice) utter.voice = voice;
      utter.lang = 'zh-CN';
      utter.rate = urgent ? Math.min(finalRate * 1.1, 1.5) : finalRate;
      utter.pitch = urgent ? 1.2 : 1.0;
      utter.volume = urgent ? 1.0 : 0.9;

      if (idx === 0) setSpeaking(true);

      utter.onstart = () => {
        if (idx === 0) setSpeaking(true);
        currentUtterRef.current = utter;
      };

      utter.onend = () => {
        if (idx === sentences.length - 1) {
          setSpeaking(false);
          currentUtterRef.current = null;
          if (onEnd) onEnd();
        }
      };

      utter.onerror = () => {
        setSpeaking(false);
        currentUtterRef.current = null;
      };

      utterQueueRef.current.push(utter);
    });

    // 依次播放
    const playNext = () => {
      // 停止标志检查: stop()后不再推进
      if (stoppedRef.current) return;
      const next = utterQueueRef.current.shift();
      if (next) {
        window.speechSynthesis.speak(next);
        // 某些浏览器需要轮询推进 - 跟踪定时器以便stop清除
        const timer = setTimeout(playNext, 100);
        playNextTimersRef.current.push(timer);
      }
    };
    if (!window.speechSynthesis.speaking) playNext();
  }, [supported, voice]);

  const stop = useCallback(() => {
    if (!supported) return;
    // 设置停止标志,阻止所有pending的playNext继续推进
    stoppedRef.current = true;
    // 清除所有pending的playNext定时器
    playNextTimersRef.current.forEach(t => clearTimeout(t));
    playNextTimersRef.current = [];
    utterQueueRef.current = [];

    // Chrome 已知 bug: 仅调用 cancel() 不能立即停止正在播放的音频
    // 必须先 pause() 立即暂停音频输出, 再 cancel() 清空队列
    // 然后在短延迟后再次 cancel() 确保浏览器内部状态彻底重置
    try { window.speechSynthesis.pause(); } catch (e) {}
    try { window.speechSynthesis.cancel(); } catch (e) {}

    // 二次清理: 在新事件循环中再次 cancel, 解决 Chrome utterance 残留问题
    setTimeout(() => {
      try { window.speechSynthesis.cancel(); } catch (e) {}
      setTimeout(() => {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }, 80);
    }, 50);

    setSpeaking(false);
  }, [supported]);

  return { speak, stop, speaking, supported, setVoiceByName, voice };
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
