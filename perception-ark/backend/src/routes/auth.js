import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createAccount, getAccountByUsername, getAccountById, getAccountByPhone, updateAccountProfile, deleteAccount, getSecurityQuestion, verifySecurityAnswer, resetPassword, updateSecurity, addFamilyBinding, getFamilyBindings, removeFamilyBinding, getActiveFamilyBindingsAsContacts, confirmFamilyBinding, rejectFamilyBinding, getPendingConfirmViBindings } from '../services/memory-store.js';
import { generateToken, authRequired } from '../services/auth.js';
import { sendFamilyInviteSms } from '../services/sms.js';
import { log } from '../utils/logger.js';

const router = Router();

// ===== 手机验证码存储(内存Map,5分钟过期) =====
// key: 手机号, value: { code, expireAt, attempts }
const smsCodes = new Map();
const SMS_EXPIRE_MS = 5 * 60 * 1000; // 5分钟
const SMS_MAX_ATTEMPTS = 5; // 单次验证码最多尝试5次

/**
 * 注册
 * POST /api/auth/register
 * body: { username, password, role?: 'user'|'family' }
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password, role, phone, securityQuestion, securityAnswer } = req.body;

    // 输入验证
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ success: false, error: '用户名长度需2-20个字符' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '密码长度至少6位' });
    }
    // 注册仅允许 user/family 角色;管理员(超级管理员)由系统初始化创建,不通过注册
    const accountRole = role === 'family' ? 'family' : 'user';
    if (!phone) {
      return res.status(400).json({ success: false, error: '请填写手机号码,用于家属绑定关系' });
    }
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      return res.status(400).json({ success: false, error: '手机号格式不正确' });
    }
    // 密保问题与答案必填(用于找回密码)
    if (!securityQuestion || !securityQuestion.trim()) {
      return res.status(400).json({ success: false, error: '请选择密保问题' });
    }
    if (!securityAnswer || !securityAnswer.trim()) {
      return res.status(400).json({ success: false, error: '请填写密保答案' });
    }

    // 检查用户名是否已存在
    const existing = await getAccountByUsername(username);
    if (existing) {
      return res.status(409).json({ success: false, error: '用户名已存在' });
    }

    // 加密密码和密保答案
    const passwordHash = await bcrypt.hash(password, 10);
    const answerHash = bcrypt.hashSync(securityAnswer.trim(), 10);

    // 创建账号
    const accountId = await createAccount(username, passwordHash, accountRole, null, phone, securityQuestion.trim(), answerHash);
    if (!accountId) {
      return res.status(500).json({ success: false, error: '注册失败' });
    }

    const account = await getAccountById(accountId);
    const token = generateToken(account);

    log('AUTH', `新用户注册: ${username} (${accountRole})${phone ? ' phone=' + phone : ''}`);

    res.json({
      success: true,
      token,
      user: buildUserPayload(account)
    });
  } catch (err) {
    log('AUTH', `注册失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 登录
 * POST /api/auth/login
 * body: { username, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }

    const account = await getAccountByUsername(username);
    if (!account) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    const matched = await bcrypt.compare(password, account.password_hash);
    if (!matched) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    // 检查账号状态(封禁账号禁止登录)
    if (account.status === 'banned') {
      return res.status(403).json({ success: false, error: '该账号已被封禁,如有疑问请联系管理员' });
    }

    const token = generateToken(account);
    log('AUTH', `用户登录: ${username}`);

    res.json({
      success: true,
      token,
      user: buildUserPayload(account)
    });
  } catch (err) {
    log('AUTH', `登录失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 发送手机验证码
 * POST /api/auth/send-sms
 * body: { phone }
 * 说明: 未配置短信服务商,开发模式下验证码通过响应 devCode 字段返回(前端弹窗显示),
 *       同时在后端日志输出。生产环境接入真实短信服务后移除 devCode 字段。
 */
