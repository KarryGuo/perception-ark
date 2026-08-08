import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';

// 判断是否为移动端(扫码体验默认进AppMobile移动端APP)
const isMobile = () => typeof window !== 'undefined' && window.innerWidth <= 768;

// 根据角色跳转: 管理员进Web管理后台,家属进App家属视图,使用者进App视障视图
const goHomeByRole = (role) => {
  if (role === 'admin') {
    window.location.hash = '#/';
  } else {
    // 家属和使用者都进App端,App内根据角色自动分流
    window.location.hash = isMobile() ? '#/app' : '#/app';
  }
};

export default function Register() {
  const { register, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('user');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 密保问题预设列表
  const SECURITY_QUESTIONS = [
    '您的母亲叫什么名字？',
    '您的父亲叫什么名字？',
    '您出生的城市是哪里？',
    '您的小学叫什么名字？',
    '您最喜欢的食物是什么？',
    '您养的第一只宠物叫什么名字？',
  ];

  // 注册后按角色跳转
  useEffect(() => {
    if (user) goHomeByRole(user.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // 视障人员和家属必须填写手机号(管理员不需要)
    if (role !== 'admin' && !phone.trim()) {
      setError('请填写手机号码,用于家属绑定关系');
      return;
    }
    if (phone.trim() && !/^1[3-9]\d{9}$/.test(phone.trim())) {
      setError('手机号格式不正确');
      return;
    }
    // 密保问题与答案必填
    if (!securityQuestion) {
      setError('请选择密保问题');
      return;
    }
    if (!securityAnswer.trim()) {
      setError('请填写密保答案');
      return;
    }

    setLoading(true);
    try {
      const newUser = await register(username.trim(), password, role, phone.trim() || undefined, securityQuestion, securityAnswer.trim());
      goHomeByRole(newUser.role);
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
              autoComplete="off"
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
              autoComplete="new-password"
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
              autoComplete="new-password"
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="reg-phone">手机号码</label>
            <input
              id="reg-phone"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="11位手机号"
              autoComplete="off"
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="reg-question">密保问题 <span style={{ fontSize: '.72rem', color: 'var(--ink-muted)' }}>(用于找回密码)</span></label>
            <select
              id="reg-question"
              value={securityQuestion}
              onChange={e => setSecurityQuestion(e.target.value)}
              required
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 8,
                background: 'var(--void-3)', border: '1px solid var(--gb)',
                color: 'var(--ink)', fontSize: '.92rem', fontFamily: 'inherit',
                outline: 'none', boxSizing: 'border-box',
                appearance: 'none', WebkitAppearance: 'none',
              }}
            >
              <option value="">请选择密保问题</option>
              {SECURITY_QUESTIONS.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>

          <div className="auth-field">
            <label htmlFor="reg-answer">密保答案</label>
            <input
              id="reg-answer"
              type="text"
              value={securityAnswer}
              onChange={e => setSecurityAnswer(e.target.value)}
              placeholder="请输入密保答案"
              autoComplete="off"
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
