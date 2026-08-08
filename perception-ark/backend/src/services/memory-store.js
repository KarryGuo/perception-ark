/**
 * 环境记忆 Agent 存储 (A05)
 * 使用SQLite存储路线、熟人、习惯
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { log } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 优先使用 DATA_DIR 环境变量(云平台持久化磁盘),否则使用本地 data 目录
let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // 验证可写权限(持久化磁盘挂载异常时会抛错)
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (e) {
  // 持久化磁盘不可写/未挂载时,降级到本地目录(非持久化,但保证服务启动)
  log(`[memory-store] DATA_DIR=${DATA_DIR} 不可用(${e.message}),降级到本地目录`);
  DATA_DIR = path.join(__dirname, '../../data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
log(`[memory-store] 数据目录: ${DATA_DIR}`);
const DB_PATH = path.join(DATA_DIR, 'memory.db');

let db = null;

export function initMemoryStore() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_lat REAL, start_lng REAL,
      end_lat REAL, end_lng REAL,
      route_name TEXT,
      visit_count INTEGER DEFAULT 1,
      last_visited TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      relation TEXT,
      description TEXT,
      visit_count INTEGER DEFAULT 1,
      last_seen TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_type TEXT,
      habit_key TEXT,
      habit_value TEXT,
      trigger_count INTEGER DEFAULT 1,
      last_triggered TEXT,
      created_at TEXT,
      UNIQUE(habit_type, habit_key)
    );

    CREATE TABLE IF NOT EXISTS sos_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      lat REAL, lng REAL,
      address TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      age INTEGER,
      relation TEXT,
      phone TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      health_notes TEXT,
      bound_at TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      user_id INTEGER,
      created_at TEXT,
      nickname TEXT,
      avatar TEXT,
      phone TEXT,
      status TEXT DEFAULT 'active',
      security_question TEXT,
      security_answer_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      target_account_id INTEGER,
      action TEXT NOT NULL,
      reason TEXT,
      detail TEXT,
      created_at TEXT
    );
  `);

  // 兼容旧库: 若 accounts 表缺少列,自动补列
  try {
    const cols = db.prepare("PRAGMA table_info(accounts)").all().map(c => c.name);
    if (!cols.includes('nickname')) {
      db.exec("ALTER TABLE accounts ADD COLUMN nickname TEXT");
      log('A05', 'accounts 表已补列 nickname');
    }
    if (!cols.includes('avatar')) {
      db.exec("ALTER TABLE accounts ADD COLUMN avatar TEXT");
      log('A05', 'accounts 表已补列 avatar');
    }
    if (!cols.includes('phone')) {
      db.exec("ALTER TABLE accounts ADD COLUMN phone TEXT");
      log('A05', 'accounts 表已补列 phone');
    }
    if (!cols.includes('status')) {
      db.exec("ALTER TABLE accounts ADD COLUMN status TEXT DEFAULT 'active'");
      log('A05', 'accounts 表已补列 status');
    }
    if (!cols.includes('security_question')) {
      db.exec("ALTER TABLE accounts ADD COLUMN security_question TEXT");
      log('A05', 'accounts 表已补列 security_question');
    }
    if (!cols.includes('security_answer_hash')) {
      db.exec("ALTER TABLE accounts ADD COLUMN security_answer_hash TEXT");
      log('A05', 'accounts 表已补列 security_answer_hash');
    }
  } catch (e) {
    log('A05', `accounts 表补列检查失败: ${e.message}`, 'warn');
  }

  // 兼容旧库: 若 users 表缺少 bound_account_id 列,自动补列(用于家属绑定视障账号)
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes('bound_account_id')) {
      db.exec("ALTER TABLE users ADD COLUMN bound_account_id INTEGER");
      log('A05', 'users 表已补列 bound_account_id');
    }
  } catch (e) {
    log('A05', `users 表补列检查失败: ${e.message}`, 'warn');
  }

  log('A05', '记忆数据库初始化完成');
  // 记忆库启动时为空,由用户使用过程中自然累积

  // 初始化默认超级管理员账号(注册页不提供管理员注册,需保证系统始终可登录管理后台)
  try {
    const existingAdmin = db.prepare("SELECT id FROM accounts WHERE username = 'admin' AND role = 'admin'").get();
    if (!existingAdmin) {
      const adminHash = bcrypt.hashSync('admin123', 10);
      db.prepare(`
        INSERT INTO accounts (username, password_hash, role, user_id, created_at, phone, status)
        VALUES (?, ?, 'admin', NULL, ?, NULL, 'active')
      `).run('admin', adminHash, new Date().toISOString());
      log('A05', '默认超级管理员账号已创建 (用户名: admin / 密码: admin123)');
    }
  } catch (e) {
    log('A05', `默认超级管理员初始化失败: ${e.message}`, 'warn');
  }
}

// ===== 账号管理(登录系统) =====
export function createAccount(username, passwordHash, role = 'user', userId = null, phone = null, securityQuestion = null, securityAnswerHash = null) {
  if (!db) return null;
  try {
    const result = db.prepare(`
      INSERT INTO accounts (username, password_hash, role, user_id, created_at, phone, security_question, security_answer_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(username, passwordHash, role, userId, new Date().toISOString(), phone || null, securityQuestion || null, securityAnswerHash || null);
    return result.lastInsertRowid;
  } catch (err) {
    if (err.message.includes('UNIQUE')) return null;
    throw err;
  }
}

export function getAccountByUsername(username) {
  if (!db) return null;
  return db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
}

export function getAccountById(id) {
  if (!db) return null;
  return db.prepare('SELECT id, username, role, user_id, created_at, nickname, avatar, phone, status, security_question FROM accounts WHERE id = ?').get(id);
}

/**
 * 获取账号的密保问题(仅返回问题文本,不含答案)
 */
