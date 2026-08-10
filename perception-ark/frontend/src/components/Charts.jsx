/**
 * 纯SVG图表组件(无第三方依赖)
 * - 暗色主题优先,文字使用currentColor继承父元素
 * - 网格线使用半透明白色,适配暗色背景
 * - 响应式宽度100%,通过viewBox + preserveAspectRatio实现
 */
import { useState, useMemo } from 'react';

const GRID_COLOR = 'rgba(255,255,255,0.06)';
const AXIS_COLOR = 'rgba(255,255,255,0.12)';
const LABEL_OPACITY = 0.6;

// ============================================================
// LineChart - 多系列折线图
// ============================================================
export function LineChart({ data = [], series = [], height = 200 }) {
  const [hover, setHover] = useState(null);

  const W = 800;
  const H = height;
  const padding = { top: 12, right: 16, bottom: 28, left: 36 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;

  // Y轴最大值(跨所有系列)
  const yMax = useMemo(() => {
    let m = 0;
    for (const row of data) {
      for (const s of series) {
        const v = Number(row[s.key]) || 0;
        if (v > m) m = v;
      }
    }
    if (m <= 0) return 4;
    return Math.ceil(m * 1.2);
  }, [data, series]);

  const yTicks = 4;
  const tickStep = yMax / yTicks;

  const xPos = (i) => padding.left + (data.length > 1 ? (i * innerW) / (data.length - 1) : innerW / 2);
  const yPos = (v) => padding.top + innerH - (v / yMax) * innerH;

  const fmtDate = (d) => {
    const s = String(d || '');
    return s.length >= 10 ? s.slice(5) : s;
  };

  return (
    <div style={{ position: 'relative', width: '100%', color: 'var(--ink)' }}>
      {/* 图例 */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 4, paddingLeft: 4 }}>
        {series.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.72rem', color: 'var(--ink-soft)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }}></span>
            {s.name}
          </div>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* 网格线 + Y轴刻度 */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = i * tickStep;
          const y = yPos(v);
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={W - padding.right} y2={y} stroke={GRID_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize={10} fill="currentColor" opacity={LABEL_OPACITY} fontFamily="Space Grotesk, monospace">
                {Math.round(v)}
              </text>
            </g>
          );
        })}

        {/* X轴日期 */}
        {data.map((row, i) => (
          <text key={i} x={xPos(i)} y={H - padding.bottom + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={LABEL_OPACITY} fontFamily="Space Grotesk, monospace">
            {fmtDate(row.date)}
          </text>
        ))}

        {/* 折线 + 数据点 */}
        {series.map((s) => {
          const pts = data.map((row, i) => ({ x: xPos(i), y: yPos(Number(row[s.key]) || 0), v: Number(row[s.key]) || 0, date: row.date }));
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {pts.map((p, di) => (
                <circle
                  key={di}
                  cx={p.x}
                  cy={p.y}
                  r={3.5}
                  fill={s.color}
                  stroke="var(--void-3)"
                  strokeWidth={1}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHover({ x: p.x, y: p.y, value: p.v, name: s.name, date: p.date, color: s.color })}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* 悬浮提示 */}
      {hover && (
        <div style={{
          position: 'absolute',
          left: `${(hover.x / W) * 100}%`,
          top: hover.y,
          transform: 'translate(-50%, -120%)',
          background: 'var(--void-3)',
          border: '1px solid var(--gb)',
          borderRadius: 6,
          padding: '5px 9px',
          fontSize: '.7rem',
          color: 'var(--ink)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          <div style={{ color: 'var(--ink-muted)', fontSize: '.66rem', marginBottom: 2 }}>{fmtDate(hover.date)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: hover.color, display: 'inline-block' }}></span>
            {hover.name}: <strong style={{ color: 'var(--ink)' }}>{hover.value}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// DonutChart - 环形饼图
// ============================================================
export function DonutChart({ data = [], size = 160 }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  const radius = size / 2;
  const strokeW = Math.max(14, size * 0.14);
  const r = radius - strokeW / 2;
  const circumference = 2 * Math.PI * r;

  // 累计偏移量(从顶部12点钟方向开始,顺时针)
  let accOffset = 0;
  const segments = data.map((d, i) => {
    const value = Number(d.value) || 0;
    const fraction = total > 0 ? value / total : 0;
    const segLen = fraction * circumference;
    // dasharray: 段长 + 剩余周长
    const dashArray = `${segLen} ${circumference - segLen}`;
    // dashoffset: 控制起始位置,从顶部开始需要旋转-90度(用transform)
    const dashOffset = -accOffset;
    accOffset += segLen;
    return { ...d, value, fraction, dashArray, dashOffset, idx: i };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: 'var(--ink)', flexWrap: 'wrap', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
          <g transform={`rotate(-90 ${radius} ${radius})`}>
            {/* 底环(无数据时显示完整环) */}
            <circle
              cx={radius}
              cy={radius}
              r={r}
              fill="none"
              stroke={GRID_COLOR}
              strokeWidth={strokeW}
            />
            {total > 0 && segments.map((seg) => (
              <circle
                key={seg.idx}
                cx={radius}
                cy={radius}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeW}
                strokeDasharray={seg.dashArray}
                strokeDashoffset={seg.dashOffset}
                strokeLinecap="butt"
                style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                opacity={hoverIdx === null || hoverIdx === seg.idx ? 1 : 0.35}
                onMouseEnter={() => setHoverIdx(seg.idx)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            ))}
          </g>
        </svg>
        {/* 中心文字 */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        }}>
          {hoverIdx !== null && total > 0 ? (
            <>
              <div style={{ fontSize: '.7rem', color: 'var(--ink-muted)', marginBottom: 2 }}>
                {data[hoverIdx]?.name}
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: data[hoverIdx]?.color || 'var(--ink)', fontFamily: 'Space Grotesk, monospace' }}>
                {((data[hoverIdx]?.value / total) * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: '.68rem', color: 'var(--ink-muted)', marginTop: 2 }}>
                {data[hoverIdx]?.value} 次
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '.7rem', color: 'var(--ink-muted)', marginBottom: 2 }}>总计</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--ink)', fontFamily: 'Space Grotesk, monospace' }}>
                {total}
              </div>
              <div style={{ fontSize: '.66rem', color: 'var(--ink-faint)', marginTop: 2 }}>事件</div>
            </>
          )}
        </div>
      </div>

      {/* 右侧图例 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 100, flex: 1, maxWidth: 180 }}>
        {data.length > 0 ? data.map((d, i) => {
          const v = Number(d.value) || 0;
          const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
          return (
            <div
              key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: '.72rem',
                color: 'var(--ink-soft)', cursor: 'pointer',
                opacity: hoverIdx === null || hoverIdx === i ? 1 : 0.5,
                transition: 'opacity 0.15s',
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 2, background: d.color, flexShrink: 0 }}></span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
              <span style={{ color: 'var(--ink-muted)', fontFamily: 'Space Grotesk, monospace' }}>{v}</span>
              <span style={{ color: 'var(--ink-faint)', fontSize: '.66rem', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
            </div>
          );
        }) : (
          <div style={{ fontSize: '.72rem', color: 'var(--ink-muted)' }}>暂无数据</div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// BarChart - 柱状图
// ============================================================
export function BarChart({ data = [], height = 160 }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const W = 600;
  const H = height;
  const padding = { top: 18, right: 12, bottom: 28, left: 28 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;

  const maxV = useMemo(() => {
    let m = 0;
    for (const d of data) {
      const v = Number(d.value) || 0;
      if (v > m) m = v;
    }
    return Math.max(m, 1);
  }, [data]);

  const yMax = Math.ceil(maxV * 1.15);
  const yTicks = 3;
  const tickStep = yMax / yTicks;

  const barCount = data.length || 1;
  const slotW = innerW / barCount;
  const barW = Math.min(slotW * 0.6, 48);

  const yPos = (v) => padding.top + innerH - (v / yMax) * innerH;

  return (
    <div style={{ width: '100%', color: 'var(--ink)' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Y轴网格线 */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = i * tickStep;
          const y = yPos(v);
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={W - padding.right} y2={y} stroke={GRID_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize={10} fill="currentColor" opacity={LABEL_OPACITY} fontFamily="Space Grotesk, monospace">
                {Math.round(v)}
              </text>
            </g>
          );
        })}

        {/* 柱子 */}
        {data.map((d, i) => {
          const v = Number(d.value) || 0;
          const cx = padding.left + slotW * (i + 0.5);
          const x = cx - barW / 2;
          const y = yPos(v);
          const h = padding.top + innerH - y;
          const isHover = hoverIdx === i;
          return (
            <g
              key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 0)}
                fill={d.color}
                rx={3}
                opacity={hoverIdx === null || isHover ? 1 : 0.55}
                style={{ transition: 'opacity 0.15s' }}
              />
              {/* 数值 */}
              <text x={cx} y={y - 5} textAnchor="middle" fontSize={10} fill="currentColor" opacity={isHover ? 1 : LABEL_OPACITY} fontFamily="Space Grotesk, monospace" fontWeight={isHover ? 700 : 400}>
                {v}
              </text>
              {/* 标签 */}
              <text x={cx} y={H - padding.bottom + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={LABEL_OPACITY}>
                {d.label}
              </text>
            </g>
          );
        })}

        {data.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.5}>
            暂无数据
          </text>
        )}
      </svg>
    </div>
  );
}
