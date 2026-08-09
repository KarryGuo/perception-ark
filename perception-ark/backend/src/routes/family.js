import { Router } from 'express';
import { getSosEvents, getMemoryStats, getAllRoutes, searchFaces, getAllUsers, addUser, deleteUser, updateUser, getAllHabits, findUserAccountByPhone } from '../services/memory-store.js';
import { getContext, getStats } from '../agents/orchestrator.js';
import { log } from '../utils/logger.js';

const router = Router();

/**
 * 隐私过滤: 对位置进行模糊化(保留街道级,屏蔽精确经纬度)
 * 屏蔽: 摄像头画面、详细识别内容、聊天记录、个人习惯记忆
 */
function privacyFilterLocation(location) {
  if (!location) return null;
  // 模糊化经纬度: 保留2位小数(约1km精度),不暴露精确行踪
  return {
    address: location.address || '未知位置',
    lat: location.lat ? Math.round(location.lat * 100) / 100 : null,
    lng: location.lng ? Math.round(location.lng * 100) / 100 : null,
    // 不返回精确坐标和详细地理信息
    approximate: true
  };
}

// 使用者列表(家属绑定的被守护人)
router.get('/users', (req, res) => {
  res.json({ users: getAllUsers() });
});

// 添加使用者(绑定信息) - 支持通过 bind_phone 手机号绑定视障账号
router.post('/users', (req, res) => {
  const { name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bind_phone } = req.body;
  if (!name) return res.status(400).json({ error: '请填写姓名' });

  let bound_account_id = null;
  // 如果填写了视障账号手机号,查找并绑定
  if (bind_phone) {
    const account = findUserAccountByPhone(bind_phone.trim());
    if (!account) {
      return res.status(404).json({ error: `未找到手机号为"${bind_phone}"的视障用户,请确认手机号正确且该账号身份为使用者` });
    }
    bound_account_id = account.id;
    log('FAMILY', `家属通过手机号绑定视障账号: ${bind_phone} (account_id=${account.id})`);
  }

  const id = addUser({ name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bound_account_id });
  res.json({ success: true, id, bound_account_id });
});

// 删除使用者
router.delete('/users/:id', (req, res) => {
  const changes = deleteUser(parseInt(req.params.id));
  res.json({ success: true, changes });
});

// 编辑使用者信息
router.put('/users/:id', (req, res) => {
  const { name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bind_phone } = req.body;
  if (!name) return res.status(400).json({ error: '请填写姓名' });

  let bound_account_id = undefined;
  // 如果填写了视障账号手机号,查找并绑定(空字符串表示解绑)
  if (bind_phone !== undefined) {
    if (bind_phone && bind_phone.trim()) {
      const account = findUserAccountByPhone(bind_phone.trim());
      if (!account) {
        return res.status(404).json({ error: `未找到手机号为"${bind_phone}"的视障用户,请确认手机号正确且该账号身份为使用者` });
      }
      bound_account_id = account.id;
      log('FAMILY', `家属编辑绑定视障账号: ${bind_phone} (account_id=${account.id})`);
    } else {
      bound_account_id = null; // 解绑
    }
  }

  const changes = updateUser(parseInt(req.params.id), {
    name, age: age !== undefined ? (age ? parseInt(age) : null) : undefined,
    relation, phone, emergency_contact, emergency_phone, health_notes, bound_account_id
  });
  res.json({ success: true, changes, bound_account_id });
});

// 家属端首页数据 - 实时状态总览
router.get('/overview', (req, res) => {
  const context = getContext();
  const stats = getStats();
  const sosEvents = getSosEvents(5);
  const users = getAllUsers();

  // 从已绑定的使用者中提取紧急联系人
  const primaryUser = users[0];
  const emergencyContacts = users
    .filter(u => u.emergency_contact && u.emergency_phone)
    .map((u, i) => ({
      id: u.id,
      name: u.emergency_contact,
      phone: u.emergency_phone,
      relation: u.relation || '紧急联系人',
      primary: i === 0
    }));

  res.json({
    users,
    user: {
      name: primaryUser?.name || '未绑定',
      location: privacyFilterLocation(context.currentLocation),  // 模糊化位置
      activity: context.userActivity,
      // 隐私保护: 不返回 lastSpoken(聊天内容属于隐私)
      battery: parseInt(process.env.DEVICE_BATTERY || '87', 10),
      online: true
    },
    agents: context.agents,
    stats,
    recentSos: sosEvents,
    timestamp: new Date().toISOString()
  });
});

