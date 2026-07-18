import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';

// 判断是否为移动端(扫码体验默认进AppMobile移动端APP)
const isMobile = () => typeof window !== 'undefined' && window.innerWidth <= 768;

export default function Login() {
  const { login, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 登录后跳转: 移动端进AppMobile, PC端进Glasses首页
  const goHome = () => { window.location.hash = isMobile() ? '#/app' : '#/'; };

  // 已登录则跳转首页
  useEffect(() => {
    if (user) goHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
      goHome();
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

  // 评委快速体验: 自动登录demo账号(不存在则注册)
  const handleDemo = async () => {
    setError('');
    setLoading(true);
    try {
      try {
        await login('demo', 'demo123');
      } catch {
        await api.register('demo', 'demo123', 'user');
        await login('demo', 'demo123');
      }
      goHome();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="PerceptionArk" className="auth-logo-img" />
          <h1>PerceptionArk</h1>
          <p>感知方舟 · AI感知眼镜系统</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
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

          <button type="button" className="auth-btn demo" onClick={handleDemo} disabled={loading}>
            评委快速体验
          </button>

          <div className="auth-links">
            <a href="#/register">没有账号? 立即注册</a>
            <a href="#/guide">产品使用说明</a>
          </div>
        </form>

        {/* 评委手机扫码体验 */}
        <div className="auth-qr">
          <div className="auth-qr-title">📱 评委手机扫码体验</div>
          <div className="auth-qr-img">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&color=04060C&bgcolor=FFFFFF&data=${encodeURIComponent(window.location.href.split('#')[0] + '#/demo')}`}
              alt="扫码体验移动端APP"
              width="160"
              height="160"
            />
          </div>
          <div className="auth-qr-tip">扫码一键进入移动端APP</div>
          <div className="auth-qr-hint">首次访问需等待约30秒服务唤醒</div>
        </div>
      </div>
    </div>
  );
}
