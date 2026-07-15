import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth.jsx';
import { api } from './services/api.js';
import Glasses from './pages/Glasses.jsx';
import Family from './pages/Family.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
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
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (user) {
      window.location.hash = '#/app';
      return;
    }
    (async () => {
      try {
        try {
          await login('demo', 'demo123');
        } catch {
          await api.register('demo', 'demo123', 'user');
          await login('demo', 'demo123');
        }
        window.location.hash = '#/app';
      } catch (err) {
        setStatus('error');
      }
    })();
  }, [user, login]);

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#04060C', color: '#fff', fontFamily: 'Noto Sans SC, sans-serif', gap: 16 }}>
        <div style={{ fontSize: '2rem' }}>⚠️</div>
        <div>体验入口暂时不可用</div>
        <a href="#/login" style={{ color: '#00FFA3', padding: '10px 24px', border: '1px solid #00FFA3', borderRadius: 8, textDecoration: 'none' }}>前往登录</a>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#04060C', color: '#00FFA3', fontFamily: 'Noto Sans SC, sans-serif', gap: 20 }}>
      <div style={{ fontSize: '3rem', animation: 'spin 1s linear infinite' }}>⚡</div>
      <div style={{ fontSize: '1.1rem' }}>正在进入感知方舟...</div>
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
