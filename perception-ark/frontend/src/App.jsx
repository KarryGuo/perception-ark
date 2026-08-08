import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth.jsx';
import { api } from './services/api.js';
import Glasses from './pages/Glasses.jsx';
import Family from './pages/Family.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Guide from './pages/Guide.jsx';
import AppMobile from './pages/AppMobile.jsx';
import Settings from './pages/Settings.jsx';

// 路由守卫: 未登录则跳转登录页
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#04060C', color: '#8893A8', fontFamily: 'Noto Sans SC, sans-serif' }}>
        正在加载...
      </div>
    );
  }
  if (!user) {
    window.location.hash = '#/login';
    return null;
  }
  return children;
}

// 评委一键体验: 自动登录demo账号并跳转APP端
function DemoEntry() {
  const { login, user } = useAuth();
  const [status, setStatus] = useState('loading'); // loading | warming | error
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (user) {
      window.location.hash = '#/app';
      return;
    }
    let cancelled = false;

    (async () => {
      // Render免费版后端会休眠,首次请求需要冷启动(30-50秒)
      // 最多重试3次,每次超时20秒
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        try {
          setStatus(attempt === 0 ? 'loading' : 'warming');
          // 使用Promise.race添加超时控制
          const loginPromise = (async () => {
            try {
              await login('demo', 'demo123');
            } catch {
              await api.register('demo', 'demo123', 'user');
              await login('demo', 'demo123');
            }
          })();

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 25000)
          );

          await Promise.race([loginPromise, timeoutPromise]);

          if (!cancelled) {
            window.location.hash = '#/app';
          }
          return;
        } catch (err) {
          console.warn(`[Demo] 第${attempt + 1}次尝试失败:`, err.message);
          if (attempt < 2) {
            // 等待2秒后重试
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
      // 3次都失败
      if (!cancelled) {
        setStatus('error');
      }
    })();

    return () => { cancelled = true; };
  }, [user, login, retryCount]);

  // 手动重试
  const handleRetry = () => {
    setStatus('loading');
    setRetryCount(c => c + 1);
  };

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#04060C', color: '#fff', fontFamily: 'Noto Sans SC, sans-serif', gap: 16, padding: 20 }}>
        <div style={{ fontSize: '2rem' }}>⚠️</div>
        <div style={{ fontSize: '1rem', textAlign: 'center' }}>服务正在唤醒中，请稍后重试</div>
        <div style={{ fontSize: '.8rem', color: '#8893A8', textAlign: 'center' }}>首次访问需要等待服务启动</div>
        <button onClick={handleRetry} style={{ color: '#00FFA3', padding: '10px 32px', border: '1px solid #00FFA3', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: '.9rem', fontFamily: 'inherit' }}>重新尝试</button>
        <a href="#/login" style={{ color: '#8893A8', fontSize: '.8rem', marginTop: 8 }}>前往登录页</a>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#04060C', color: '#00FFA3', fontFamily: 'Noto Sans SC, sans-serif', gap: 20 }}>
      <div style={{ fontSize: '3rem', animation: 'spin 1.2s linear infinite' }}>⚡</div>
      <div style={{ fontSize: '1.1rem' }}>
        {status === 'warming' ? '服务启动中，请稍候...' : '正在进入感知方舟...'}
      </div>
      {status === 'warming' && (
        <div style={{ fontSize: '.8rem', color: '#8893A8' }}>首次访问需要等待约30秒</div>
      )}
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(window.location.hash || '#/');

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 公开路由: 登录/注册/说明页/评委体验入口
  if (route === '#/login' || route === '#/login/') return <Login />;
  if (route === '#/register' || route === '#/register/') return <Register />;
  if (route === '#/forgot' || route === '#/forgot/') return <ForgotPassword />;
  if (route === '#/guide' || route === '#/guide/') return <Guide />;
  if (route === '#/demo' || route === '#/demo/') return <DemoEntry />;

  // 受保护路由: 需要登录
  if (route === '#/app' || route === '#/app/') return <RequireAuth><AppMobile /></RequireAuth>;
  if (route === '#/settings' || route === '#/settings/') return <RequireAuth><Settings /></RequireAuth>;
  if (route.startsWith('#/family')) return <RequireAuth><Family /></RequireAuth>;
  if (route === '#/' || route === '' || route === '#') return <RequireAuth><Glasses /></RequireAuth>;

  // 404
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#04060C', color: '#fff', fontFamily: 'Noto Sans SC, sans-serif' }}>
      <div style={{ fontSize: '4rem', marginBottom: 16 }}>404</div>
      <div style={{ fontSize: '1.2rem', marginBottom: 8, opacity: 0.8 }}>页面不存在</div>
      <div style={{ fontSize: '0.9rem', opacity: 0.5, marginBottom: 24 }}>路径: {route}</div>
      <a href="#/" style={{ color: '#00FFA3', padding: '12px 32px', border: '1px solid #00FFA3', borderRadius: 8, textDecoration: 'none' }}>返回首页</a>
    </div>
  );
}
