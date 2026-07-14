import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { api } from '../services/api.js';

const AuthContext = createContext(null);

/**
 * 认证 Context Hook
 * 管理登录状态、token持久化、用户信息
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 初始化: 从localStorage恢复登录状态
  useEffect(() => {
    const token = localStorage.getItem('ark_token');
    if (!token) {
      setLoading(false);
      return;
    }
    // 验证token有效性
    api.me()
      .then(res => {
        if (res.success) setUser(res.user);
        else localStorage.removeItem('ark_token');
      })
      .catch(() => {
        localStorage.removeItem('ark_token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password);
    if (res.success) {
      localStorage.setItem('ark_token', res.token);
      setUser(res.user);
      return res.user;
    }
    throw new Error(res.error || '登录失败');
  }, []);

  const register = useCallback(async (username, password, role) => {
    const res = await api.register(username, password, role);
    if (res.success) {
      localStorage.setItem('ark_token', res.token);
      setUser(res.user);
      return res.user;
    }
    throw new Error(res.error || '注册失败');
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('ark_token');
    setUser(null);
    window.location.hash = '#/login';
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
