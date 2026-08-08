import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth.jsx';
import { api } from './services/api.js';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Guide from './pages/Guide.jsx';
import AppMobile from './pages/AppMobile.jsx';
import Settings from './pages/Settings.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1115', color: '#9ca3af', fontFamily: 'system-ui, sans-serif' }}>
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

function DemoEntry() {
  const { login, user } = useAuth();
  const [status, setStatus] = useState('loading');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (user) {
      window.location.hash = '#/app';
      return;
    }
    let cancelled = false;

    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        try {
          setStatus(attempt === 0 ? 'loading' : 'warming');
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
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
      if (!cancelled) {
        setStatus('error');
      }
    })();

    return () => { cancelled = true; };
  }, [user, login, retryCount]);

  const handleRetry = () => {
    setStatus('loading');
    setRetryCount(c => c + 1);
  };

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f1115', color: '#f5f6f8', fontFamily: 'system-ui, sans-serif', gap: 16, padding: 20 }}>
        <div style={{ fontSize: '2rem' }}>⚠️</div>
        <div style={{ fontSize: '1rem', textAlign: 'center' }}>服务正在唤醒中，请稍后重试</div>
        <div style={{ fontSize: '.8rem', color: '#9ca3af', textAlign: 'center' }}>首次访问需要等待服务启动</div>
        <button onClick={handleRetry} style={{ color: '#fff', padding: '12px 32px', border: 'none', borderRadius: 12, background: '#3b82f6', cursor: 'pointer', fontSize: '.9rem', fontFamily: 'inherit', fontWeight: 500 }}>重新尝试</button>
        <a href="#/login" style={{ color: '#9ca3af', fontSize: '.8rem', marginTop: 8 }}>前往登录页</a>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f1115', color: '#3b82f6', fontFamily: 'system-ui, sans-serif', gap: 20 }}>
      <div style={{ fontSize: '3rem', animation: 'spin 1.2s linear infinite' }}>⚡</div>
      <div style={{ fontSize: '1.1rem' }}>
        {status === 'warming' ? '服务启动中，请稍候...' : '正在进入感知方舟...'}
      </div>
      {status === 'warming' && (
        <div style={{ fontSize: '.8rem', color: '#9ca3af' }}>首次访问需要等待约30秒</div>
      )}
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(window.location.hash || '#/app');

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/app');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (route === '#/login' || route === '#/login/') return <Login />;
  if (route === '#/register' || route === '#/register/') return <Register />;
  if (route === '#/guide' || route === '#/guide/') return <Guide />;
  if (route === '#/demo' || route === '#/demo/') return <DemoEntry />;

  if (route === '#/app' || route === '#/app/') return <RequireAuth><AppMobile /></RequireAuth>;
  if (route === '#/settings' || route === '#/settings/') return <RequireAuth><Settings /></RequireAuth>;

  if (route === '#/' || route === '' || route === '#') return <RequireAuth><AppMobile /></RequireAuth>;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f1115', color: '#f5f6f8', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: '4rem', marginBottom: 16 }}>404</div>
      <div style={{ fontSize: '1.2rem', marginBottom: 8, opacity: 0.8 }}>页面不存在</div>
      <div style={{ fontSize: '0.9rem', opacity: 0.5, marginBottom: 24 }}>路径: {route}</div>
      <a href="#/app" style={{ color: '#fff', padding: '12px 32px', border: 'none', borderRadius: 12, background: '#3b82f6', textDecoration: 'none', fontWeight: 500 }}>返回APP</a>
    </div>
  );
}
