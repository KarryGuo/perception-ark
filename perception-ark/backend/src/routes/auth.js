import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createAccount, getAccountByUsername, getAccountById, updateAccountProfile, deleteAccount } from '../services/memory-store.js';
import { generateToken, authRequired } from '../services/auth.js';
import { log } from '../utils/logger.js';

const router = Router();

/**
 * 注册
 * POST /api/auth/register
 * body: { username, password, role?: 'user'|'family' }
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;

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

    // 检查用户名是否已存在
    const existing = getAccountByUsername(username);
    if (existing) {
      return res.status(409).json({ success: false, error: '用户名已存在' });
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);
    const accountRole = role === 'family' ? 'family' : 'user';

    // 创建账号
    const accountId = createAccount(username, passwordHash, accountRole);
    if (!accountId) {
      return res.status(500).json({ success: false, error: '注册失败' });
    }

    const account = getAccountById(accountId);
    const token = generateToken(account);

    log('AUTH', `新用户注册: ${username} (${accountRole})`);

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

    const account = getAccountByUsername(username);
    if (!account) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    const matched = await bcrypt.compare(password, account.password_hash);
    if (!matched) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
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
 * 获取当前登录用户信息
 * GET /api/auth/me
 */
router.get('/me', authRequired, (req, res) => {
  const account = getAccountById(req.user.id);
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
router.put('/profile', authRequired, (req, res) => {
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
    const ok = updateAccountProfile(req.user.id, { nickname: trimmed });
    if (!ok) {
      return res.status(500).json({ success: false, error: '昵称更新失败' });
    }
    const account = getAccountById(req.user.id);
    log('AUTH', `用户修改昵称: ${account.username} -> "${trimmed}"`);
    res.json({ success: true, user: buildUserPayload(account) });
  } catch (err) {
    log('AUTH', `修改昵称失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 修改头像
 * PUT /api/auth/avatar
 * body: { avatar: <dataURL> }  dataURL 格式: data:image/jpeg;base64,xxxx
 * 限制: 头像图片大小不超过 500KB(base64长度约 680000 字符)
 */
router.put('/avatar', authRequired, (req, res) => {
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
    const ok = updateAccountProfile(req.user.id, { avatar });
    if (!ok) {
      return res.status(500).json({ success: false, error: '头像更新失败' });
    }
    const account = getAccountById(req.user.id);
    log('AUTH', `用户修改头像: ${account.username}`);
    res.json({ success: true, user: buildUserPayload(account) });
  } catch (err) {
    log('AUTH', `修改头像失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 注销账户(永久删除)
 * DELETE /api/auth/account
 * body: { confirm?: 'DELETE' }  二次确认,值为 DELETE 才执行
 */
router.delete('/account', authRequired, (req, res) => {
  try {
    const confirm = req.body?.confirm || req.query.confirm;
    if (confirm !== 'DELETE') {
      return res.status(400).json({ success: false, error: '请二次确认注销操作(confirm=DELETE)' });
    }
    const account = getAccountById(req.user.id);
    if (!account) {
      return res.status(404).json({ success: false, error: '账号不存在' });
    }
    const ok = deleteAccount(req.user.id);
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
    avatar: account.avatar || ''
  };
}

export default router;
