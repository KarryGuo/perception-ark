import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Register() {
  const { register, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) window.location.hash = '#/';
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      setError('密码长度至少6位');
      return;
    }

    setLoading(true);
    try {
      await register(username.trim(), password, role);
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
          <img src="/logo.png" alt="PerceptionArk" className="auth-logo-img" />
          <h1>注册感知方舟</h1>
          <p>加入感知方舟,开启智能感知之旅</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="reg-username">用户名</label>
            <input
              id="reg-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="2-20个字符"
              required
              autoFocus
            />
          </div>

          <div className="auth-field">
            <label htmlFor="reg-password">密码</label>
            <input
              id="reg-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="至少6位"
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="reg-confirm">确认密码</label>
            <input
              id="reg-confirm"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入密码"
              required
            />
          </div>

          <div className="auth-field">
            <label>账号类型</label>
            <div className="auth-radio-group">
              <label className={`auth-radio ${role === 'user' ? 'active' : ''}`}>
                <input type="radio" value="user" checked={role === 'user'} onChange={() => setRole('user')} />
                使用者(视障用户)
              </label>
              <label className={`auth-radio ${role === 'family' ? 'active' : ''}`}>
                <input type="radio" value="family" checked={role === 'family'} onChange={() => setRole('family')} />
                家属
              </label>
            </div>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? '注册中...' : '注 册'}
          </button>

          <div className="auth-links">
            <a href="#/login">已有账号? 返回登录</a>
          </div>
        </form>
      </div>
    </div>
  );
}
