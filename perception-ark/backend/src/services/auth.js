import jwt from 'jsonwebtoken';
import { getAccountById } from './memory-store.js';

const JWT_SECRET = process.env.JWT_SECRET || 'perception-ark-2026-secret-key';
const JWT_EXPIRES = '7d';

/**
 * 生成 JWT Token
 */
export function generateToken(account) {
  return jwt.sign(
    { id: account.id, username: account.username, role: account.role, userId: account.user_id },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/**
 * JWT 验证中间件
 * 从 Authorization: Bearer <token> 提取并验证token
 * 验证通过后 req.user = { id, username, role, userId }
 */
export function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未登录,请先登录' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: '登录已过期,请重新登录' });
  }
}

/**
 * 可选认证中间件
 * 有token则解析,无token也放行(用于兼容未登录访问的接口)
 */
export function authOptional(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (err) {
      // token无效也不阻断,只是req.user为undefined
    }
  }
  next();
}

export { JWT_SECRET };
