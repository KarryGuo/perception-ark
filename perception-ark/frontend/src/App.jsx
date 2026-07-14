import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth.jsx';
import Glasses from './pages/Glasses.jsx';
import Family from './pages/Family.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Guide from './pages/Guide.jsx';
import AppMobile from './pages/AppMobile.jsx';

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

export default function App() {
  const [route, setRoute] = useState(window.location.hash || '#/');

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 公开路由: 登录/注册/说明页无需认证
  if (route === '#/login' || route === '#/login/') return <Login />;
  if (route === '#/register' || route === '#/register/') return <Register />;
  if (route === '#/guide' || route === '#/guide/') return <Guide />;

  // 受保护路由: 需要登录
  if (route === '#/app' || route === '#/app/') return <RequireAuth><AppMobile /></RequireAuth>;
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
