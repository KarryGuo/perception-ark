import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';

export default function Login() {
  const { login, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 已登录则跳转首页
  useEffect(() => {
    if (user) window.location.hash = '#/';
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
      window.location.hash = '#/';
    } catch (err) {
      setError(err.message);
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
      window.location.hash = '#/';
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
          <div className="auth-logo">⚡</div>
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
      </div>
    </div>
  );
}
