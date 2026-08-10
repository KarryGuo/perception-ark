import { useTheme } from '../hooks/useTheme.js';

/**
 * 明暗主题切换按钮 (三态循环: 跟随系统 → 浅色 → 暗色)
 * 用于家属端/管理端,视障端不使用
 */
export default function ThemeToggle({ className = '', size = 'md' }) {
  const { theme, cycleTheme } = useTheme();

  const meta = {
    system: { icon: '🌓', label: '跟随系统', title: '跟随系统主题 (点击切换为浅色)' },
    light:  { icon: '☀️', label: '浅色',     title: '浅色主题 (点击切换为暗色)' },
    dark:   { icon: '🌙', label: '暗色',     title: '暗色主题 (点击跟随系统)' },
  }[theme];

  const sizeStyle = size === 'sm'
    ? { padding: '4px 8px', fontSize: '.72rem', gap: 4 }
    : { padding: '6px 12px', fontSize: '.78rem', gap: 6 };

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className={`ark-theme-toggle ${className}`}
      aria-label={meta.title}
      title={meta.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        ...sizeStyle,
        borderRadius: 20,
        border: '1px solid var(--gb)',
        background: 'var(--glass)',
        color: 'var(--ink-soft)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: 500,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        transition: 'all .2s',
        minWidth: 48,
        minHeight: 36,
      }}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.label}</span>
    </button>
  );
}
