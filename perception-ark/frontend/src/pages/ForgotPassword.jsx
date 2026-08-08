import { useState } from 'react';
import { api } from '../services/api.js';

// 找回密码: 三步流程 (输入用户名 → 回答密保 → 设置新密码)
// step1: 输入用户名,获取密保问题
// step2: 回答密保问题
// step3: 设置新密码
export default function ForgotPassword() {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [question, setQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // 第1步: 提交用户名,获取密保问题
  const handleGetQuestion = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    setLoading(true);
    try {
      const res = await api.getSecurityQuestion(username.trim());
      if (res.success) {
        setQuestion(res.question);
        setStep(2);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 第3步: 重置密码
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (!securityAnswer.trim()) {
      setError('请填写密保答案');
      return;
    }
    if (newPassword.length < 6) {
      setError('新密码长度至少6位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const res = await api.resetPassword(username.trim(), securityAnswer.trim(), newPassword);
      if (res.success) {
        setSuccess(res.message || '密码重置成功');
        setStep(4);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 返回登录
  const goLogin = () => {
    window.location.hash = '#/login';
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="PerceptionArk" className="auth-logo-img" />
          <h1>找回密码</h1>
          <p>通过密保问题重置您的密码</p>
        </div>

        {/* 步骤指示器 */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
          {[1, 2, 3].map(s => (
            <div
              key={s}
              style={{
                width: 32, height: 4, borderRadius: 2,
                background: step >= s ? 'var(--bio-emerald)' : 'var(--gb)',
                transition: 'all .3s',
              }}
            />
          ))}
        </div>

        {/* 第1步: 输入用户名 */}
        {step === 1 && (
          <form onSubmit={handleGetQuestion} className="auth-form">
            <div className="auth-field">
              <label htmlFor="fp-username">用户名</label>
              <input
                id="fp-username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="请输入您的用户名"
                autoComplete="off"
                required
                autoFocus
              />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? '查询中...' : '获取密保问题'}
            </button>
            <div className="auth-links">
              <a href="#/login">返回登录</a>
            </div>
          </form>
        )}

        {/* 第2步&第3步: 回答密保 + 设置新密码(合并为一步,减少跳转) */}
        {step === 2 && (
          <form onSubmit={handleResetPassword} className="auth-form">
            <div className="auth-field">
              <label>用户名</label>
              <div style={{
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--void-3)', border: '1px solid var(--gb)',
                color: 'var(--ink-soft)', fontSize: '.92rem',
              }}>
                {username}
              </div>
            </div>

            <div className="auth-field">
              <label>密保问题</label>
              <div style={{
                padding: '12px 14px', borderRadius: 8,
                background: 'rgba(0,255,163,0.06)', border: '1px solid rgba(0,255,163,0.2)',
                color: 'var(--ink)', fontSize: '.92rem', lineHeight: 1.6,
              }}>
                🔒 {question}
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="fp-answer">密保答案</label>
              <input
                id="fp-answer"
                type="text"
                value={securityAnswer}
                onChange={e => setSecurityAnswer(e.target.value)}
                placeholder="请输入密保答案"
                autoComplete="off"
                required
                autoFocus
              />
            </div>

            <div className="auth-field">
              <label htmlFor="fp-newpwd">新密码</label>
              <input
                id="fp-newpwd"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="至少6位"
                autoComplete="new-password"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="fp-confirm">确认新密码</label>
              <input
                id="fp-confirm"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
                autoComplete="new-password"
                required
              />
            </div>

            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? '重置中...' : '重置密码'}
            </button>
            <div className="auth-links">
              <a href="#/login">返回登录</a>
            </div>
          </form>
        )}

        {/* 成功页 */}
        {step === 4 && (
          <div className="auth-form" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: '1.1rem', color: 'var(--bio-emerald)', marginBottom: 8, fontWeight: 600 }}>
              {success}
            </div>
            <div style={{ fontSize: '.85rem', color: 'var(--ink-muted)', marginBottom: 24 }}>
              请使用新密码登录您的账号
            </div>
            <button className="auth-btn" onClick={goLogin}>返回登录</button>
          </div>
        )}
      </div>
    </div>
  );
}
