import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';

/**
 * 感知方舟 · 设置页面
 * 账户设置 / 问答对话 / 出行模式 / 导航 / 音频 / 无障碍 / 功能引导 / 关于 / 退出登录
 */
export default function Settings() {
  const { user, logout } = useAuth();

  // ===== 音频设置 =====
  const [ttsRate, setTtsRate] = useState(() => parseFloat(localStorage.getItem('ark_tts_rate')) || 0.95);
  const [ttsVoiceName, setTtsVoiceName] = useState(() => localStorage.getItem('ark_tts_voice') || '');
  const [availableVoices, setAvailableVoices] = useState([]);
  const [testText, setTestText] = useState('这是一段测试语音，用于预览播报效果。');

  // ===== 问答对话设置 =====
  const [chatStyle, setChatStyle] = useState(() => localStorage.getItem('ark_chat_style') || 'concise'); // concise | detailed
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('ark_auto_speak') !== 'false');

  // ===== 出行模式设置 =====
  const [obstacleSensitivity, setObstacleSensitivity] = useState(() => localStorage.getItem('ark_obstacle_sens') || 'normal'); // low | normal | high
  const [vibrationStrength, setVibrationStrength] = useState(() => localStorage.getItem('ark_vibration') || 'strong'); // off | weak | strong

  // ===== 导航设置 =====
  const [navMode, setNavMode] = useState(() => localStorage.getItem('ark_nav_mode') || 'walking'); // walking | transit
  const [navVoiceGuide, setNavVoiceGuide] = useState(() => localStorage.getItem('ark_nav_voice') !== 'false');

  // ===== 无障碍设置 =====
  const [largeFont, setLargeFont] = useState(() => localStorage.getItem('ark_large_font') === 'true');
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem('ark_high_contrast') === 'true');

  // ===== 导航历史 =====
  const [navHistory, setNavHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ark_nav_history') || '[]'); }
    catch { return []; }
  });

  // ===== 展开的section =====
  const [expanded, setExpanded] = useState('audio'); // 默认展开音频

  const toggleSection = useCallback((key) => {
    setExpanded(prev => prev === key ? null : key);
  }, []);

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

  // 无障碍模式: 大字体/高对比度 实时生效
  useEffect(() => {
    document.body.classList.toggle('ark-large-font', largeFont);
    localStorage.setItem('ark_large_font', String(largeFont));
  }, [largeFont]);
  useEffect(() => {
    document.body.classList.toggle('ark-high-contrast', highContrast);
    localStorage.setItem('ark_high_contrast', String(highContrast));
  }, [highContrast]);

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

  // 设置项数据
  const sections = [
    { key: 'account', icon: '👤', title: '账户设置' },
    { key: 'chat', icon: '💬', title: '问答对话' },
    { key: 'travel', icon: '🚶', title: '出行模式' },
    { key: 'nav', icon: '🧭', title: '导航设置' },
    { key: 'audio', icon: '🔊', title: '音频设置' },
    { key: 'a11y', icon: '♿', title: '无障碍模式' },
    { key: 'guide', icon: '📖', title: '功能引导' },
    { key: 'about', icon: 'ℹ️', title: '关于我们' },
  ];

  return (
    <div className="settings-page">
      {/* 顶部导航 */}
      <div className="sp-header">
        <button className="sp-back" onClick={goBack}>← 返回</button>
        <span className="sp-title">⚙️ 设置</span>
        <span className="sp-placeholder" />
      </div>

      <div className="sp-body">
        {/* ===== 账户设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('account')}>
            <span className="sp-section-icon">👤</span>
            <span className="sp-section-title-sm">账户设置</span>
            <span className={`sp-arrow ${expanded === 'account' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'account' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label"><span>当前用户</span></label>
                <div className="sp-user-info">{user?.username || '未登录'}</div>
              </div>
              <div className="sp-item">
                <label className="sp-label"><span>用户角色</span></label>
                <div className="sp-user-info">{user?.role === 'family' ? '家属' : '使用者'}</div>
              </div>
              <button className="sp-logout-btn" onClick={() => { logout(); window.location.hash = '#/login'; }}>
                退出登录
              </button>
            </div>
          )}
        </section>

        {/* ===== 问答对话设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('chat')}>
            <span className="sp-section-icon">💬</span>
            <span className="sp-section-title-sm">问答对话</span>
            <span className={`sp-arrow ${expanded === 'chat' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'chat' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label"><span>回复风格</span></label>
                <select className="sp-select" value={chatStyle}
                  onChange={e => { setChatStyle(e.target.value); localStorage.setItem('ark_chat_style', e.target.value); }}>
                  <option value="concise">简洁模式（50字以内）</option>
                  <option value="detailed">详细模式（100字以内）</option>
                </select>
              </div>
              <div className="sp-item-row">
                <span className="sp-row-label">自动语音播报</span>
                <button className={`sp-switch ${autoSpeak ? 'on' : ''}`}
                  onClick={() => { const v = !autoSpeak; setAutoSpeak(v); localStorage.setItem('ark_auto_speak', String(v)); }}>
                  <span className="sp-switch-knob" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ===== 出行模式设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('travel')}>
            <span className="sp-section-icon">🚶</span>
            <span className="sp-section-title-sm">出行模式</span>
            <span className={`sp-arrow ${expanded === 'travel' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'travel' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label"><span>障碍物检测灵敏度</span></label>
                <select className="sp-select" value={obstacleSensitivity}
                  onChange={e => { setObstacleSensitivity(e.target.value); localStorage.setItem('ark_obstacle_sens', e.target.value); }}>
                  <option value="low">低（仅危险物）</option>
                  <option value="normal">中（默认）</option>
                  <option value="high">高（所有障碍）</option>
                </select>
              </div>
              <div className="sp-item">
                <label className="sp-label"><span>震动反馈强度</span></label>
                <select className="sp-select" value={vibrationStrength}
                  onChange={e => { setVibrationStrength(e.target.value); localStorage.setItem('ark_vibration', e.target.value); }}>
                  <option value="off">关闭震动</option>
                  <option value="weak">弱震动</option>
                  <option value="strong">强震动（默认）</option>
                </select>
              </div>
            </div>
          )}
        </section>

        {/* ===== 导航设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('nav')}>
            <span className="sp-section-icon">🧭</span>
            <span className="sp-section-title-sm">导航设置</span>
            <span className={`sp-arrow ${expanded === 'nav' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'nav' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label"><span>默认出行方式</span></label>
                <select className="sp-select" value={navMode}
                  onChange={e => { setNavMode(e.target.value); localStorage.setItem('ark_nav_mode', e.target.value); }}>
                  <option value="walking">步行导航</option>
                  <option value="transit">公交出行</option>
                </select>
              </div>
              <div className="sp-item-row">
                <span className="sp-row-label">导航语音引导</span>
                <button className={`sp-switch ${navVoiceGuide ? 'on' : ''}`}
                  onClick={() => { const v = !navVoiceGuide; setNavVoiceGuide(v); localStorage.setItem('ark_nav_voice', String(v)); }}>
                  <span className="sp-switch-knob" />
                </button>
              </div>
              {navHistory.length > 0 && (
                <div className="sp-item">
                  <label className="sp-label"><span>导航历史记录</span></label>
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
                </div>
              )}
            </div>
          )}
        </section>

        {/* ===== 音频设置 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('audio')}>
            <span className="sp-section-icon">🔊</span>
            <span className="sp-section-title-sm">音频设置</span>
            <span className={`sp-arrow ${expanded === 'audio' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'audio' && (
            <div className="sp-section-body">
              <div className="sp-item">
                <label className="sp-label">
                  <span>播报语速</span>
                  <span className="sp-value">{ttsRate.toFixed(2)}x</span>
                </label>
                <input type="range" min="0.5" max="1.5" step="0.05"
                  value={ttsRate}
                  onChange={e => handleSaveRate(parseFloat(e.target.value))}
                  className="sp-slider"
                />
                <div className="sp-marks"><span>慢</span><span>正常</span><span>快</span></div>
              </div>
              <div className="sp-item">
                <label className="sp-label"><span>播报音色</span></label>
                <select className="sp-select" value={ttsVoiceName} onChange={e => handleSaveVoice(e.target.value)}>
                  <option value="">系统默认</option>
                  {availableVoices.map(v => (
                    <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                  ))}
                </select>
              </div>
              <div className="sp-item">
                <label className="sp-label"><span>试听效果</span></label>
                <input type="text" className="sp-input" value={testText}
                  onChange={e => setTestText(e.target.value)} placeholder="输入测试文字..."
                />
                <button className="sp-test-btn" onClick={handleTestSpeak}>🔊 试听</button>
              </div>
            </div>
          )}
        </section>

        {/* ===== 无障碍模式 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('a11y')}>
            <span className="sp-section-icon">♿</span>
            <span className="sp-section-title-sm">无障碍模式</span>
            <span className={`sp-arrow ${expanded === 'a11y' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'a11y' && (
            <div className="sp-section-body">
              <div className="sp-item-row">
                <span className="sp-row-label">大字体模式</span>
                <button className={`sp-switch ${largeFont ? 'on' : ''}`} onClick={() => setLargeFont(v => !v)}>
                  <span className="sp-switch-knob" />
                </button>
              </div>
              <div className="sp-item-row">
                <span className="sp-row-label">高对比度模式</span>
                <button className={`sp-switch ${highContrast ? 'on' : ''}`} onClick={() => setHighContrast(v => !v)}>
                  <span className="sp-switch-knob" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ===== 功能引导 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('guide')}>
            <span className="sp-section-icon">📖</span>
            <span className="sp-section-title-sm">功能引导</span>
            <span className={`sp-arrow ${expanded === 'guide' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'guide' && (
            <div className="sp-section-body">
              <div className="sp-guide-item">
                <span className="sp-guide-icon">🎙️</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">按住说话</div>
                  <div className="sp-guide-desc">长按底部按钮说话，松开后系统自动识别并回复</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">⚡</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">快速分析</div>
                  <div className="sp-guide-desc">点击后持续分析前方场景，自动播报物体方位和距离</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">🚶</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">出行模式</div>
                  <div className="sp-guide-desc">检测前方障碍物，遇到危险紧急播报并震动提醒</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">📖</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">阅读文字</div>
                  <div className="sp-guide-desc">持续识别前方文字内容，适合阅读书本、标签、指示牌</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">🚦</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">红绿灯识别</div>
                  <div className="sp-guide-desc">持续检测交通信号灯状态，提醒您何时可安全通过</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">🔍</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">寻物模式</div>
                  <div className="sp-guide-desc">说出要找的物品，系统持续寻找并播报方位和距离</div>
                </div>
              </div>
              <div className="sp-guide-item">
                <span className="sp-guide-icon">📱</span>
                <div className="sp-guide-text">
                  <div className="sp-guide-title">摇一摇</div>
                  <div className="sp-guide-desc">摇动手机可快速开启出行模式</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ===== 关于我们 ===== */}
        <section className="sp-section">
          <div className="sp-section-head" onClick={() => toggleSection('about')}>
            <span className="sp-section-icon">ℹ️</span>
            <span className="sp-section-title-sm">关于我们</span>
            <span className={`sp-arrow ${expanded === 'about' ? 'open' : ''}`}>▾</span>
          </div>
          {expanded === 'about' && (
            <div className="sp-section-body">
              <div className="sp-about">
                <div className="sp-about-name">感知方舟 · PerceptionArk</div>
                <div className="sp-about-version">版本 1.0.0</div>
                <div className="sp-about-desc">面向视障人群的AI智能辅助系统，集成视觉识别、智能导航、安全预警、社交辅助与环境记忆五大核心能力。</div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
