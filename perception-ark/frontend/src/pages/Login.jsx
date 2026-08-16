import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';
import { useSpeechSynthesis, useSpeechRecognition } from '../hooks/useSpeech.js';
import ThemeToggle from '../components/ThemeToggle.jsx';

// 判断是否为移动端(扫码体验默认进AppMobile移动端APP)
const isMobile = () => typeof window !== 'undefined' && window.innerWidth <= 768;

// 根据角色跳转: 管理员进Web管理后台,家属进App家属视图,使用者进App视障视图
const goHomeByRole = (role) => {
  if (role === 'admin') {
    window.location.hash = '#/';
  } else {
    // 家属和使用者都进App端,App内根据角色自动分流
    window.location.hash = '#/app';
  }
};

export default function Login() {
  const { login, loginBySms, logout, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 登录身份: 'user'(用户登录,自动识别视障/家属) | 'admin'(超级管理员)
  const [loginRole, setLoginRole] = useState('user');
  // 标记是否本次主动登录(防止useEffect自动跳转覆盖角色拦截)
  const [manualLogin, setManualLogin] = useState(false);
  // 登录方式: 'sms'(手机验证码,默认) | 'password'(账号密码)
  const [loginMethod, setLoginMethod] = useState('sms');

  // 手机验证码登录相关状态
  const [smsPhone, setSmsPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0); // 倒计时(秒)
  const [smsHint, setSmsHint] = useState(''); // 验证码提示(体验模式显示验证码)
  const countdownRef = useRef(null);
  // 手机登录身份选择: 'user'(视障人员) | 'family'(家属)
  const [smsRole, setSmsRole] = useState('user');

  // 已登录且非本次手动登录(如页面刷新/直接访问)则按角色跳转
  useEffect(() => {
    if (user && !manualLogin) goHomeByRole(user.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 倒计时清理
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ===== 语音交互(视障用户: 语音切换登录方式/播报页面/语音填表/语音登录) =====
  const { speak, stop: stopTts } = useSpeechSynthesis();
  const { start: asrStart, stop: asrStop, reset: asrReset, transcript, supported: asrSupported } = useSpeechRecognition();
  const [voiceOn, setVoiceOn] = useState(false);
  const voiceOnRef = useRef(false);
  const ttsEchoUntilRef = useRef(0); // TTS回声窗口(播报期间及尾音内忽略ASR结果,防止自言自语循环)
  const loginFnsRef = useRef({}); // 始终指向最新的提交/发送函数(避免useEffect闭包陈旧)

  // 带回声窗口的播报: 估算播报时长+尾音,期间忽略语音识别结果
  const safeSpeak = useCallback((text, opts = {}) => {
    ttsEchoUntilRef.current = Date.now() + 1600 + text.length * 130;
    speak(text, opts);
  }, [speak]);

  // 错误提示同步语音播报(视障用户看不到红色错误文字)
  const voiceError = useCallback((msg) => {
    setError(msg);
    if (voiceOnRef.current) safeSpeak(msg.replace(/。若您[^。]*。/, '。').slice(0, 60));
  }, [safeSpeak]);

  const VOICE_HELP = '语音指令:说,切换到账号密码登录,或,切换到验证码登录。说,视障人员,或,家属,选择身份。验证码方式:说,手机号加您的号码,验证码加六位数字。密码方式:说,账号是您的用户名,密码是您的密码。说,发送验证码。说,登录,立即提交。说,去注册。说,安静,停止播报';

  // 语音助手开关
  const toggleVoice = useCallback(() => {
    if (voiceOnRef.current) {
      voiceOnRef.current = false;
      setVoiceOn(false);
      asrStop(); stopTts();
      return;
    }
    if (!asrSupported) {
      voiceOnRef.current = true; // 临时置true让safeSpeak生效
      safeSpeak('当前浏览器不支持语音识别,请使用Chrome浏览器');
      voiceOnRef.current = false;
      return;
    }
    voiceOnRef.current = true;
    setVoiceOn(true);
    safeSpeak('语音助手已开启。当前是登录页面,默认手机验证码方式。您可以说:切换到账号密码登录;或说:语音帮助,收听全部指令');
    // 等欢迎词尾音消散后再启动持续聆听
    setTimeout(() => { if (voiceOnRef.current) { try { asrStart(); } catch(ex) {} } }, 1800);
  }, [asrSupported, asrStart, asrStop, stopTts, safeSpeak]);

  // 看门狗: ASR意外掉线时自动恢复聆听(voiceOn期间)
  useEffect(() => {
    if (!voiceOn) return;
    const t = setInterval(() => { if (voiceOnRef.current) { try { asrStart(); } catch(ex) {} } }, 8000);
    return () => clearInterval(t);
  }, [voiceOn, asrStart]);

  // 离开页面: 停止聆听与播报
  useEffect(() => () => { asrStop(); stopTts(); }, [asrStop, stopTts]);

  // ===== 语音指令处理 =====
  useEffect(() => {
    if (!voiceOn || !transcript) return;
    if (Date.now() < ttsEchoUntilRef.current) { asrReset(); return; } // TTS回声窗口内忽略
    const text = transcript.trim().replace(/\s/g, '');
    asrReset();
    const fns = loginFnsRef.current;
    const fakeEv = { preventDefault() {} };

    // 帮助/停止
    if (/^(语音)?帮助$|语音帮助|有什么指令|怎么(用|操作|登录)/.test(text)) { safeSpeak(VOICE_HELP); return; }
    if (/安静|别说了|停止播报|闭嘴/.test(text)) { stopTts(); return; }
    if (/关闭语音|退出语音|关掉语音/.test(text)) { voiceOnRef.current = false; setVoiceOn(false); asrStop(); stopTts(); return; }

    // 切换登录方式
    if (/切换?(到)?(账号密码|密码登录|账户登录|密码方式)/.test(text)) { fns.switchMethod('password'); safeSpeak('已切换到账号密码登录。请说:账号是您的用户名,密码是您的密码'); return; }
    if (/切换?(到)?(手机验证码|验证码登录|短信登录|手机登录|验证码方式)/.test(text)) { fns.switchMethod('sms'); safeSpeak('已切换到手机验证码登录。请说:手机号加您的手机号码'); return; }

    // 切换身份
    if (/切换?(到)?视障|我是视障|视障人员|视障用户|视障登录/.test(text)) { setSmsRole('user'); setLoginRole('user'); safeSpeak('已选择视障人员身份'); return; }
    if (/切换?(到)?家属|我是家属|家属登录/.test(text)) { setSmsRole('family'); safeSpeak('已选择家属身份,登录后进入家属端'); return; }
    if (/切换?(到)?管理员|管理员登录|超级管理员/.test(text)) { setLoginRole('admin'); safeSpeak('已选择超级管理员身份'); return; }

    // 语音填表
    const phoneM = text.match(/(?:手机号|手机号码|电话|号码)(?:是|为)?(1[3-9]\d{9})/);
    if (phoneM) { setSmsPhone(phoneM[1]); safeSpeak('手机号已填入'); return; }
    const codeM = text.match(/验证码(?:是|为)?(\d{4,6})/);
    if (codeM) { setSmsCode(codeM[1]); safeSpeak('验证码已填入'); return; }
    const userM = text.match(/(?:用户名|账号)(?:是|为)([A-Za-z0-9_\u4e00-\u9fa5]{1,20})/);
    if (userM) { setUsername(userM[1]); safeSpeak('用户名已填入'); return; }
    const pwdM = text.match(/密码(?:是|为)([^\s，。,]{1,20})/);
    if (pwdM) { setPassword(pwdM[1]); safeSpeak('密码已填入'); return; }

    // 动作
    if (/发送验证码|获取验证码|发个验证码|要验证码/.test(text)) { safeSpeak('正在发送验证码'); fns.handleSendSms(); return; }
    if (/^(立即|确认|开始)?登录$|^登录吧$|^提交$|立即登录|确认登录|开始登录/.test(text)) {
      if (loginMethod === 'sms') { safeSpeak('正在登录'); fns.handleSmsLogin(fakeEv); }
      else { safeSpeak('正在登录'); fns.handleSubmit(fakeEv); }
      return;
    }
    if (/去注册|我要注册|立即注册/.test(text)) { safeSpeak('即将进入注册页面'); setTimeout(() => { window.location.hash = '#/register'; }, 1200); return; }
    if (/忘记密码|找回密码/.test(text)) { safeSpeak('即将进入找回密码页面'); setTimeout(() => { window.location.hash = '#/forgot'; }, 1200); return; }

    safeSpeak('没有听懂。您可以说:语音帮助,收听全部指令');
  }, [transcript, voiceOn, loginMethod, asrReset, asrStop, stopTts, safeSpeak]);

  // 账号密码登录
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setManualLogin(true);
    if (voiceOnRef.current) safeSpeak('正在登录');
    try {
      const loginUser = await login(username.trim(), password);
      // 用户登录: 自动识别账号类型(视障/家属)并跳转
      if (loginRole === 'user') {
        if (loginUser.role === 'admin') {
          // 用户登录入口不允许管理员进入,登出并提示
          logout();
          voiceError('该账号为管理员账号,请选择"超级管理员"身份登录');
          return;
        }
        // 视障人员根据手机号注册信息自动跳转视障端;家属跳转家属端(App内分流)
        goHomeByRole(loginUser.role);
      } else {
        // 超级管理员: 仅允许 admin 角色登录
        if (loginUser.role !== 'admin') {
          logout();
          voiceError('该账号不是超级管理员,无权通过此入口登录');
          return;
        }
        goHomeByRole(loginUser.role);
      }
    } catch (err) {
      // 401可能是后端重启数据丢失(账号不存在),给友好提示
      if (/用户名或密码错误|Unauthorized|401/.test(err.message)) {
        voiceError(`账号或密码错误。若您之前已注册,可能因服务器重启数据被清除,请点击"评委快速体验"或重新注册。`);
      } else {
        voiceError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // 发送手机验证码
  const handleSendSms = async () => {
    setError('');
    setSmsHint('');
    if (!smsPhone.trim() || !/^1[3-9]\d{9}$/.test(smsPhone.trim())) {
      voiceError('请输入正确的手机号');
      return;
    }
    setSmsSending(true);
    try {
      const res = await api.sendSms(smsPhone.trim());
      if (res.success) {
        // 体验模式: 后端返回 devCode,前端显示提示
        if (res.devCode) {
          setSmsHint(`验证码已发送(体验模式): ${res.devCode}`);
          if (voiceOnRef.current) safeSpeak(`验证码已发送,验证码是${res.devCode.split('').join(' ')}`);
        } else {
          setSmsHint('验证码已发送至手机,请注意查收');
          if (voiceOnRef.current) safeSpeak('验证码已发送至手机,请注意查收');
        }
        // 开始60秒倒计时
        setSmsCountdown(60);
        countdownRef.current = setInterval(() => {
          setSmsCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdownRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } catch (err) {
      voiceError(err.message);
    } finally {
      setSmsSending(false);
    }
  };

  // 手机验证码登录
  const handleSmsLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setManualLogin(true);
    if (voiceOnRef.current) safeSpeak('正在登录');
    try {
      // 传递smsRole给后端: 未注册时按所选身份自动注册(user/family)
      const loginUser = await loginBySms(smsPhone.trim(), smsCode.trim(), smsRole);
      // 手机验证码登录仅限用户登录(管理员不能通过验证码登录)
      if (loginUser.role === 'admin') {
        logout();
        voiceError('管理员账号不支持手机验证码登录,请使用账号密码登录');
        return;
      }
      // 身份校验: 视障人员入口仅允许user角色,家属入口仅允许family角色
      // (未注册的手机号已由后端按smsRole自动注册,此处不会因角色不匹配而报错)
      if (smsRole === 'user' && loginUser.role === 'family') {
        logout();
        voiceError('该手机号为家属账号,请选择"家属"身份登录');
        return;
      }
      if (smsRole === 'family' && loginUser.role === 'user') {
        logout();
        voiceError('该手机号为视障人员账号,请选择"视障人员"身份登录');
        return;
      }
      goHomeByRole(loginUser.role);
    } catch (err) {
      voiceError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 切换登录方式时清空错误和提示
  const switchMethod = (method) => {
    setLoginMethod(method);
    setError('');
    setSmsHint('');
  };

  // 始终指向最新的提交/发送函数(渲染时同步,供语音指令useEffect调用,避免闭包陈旧)
  loginFnsRef.current = { handleSubmit, handleSmsLogin, handleSendSms, switchMethod };

  return (
    <div className="auth-page">
      {/* 右上角主题切换 */}
      <div className="auth-theme-toggle">
        <ThemeToggle size="sm" />
      </div>
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="PerceptionArk" className="auth-logo-img" />
          <h1>PerceptionArk</h1>
          <p>感知方舟 · AI感知眼镜系统</p>
        </div>

        {/* 登录方式切换Tab(触摸即语音播报,视障用户可感知当前选择) */}
        <div className="auth-method-tabs">
          <button
            type="button"
            className={`auth-method-tab ${loginMethod === 'sms' ? 'active' : ''}`}
            onClick={() => { switchMethod('sms'); if (voiceOnRef.current) safeSpeak('已切换到手机验证码登录'); }}
            aria-label="手机验证码登录方式"
          >
            📱 手机验证码
          </button>
          <button
            type="button"
            className={`auth-method-tab ${loginMethod === 'password' ? 'active' : ''}`}
            onClick={() => { switchMethod('password'); if (voiceOnRef.current) safeSpeak('已切换到账号密码登录'); }}
            aria-label="账号密码登录方式"
          >
            🔑 账号密码
          </button>
        </div>

        {/* ===== 手机验证码登录 ===== */}
        {loginMethod === 'sms' && (
          <form onSubmit={handleSmsLogin} className="auth-form">
            {/* 登录身份选择: 视障人员 / 家属 */}
            <div className="auth-field">
              <label>登录身份</label>
              <div className="auth-radio-group">
                <label className={`auth-radio ${smsRole === 'user' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    value="user"
                    checked={smsRole === 'user'}
                    onChange={() => { setSmsRole('user'); setError(''); if (voiceOnRef.current) safeSpeak('已选择视障人员身份,登录后进入视障端'); }}
                  />
                  视障人员
                </label>
                <label className={`auth-radio ${smsRole === 'family' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    value="family"
                    checked={smsRole === 'family'}
                    onChange={() => { setSmsRole('family'); setError(''); if (voiceOnRef.current) safeSpeak('已选择家属身份,登录后进入家属端'); }}
                  />
                  家属
                </label>
              </div>
              <div style={{ fontSize: '.72rem', color: 'var(--ink-muted)', marginTop: 6 }}>
                {smsRole === 'user'
                  ? '视障人员账号登录后进入视障端,使用智能感知功能'
                  : '家属账号登录后进入家属端,查看亲人位置和接收SOS通知'}
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="sms-phone">手机号码</label>
              <input
                id="sms-phone"
                type="tel"
                value={smsPhone}
                onChange={e => setSmsPhone(e.target.value)}
                placeholder="请输入注册时的手机号"
                autoComplete="off"
                required
                autoFocus
              />
            </div>

            <div className="auth-field">
              <label htmlFor="sms-code">验证码</label>
              <div className="auth-sms-row">
                <input
                  id="sms-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={smsCode}
                  onChange={e => setSmsCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="6位数字验证码"
                  autoComplete="one-time-code"
                  required
                />
                <button
                  type="button"
                  className="auth-sms-btn"
                  onClick={handleSendSms}
                  disabled={smsSending || smsCountdown > 0}
                >
                  {smsCountdown > 0 ? `${smsCountdown}s` : (smsSending ? '发送中...' : '获取验证码')}
                </button>
              </div>
              {smsHint && <div className="auth-sms-hint">{smsHint}</div>}
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? '登录中...' : '验证码登录'}
            </button>

            <div className="auth-links">
              <a href="#/register">没有账号? 立即注册</a>
              <a href="#/forgot">忘记密码?</a>
              <a href="#/guide">产品使用说明</a>
            </div>
          </form>
        )}

        {/* ===== 账号密码登录 ===== */}
        {loginMethod === 'password' && (
          <form onSubmit={handleSubmit} className="auth-form">
            {/* 登录身份选择: 用户登录 / 超级管理员 */}
            <div className="auth-field">
              <label>登录身份</label>
              <div className="auth-radio-group">
                <label className={`auth-radio ${loginRole === 'user' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    value="user"
                    checked={loginRole === 'user'}
                    onChange={() => { setLoginRole('user'); setError(''); if (voiceOnRef.current) safeSpeak('已选择用户登录,自动识别视障人员或家属账号'); }}
                  />
                  用户登录
                </label>
                <label className={`auth-radio ${loginRole === 'admin' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    value="admin"
                    checked={loginRole === 'admin'}
                    onChange={() => { setLoginRole('admin'); setError(''); if (voiceOnRef.current) safeSpeak('已选择超级管理员身份'); }}
                  />
                  超级管理员
                </label>
              </div>
              <div style={{ fontSize: '.72rem', color: 'var(--ink-muted)', marginTop: 6 }}>
                {loginRole === 'user'
                  ? '自动识别视障人员/家属账号,登录后跳转对应页面'
                  : '仅供系统管理员登录,进入Web管理后台'}
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="username">用户名</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="请输入用户名"
                autoComplete="username"
                required
                autoFocus
              />
            </div>

            <div className="auth-field">
              <label htmlFor="password">密码</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="请输入密码(至少6位)"
                autoComplete="current-password"
                required
              />
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? '登录中...' : '登 录'}
            </button>

            <div className="auth-links">
              <a href="#/register">没有账号? 立即注册</a>
              <a href="#/forgot">忘记密码?</a>
              <a href="#/guide">产品使用说明</a>
            </div>
          </form>
        )}

        {/* ===== 语音登录助手(视障用户: 点击开启后全程语音交互) ===== */}
        <button
          type="button"
          className={`auth-voice-btn ${voiceOn ? 'on' : ''}`}
          onClick={toggleVoice}
          aria-label={voiceOn ? '语音助手已开启，点击关闭' : '开启语音登录助手，可用语音切换登录方式、填写信息并登录'}
        >
          <span className="icon" aria-hidden="true">{voiceOn ? '🎙️' : '🎤'}</span>
          <span className="text">{voiceOn ? '聆听中 · 说"语音帮助"收听指令' : '语音登录助手(视障用户)'}</span>
        </button>
      </div>
    </div>
  );
}
