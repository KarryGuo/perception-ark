import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';

/**
 * 感知方舟 · 设置页面
 * - 播报语速/音色调节
 * - 导航历史记录管理
 * - 账户信息
 */
export default function Settings() {
  const { user, logout } = useAuth();
  const [ttsRate, setTtsRate] = useState(() => parseFloat(localStorage.getItem('ark_tts_rate')) || 0.95);
  const [ttsVoiceName, setTtsVoiceName] = useState(() => localStorage.getItem('ark_tts_voice') || '');
  const [availableVoices, setAvailableVoices] = useState([]);
  const [navHistory, setNavHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ark_nav_history') || '[]'); }
    catch { return []; }
  });
  const [testText, setTestText] = useState('这是一段测试语音，用于预览播报效果。');

  // 加载可用语音列表
  useEffect(() => {
    const load = () => {
      const voices = window.speechSynthesis?.getVoices() || [];
      const cn = voices.filter(v => v.lang.startsWith('zh'));
      setAvailableVoices(cn.length > 0 ? cn : voices);
    };
    load();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = load;
    }
  }, []);

  const handleSaveRate = useCallback((rate) => {
    localStorage.setItem('ark_tts_rate', String(rate));
    setTtsRate(rate);
  }, []);

  const handleSaveVoice = useCallback((name) => {
    const voices = window.speechSynthesis?.getVoices() || [];
    const v = voices.find(vv => vv.name === name);
    if (v) {
      localStorage.setItem('ark_tts_voice', name);
      setTtsVoiceName(name);
    } else if (name === '') {
      localStorage.removeItem('ark_tts_voice');
      setTtsVoiceName('');
    }
  }, []);

  // 试听播报
  const handleTestSpeak = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(testText);
    utter.lang = 'zh-CN';
    utter.rate = ttsRate;
    const voices = window.speechSynthesis.getVoices();
    if (ttsVoiceName) {
      const v = voices.find(vv => vv.name === ttsVoiceName);
      if (v) utter.voice = v;
    } else {
      const cn = voices.find(v => v.lang === 'zh-CN') || voices.find(v => v.lang.startsWith('zh'));
      if (cn) utter.voice = cn;
    }
    window.speechSynthesis.speak(utter);
  }, [testText, ttsRate, ttsVoiceName]);

  const handleClearNavHistory = useCallback(() => {
    localStorage.removeItem('ark_nav_history');
    setNavHistory([]);
  }, []);

  const handleRemoveHistoryItem = useCallback((item) => {
    setNavHistory(prev => {
      const updated = prev.filter(i => i !== item);
      localStorage.setItem('ark_nav_history', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const goBack = useCallback(() => {
    window.location.hash = '#/app';
  }, []);

  return (
    <div className="settings-page">
      {/* 顶部导航 */}
      <div className="sp-header">
        <button className="sp-back" onClick={goBack}>← 返回</button>
        <span className="sp-title">⚙️ 设置</span>
        <span className="sp-placeholder" />
      </div>

      <div className="sp-body">
        {/* ===== 语音播报设置 ===== */}
        <section className="sp-section">
          <h3 className="sp-section-title">🔊 语音播报</h3>

          {/* 语速调节 */}
          <div className="sp-item">
            <label className="sp-label">
              <span>播报语速</span>
              <span className="sp-value">{ttsRate.toFixed(2)}x</span>
            </label>
            <input
              type="range" min="0.5" max="1.5" step="0.05"
              value={ttsRate}
              onChange={e => handleSaveRate(parseFloat(e.target.value))}
              className="sp-slider"
            />
            <div className="sp-marks"><span>慢</span><span>正常</span><span>快</span></div>
          </div>

          {/* 音色选择 */}
          <div className="sp-item">
            <label className="sp-label"><span>播报音色</span></label>
            <select
              className="sp-select"
              value={ttsVoiceName}
              onChange={e => handleSaveVoice(e.target.value)}
            >
              <option value="">系统默认</option>
              {availableVoices.map(v => (
                <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </div>

          {/* 试听 */}
          <div className="sp-item">
            <label className="sp-label"><span>试听效果</span></label>
            <input
              type="text"
              className="sp-input"
              value={testText}
              onChange={e => setTestText(e.target.value)}
              placeholder="输入测试文字..."
            />
            <button className="sp-test-btn" onClick={handleTestSpeak}>🔊 试听</button>
          </div>
        </section>

        {/* ===== 导航历史管理 ===== */}
        <section className="sp-section">
          <h3 className="sp-section-title">🕐 导航历史</h3>
          {navHistory.length === 0 ? (
            <div className="sp-empty">暂无历史记录</div>
          ) : (
            <>
              <div className="sp-history-list">
                {navHistory.map((item, i) => (
                  <div key={i} className="sp-history-item">
                    <span className="sp-history-icon">📍</span>
                    <span className="sp-history-text">{item}</span>
                    <button className="sp-history-del" onClick={() => handleRemoveHistoryItem(item)}>✕</button>
                  </div>
                ))}
              </div>
              <button className="sp-danger-btn" onClick={handleClearNavHistory}>
                清空全部记录 ({navHistory.length}条)
              </button>
            </>
          )}
        </section>

        {/* ===== 账户信息 ===== */}
        <section className="sp-section">
          <h3 className="sp-section-title">👤 账户</h3>
          <div className="sp-item">
            <label className="sp-label"><span>当前用户</span></label>
            <div className="sp-user-info">{user?.username || '未登录'}</div>
          </div>
          <button className="sp-logout-btn" onClick={() => { logout(); window.location.hash = '#/login'; }}>
            退出登录
          </button>
        </section>

        {/* ===== 关于 ===== */}
        <section className="sp-section">
          <h3 className="sp-section-title">ℹ️ 关于</h3>
          <div className="sp-about">
            <div className="sp-about-name">感知方舟 · PerceptionArk</div>
            <div className="sp-about-version">版本 1.0.0</div>
            <div className="sp-about-desc">面向视障人群的AI智能辅助系统，集成视觉识别、智能导航、安全预警、社交辅助与环境记忆五大核心能力。</div>
          </div>
        </section>
      </div>
    </div>
  );
}
