import { Router } from 'express';
import { getSosEvents, getMemoryStats, getAllRoutes, searchFaces, getAllUsers, addUser, deleteUser, updateUser, getAllHabits, findUserAccountByPhone, syncFamilyBindingFromFamilySide, getAccountById, getFamilyBoundVisuallyImpairedUsers, confirmFamilyBinding, rejectFamilyBinding, getPendingConfirmFamilyBindings, updateFamilyBinding, removeFamilyBindingByFamily } from '../services/memory-store.js';
import { getContext, getStats } from '../agents/orchestrator.js';
import { authRequired } from '../services/auth.js';
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
// 合并两个来源: 1.家属主动添加的(users表) 2.视障端邀请自动建立的(family_bindings反向查询)
router.get('/users', authRequired, async (req, res) => {
  const manualUsers = await getAllUsers(req.user.id);
  // 反向查询: 通过family_bindings自动绑定的视障人员(视障端发起邀请,家属注册后自动激活)
  const invitedUsers = await getFamilyBoundVisuallyImpairedUsers(req.user.id);
  // 合并去重(以bound_account_id为键)
  const seenAccountIds = new Set(manualUsers.filter(u => u.bound_account_id).map(u => u.bound_account_id));
  const merged = [...manualUsers, ...invitedUsers.filter(u => !seenAccountIds.has(u.bound_account_id))];
  res.json({ users: merged });
});

// 添加使用者(绑定信息) - 支持通过 bind_phone 手机号绑定视障账号
router.post('/users', authRequired, async (req, res) => {
  const { name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bind_phone } = req.body;
  if (!name) return res.status(400).json({ error: '请填写称呼' });

  let bound_account_id = null;
  // 如果填写了视障账号手机号,查找并绑定
  if (bind_phone) {
    const account = await findUserAccountByPhone(bind_phone.trim());
    if (!account) {
      return res.status(404).json({ error: `该账号未注册（手机号${bind_phone}），请确认手机号正确且该账号身份为使用者` });
    }
    bound_account_id = account.id;
    log('FAMILY', `家属通过手机号绑定视障账号: ${bind_phone} (account_id=${account.id})`);
  }

  const id = await addUser({ name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bound_account_id, family_account_id: req.user.id });

  // 反向同步到视障端family_bindings表(新机制: pending 等待视障确认 / autoActivated 双方互邀请直接 active)
  let bindStatus = 'none';
  let bindMessage = null;
  if (bound_account_id && req.user?.id) {
    const familyAccount = await getAccountById(req.user.id);
    if (familyAccount?.phone) {
      const syncResult = await syncFamilyBindingFromFamilySide(
        bound_account_id, req.user.id, familyAccount.phone,
        familyAccount.nickname || familyAccount.username, relation
      );
      if (syncResult.success) {
        bindStatus = syncResult.status;
        if (syncResult.autoActivated) {
          bindMessage = '双方互邀请,绑定成功';
        } else if (syncResult.status === 'pending') {
          bindMessage = '已发送邀请,等待视障用户确认后绑定生效';
        } else if (syncResult.status === 'active') {
          bindMessage = '绑定成功';
        }
        log('FAMILY', `反向同步家属绑定: 视障账号${bound_account_id} ← 家属${req.user.id} status=${syncResult.status}`);
      } else {
        log('FAMILY', `反向同步家属绑定失败: ${syncResult.error}`, 'warn');
      }
    }
  }

  res.json({
    success: true,
    id,
    bound_account_id,
    bindStatus,
    needsConfirm: bindStatus === 'pending',
    autoActivated: bindStatus === 'active' && bindMessage === '双方互邀请,绑定成功',
    message: bindMessage
  });
});