export function getSecurityQuestion(username) {
  if (!db) return null;
  const row = db.prepare('SELECT security_question FROM accounts WHERE username = ?').get(username);
  if (!row || !row.security_question) return null;
  return row.security_question;
}

/**
 * 校验密保答案是否正确
 */
export function verifySecurityAnswer(username, answer) {
  if (!db || !answer) return false;
  const row = db.prepare('SELECT security_answer_hash FROM accounts WHERE username = ?').get(username);
  if (!row || !row.security_answer_hash) return false;
  return bcrypt.compareSync(answer, row.security_answer_hash);
}

/**
 * 重置账号密码
 */
export function resetPassword(username, newPasswordHash) {
  if (!db) return false;
  try {
    const result = db.prepare('UPDATE accounts SET password_hash = ? WHERE username = ?').run(newPasswordHash, username);
    return result.changes > 0;
  } catch (err) {
    log('A05', `重置密码失败: ${err.message}`, 'error');
    return false;
  }
}

/**
 * 更新密保问题和答案
 * @param {number} id 账户ID
 * @param {string} question 密保问题
 * @param {string} answerHash bcrypt哈希后的答案
 * @returns {boolean} 是否更新成功
 */
export function updateSecurity(id, question, answerHash) {
  if (!db) return false;
  try {
    const result = db.prepare('UPDATE accounts SET security_question = ?, security_answer_hash = ? WHERE id = ?').run(question, answerHash, id);
    return result.changes > 0;
  } catch (err) {
    log('A05', `更新密保失败: ${err.message}`, 'error');
    return false;
  }
}

/**
 * 更新账户资料(昵称/头像)
 * @param {number} id 账户ID
 * @param {{nickname?: string, avatar?: string|null}} fields
 * @returns {boolean} 是否更新成功
 */
export function updateAccountProfile(id, { nickname, avatar }) {
  if (!db) return false;
  try {
    const sets = [];
    const args = [];
    if (nickname !== undefined) { sets.push('nickname = ?'); args.push(nickname); }
    if (avatar !== undefined) { sets.push('avatar = ?'); args.push(avatar); }
    if (sets.length === 0) return false;
    args.push(id);
    const result = db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return result.changes > 0;
  } catch (err) {
    log('A05', `更新账户资料失败: ${err.message}`, 'error');
    return false;
  }
}

