import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { api } from '../services/api.js';
import { secureStorage } from '../services/nativeBridge.js';

const AuthContext = createContext(null);

/**
 * 认证 Context Hook
 * 管理登录状态、token持久化、用户信息
 * Token存储: 原生APP用 @capacitor/preferences(安全),Web环境用 localStorage
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 初始化: 从安全存储恢复登录状态
  useEffect(() => {
    // 用同步缓存快速判断(避免每次刷新都闪现登录页)
    const token = secureStorage.getSync('ark_token');
    if (!token) {
      setLoading(false);
      return;
    }
    // 验证token有效性
    api.me()
      .then(res => {
        if (res.success) {
          setUser(res.user);
        } else {
          // token无效或账号不存在(后端重启数据丢失),清除token跳转登录
          secureStorage.removeSync('ark_token');
          // 避免在登录页本身跳转造成循环
          if (window.location.hash !== '#/login' && window.location.hash !== '#/demo') {
            window.location.hash = '#/login';
          }
        }
      })
      .catch(() => {
        // 网络错误或401/404: 清除token
        secureStorage.removeSync('ark_token');
        if (window.location.hash !== '#/login' && window.location.hash !== '#/demo') {
          window.location.hash = '#/login';
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password);
    if (res.success) {
      secureStorage.setSync('ark_token', res.token);
      setUser(res.user);
      return res.user;
    }
    throw new Error(res.error || '登录失败');
  }, []);

  // 手机验证码登录(无需密码,通过验证码登录;role用于未注册时自动注册的身份)
  const loginBySms = useCallback(async (phone, code, role) => {
    const res = await api.loginBySms(phone, code, role);
    if (res.success) {
      secureStorage.setSync('ark_token', res.token);
      setUser(res.user);
      return res.user;
    }
    throw new Error(res.error || '验证码登录失败');
  }, []);

  const register = useCallback(async (username, password, role, phone, securityQuestion, securityAnswer) => {
    const res = await api.register(username, password, role, phone, securityQuestion, securityAnswer);
    if (res.success) {
      secureStorage.setSync('ark_token', res.token);
      setUser(res.user);
      return res.user;
    }
    throw new Error(res.error || '注册失败');
  }, []);

  // 刷新当前用户信息(从后端拉取最新,用于修改昵称/头像后同步本地状态)
  const refreshUser = useCallback(async () => {
    try {
      const res = await api.me();
      if (res.success) {
        setUser(res.user);
        return res.user;
      }
    } catch (e) {
      console.warn('[Auth] 刷新用户信息失败:', e.message);
    }
    return null;
  }, []);

  // 用后端返回的 user 对象直接更新本地状态(避免再次请求 /me)
  const updateUser = useCallback((newUser) => {
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    secureStorage.removeSync('ark_token');
    setUser(null);
    window.location.hash = '#/login';
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginBySms, register, logout, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}