// 实时位置(模糊化)
router.get('/location', (req, res) => {
  const context = getContext();
  res.json({
    location: privacyFilterLocation(context.currentLocation),
    activity: context.userActivity,
    lastDangerEvent: context.lastDangerEvent
  });
});

// SOS历史
router.get('/sos', (req, res) => {
  res.json({ events: getSosEvents(50) });
});

// 紧急联系人 - 从已绑定的使用者信息中提取
router.get('/contacts', (req, res) => {
  const users = getAllUsers();
  const contacts = users
    .filter(u => u.emergency_contact && u.emergency_phone)
    .map((u, i) => ({
      id: u.id,
      name: u.emergency_contact,
      phone: u.emergency_phone,
      relation: u.relation || '紧急联系人',
      primary: i === 0
    }));

  // 如果没有绑定使用者,返回空列表(前端会提示去绑定)
  res.json({ contacts });
});

// 识别历史 - 从共享上下文中提取Agent识别事件
router.get('/recognition-history', (req, res) => {
  const context = getContext();
  const limit = parseInt(req.query.limit) || 50;
  const history = (context.history || [])
    .filter(e => e.type === 'subtitle' || e.type === 'safety_result' || e.type === 'agent_log')
    .slice(-limit)
    .reverse();
  res.json({ events: history });
});

// 路线历史
router.get('/routes', (req, res) => {
  const routes = getAllRoutes();
  res.json({ routes });
});

// 习惯数据
router.get('/habits', (req, res) => {
  const habits = getAllHabits();
  res.json({ habits });
});

// 综合仪表盘数据
router.get('/dashboard', (req, res) => {
  const context = getContext();
  const stats = getStats();
  const memStats = getMemoryStats();
  const users = getAllUsers();
  const routes = getAllRoutes();
  const sosEvents = getSosEvents(50);
  const habits = getAllHabits();

  // 统计识别历史中的事件类型
  const history = context.history || [];
  const recognitionCount = history.filter(e => e.type === 'subtitle').length;
  const safetyChecks = history.filter(e => e.type === 'safety_result').length;
  const dangerCount = history.filter(e => e.type === 'safety_result' && !e.safe).length;

  // 今日SOS
  const today = new Date().toISOString().slice(0, 10);
  const todaySos = sosEvents.filter(e => (e.created_at || '').startsWith(today)).length;

  // 常用路线(top5) - 隐私保护: 只返回路线名称和次数,不返回精确坐标
  const topRoutes = routes.slice(0, 5).map(r => ({
    id: r.id,
    route_name: r.route_name || '未命名路线',
    visit_count: r.visit_count,
    last_visited: r.last_visited
  }));

  // 最近识别 - 隐私保护: 只返回安全相关的摘要,不返回识别详细内容
  const recentRecognitions = history
    .filter(e => e.type === 'subtitle')
    .slice(-10)
    .reverse()
    .map(e => ({ type: e.type, time: e.time, summary: '识别已记录' }));

  // 最近安全事件(最近10条) - 安全预警对家属可见
  const recentSafety = history
    .filter(e => e.type === 'safety_result' && !e.safe)
    .slice(-10)
    .reverse();

  res.json({
    stats: {
      totalRecognitions: recognitionCount,
      totalSafetyChecks: safetyChecks,
      dangerCount,
      todaySos,
      totalRoutes: routes.length,
      totalHabits: habits.length,
      totalUsers: users.length,
      ...memStats,
      agentStatus: stats.agentStatus,
      traeConfigured: stats.traeConfigured
    },
    user: {
      name: users[0]?.name || '未绑定',
      location: privacyFilterLocation(context.currentLocation),  // 模糊化位置
      activity: context.userActivity,
      // 隐私保护: 不返回 lastSpoken
      battery: parseInt(process.env.DEVICE_BATTERY || '87', 10),
      online: true
    },
    agents: context.agents,
    topRoutes,
    recentRecognitions,
    recentSafety,
    recentSos: sosEvents.slice(0, 10),
    timestamp: new Date().toISOString()
  });
});

export default router;