/**
 * 注销账户(永久删除)
 * @param {number} id 账户ID
 * @returns {boolean} 是否删除成功
 */
export function deleteAccount(id) {
  if (!db) return false;
  try {
    const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return result.changes > 0;
  } catch (err) {
    log('A05', `注销账户失败: ${err.message}`, 'error');
    return false;
  }
}

// ===== 使用者管理(家属端绑定) =====
export function addUser(user) {
  if (!db) return null;
  const { name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bound_account_id } = user;
  const result = db.prepare(`
    INSERT INTO users (name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bound_at, bound_account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, age || null, relation || '', phone || '', emergency_contact || '', emergency_phone || '', health_notes || '', new Date().toISOString(), bound_account_id || null);
  return result.lastInsertRowid;
}

export function getAllUsers() {
  if (!db) return [];
  return db.prepare('SELECT * FROM users ORDER BY bound_at DESC').all();
}

export function deleteUser(id) {
  if (!db) return 0;
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes;
}

/**
 * 按手机号查找视障账号(家属绑定用)
 * 仅返回 role='user' 且状态正常的账号,避免家属绑定家属或被封禁账号
 */
export function findUserAccountByPhone(phone) {
  if (!db || !phone) return null;
  return db.prepare("SELECT id, username, role, nickname, phone FROM accounts WHERE phone = ? AND role = 'user' AND (status IS NULL OR status = 'active')").get(phone.trim());
}

/**
 * 按用户名查找视障账号(兼容旧接口)
 */
export function findUserAccountByUsername(username) {
  if (!db) return null;
  return db.prepare("SELECT id, username, role, nickname FROM accounts WHERE username = ? AND role = 'user'").get(username);
}

/**
 * 按手机号查找任意账号(手机验证码登录用,不限角色)
 * 返回完整账号记录(含password_hash等字段)
 */
export function getAccountByPhone(phone) {
  if (!db || !phone) return null;
  return db.prepare('SELECT * FROM accounts WHERE phone = ?').get(phone.trim());
}

// ===== 管理员功能 =====
/**
 * 获取所有账号列表(管理员用,过滤password_hash)
 */
export function getAllAccounts() {
  if (!db) return [];
  return db.prepare("SELECT id, username, role, user_id, created_at, nickname, avatar, phone, status FROM accounts ORDER BY created_at DESC").all();
}

/**
 * 更新账号状态(管理员封禁/解封)
 */
export function updateAccountStatus(id, status) {
  if (!db) return false;
  try {
    const result = db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, id);
    return result.changes > 0;
  } catch (err) {
    log('A05', `更新账号状态失败: ${err.message}`, 'error');
    return false;
  }
}

/**
 * 记录管理员操作日志
 */
export function addAdminLog(logEntry) {
  if (!db) return null;
  const { admin_id, target_account_id, action, reason, detail } = logEntry;
  const result = db.prepare(`
    INSERT INTO admin_logs (admin_id, target_account_id, action, reason, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(admin_id || null, target_account_id || null, action, reason || '', detail || '', new Date().toISOString());
  return result.lastInsertRowid;
}

/**
 * 获取管理员操作日志
 */
export function getAdminLogs(limit = 50) {
  if (!db) return [];
  return db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT ?').all(limit);
}

// ===== 路线记忆 =====
export function searchRoutes(lat, lng, limit = 5) {
  if (!db) return [];
  // 简化版: 查找起点附近1000米内的常用路线
  return db.prepare(`
    SELECT *, (
      (start_lat - ?) * (start_lat - ?) + (start_lng - ?) * (start_lng - ?)
    ) as dist
    FROM routes
    ORDER BY dist ASC, visit_count DESC
    LIMIT ?
  `).all(lat, lat, lng, lng, limit);
}

export function addRoute(route) {
  if (!db) return null;
  const { start_lat, start_lng, end_lat, end_lng, route_name } = route;
  const now = new Date().toISOString();
  // upsert: 相同起终点路线已存在则递增visit_count,否则插入新记录
  const existing = db.prepare(`
    SELECT id, visit_count FROM routes
    WHERE start_lat=? AND start_lng=? AND end_lat=? AND end_lng=?
  `).get(start_lat, start_lng, end_lat, end_lng);
  if (existing) {
    db.prepare(`
      UPDATE routes SET visit_count=visit_count+1, last_visited=?, route_name=?
      WHERE id=?
    `).run(now, route_name, existing.id);
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO routes (start_lat, start_lng, end_lat, end_lng, route_name, visit_count, last_visited, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(start_lat, start_lng, end_lat, end_lng, route_name, now, now);
  return result.lastInsertRowid;
}

export function getAllRoutes() {
  if (!db) return [];
  return db.prepare('SELECT * FROM routes ORDER BY visit_count DESC, last_visited DESC').all();
}

// ===== 熟人面孔 =====
export function searchFaces() {
  if (!db) return [];
  return db.prepare('SELECT * FROM faces ORDER BY visit_count DESC, last_seen DESC').all();
}

export function addFace(face) {
  if (!db) return null;
  const { name, relation, description } = face;
  const existing = db.prepare('SELECT id FROM faces WHERE name = ?').get(name);
  if (existing) {
    db.prepare('UPDATE faces SET visit_count = visit_count + 1, last_seen = ? WHERE id = ?')
      .run(new Date().toISOString(), existing.id);
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO faces (name, relation, description, visit_count, last_seen, created_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(name, relation, description, new Date().toISOString(), new Date().toISOString());
  return result.lastInsertRowid;
}

export function forgetAllFaces() {
  if (!db) return 0;
  const result = db.prepare('DELETE FROM faces').run();
  return result.changes;
}

// ===== 习惯 =====
export function getHabit(type, key) {
  if (!db) return null;
  return db.prepare('SELECT * FROM habits WHERE habit_type = ? AND habit_key = ?').get(type, key);
}

export function upsertHabit(type, key, value) {
  if (!db) return null;
  const existing = db.prepare('SELECT id FROM habits WHERE habit_type = ? AND habit_key = ?').get(type, key);
  if (existing) {
    db.prepare('UPDATE habits SET habit_value = ?, trigger_count = trigger_count + 1, last_triggered = ? WHERE id = ?')
      .run(value, new Date().toISOString(), existing.id);
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO habits (habit_type, habit_key, habit_value, trigger_count, last_triggered, created_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(type, key, value, new Date().toISOString(), new Date().toISOString());
  return result.lastInsertRowid;
}

export function getAllHabits() {
  if (!db) return [];
  return db.prepare('SELECT * FROM habits ORDER BY last_triggered DESC').all();
}

// ===== SOS事件 =====
export function addSosEvent(event) {
  if (!db) return null;
  const { event_type, lat, lng, address, contact_name, contact_phone } = event;
  const result = db.prepare(`
    INSERT INTO sos_events (event_type, lat, lng, address, contact_name, contact_phone, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(event_type, lat, lng, address, contact_name, contact_phone, new Date().toISOString());
  return result.lastInsertRowid;
}

export function updateSosStatus(id, status) {
  if (!db) return;
  db.prepare('UPDATE sos_events SET status = ? WHERE id = ?').run(status, id);
}

export function getSosEvents(limit = 20) {
  if (!db) return [];
  return db.prepare('SELECT * FROM sos_events ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function clearSosEvents() {
  if (!db) return 0;
  const result = db.prepare('DELETE FROM sos_events').run();
  return result.changes;
}

// ===== 记忆总览 =====
export function getMemoryStats() {
  if (!db) return { routes: 0, faces: 0, habits: 0, sos_events: 0 };
  return {
    routes: db.prepare('SELECT COUNT(*) as c FROM routes').get().c,
    faces: db.prepare('SELECT COUNT(*) as c FROM faces').get().c,
    habits: db.prepare('SELECT COUNT(*) as c FROM habits').get().c,
    sos_events: db.prepare('SELECT COUNT(*) as c FROM sos_events').get().c,
  };
}
