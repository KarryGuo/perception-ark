import { Router } from 'express';
import { getSosEvents, getMemoryStats, getAllRoutes, searchFaces, getAllUsers, addUser, deleteUser, getAllHabits } from '../services/memory-store.js';
import { getContext, getStats } from '../agents/orchestrator.js';

const router = Router();

// 使用者列表(家属绑定的被守护人)
router.get('/users', (req, res) => {
  res.json({ users: getAllUsers() });
});

// 添加使用者(绑定信息)
router.post('/users', (req, res) => {
  const { name, age, relation, phone, emergency_contact, emergency_phone, health_notes } = req.body;
  if (!name) return res.status(400).json({ error: '请填写姓名' });
  const id = addUser({ name, age, relation, phone, emergency_contact, emergency_phone, health_notes });
  res.json({ success: true, id });
});

// 删除使用者
router.delete('/users/:id', (req, res) => {
  const changes = deleteUser(parseInt(req.params.id));
  res.json({ success: true, changes });
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
      location: context.currentLocation,
      activity: context.userActivity,
      lastSpoken: context.lastSpoken?.text || '暂无',
      battery: parseInt(process.env.DEVICE_BATTERY || '87', 10),
      online: true
    },
    agents: context.agents,
    stats,
    recentSos: sosEvents,
    timestamp: new Date().toISOString()
  });
});

// 实时位置
router.get('/location', (req, res) => {
  const context = getContext();
  res.json({
    location: context.currentLocation,
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

  // 常用路线(top5)
  const topRoutes = routes.slice(0, 5);

  // 最近识别(最近10条)
  const recentRecognitions = history
    .filter(e => e.type === 'subtitle')
    .slice(-10)
    .reverse();

  // 最近安全事件(最近10条)
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
      location: context.currentLocation,
      activity: context.userActivity,
      lastSpoken: context.lastSpoken?.text || '暂无',
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
