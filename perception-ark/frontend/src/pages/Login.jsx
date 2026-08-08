import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';

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
  const [smsHint, setSmsHint] = useState(''); // 验证码提示(开发模式显示验证码)
  const countdownRef = useRef(null);

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

  // 账号密码登录
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setManualLogin(true);
    try {
      const loginUser = await login(username.trim(), password);
      // 用户登录: 自动识别账号类型(视障/家属)并跳转
      if (loginRole === 'user') {
        if (loginUser.role === 'admin') {
          // 用户登录入口不允许管理员进入,登出并提示
          logout();
          setError('该账号为管理员账号,请选择"超级管理员"身份登录');
          return;
        }
        // 视障人员根据手机号注册信息自动跳转视障端;家属跳转家属端(App内分流)
        goHomeByRole(loginUser.role);
      } else {
        // 超级管理员: 仅允许 admin 角色登录
        if (loginUser.role !== 'admin') {
          logout();
          setError('该账号不是超级管理员,无权通过此入口登录');
          return;
        }
        goHomeByRole(loginUser.role);
      }
    } catch (err) {
      // 401可能是后端重启数据丢失(账号不存在),给友好提示
      if (/用户名或密码错误|Unauthorized|401/.test(err.message)) {
        setError(`账号或密码错误。若您之前已注册,可能因服务器重启数据被清除,请点击"评委快速体验"或重新注册。`);
      } else {
        setError(err.message);
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
      setError('请输入正确的手机号');
      return;
    }
    setSmsSending(true);
    try {
      const res = await api.sendSms(smsPhone.trim());
      if (res.success) {
        // 开发模式: 后端返回 devCode,前端显示提示
        if (res.devCode) {
          setSmsHint(`验证码已发送(开发模式): ${res.devCode}`);
        } else {
          setSmsHint('验证码已发送至手机,请注意查收');
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
      setError(err.message);
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
    try {
      const loginUser = await loginBySms(smsPhone.trim(), smsCode.trim());
      // 手机验证码登录仅限用户登录(管理员不能通过验证码登录)
      if (loginUser.role === 'admin') {
        logout();
        setError('管理员账号不支持手机验证码登录,请使用账号密码登录');
        return;
      }
      goHomeByRole(loginUser.role);
    } catch (err) {
      setError(err.message);
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="PerceptionArk" className="auth-logo-img" />
          <h1>PerceptionArk</h1>
          <p>感知方舟 · AI感知眼镜系统</p>
        </div>

        {/* 登录方式切换Tab */}
        <div className="auth-method-tabs">
          <button
            type="button"
            className={`auth-method-tab ${loginMethod === 'sms' ? 'active' : ''}`}
            onClick={() => switchMethod('sms')}
          >
            📱 手机验证码
          </button>
          <button
            type="button"
            className={`auth-method-tab ${loginMethod === 'password' ? 'active' : ''}`}
            onClick={() => switchMethod('password')}
          >
            🔑 账号密码
          </button>
        </div>

        {/* ===== 手机验证码登录 ===== */}
        {loginMethod === 'sms' && (
          <form onSubmit={handleSmsLogin} className="auth-form">
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
                    onChange={() => { setLoginRole('user'); setError(''); }}
                  />
                  用户登录
                </label>
                <label className={`auth-radio ${loginRole === 'admin' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    value="admin"
                    checked={loginRole === 'admin'}
                    onChange={() => { setLoginRole('admin'); setError(''); }}
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
      </div>
    </div>
  );
}
