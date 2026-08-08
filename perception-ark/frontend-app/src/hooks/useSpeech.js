import { useEffect, useRef, useState, useCallback } from 'react';

// 检测是否在Capacitor原生环境中
const isNative = () => {
  return typeof window !== 'undefined' && window.Capacitor !== undefined;
};

// 检测iOS设备
const isIOS = () => {
  return typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
};

/**
 * 语音合成 Hook (TTS) - 浏览器原生 + Capacitor降级
 */
export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [voice, setVoice] = useState(null);
  const utterQueueRef = useRef([]);
  const currentUtterRef = useRef(null);
  const stoppedRef = useRef(false);
  const playNextTimersRef = useRef([]);

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
    // 原生环境中TTS可能也可用，先检测浏览器TTS
    if ('speechSynthesis' in window) {
      setSupported(true);

      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        const saved = getSavedVoice(voices);
        if (saved) {
          setVoice(saved);
          return;
        }
        const cnVoice = voices.find(v => v.lang === 'zh-CN')
          || voices.find(v => v.lang.startsWith('zh'))
          || voices[0];
        if (cnVoice) {
          setVoice(cnVoice);
        }
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;

      return () => {
        window.speechSynthesis.cancel();
      };
    } else if (isNative()) {
      // 原生环境即使浏览器TTS不可用，也标记为支持（使用系统TTS降级）
      setSupported(true);
    }
  }, []);

  const setVoiceByName = useCallback((name) => {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(vv => vv.name === name);
    if (v) {
      setVoice(v);
      localStorage.setItem('ark_tts_voice', name);
    }
  }, []);

  const speak = useCallback((text, options = {}) => {
    if (!text) return;
    
    // 原生环境如果浏览器TTS不可用，尝试使用系统TTS或静默处理
    if (!('speechSynthesis' in window)) {
      console.log('[TTS] (原生环境播报):', text);
      // 在原生环境中，可以考虑使用Capacitor TTS插件，但目前先输出到字幕
      return;
    }

    const { urgent = false, onEnd, rate } = options;
    stoppedRef.current = false;

    try { window.speechSynthesis.resume(); } catch (e) {}

    if (urgent) {
      window.speechSynthesis.cancel();
      utterQueueRef.current = [];
      playNextTimersRef.current.forEach(t => clearTimeout(t));
      playNextTimersRef.current = [];
    }

    const sentences = text.match(/[^。！？!?.]+[。！？!?.]?/g) || [text];
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

    const playNext = () => {
      if (stoppedRef.current) return;
      const next = utterQueueRef.current.shift();
      if (next) {
        window.speechSynthesis.speak(next);
        const timer = setTimeout(playNext, 100);
        playNextTimersRef.current.push(timer);
      }
    };
    if (!window.speechSynthesis.speaking) playNext();
  }, [supported, voice]);

  const stop = useCallback(() => {
    if (!('speechSynthesis' in window)) {
      setSpeaking(false);
      return;
    }
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
  }, []);

  return { speak, stop, speaking, supported, setVoiceByName, voice };
}

/**
 * 语音识别 Hook (ASR)
 * - 浏览器环境: Web Speech API
 * - 原生环境: @capacitor-community/speech-recognition 插件
 */
