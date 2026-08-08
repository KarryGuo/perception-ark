import { useEffect, useRef, useState, useCallback } from 'react';

const DIRECTION_PAN_MAP = {
  '左前方': -0.6,
  '正前方': 0,
  '右前方': 0.6,
  '左方': -0.9,
  '右方': 0.9,
};

export function useSpatialAudio() {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [voice, setVoice] = useState(null);
  const audioContextRef = useRef(null);
  const pannerRef = useRef(null);
  const gainNodeRef = useRef(null);
  const utterQueueRef = useRef([]);
  const currentUtterRef = useRef(null);
  const stoppedRef = useRef(false);
  const playNextTimersRef = useRef([]);
  const audioUnlockedRef = useRef(false);

  const getSavedRate = () => {
    const r = parseFloat(localStorage.getItem('ark_tts_rate'));
    return isNaN(r) ? 0.95 : r;
  };

  const getSavedVoice = (voices) => {
    const name = localStorage.getItem('ark_tts_voice') || '';
    if (!name || !voices) return null;
    return voices.find(v => v.name === name) || null;
  };

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const panner = ctx.createStereoPanner();
      const gain = ctx.createGain();
      gain.gain.value = 0.8;
      panner.connect(gain);
      gain.connect(ctx.destination);
      audioContextRef.current = ctx;
      pannerRef.current = panner;
      gainNodeRef.current = gain;
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    const ctx = ensureAudioContext();
    if (ctx) {
      audioUnlockedRef.current = true;
    }
  }, [ensureAudioContext]);

  useEffect(() => {
    const hasTTS = 'speechSynthesis' in window;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const hasWebAudio = !!AudioCtx;
    setSupported(hasTTS && hasWebAudio);

    if (!hasTTS) {
      console.warn('[SpatialAudio] 浏览器不支持语音合成');
      return;
    }

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

    const interactionEvents = ['touchstart', 'click', 'keydown', 'pointerdown'];
    const handleInteraction = () => unlockAudio();
    interactionEvents.forEach(evt => {
      document.addEventListener(evt, handleInteraction, { once: true, passive: true });
    });

    return () => {
      window.speechSynthesis.cancel();
      interactionEvents.forEach(evt => {
        document.removeEventListener(evt, handleInteraction);
      });
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch (e) {}
      }
    };
  }, [unlockAudio]);

  const setPan = useCallback((direction) => {
    const ctx = ensureAudioContext();
    if (!ctx || !pannerRef.current) return;
    const panValue = DIRECTION_PAN_MAP[direction] ?? 0;
    pannerRef.current.pan.setValueAtTime(panValue, ctx.currentTime);
  }, [ensureAudioContext]);

  const beep = useCallback((direction = '正前方', duration = 0.12, frequency = 880) => {
    const ctx = ensureAudioContext();
    if (!ctx || !pannerRef.current || !gainNodeRef.current) return;

    const panValue = DIRECTION_PAN_MAP[direction] ?? 0;
    pannerRef.current.pan.setValueAtTime(panValue, ctx.currentTime);

    const oscillator = ctx.createOscillator();
    const beepGain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    beepGain.gain.setValueAtTime(0, ctx.currentTime);
    beepGain.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 0.01);
    beepGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.connect(beepGain);
    beepGain.connect(pannerRef.current);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  }, [ensureAudioContext]);

  const speakInternal = useCallback((text, options = {}, direction = null) => {
    if (!supported || !text) return;
    const { urgent = false, onEnd, rate } = options;

    stoppedRef.current = false;

    try { window.speechSynthesis.resume(); } catch (e) {}

    if (urgent) {
      window.speechSynthesis.cancel();
      utterQueueRef.current = [];
      playNextTimersRef.current.forEach(t => clearTimeout(t));
      playNextTimersRef.current = [];
    }

    if (direction !== null) {
      setPan(direction);
      beep(direction, 0.08, urgent ? 1000 : 800);
    } else {
      setPan('正前方');
    }

    const sentences = text.match(/[^。！？!?.]+[。！？!?.]?/g) || [text];
    const finalRate = rate || getSavedRate();

    sentences.forEach((sentence, idx) => {
      const trimmed = sentence.trim();
      if (!trimmed) return;

      const utter = new SpeechSynthesisUtterance(trimmed);
      if (voice) utter.voice = voice;
      utter.lang = 'zh-CN';
      utter.rate = urgent ? Math.min(finalRate * 1.15, 1.6) : finalRate;
      utter.pitch = urgent ? 1.3 : 1.0;
      utter.volume = 1.0;

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
  }, [supported, voice, setPan, beep]);

  const speakDirectional = useCallback((text, direction, options = {}) => {
    speakInternal(text, options, direction);
  }, [speakInternal]);

  const speak = useCallback((text, options = {}) => {
    speakInternal(text, options, null);
  }, [speakInternal]);

  const stop = useCallback(() => {
    if (!supported) return;
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

  return { speakDirectional, speak, stop, beep, speaking, supported };
}

export default useSpatialAudio;
