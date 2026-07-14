// 日志工具
const colors = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m'
};

const agentColors = {
  ORCH: colors.cyan,
  A01: colors.green, A02: colors.yellow, A03: colors.red,
  A04: colors.magenta, A05: colors.blue, SYS: colors.gray
};

export function log(tag, message, level = 'info') {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  const color = agentColors[tag] || colors.reset;
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠' : '✓';
  console.log(`${colors.gray}[${ts}]${colors.reset} ${color}[${tag}]${colors.reset} ${prefix} ${message}`);
}

export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function now() {
  return new Date().toISOString();
}

// 简单延迟
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 距离计算 (haversine公式)
export function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
