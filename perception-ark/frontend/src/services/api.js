/**
 * 后端API客户端
 * - 开发环境: 走Vite代理 /api
 * - 生产环境: 通过 VITE_API_BASE 指向后端域名(如 https://perception-ark.onrender.com)
 */
const API_BASE = import.meta.env.VITE_API_BASE || '';
const BASE = `${API_BASE}/api`;

async function request(url, options = {}) {
  // 自动携带认证Token
  const token = localStorage.getItem('ark_token');
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function fileToFormData(file, extra = {}) {
  const fd = new FormData();
  if (file) fd.append('image', file);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, String(v)));
  return fd;
}

export const api = {
  // 认证
  register: (username, password, role, phone, securityQuestion, securityAnswer) =>
    request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role, phone, securityQuestion, securityAnswer })
    }),
  login: (username, password) =>
    request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }),
  // 手机验证码登录: 发送验证码
  sendSms: (phone) =>
    request('/auth/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    }),
  // 手机验证码登录: 验证码登录(role用于未注册时自动注册的身份:user/family)
  loginBySms: (phone, code, role) =>
    request('/auth/login-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, role })
    }),
  me: () => request('/auth/me'),
  // 找回密码: 获取密保问题
  getSecurityQuestion: (username) =>
    request('/auth/security-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    }),
  // 找回密码: 校验密保答案并重置密码
  resetPassword: (username, securityAnswer, newPassword) =>
    request('/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, securityAnswer, newPassword })
    }),
  // 修改昵称
  updateNickname: (nickname) =>
    request('/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname })
    }),
  // 修改头像(dataURL: data:image/...;base64,...)
  updateAvatar: (avatar) =>
    request('/auth/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar })
    }),
  // 注销账户(二次确认 confirm=DELETE)
  deleteAccount: () =>
    request('/auth/account?confirm=DELETE', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' })
    }),
  // 修改密码(oldPassword='skip'时跳过验证,用于手机注册用户首次设置密码)
  updatePassword: (oldPassword, newPassword) =>
    request('/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword })
    }),
  // 修改密保问题和答案
  updateSecurity: (question, answer) =>
    request('/auth/security', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer })
    }),
  // 家属绑定(视障用户邀请家属)
  bindFamily: (phone, name, relation) =>
    request('/auth/family/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name, relation })
    }),
  // 获取家属绑定列表
  getFamilyList: () => request('/auth/family/list'),
  // 获取视障用户SOS紧急联系人(从family_bindings表读取active家属)
  getFamilyContacts: () => request('/auth/family/contacts'),
  // 解绑家属
  unbindFamily: (bindingId) =>
    request(`/auth/family/unbind/${bindingId}`, { method: 'DELETE' }),
  // 视障端: 待确认的家属邀请列表(家属端发起,等待视障确认)
  getFamilyPendingConfirm: () => request('/auth/family/pending-confirm'),
  // 视障端: 确认家属邀请
  confirmFamilyInvitation: (bindingId) =>
    request(`/auth/family/confirm/${bindingId}`, { method: 'POST' }),
  // 视障端: 拒绝家属邀请
  rejectFamilyInvitation: (bindingId) =>
    request(`/auth/family/reject/${bindingId}`, { method: 'POST' }),

  // 系统
  health: () => request('/health'),
  stats: () => request('/stats'),
  context: () => request('/context'),
  reset: () => request('/reset', { method: 'POST' }),

  // A01 场景感知
  scene: (imageFile, query = '') =>
    request('/scene', { method: 'POST', body: fileToFormData(imageFile, { query }) }),

  // A02 导航引导
  navigate: (destination, lat, lng) =>
    request('/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination, lat, lng })
    }),

  // POI搜索(实时搜索建议,类似高德输入联想)
  poiSearch: (keyword, lat, lng) => {
    const params = new URLSearchParams({ keyword });
    if (lat != null && lng != null) {
      params.append('lat', String(lat));
      params.append('lng', String(lng));
    }
    return request(`/poi/search?${params.toString()}`);
  },

  // A03 安全预警
  safety: (imageFile, mode = 'scan') =>
    request('/safety', { method: 'POST', body: fileToFormData(imageFile, { mode }) }),

  fall: (lat, lng) =>
    request('/fall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng })
    }),

  // 主动SOS(用户点击SOS按钮)
  sosTrigger: (lat, lng) =>
    request('/sos/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng })
    }),
  sosRespond: () =>
    request('/sos/respond', { method: 'POST' }),
  sosCancel: () =>
    request('/sos/cancel', { method: 'POST' }),

  // 抢占演示 - 多Agent冲突仲裁可视化
  preemptionDemo: (imageFile) =>
    request('/preemption-demo', { method: 'POST', body: fileToFormData(imageFile) }),

  // A04 社交辅助
  social: (imageFile, mode = 'ocr') =>
    request('/social', { method: 'POST', body: fileToFormData(imageFile, { mode }) }),

  // A05 环境记忆
  memory: (query = '') => request(`/memory?query=${encodeURIComponent(query)}`),

  // 通用语音指令
  voice: (text, imageFile, location) => {
    const fd = fileToFormData(imageFile, { text });
    if (location) {
      fd.append('lat', String(location.lat));
      fd.append('lng', String(location.lng));
      fd.append('address', location.address || '');
    }
    return request('/voice', { method: 'POST', body: fd });
  },

  // 位置更新
  location: (lat, lng, address) =>
    request('/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, address })
    }),

  // 逆地理编码 + 天气查询(小舟开机自检用)
  locationInfo: (lat, lng) =>
    request(`/location-info?lat=${lat}&lng=${lng}`),

  // 天气查询
  weather: (adcode) => request(`/weather?adcode=${adcode}`),

  // 记忆库管理
  memoryRoutes: () => request('/memory/routes'),
  memoryFaces: () => request('/memory/faces'),
  memoryHabits: () => request('/memory/habits'),
  memoryStats: () => request('/memory/stats'),
  addFace: (name, relation, description) =>
    request('/memory/faces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, relation, description })
    }),
  forgetFaces: () => request('/memory/faces', { method: 'DELETE' }),

  // SOS事件
  sosEvents: () => request('/sos/events'),

  // ===== 小舟智能助手 =====
  assistantChat: (text, { sessionId, imageFile, location } = {}) => {
    const fd = fileToFormData(imageFile, { text, sessionId });
    if (location) {
      fd.append('lat', String(location.lat));
      fd.append('lng', String(location.lng));
      fd.append('address', location.address || '');
    }
    return request('/assistant/chat', { method: 'POST', body: fd });
  },

  assistantClear: (sessionId) =>
    request('/assistant/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    }),

  assistantHistory: (sessionId) =>
    request(`/assistant/history/${encodeURIComponent(sessionId)}`),

  // 家属端
  familyOverview: () => request('/family/overview'),
  familyLocation: () => request('/family/location'),
  familyPreciseLocation: () => request('/family/precise-location'),
  familySos: () => request('/family/sos'),
  familyContacts: () => request('/family/contacts'),
  familyUsers: () => request('/family/users'),
  familyAddUser: (data) =>
    request('/family/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }),
  familyUpdateUser: (id, data) =>
    request(`/family/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }),
  familyDeleteUser: (id) =>
    request(`/family/users/${id}`, { method: 'DELETE' }),
  // 家属端: 待确认的视障邀请列表(视障端发起,等待家属确认)
  familyPendingConfirm: () => request('/family/pending-confirm'),
  // 家属端: 确认视障邀请
  familyConfirmInvitation: (bindingId) =>
    request(`/family/confirm/${bindingId}`, { method: 'POST' }),
  // 家属端: 拒绝视障邀请
  familyRejectInvitation: (bindingId) =>
    request(`/family/reject/${bindingId}`, { method: 'POST' }),
  // 管理端新增
  familyDashboard: () => request('/family/dashboard'),
  familyRecognitionHistory: (limit) => request(`/family/recognition-history${limit ? `?limit=${limit}` : ''}`),
  familyRoutes: () => request('/family/routes'),
  familyHabits: () => request('/family/habits'),

  // 管理员后台
  adminAccounts: () => request('/admin/accounts'),
  adminBanAccount: (id, reason) =>
    request(`/admin/accounts/${id}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    }),
  adminUnbanAccount: (id, reason) =>
    request(`/admin/accounts/${id}/unban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    }),
  adminLogs: (limit) => request(`/admin/logs${limit ? `?limit=${limit}` : ''}`),
  adminDevices: () => request('/admin/devices'),
};
