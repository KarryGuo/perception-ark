import { useState, useEffect, useCallback } from 'react';

/**
 * 主题切换 Hook (家属端/管理端使用,视障端强制暗色)
 * 三态: 'system' 跟随系统 | 'light' 强制浅色 | 'dark' 强制暗色
 * 通过在 <html> 上设置 data-theme 属性实现手动覆盖
 * 持久化到 localStorage('ark-theme')
 */
const STORAGE_KEY = 'ark-theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'system';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
  return 'system';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [theme]);

  // 监听系统主题变化(仅在system模式时由CSS自动响应,此处无需额外处理)
  const cycleTheme = useCallback(() => {
    setTheme(prev => {
      if (prev === 'system') return 'light';
      if (prev === 'light') return 'dark';
      return 'system';
    });
  }, []);

  const setThemeExplicit = useCallback((t) => {
    setTheme(t);
  }, []);

  return { theme, cycleTheme, setTheme: setThemeExplicit };
}