export function useSpeechRecognition() {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef(null);
  const asrRunningRef = useRef(false);
  const nativeRecognitionRef = useRef(null);
  const nativePartialCallbackRef = useRef(null);

  useEffect(() => {
    let supported_ = false;

    // 检测浏览器Web Speech API
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      supported_ = true;
      setupBrowserASR(SR);
    }

    // 检测原生环境语音识别插件
    if (isNative()) {
      setupNativeASR().then(available => {
        if (available) supported_ = true;
        setSupported(supported_);
      });
    } else {
      setSupported(supported_);
    }

    return () => {
      try { recognitionRef.current?.stop?.(); } catch (e) {}
      try { nativeRecognitionRef.current?.stop?.(); } catch (e) {}
      asrRunningRef.current = false;
    };
  }, []);

  const setupBrowserASR = (SR) => {
    const recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
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
      if (finalText) {
        setTranscript(prev => (prev ? prev + finalText : finalText));
        setInterim('');
      } else if (interimText) {
        setInterim(interimText);
      }
    };

    recognition.onend = () => {
      setListening(false);
      asrRunningRef.current = false;
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('[ASR] 识别错误:', e.error);
      }
      setListening(false);
      asrRunningRef.current = false;
      if (e.error === 'not-allowed') {
        alert('请允许使用麦克风权限以启用语音识别');
      }
    };

    recognitionRef.current = recognition;
  };

  const setupNativeASR = async () => {
    try {
      const mod = await import('@capacitor-community/speech-recognition');
      const SpeechRecognition = mod.SpeechRecognition || mod.default;
      if (!SpeechRecognition) return false;

      nativeRecognitionRef.current = SpeechRecognition;

      // 请求权限
      try {
        const perm = await SpeechRecognition.requestPermissions();
        if (perm.speechRecognition !== 'granted') {
          console.warn('[ASR] 原生语音识别权限未授予');
        }
      } catch (e) {
        console.warn('[ASR] 请求权限失败:', e);
      }

      return true;
    } catch (e) {
      console.warn('[ASR] 原生语音识别插件不可用:', e.message);
      return false;
    }
  };

  const start = useCallback(() => {
    if (asrRunningRef.current) return false;
    setTranscript('');
    setInterim('');

    // 优先使用原生语音识别（在原生环境中）
    if (isNative() && nativeRecognitionRef.current) {
      return startNative();
    }

    // 降级到浏览器语音识别
    if (recognitionRef.current) {
      return startBrowser();
    }

    return false;
  }, []);

  const startBrowser = () => {
    try {
      recognitionRef.current.start();
      asrRunningRef.current = true;
      setListening(true);
      return true;
    } catch (err) {
      asrRunningRef.current = true;
      setListening(true);
      return false;
    }
  };

  const startNative = async () => {
    try {
      const SpeechRecognition = nativeRecognitionRef.current;
      
      // 设置partial结果回调
      nativePartialCallbackRef.current = (result) => {
        if (result?.matches && result.matches.length > 0) {
          const bestMatch = result.matches[0];
          if (result.isFinal) {
            setTranscript(prev => (prev ? prev + bestMatch : bestMatch));
            setInterim('');
          } else {
            setInterim(bestMatch);
          }
        }
      };

      await SpeechRecognition.start({
        language: 'zh-CN',
        maxResults: 1,
        prompt: '正在聆听...',
        partialResults: true,
        popup: false,
      });

      // 监听partial results
      SpeechRecognition.addListener('partialResults', nativePartialCallbackRef.current);

      asrRunningRef.current = true;
      setListening(true);
      return true;
    } catch (err) {
      console.error('[ASR] 原生语音识别启动失败:', err);
      // 降级到浏览器识别
      if (recognitionRef.current) {
        return startBrowser();
      }
      return false;
    }
  };

  const stop = useCallback(() => {
    asrRunningRef.current = false;
    setListening(false);

    // 停止原生识别
    if (isNative() && nativeRecognitionRef.current) {
      try {
        nativeRecognitionRef.current.stop?.();
        if (nativePartialCallbackRef.current) {
          nativeRecognitionRef.current.removeListener?.('partialResults', nativePartialCallbackRef.current);
          nativePartialCallbackRef.current = null;
        }
      } catch (e) {}
    }

    // 停止浏览器识别
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterim('');
  }, []);

  return { start, stop, reset, listening, transcript, interim, supported };
}

/**
 * 唤醒词持续监听 Hook
 * - 浏览器环境: Web Speech API 连续识别
 * - 原生环境: @capacitor-community/speech-recognition 插件
 * - 特点: 后台持续监听,检测到唤醒词后触发回调,自动重启
 */