// 删除使用者
router.delete('/users/:id', authRequired, async (req, res) => {
  try {
    const idParam = req.params.id;
    // 处理通过邀请绑定的用户(id格式为 bind_xxx)
    if (idParam.startsWith('bind_')) {
      const bindingId = parseInt(idParam.slice(6));
      if (!bindingId) {
        return res.status(400).json({ success: false, error: '无效的绑定ID' });
      }
      const ok = await removeFamilyBindingByFamily(bindingId, req.user.id);
      if (!ok) {
        return res.status(404).json({ success: false, error: '绑定记录不存在或无权删除' });
      }
      log('FAMILY', `家属删除邀请绑定: binding_id=${bindingId}`);
      return res.json({ success: true, changes: 1 });
    }
    // 普通用户(手动添加的,存在users表中)
    const changes = await deleteUser(parseInt(idParam));
    res.json({ success: true, changes });
  } catch (err) {
    log('FAMILY', `删除使用者失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 家属端待确认列表(视障端发起的邀请,等待家属确认)
 * GET /api/family/pending-confirm
 */
router.get('/pending-confirm', authRequired, async (req, res) => {
  try {
    const list = await getPendingConfirmFamilyBindings(req.user.id);
    res.json({ success: true, list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 家属确认视障端发起的邀请
 * POST /api/family/confirm/:bindingId
 */
router.post('/confirm/:bindingId', authRequired, async (req, res) => {
  try {
    const bindingId = parseInt(req.params.bindingId);
    if (!bindingId) {
      return res.status(400).json({ success: false, error: '无效的绑定ID' });
    }
    const result = await confirmFamilyBinding(bindingId, req.user.id, 'family');
    if (!result.success) {
      return res.status(400).json(result);
    }
    log('FAMILY', `家属 ${req.user.username} 确认视障邀请: bindingId=${bindingId}`);
    res.json({ success: true, message: '已确认绑定', status: result.status });
  } catch (err) {
    log('FAMILY', `家属确认邀请失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 家属拒绝视障端发起的邀请
 * POST /api/family/reject/:bindingId
 */
router.post('/reject/:bindingId', authRequired, async (req, res) => {
  try {
    const bindingId = parseInt(req.params.bindingId);
    if (!bindingId) {
      return res.status(400).json({ success: false, error: '无效的绑定ID' });
    }
    const result = await rejectFamilyBinding(bindingId, req.user.id, 'family');
    if (!result.success) {
      return res.status(400).json(result);
    }
    log('FAMILY', `家属 ${req.user.username} 拒绝视障邀请: bindingId=${bindingId}`);
    res.json({ success: true, message: '已拒绝邀请' });
  } catch (err) {
    log('FAMILY', `家属拒绝邀请失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// 编辑使用者信息
router.put('/users/:id', authRequired, async (req, res) => {
  try {
    const { name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bind_phone } = req.body;
    if (!name) return res.status(400).json({ error: '请填写称呼' });

    const idParam = req.params.id;

    // 处理通过邀请绑定的用户(id格式为 bind_xxx)
    // 这类用户的信息存储在family_bindings表中,仅能更新称呼(family_name)和关系(relation)
    if (idParam.startsWith('bind_')) {
      const bindingId = parseInt(idParam.slice(6));
      if (!bindingId) {
        return res.status(400).json({ success: false, error: '无效的绑定ID' });
      }
      const ok = await updateFamilyBinding(bindingId, {
        family_name: name,
        relation: relation || undefined
      });
      if (!ok) {
        return res.status(500).json({ success: false, error: '更新失败,绑定记录可能不存在' });
      }
      log('FAMILY', `家属编辑邀请绑定: binding_id=${bindingId} name="${name}"`);
      return res.json({ success: true, changes: 1 });
    }

    // 普通用户(手动添加的,存在users表中)
    let bound_account_id = undefined;
    // 如果填写了视障账号手机号,查找并绑定(空字符串表示解绑)
    if (bind_phone !== undefined) {
      if (bind_phone && bind_phone.trim()) {
        const account = await findUserAccountByPhone(bind_phone.trim());
        if (!account) {
          return res.status(404).json({ error: `该账号未注册（手机号${bind_phone}），请确认手机号正确且该账号身份为使用者` });
        }
        bound_account_id = account.id;
        log('FAMILY', `家属编辑绑定视障账号: ${bind_phone} (account_id=${account.id})`);

        // 反向同步: 在视障端的family_bindings表插入active记录
        if (req.user?.id) {
          const familyAccount = await getAccountById(req.user.id);
          if (familyAccount?.phone) {
            const syncResult = await syncFamilyBindingFromFamilySide(
              account.id,
              req.user.id,
              familyAccount.phone,
              familyAccount.nickname || familyAccount.username,
              relation
            );
            if (syncResult.success) {
              log('FAMILY', `编辑反向同步家属绑定成功: 视障账号${account.id} ← 家属${req.user.id}`);
            } else {
              log('FAMILY', `编辑反向同步家属绑定失败: ${syncResult.error}`, 'warn');
            }
          }
        }
      } else {
        bound_account_id = null; // 解绑
      }
    }

    const changes = await updateUser(parseInt(idParam), {
      name, age: age !== undefined ? (age ? parseInt(age) : null) : undefined,
      relation, phone, emergency_contact, emergency_phone, health_notes, bound_account_id
    });
    res.json({ success: true, changes, bound_account_id });
  } catch (err) {
    log('FAMILY', `编辑使用者失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// 家属端首页数据 - 实时状态总览
// 合并users表和family_bindings反向查询,确保视障端邀请的绑定也能显示
router.get('/overview', authRequired, async (req, res) => {
  const context = getContext();
  const stats = await getStats();
  const sosEvents = await getSosEvents(5);
  const manualUsers = await getAllUsers(req.user.id);
  const invitedUsers = await getFamilyBoundVisuallyImpairedUsers(req.user.id);
  // 合并去重
  const seenAccountIds = new Set(manualUsers.filter(u => u.bound_account_id).map(u => u.bound_account_id));
  const users = [...manualUsers, ...invitedUsers.filter(u => !seenAccountIds.has(u.bound_account_id))];

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

// 实时精确位置(仅家属监护人可见,用于内嵌地图显示)
// 家属作为监护人,需要查看视障人员的精确位置以提供及时救助
router.get('/precise-location', authRequired, (req, res) => {
  const context = getContext();
  if (!context.currentLocation) {
    return res.json({ location: null, activity: context.userActivity, timestamp: new Date().toISOString() });
  }
  res.json({
    location: {
      lat: context.currentLocation.lat,
      lng: context.currentLocation.lng,
      address: context.currentLocation.address || '未知位置',
      province: context.currentLocation.province || '',
      city: context.currentLocation.city || '',
      district: context.currentLocation.district || ''
    },
    activity: context.userActivity,
    lastDangerEvent: context.lastDangerEvent,
    lastUpdate: context.currentLocation.timestamp || null,
    timestamp: new Date().toISOString()
  });
});

// SOS历史
router.get('/sos', async (req, res) => {
  res.json({ events: await getSosEvents(50) });
});

// 紧急联系人 - 从已绑定的使用者信息中提取
router.get('/contacts', authRequired, async (req, res) => {
  const users = await getAllUsers(req.user.id);
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
router.get('/routes', async (req, res) => {
  const routes = await getAllRoutes();
  res.json({ routes });
});

// 习惯数据
router.get('/habits', async (req, res) => {
  const habits = await getAllHabits();
  res.json({ habits });
});

// 综合仪表盘数据
router.get('/dashboard', authRequired, async (req, res) => {
  const context = getContext();
  const stats = await getStats();
  const memStats = await getMemoryStats();
  const manualUsers = await getAllUsers(req.user.id);
  // 反向查询: 通过family_bindings自动绑定的视障人员(视障端发起邀请,家属注册后自动激活)
  const invitedUsers = await getFamilyBoundVisuallyImpairedUsers(req.user.id);
  // 合并去重(以bound_account_id为键),与/overview和/users接口保持一致
  const seenAccountIds = new Set(manualUsers.filter(u => u.bound_account_id).map(u => u.bound_account_id));
  const users = [...manualUsers, ...invitedUsers.filter(u => !seenAccountIds.has(u.bound_account_id))];
  const routes = await getAllRoutes();
  const sosEvents = await getSosEvents(50);
  const habits = await getAllHabits();

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
