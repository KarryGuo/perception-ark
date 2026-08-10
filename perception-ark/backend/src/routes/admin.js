import { Router } from 'express';
import { getAllAccounts, updateAccountStatus, addAdminLog, getAdminLogs, getMemoryStats, getSosEvents } from '../services/memory-store.js';
import { getContext, getStats } from '../agents/orchestrator.js';
import { authRequired } from '../services/auth.js';
import { log } from '../utils/logger.js';

const router = Router();

// 管理员权限校验中间件
function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '无管理员权限' });
  }
  next();
}

// 所有admin路由都需要登录+管理员权限
router.use(authRequired, adminRequired);

// 账号管理列表
router.get('/accounts', async (req, res) => {
  const accounts = await getAllAccounts();
  res.json({ accounts });
});

// 封禁账号
router.post('/accounts/:id/ban', async (req, res) => {
  const targetId = parseInt(req.params.id);
  const { reason } = req.body;
  if (targetId === req.user.id) {
    return res.status(400).json({ error: '不能封禁自己' });
  }
  const ok = await updateAccountStatus(targetId, 'banned');
  if (!ok) {
    return res.status(404).json({ error: '账号不存在' });
  }
  await addAdminLog({
    admin_id: req.user.id,
    target_account_id: targetId,
    action: 'ban',
    reason: reason || '违规操作',
    detail: `封禁账号ID=${targetId}`
  });
  log('ADMIN', `管理员 ${req.user.username} 封禁账号 ID=${targetId}, 原因: ${reason || '违规操作'}`, 'warn');
  res.json({ success: true });
});

// 解封账号
router.post('/accounts/:id/unban', async (req, res) => {
  const targetId = parseInt(req.params.id);
  const { reason } = req.body;
  const ok = await updateAccountStatus(targetId, 'active');
  if (!ok) {
    return res.status(404).json({ error: '账号不存在' });
  }
  await addAdminLog({
    admin_id: req.user.id,
    target_account_id: targetId,
    action: 'unban',
    reason: reason || '申诉通过',
    detail: `解封账号ID=${targetId}`
  });
  log('ADMIN', `管理员 ${req.user.username} 解封账号 ID=${targetId}`);
  res.json({ success: true });
});

// 管理员操作日志
router.get('/logs', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ logs: await getAdminLogs(limit) });
});

// 设备监测总览
router.get('/devices', async (req, res) => {
  const context = getContext();
  const stats = await getStats();
  const memStats = await getMemoryStats();
  const accounts = await getAllAccounts();
  const sosEvents = await getSosEvents(20);

  // 统计各角色账号数
  const userCount = accounts.filter(a => a.role === 'user').length;
  const familyCount = accounts.filter(a => a.role === 'family').length;
  const adminCount = accounts.filter(a => a.role === 'admin').length;
  const bannedCount = accounts.filter(a => a.status === 'banned').length;

  // 今日活跃统计: 今日有登录记录的账号数
  const today = new Date().toISOString().slice(0, 10);
  const activeTodayCount = accounts.filter(a => (a.last_login || '').startsWith(today)).length;

  // 今日SOS事件数
  const todaySosCount = sosEvents.filter(e => (e.created_at || '').startsWith(today)).length;

  // 历史事件总数(从context.history获取)
  const history = context.history || [];
  const totalRecognitions = history.filter(e => e.type === 'subtitle').length;
  const totalSafetyChecks = history.filter(e => e.type === 'safety_result').length;
  const totalDangerCount = history.filter(e => e.type === 'safety_result' && !e.safe).length;

  // Agent在线数
  const agentList = Object.entries(context.agents || {});
  const activeAgentCount = agentList.filter(([, info]) => info.active).length;

  // 在线设备数: 当前有WebSocket连接的设备(简化为context有位置信息则视为在线)
  const onlineDevices = context.currentLocation ? 1 : 0;

  res.json({
    accounts: {
      total: accounts.length,
      users: userCount,
      families: familyCount,
      admins: adminCount,
      banned: bannedCount,
      activeToday: activeTodayCount
    },
    devices: {
      online: true,
      battery: parseInt(process.env.DEVICE_BATTERY || '87', 10),
      location: context.currentLocation,
      activity: context.userActivity,
      onlineDevices
    },
    system: {
      ...memStats,
      agentStatus: stats.agentStatus,
      traeConfigured: stats.traeConfigured,
      mockMode: process.env.MOCK_MODE === 'true'
    },
    // 运营数据看板
    dashboard: {
      activeToday: activeTodayCount,
      onlineDevices,
      todaySos: todaySosCount,
      totalSos: sosEvents.length,
      totalRecognitions,
      totalSafetyChecks,
      totalDangerCount,
      activeAgents: activeAgentCount,
      totalAgents: agentList.length,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    },
    recentSos: sosEvents,
    agents: context.agents,
    timestamp: new Date().toISOString()
  });
});

export default router;