export function useWakeWordListener(wakeWords, onWakeDetected) {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const nativeRecognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const wakeWordsRef = useRef(wakeWords || []);
  const onWakeRef = useRef(onWakeDetected);
  const restartTimerRef = useRef(null);
  const partialBufferRef = useRef('');

  useEffect(() => {
    wakeWordsRef.current = wakeWords || [];
  }, [wakeWords]);

  useEffect(() => {
    onWakeRef.current = onWakeDetected;
  }, [onWakeDetected]);

  // 检测唤醒词
  const detectWakeWord = useCallback((text) => {
    if (!text) return null;
    const cleanText = text.replace(/\s/g, '');
    const words = wakeWordsRef.current;
    for (const word of words) {
      if (cleanText.includes(word)) {
        return word;
      }
    }
    return null;
  }, []);

  // 浏览器Web Speech API实现
  const startBrowserWake = useCallback(() => {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return false;

      const recognition = new SR();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          interim += e.results[i][0].transcript;
        }

        // 检测唤醒词
        const detected = detectWakeWord(interim);
        if (detected) {
          try { recognition.stop(); } catch(ex) {}
          isListeningRef.current = false;
          setListening(false);
          partialBufferRef.current = '';
          onWakeRef.current?.(detected, interim);
          return;
        }

        partialBufferRef.current = interim;
      };

      recognition.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[Wake] 识别错误:', e.error);
        }
        isListeningRef.current = false;
        setListening(false);
      };

      recognition.onend = () => {
        isListeningRef.current = false;
        setListening(false);
        // 如果还在激活状态，自动重启
        if (active) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (active && !isListeningRef.current) {
              startBrowserWake();
            }
          }, 500);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      isListeningRef.current = true;
      setListening(true);
      return true;
    } catch (e) {
      console.warn('[Wake] 浏览器唤醒启动失败:', e);
      return false;
    }
  }, [active, detectWakeWord]);

  // 原生Capacitor语音识别实现
  const startNativeWake = useCallback(async () => {
    try {
      const mod = await import('@capacitor-community/speech-recognition');
      const SpeechRecognition = mod.SpeechRecognition || mod.default;
      if (!SpeechRecognition) return false;

      nativeRecognitionRef.current = SpeechRecognition;

      // 请求权限
      try {
        const perm = await SpeechRecognition.requestPermissions();
        if (perm.speechRecognition !== 'granted') {
          console.warn('[Wake] 原生语音识别权限未授予');
        }
      } catch (e) {
        console.warn('[Wake] 请求权限失败:', e);
      }

      const handlePartialResults = (result) => {
        if (result?.matches && result.matches.length > 0) {
          const bestMatch = result.matches[0];
          const detected = detectWakeWord(bestMatch);
          if (detected) {
            // 检测到唤醒词
            try {
              SpeechRecognition.removeListener?.('partialResults', handlePartialResults);
              SpeechRecognition.stop?.();
            } catch(ex) {}
            isListeningRef.current = false;
            setListening(false);
            onWakeRef.current?.(detected, bestMatch);
          }
        }
      };

      await SpeechRecognition.start({
        language: 'zh-CN',
        maxResults: 1,
        prompt: '',
        partialResults: true,
        popup: false,
      });

      SpeechRecognition.addListener('partialResults', handlePartialResults);
      isListeningRef.current = true;
      setListening(true);
      return true;
    } catch (e) {
      console.warn('[Wake] 原生语音识别启动失败:', e);
      // 降级到浏览器识别
      return startBrowserWake();
    }
  }, [detectWakeWord, startBrowserWake]);

  // 启动监听
  const start = useCallback(() => {
    if (isListeningRef.current) return;
    setActive(true);

    if (isNative()) {
      startNativeWake();
    } else {
      startBrowserWake();
    }
  }, [startNativeWake, startBrowserWake]);

  // 停止监听
  const stop = useCallback(() => {
    setActive(false);
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    // 停止原生识别
    if (nativeRecognitionRef.current) {
      try {
        nativeRecognitionRef.current.removeAllListeners?.();
        nativeRecognitionRef.current.stop?.();
      } catch (e) {}
      nativeRecognitionRef.current = null;
    }

    // 停止浏览器识别
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch(e) {}
      try { recognitionRef.current.stop(); } catch(e) {}
      recognitionRef.current = null;
    }

    isListeningRef.current = false;
    setListening(false);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { start, stop, active, listening };
}
