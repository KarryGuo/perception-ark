import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createAccount, getAccountByUsername, getAccountById } from '../services/memory-store.js';
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
      user: { id: account.id, username: account.username, role: account.role, userId: account.user_id }
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
      user: { id: account.id, username: account.username, role: account.role, userId: account.user_id }
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
    user: { id: account.id, username: account.username, role: account.role, userId: account.user_id }
  });
});

export default router;