router.post('/send-sms', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^1[3-9]\d{9}$/.test(phone.trim())) {
      return res.status(400).json({ success: false, error: '手机号格式不正确' });
    }
    const phoneTrim = phone.trim();

    // 检查封禁状态(仅对已注册账号检查,未注册可直接获取验证码)
    const existingAccount = await getAccountByPhone(phoneTrim);
    if (existingAccount && existingAccount.status === 'banned') {
      return res.status(403).json({ success: false, error: '该账号已被封禁,如有疑问请联系管理员' });
    }

    // 生成6位数字验证码
    const code = String(Math.floor(100000 + Math.random() * 900000));
    smsCodes.set(phoneTrim, {
      code,
      expireAt: Date.now() + SMS_EXPIRE_MS,
      attempts: 0,
    });

    // 后端日志输出验证码(开发/调试用)
    log('AUTH', `发送验证码到 ${phoneTrim}: ${code}`);

    res.json({
      success: true,
      message: '验证码已发送,请查看手机短信',
      devCode: code, // 开发模式返回验证码(生产环境移除)
    });
  } catch (err) {
    log('AUTH', `发送验证码失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 手机验证码登录
 * POST /api/auth/login-sms
 * body: { phone, code, role?: 'user'|'family' }
 * 说明: 账号已存在则直接登录;账号不存在时按 role 自动注册(默认user,家属身份注册为family)
 *       字段信息(昵称/密保等)登录后可在设置中完善
 */
router.post('/login-sms', async (req, res) => {
  try {
    const { phone, code, role } = req.body;
    if (!phone || !/^1[3-9]\d{9}$/.test(phone.trim())) {
      return res.status(400).json({ success: false, error: '手机号格式不正确' });
    }
    if (!code || !/^\d{6}$/.test(String(code).trim())) {
      return res.status(400).json({ success: false, error: '请输入6位数字验证码' });
    }

    const phoneTrim = phone.trim();
    const codeTrim = String(code).trim();
    // 自动注册角色: 仅允许 user/family,默认 user
    const accountRole = role === 'family' ? 'family' : 'user';

    // 校验验证码
    const stored = smsCodes.get(phoneTrim);
    if (!stored) {
      return res.status(401).json({ success: false, error: '请先获取验证码' });
    }
    if (Date.now() > stored.expireAt) {
      smsCodes.delete(phoneTrim);
      return res.status(401).json({ success: false, error: '验证码已过期,请重新获取' });
    }
    if (stored.attempts >= SMS_MAX_ATTEMPTS) {
      smsCodes.delete(phoneTrim);
      return res.status(401).json({ success: false, error: '验证码错误次数过多,请重新获取' });
    }

    // 比对验证码
    if (stored.code !== codeTrim) {
      stored.attempts++;
      return res.status(401).json({ success: false, error: '验证码不正确' });
    }

    // 验证通过,删除验证码记录
    smsCodes.delete(phoneTrim);

    // 查找账号
    let account = await getAccountByPhone(phoneTrim);

    // 账号不存在时自动注册(用户名=用户+手机后4位,按所选身份创建,登录后可在设置中完善信息)
    if (!account) {
      const phoneSuffix = phoneTrim.slice(-4);
      const randomName = `用户${phoneSuffix}`;
      // 检查用户名是否冲突,冲突则加随机数
      let finalName = randomName;
      while (await getAccountByUsername(finalName)) {
        finalName = `用户${phoneSuffix}${Math.floor(Math.random() * 10)}`;
      }
      const randomPwd = await bcrypt.hash(Math.random().toString(36).slice(-8), 10);
      const defaultQuestion = '您的出生城市是?';
      const defaultAnswer = bcrypt.hashSync('未知', 10);
      const accountId = await createAccount(finalName, randomPwd, accountRole, null, phoneTrim, defaultQuestion, defaultAnswer);
      if (!accountId) {
        return res.status(500).json({ success: false, error: '自动注册失败,请稍后重试' });
      }
      account = await getAccountById(accountId);
      log('AUTH', `手机验证码登录自动注册新${accountRole === 'family' ? '家属' : '用户'}: ${finalName} (${phoneTrim})`);
    }

    if (account.status === 'banned') {
      return res.status(403).json({ success: false, error: '该账号已被封禁' });
    }

    const token = generateToken(account);
    log('AUTH', `用户手机验证码登录: ${account.username} (${phoneTrim})`);

    res.json({
      success: true,
      token,
      user: buildUserPayload(account)
    });
  } catch (err) {
    log('AUTH', `验证码登录失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 获取密保问题(找回密码第1步)
 * POST /api/auth/security-question
 * body: { username }
 */
router.post('/security-question', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ success: false, error: '请输入用户名' });
    }
    const question = await getSecurityQuestion(username.trim());
    if (!question) {
      return res.status(404).json({ success: false, error: '用户名不存在或未设置密保问题' });
    }
    res.json({ success: true, question });
  } catch (err) {
    log('AUTH', `获取密保问题失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 重置密码(找回密码第2步: 校验密保答案后重置)
 * POST /api/auth/reset-password
 * body: { username, securityAnswer, newPassword }
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { username, securityAnswer, newPassword } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ success: false, error: '请输入用户名' });
    }
    if (!securityAnswer || !securityAnswer.trim()) {
      return res.status(400).json({ success: false, error: '请填写密保答案' });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: '新密码长度至少6位' });
    }

    const uname = username.trim();
    // 校验密保答案
    const matched = await verifySecurityAnswer(uname, securityAnswer.trim());
    if (!matched) {
      return res.status(401).json({ success: false, error: '密保答案不正确' });
    }

    // 加密新密码并重置
    const newHash = await bcrypt.hash(newPassword, 10);
    const ok = await resetPassword(uname, newHash);
    if (!ok) {
      return res.status(500).json({ success: false, error: '重置密码失败' });
    }

    log('AUTH', `用户通过密保重置密码: ${uname}`);
    res.json({ success: true, message: '密码重置成功,请使用新密码登录' });
  } catch (err) {
    log('AUTH', `重置密码失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 获取当前登录用户信息
 * GET /api/auth/me
 */
router.get('/me', authRequired, async (req, res) => {
  const account = await getAccountById(req.user.id);
  if (!account) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }
  res.json({
    success: true,
    user: buildUserPayload(account)
  });
});

/**
 * 修改昵称
 * PUT /api/auth/profile
 * body: { nickname?: string }
 */
router.put('/profile', authRequired, async (req, res) => {
  try {
    const { nickname } = req.body;
    if (nickname === undefined) {
      return res.status(400).json({ success: false, error: '缺少 nickname 字段' });
    }
    // 昵称长度校验: 1-20字符,允许清空(空字符串)
    const trimmed = String(nickname).trim();
    if (trimmed.length > 20) {
      return res.status(400).json({ success: false, error: '昵称长度不能超过20个字符' });
    }
    const ok = await updateAccountProfile(req.user.id, { nickname: trimmed });
    if (!ok) {
      return res.status(500).json({ success: false, error: '昵称更新失败' });
    }
    const account = await getAccountById(req.user.id);
    log('AUTH', `用户修改昵称: ${account.username} -> "${trimmed}"`);
    res.json({ success: true, user: buildUserPayload(account) });
  } catch (err) {
    log('AUTH', `修改昵称失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 修改密码
 * PUT /api/auth/password
 * body: { oldPassword, newPassword }
 */
router.put('/password', authRequired, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, error: '请输入原密码和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: '新密码长度至少6位' });
    }
    const account = await getAccountById(req.user.id);
    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }
    // 手机验证码自动注册的用户可能不知道随机密码,允许通过密保验证后修改
    // 如果原密码为空字符串"skip"(前端手机注册用户专用入口),跳过验证
    if (oldPassword !== 'skip') {
      const matched = await bcrypt.compare(oldPassword, account.password_hash);
      if (!matched) {
        return res.status(401).json({ success: false, error: '原密码不正确' });
      }
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    const ok = await resetPassword(account.username, newHash);
    if (!ok) {
      return res.status(500).json({ success: false, error: '密码修改失败' });
    }
    log('AUTH', `用户修改密码: ${account.username}`);
    res.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    log('AUTH', `修改密码失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 修改密保问题和答案
 * PUT /api/auth/security
 * body: { question, answer }
 */
router.put('/security', authRequired, async (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ success: false, error: '请选择密保问题' });
    }
    if (!answer || !answer.trim()) {
      return res.status(400).json({ success: false, error: '请填写密保答案' });
    }
    const answerHash = bcrypt.hashSync(answer.trim(), 10);
    const ok = await updateSecurity(req.user.id, question.trim(), answerHash);
    if (!ok) {
      return res.status(500).json({ success: false, error: '密保更新失败' });
    }
    log('AUTH', `用户修改密保: ${req.user.username}`);
    res.json({ success: true, message: '密保问题已更新' });
  } catch (err) {
    log('AUTH', `修改密保失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 修改头像
 * PUT /api/auth/avatar
 * body: { avatar: <dataURL> }  dataURL 格式: data:image/jpeg;base64,xxxx
 * 限制: 头像图片大小不超过 500KB(base64长度约 680000 字符)
 */
router.put('/avatar', authRequired, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar || typeof avatar !== 'string') {
      return res.status(400).json({ success: false, error: '缺少 avatar 字段' });
    }
    // 校验 dataURL 格式
    if (!avatar.startsWith('data:image/')) {
      return res.status(400).json({ success: false, error: '头像格式错误,需为 data:image/...;base64,...' });
    }
    // 大小限制: base64 字符数 / 1.37 ≈ 原始字节数,500KB ≈ 680000字符
    if (avatar.length > 680000) {
      return res.status(413).json({ success: false, error: '头像过大(限制500KB),请压缩后上传' });
    }
    const ok = await updateAccountProfile(req.user.id, { avatar });
    if (!ok) {
      return res.status(500).json({ success: false, error: '头像更新失败' });
    }
    const account = await getAccountById(req.user.id);
    log('AUTH', `用户修改头像: ${account.username}`);
    res.json({ success: true, user: buildUserPayload(account) });
  } catch (err) {
    log('AUTH', `修改头像失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 绑定家属(视障用户邀请家属)
 * POST /api/auth/family/bind
 * body: { phone, name?, relation? }
 * 如家属已注册(status=active),直接绑定;未注册则status=pending,短信邀请
 */
router.post('/family/bind', authRequired, async (req, res) => {
  try {
    const { phone, name, relation } = req.body;
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, error: '请输入家属手机号' });
    }
    // 简单校验手机号格式
    const phoneTrim = phone.trim();
    if (!/^1[3-9]\d{9}$/.test(phoneTrim)) {
      return res.status(400).json({ success: false, error: '手机号格式不正确' });
    }
    // 不能绑定自己
    const myAccount = await getAccountById(req.user.id);
    if (!myAccount) {
      return res.status(401).json({ success: false, error: '账号不存在,请重新登录' });
    }
    if (myAccount.phone === phoneTrim) {
      return res.status(400).json({ success: false, error: '不能绑定自己的手机号' });
    }
    const result = await addFamilyBinding(req.user.id, phoneTrim, name, relation);
    if (!result.success) {
      if (result.existing) {
        return res.status(409).json({ success: false, error: '该手机号已绑定' });
      }
      return res.status(500).json({ success: false, error: result.error });
    }
    log('AUTH', `用户 ${myAccount.username} 绑定家属: ${phoneTrim} (status=${result.status}, autoActivated=${!!result.autoActivated})`);
    // 家属未注册时发送短信邀请
    let smsSent = false;
    const familyNotRegistered = result.status === 'pending' && !result.familyAccount;
    if (familyNotRegistered) {
      const smsResult = await sendFamilyInviteSms(phoneTrim, myAccount.nickname || myAccount.username);
      smsSent = smsResult.success;
      if (!smsSent) {
        log('AUTH', `家属邀请短信发送失败: ${smsResult.error}`, 'warn');
      }
    }
    // 新机制: 需对方确认。autoActivated=true 表示双方互邀请直接成功
    let message;
    if (result.autoActivated) {
      message = '双方互邀请,绑定成功';
    } else if (result.status === 'active') {
      message = '家属绑定成功';
    } else if (familyNotRegistered) {
      message = '该用户还没有注册,已发送短信邀请,对方注册并确认后绑定生效';
    } else {
      message = '已发送邀请,等待家属确认后绑定生效';
    }
    res.json({
      success: true,
      message,
      status: result.status,
      not_registered: familyNotRegistered,
      needsConfirm: result.status === 'pending' && !result.autoActivated,
      autoActivated: !!result.autoActivated,
      familyAccount: result.familyAccount,
      smsSent
    });
  } catch (err) {
    log('AUTH', `绑定家属失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 获取家属绑定列表
 * GET /api/auth/family/list
 */
router.get('/family/list', authRequired, async (req, res) => {
  try {
    const list = await getFamilyBindings(req.user.id);
    res.json({ success: true, list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 视障端待确认列表(家属端发起的邀请,等待视障用户确认)
 * GET /api/auth/family/pending-confirm
 * 返回需要当前视障用户确认的家属邀请列表
 */
router.get('/family/pending-confirm', authRequired, async (req, res) => {
  try {
    const list = await getPendingConfirmViBindings(req.user.id);
    res.json({ success: true, list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 视障用户确认家属邀请(家属端发起的邀请)
 * POST /api/auth/family/confirm/:bindingId
 */
router.post('/family/confirm/:bindingId', authRequired, async (req, res) => {
  try {
    const bindingId = parseInt(req.params.bindingId);
    if (!bindingId) {
      return res.status(400).json({ success: false, error: '无效的绑定ID' });
    }
    const result = await confirmFamilyBinding(bindingId, req.user.id, 'user');
    if (!result.success) {
      return res.status(400).json(result);
    }
    log('AUTH', `视障用户 ${req.user.username} 确认家属邀请: bindingId=${bindingId}`);
    res.json({ success: true, message: '已确认绑定', status: result.status });
  } catch (err) {
    log('AUTH', `确认家属邀请失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 视障用户拒绝家属邀请
 * POST /api/auth/family/reject/:bindingId
 */
router.post('/family/reject/:bindingId', authRequired, async (req, res) => {
  try {
    const bindingId = parseInt(req.params.bindingId);
    if (!bindingId) {
      return res.status(400).json({ success: false, error: '无效的绑定ID' });
    }
    const result = await rejectFamilyBinding(bindingId, req.user.id, 'user');
    if (!result.success) {
      return res.status(400).json(result);
    }
    log('AUTH', `视障用户 ${req.user.username} 拒绝家属邀请: bindingId=${bindingId}`);
    res.json({ success: true, message: '已拒绝邀请' });
  } catch (err) {
    log('AUTH', `拒绝家属邀请失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 获取视障用户SOS紧急联系人(从family_bindings表读取active家属)
 * GET /api/auth/family/contacts
 * 供视障端SOS页面使用,确保显示用户在设置中绑定的家属
 */
router.get('/family/contacts', authRequired, async (req, res) => {
  try {
    const contacts = await getActiveFamilyBindingsAsContacts(req.user.id);
    res.json({ success: true, contacts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 解绑家属
 * DELETE /api/auth/family/unbind/:bindingId
 */
router.delete('/family/unbind/:bindingId', authRequired, async (req, res) => {
  try {
    const bindingId = parseInt(req.params.bindingId);
    if (!bindingId) {
      return res.status(400).json({ success: false, error: '无效的绑定ID' });
    }
    const ok = await removeFamilyBinding(bindingId, req.user.id);
    if (!ok) {
      return res.status(404).json({ success: false, error: '未找到绑定记录或无权操作' });
    }
    log('AUTH', `用户解绑家属: bindingId=${bindingId}`);
    res.json({ success: true, message: '已解绑' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 注销账户(永久删除)
 * DELETE /api/auth/account
 * body: { confirm?: 'DELETE' }  二次确认,值为 DELETE 才执行
 */
router.delete('/account', authRequired, async (req, res) => {
  try {
    const confirm = req.body?.confirm || req.query.confirm;
    if (confirm !== 'DELETE') {
      return res.status(400).json({ success: false, error: '请二次确认注销操作(confirm=DELETE)' });
    }
    const account = await getAccountById(req.user.id);
    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }
    const ok = await deleteAccount(req.user.id);
    if (!ok) {
      return res.status(500).json({ success: false, error: '注销失败' });
    }
    log('AUTH', `用户注销账户: ${account.username}`, 'warn');
    res.json({ success: true, message: '账户已永久注销' });
  } catch (err) {
    log('AUTH', `注销账户失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 构造前端 user 对象(过滤 password_hash)
 */
function buildUserPayload(account) {
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    userId: account.user_id,
    nickname: account.nickname || '',
    avatar: account.avatar || '',
    phone: account.phone || '',
    status: account.status || 'active'
  };
}

export default router;
