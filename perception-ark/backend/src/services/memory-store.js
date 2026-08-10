/**
 * 环境记忆 Agent 存储 (A05)
 * 使用 libsql/Turso 云数据库存储路线、熟人、习惯
 * 优先连接 Turso 云数据库(生产环境持久化),未配置时降级到本地文件 SQLite(开发环境)
 */
import { createClient } from '@libsql/client';
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

// 辅助: 把 lastInsertRowid (bigint|undefined) 转为 number|null
function toNumberId(lastInsertRowid) {
  if (lastInsertRowid === undefined || lastInsertRowid === null) return null;
  return Number(lastInsertRowid);
}

// 辅助: 把 rowsAffected (number) 返回,兼容旧 better-sqlite3 的 changes 字段名
function toChanges(rowsAffected) {
  return Number(rowsAffected || 0);
}

export async function initMemoryStore() {
  // 连接逻辑: 优先使用 Turso 云数据库; 未配置则降级到本地文件 SQLite
  const tursoUrl = process.env.TURSO_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (tursoUrl && tursoToken) {
    db = createClient({ url: tursoUrl, authToken: tursoToken });
    log('A05', `已连接 Turso 云数据库: ${tursoUrl}`);
  } else {
    // 本地文件模式 (libsql 本地 SQLite, 兼容 better-sqlite3 的 .db 文件)
    db = createClient({ url: `file:${DB_PATH}` });
    log('A05', `未配置 TURSO_URL, 降级使用本地文件 SQLite: ${DB_PATH}`);
  }

  // 创建所有表 (DDL 用 executeMultiple 一次性执行)
  await db.executeMultiple(`
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

    CREATE TABLE IF NOT EXISTS family_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_account_id INTEGER NOT NULL,
      family_account_id INTEGER,
      family_phone TEXT NOT NULL,
      family_name TEXT,
      relation TEXT,
      status TEXT DEFAULT 'pending',
      initiator TEXT DEFAULT 'user',
      invited_at TEXT,
      bound_at TEXT,
      UNIQUE(user_account_id, family_phone)
    );
  `);

  // 辅助: 查询表的所有列名 (libsql 兼容 pragma_table_info 函数)
  async function getTableColumns(tableName) {
    const rs = await db.execute({
      sql: `SELECT name FROM pragma_table_info('${tableName}')`,
    });
    return rs.rows.map(r => r.name);
  }

  // 兼容旧库: 若 family_bindings 表缺少列,自动补列
  try {
    const fbCols = await getTableColumns('family_bindings');
    if (!fbCols.includes('family_name')) {
      await db.execute("ALTER TABLE family_bindings ADD COLUMN family_name TEXT");
    }
    if (!fbCols.includes('relation')) {
      await db.execute("ALTER TABLE family_bindings ADD COLUMN relation TEXT");
    }
    if (!fbCols.includes('initiator')) {
      await db.execute("ALTER TABLE family_bindings ADD COLUMN initiator TEXT DEFAULT 'user'");
      log('A05', 'family_bindings 表已补列 initiator');
    }
  } catch (e) {
    log('A05', `family_bindings 表补列检查失败: ${e.message}`, 'warn');
  }

  // 兼容旧库: 若 accounts 表缺少列,自动补列
  try {
    const cols = await getTableColumns('accounts');
    if (!cols.includes('nickname')) {
      await db.execute("ALTER TABLE accounts ADD COLUMN nickname TEXT");
      log('A05', 'accounts 表已补列 nickname');
    }
    if (!cols.includes('avatar')) {
      await db.execute("ALTER TABLE accounts ADD COLUMN avatar TEXT");
      log('A05', 'accounts 表已补列 avatar');
    }
    if (!cols.includes('phone')) {
      await db.execute("ALTER TABLE accounts ADD COLUMN phone TEXT");
      log('A05', 'accounts 表已补列 phone');
    }
    if (!cols.includes('status')) {
      await db.execute("ALTER TABLE accounts ADD COLUMN status TEXT DEFAULT 'active'");
      log('A05', 'accounts 表已补列 status');
    }
    if (!cols.includes('security_question')) {
      await db.execute("ALTER TABLE accounts ADD COLUMN security_question TEXT");
      log('A05', 'accounts 表已补列 security_question');
    }
    if (!cols.includes('security_answer_hash')) {
      await db.execute("ALTER TABLE accounts ADD COLUMN security_answer_hash TEXT");
      log('A05', 'accounts 表已补列 security_answer_hash');
    }
  } catch (e) {
    log('A05', `accounts 表补列检查失败: ${e.message}`, 'warn');
  }

  // 兼容旧库: 若 users 表缺少 bound_account_id 列,自动补列(用于家属绑定视障账号)
  try {
    const userCols = await getTableColumns('users');
    if (!userCols.includes('bound_account_id')) {
      await db.execute("ALTER TABLE users ADD COLUMN bound_account_id INTEGER");
      log('A05', 'users 表已补列 bound_account_id');
    }
    // 补列 family_account_id: 记录是哪个家属账号添加的,用于数据隔离
    if (!userCols.includes('family_account_id')) {
      await db.execute("ALTER TABLE users ADD COLUMN family_account_id INTEGER");
      log('A05', 'users 表已补列 family_account_id');
    }
  } catch (e) {
    log('A05', `users 表补列检查失败: ${e.message}`, 'warn');
  }

  log('A05', '记忆数据库初始化完成');
  // 记忆库启动时为空,由用户使用过程中自然累积

  // 初始化默认超级管理员账号(注册页不提供管理员注册,需保证系统始终可登录管理后台)
  try {
    const rs = await db.execute({
      sql: "SELECT id FROM accounts WHERE username = 'admin' AND role = 'admin'",
    });
    if (rs.rows.length === 0) {
      const adminHash = bcrypt.hashSync('admin123', 10);
      await db.execute({
        sql: `INSERT INTO accounts (username, password_hash, role, user_id, created_at, phone, status)
              VALUES (?, ?, 'admin', NULL, ?, NULL, 'active')`,
        args: ['admin', adminHash, new Date().toISOString()],
      });
      log('A05', '默认超级管理员账号已创建 (用户名: admin / 密码: admin123)');
    }
  } catch (e) {
    log('A05', `默认超级管理员初始化失败: ${e.message}`, 'warn');
  }
}

// ===== 账号管理(登录系统) =====
export async function createAccount(username, passwordHash, role = 'user', userId = null, phone = null, securityQuestion = null, securityAnswerHash = null) {
  if (!db) return null;
  try {
    const result = await db.execute({
      sql: `INSERT INTO accounts (username, password_hash, role, user_id, created_at, phone, security_question, security_answer_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [username, passwordHash, role, userId, new Date().toISOString(), phone || null, securityQuestion || null, securityAnswerHash || null],
    });
    const accountId = toNumberId(result.lastInsertRowid);

    // 家属账号创建时,自动激活所有指向该手机号的pending邀请
    // 这样视障用户之前发出的绑定邀请,在家属注册瞬间自动完成绑定
    if (role === 'family' && phone) {
      try {
        const activated = await activatePendingFamilyBindings(Number(accountId), phone.trim());
        if (activated > 0) {
          log('AUTH', `家属注册自动激活 ${activated} 条pending邀请: ${username} (${phone})`);
        }
      } catch (e) {
        log('AUTH', `激活pending邀请失败(不影响注册): ${e.message}`, 'warn');
      }
    }

    return accountId;
  } catch (err) {
    if (err.message.includes('UNIQUE')) return null;
    throw err;
  }
}

export async function getAccountByUsername(username) {
  if (!db) return null;
  const rs = await db.execute({
    sql: 'SELECT * FROM accounts WHERE username = ?',
    args: [username],
  });
  return rs.rows[0] || null;
}

export async function getAccountById(id) {
  if (!db) return null;
  const rs = await db.execute({
    sql: 'SELECT id, username, role, user_id, created_at, nickname, avatar, phone, status, security_question FROM accounts WHERE id = ?',
    args: [id],
  });
  return rs.rows[0] || null;
}

/**
 * 获取账号的密保问题(仅返回问题文本,不含答案)
 */
export async function getSecurityQuestion(username) {
  if (!db) return null;
  const rs = await db.execute({
    sql: 'SELECT security_question FROM accounts WHERE username = ?',
    args: [username],
  });
  const row = rs.rows[0];
  if (!row || !row.security_question) return null;
  return row.security_question;
}

/**
 * 校验密保答案是否正确
 */
export async function verifySecurityAnswer(username, answer) {
  if (!db || !answer) return false;
  const rs = await db.execute({
    sql: 'SELECT security_answer_hash FROM accounts WHERE username = ?',
    args: [username],
  });
  const row = rs.rows[0];
  if (!row || !row.security_answer_hash) return false;
  return bcrypt.compareSync(answer, row.security_answer_hash);
}

/**
 * 重置账号密码
 */
export async function resetPassword(username, newPasswordHash) {
  if (!db) return false;
  try {
    const result = await db.execute({
      sql: 'UPDATE accounts SET password_hash = ? WHERE username = ?',
      args: [newPasswordHash, username],
    });
    return toChanges(result.rowsAffected) > 0;
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
export async function updateSecurity(id, question, answerHash) {
  if (!db) return false;
  try {
    const result = await db.execute({
      sql: 'UPDATE accounts SET security_question = ?, security_answer_hash = ? WHERE id = ?',
      args: [question, answerHash, id],
    });
    return toChanges(result.rowsAffected) > 0;
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
export async function updateAccountProfile(id, { nickname, avatar }) {
  if (!db) return false;
  try {
    const sets = [];
    const args = [];
    if (nickname !== undefined) { sets.push('nickname = ?'); args.push(nickname); }
    if (avatar !== undefined) { sets.push('avatar = ?'); args.push(avatar); }
    if (sets.length === 0) return false;
    args.push(id);
    const result = await db.execute({
      sql: `UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`,
      args,
    });
    return toChanges(result.rowsAffected) > 0;
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
export async function deleteAccount(id) {
  if (!db) return false;
  try {
    const result = await db.execute({
      sql: 'DELETE FROM accounts WHERE id = ?',
      args: [id],
    });
    return toChanges(result.rowsAffected) > 0;
  } catch (err) {
    log('A05', `注销账户失败: ${err.message}`, 'error');
    return false;
  }
}

// ===== 使用者管理(家属端绑定) =====
export async function addUser(user) {
  if (!db) return null;
  const { name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bound_account_id, family_account_id } = user;
  const result = await db.execute({
    sql: `INSERT INTO users (name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bound_at, bound_account_id, family_account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [name, age || null, relation || '', phone || '', emergency_contact || '', emergency_phone || '', health_notes || '', new Date().toISOString(), bound_account_id || null, family_account_id || null],
  });
  return toNumberId(result.lastInsertRowid);
}

// 按家属账号过滤获取使用者列表(数据隔离: 每个家属只能看到自己添加的使用者)
export async function getAllUsers(familyAccountId) {
  if (!db) return [];
  if (familyAccountId) {
    const rs = await db.execute({
      sql: 'SELECT * FROM users WHERE family_account_id = ? ORDER BY bound_at DESC',
      args: [familyAccountId],
    });
    return rs.rows;
  }
  // 未传familyAccountId时返回全部(向后兼容,仅用于管理后台等场景)
  const rs = await db.execute('SELECT * FROM users ORDER BY bound_at DESC');
  return rs.rows;
}

export async function deleteUser(id) {
  if (!db) return 0;
  const result = await db.execute({
    sql: 'DELETE FROM users WHERE id = ?',
    args: [id],
  });
  return toChanges(result.rowsAffected);
}

/**
 * 更新使用者信息
 */
export async function updateUser(id, data) {
  if (!db) return 0;
  const { name, age, relation, phone, emergency_contact, emergency_phone, health_notes, bound_account_id } = data;
  const result = await db.execute({
    sql: `UPDATE users SET
      name = COALESCE(?, name),
      age = COALESCE(?, age),
      relation = COALESCE(?, relation),
      phone = COALESCE(?, phone),
      emergency_contact = COALESCE(?, emergency_contact),
      emergency_phone = COALESCE(?, emergency_phone),
      health_notes = COALESCE(?, health_notes),
      bound_account_id = COALESCE(?, bound_account_id)
    WHERE id = ?`,
    args: [
      name || null, age !== undefined ? age : null, relation || null, phone || null,
      emergency_contact || null, emergency_phone || null, health_notes || null,
      bound_account_id !== undefined ? bound_account_id : null, id,
    ],
  });
  return toChanges(result.rowsAffected);
}

/**
 * 按手机号查找视障账号(家属绑定用)
 * 仅返回 role='user' 且状态正常的账号,避免家属绑定家属或被封禁账号
 */
export async function findUserAccountByPhone(phone) {
  if (!db || !phone) return null;
  const rs = await db.execute({
    sql: "SELECT id, username, role, nickname, phone FROM accounts WHERE phone = ? AND role = 'user' AND (status IS NULL OR status = 'active')",
    args: [phone.trim()],
  });
  return rs.rows[0] || null;
}

/**
 * 按用户名查找视障账号(兼容旧接口)
 */
export async function findUserAccountByUsername(username) {
  if (!db) return null;
  const rs = await db.execute({
    sql: "SELECT id, username, role, nickname FROM accounts WHERE username = ? AND role = 'user'",
    args: [username],
  });
  return rs.rows[0] || null;
}

/**
 * 按手机号查找任意账号(手机验证码登录用,不限角色)
 * 返回完整账号记录(含password_hash等字段)
 */
export async function getAccountByPhone(phone) {
  if (!db || !phone) return null;
  const rs = await db.execute({
    sql: 'SELECT * FROM accounts WHERE phone = ?',
    args: [phone.trim()],
  });
  return rs.rows[0] || null;
}

// ===== 家属绑定(双向确认机制) =====
/**
 * 添加家属绑定(视障用户邀请家属)
 * 新机制: 无论家属是否已注册,status 始终为 'pending',需家属端确认后才升级为 'active'
 * 例外: 若家属端此前已发起对该视障用户的邀请(initiator='family'),则双方互邀请,直接 active
 * @param {number} userAccountId 视障用户账号ID
 * @param {string} familyPhone 家属手机号
 * @param {string} familyName 家属称呼(可选)
 * @param {string} relation 关系(可选)
 * @returns {object} { success, bindingId, familyAccount, status, autoActivated }
 */
export async function addFamilyBinding(userAccountId, familyPhone, familyName, relation) {
  if (!db) return { success: false, error: '数据库未初始化' };
  const phone = familyPhone.trim();
  // 检查是否已绑定同一手机号
  const existingRs = await db.execute({
    sql: 'SELECT * FROM family_bindings WHERE user_account_id = ? AND family_phone = ?',
    args: [userAccountId, phone],
  });
  if (existingRs.rows[0]) {
    return { success: false, error: '该手机号已绑定', existing: true };
  }
  // 查找家属账号是否已注册
  const familyRs = await db.execute({
    sql: "SELECT id, username, role, nickname, phone FROM accounts WHERE phone = ? AND role = 'family'",
    args: [phone],
  });
  const familyAccount = familyRs.rows[0] || null;
  const now = new Date().toISOString();

  // 双向互邀请优化: 检查家属端是否已发起对该视障用户的邀请
  // 若存在 initiator='family' 且 status='pending' 的反向邀请,说明双方都想绑定,直接互相确认
  if (familyAccount) {
    const reverseRs = await db.execute({
      sql: `SELECT id FROM family_bindings
            WHERE user_account_id = ? AND family_account_id = ? AND family_phone = ?
              AND initiator = 'family' AND status = 'pending'`,
      args: [userAccountId, familyAccount.id, phone],
    });
    const reverseInvitation = reverseRs.rows[0];
    if (reverseInvitation) {
      // 将反向邀请升级为 active,同时插入正向 active 记录
      await db.execute({
        sql: `UPDATE family_bindings SET status = 'active', bound_at = COALESCE(bound_at, ?) WHERE id = ?`,
        args: [now, reverseInvitation.id],
      });
      try {
        const result = await db.execute({
          sql: `INSERT INTO family_bindings (user_account_id, family_account_id, family_phone, family_name, relation, status, initiator, invited_at, bound_at)
                VALUES (?, ?, ?, ?, ?, 'active', 'user', ?, ?)`,
          args: [userAccountId, familyAccount.id, phone, familyName || null, relation || null, now, now],
        });
        return { success: true, bindingId: toNumberId(result.lastInsertRowid), familyAccount, status: 'active', autoActivated: true };
      } catch (err) {
        log('A05', `双向互邀请插入正向记录失败: ${err.message}`, 'error');
        return { success: false, error: err.message };
      }
    }
  }

  // 常规流程: status='pending',等待家属端确认
  try {
    const result = await db.execute({
      sql: `INSERT INTO family_bindings (user_account_id, family_account_id, family_phone, family_name, relation, status, initiator, invited_at, bound_at)
            VALUES (?, ?, ?, ?, ?, 'pending', 'user', ?, ?)`,
      args: [
        userAccountId,
        familyAccount?.id || null,
        phone,
        familyName || null,
        relation || null,
        now,
        null,  // bound_at 留空,确认后填入
      ],
    });
    return { success: true, bindingId: toNumberId(result.lastInsertRowid), familyAccount, status: 'pending', autoActivated: false };
  } catch (err) {
    log('A05', `添加家属绑定失败: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

/**
 * 获取视障用户的所有家属绑定
 * @param {number} userAccountId
 * @returns {array}
 */
export async function getFamilyBindings(userAccountId) {
  if (!db) return [];
  const rs = await db.execute({
    sql: 'SELECT * FROM family_bindings WHERE user_account_id = ? ORDER BY invited_at DESC',
    args: [userAccountId],
  });
  return rs.rows;
}

/**
 * 删除家属绑定
 * @param {number} bindingId
 * @param {number} userAccountId 验证归属权
 * @returns {boolean}
 */
export async function removeFamilyBinding(bindingId, userAccountId) {
  if (!db) return false;
  try {
    const result = await db.execute({
      sql: 'DELETE FROM family_bindings WHERE id = ? AND user_account_id = ?',
      args: [bindingId, userAccountId],
    });
    return toChanges(result.rowsAffected) > 0;
  } catch (err) {
    log('A05', `删除家属绑定失败: ${err.message}`, 'error');
    return false;
  }
}

/**
 * 家属账号注册时,回填 family_account_id 到所有指向该手机号的 pending 邀请
 * 新机制: 不再自动激活(active),仅回填账号ID,等待家属端主动确认后才升级为 active
 * @param {number} familyAccountId 新注册的家属账号ID
 * @param {string} familyPhone 家属手机号
 * @returns {number} 回填账号ID的邀请数量
 */
export async function activatePendingFamilyBindings(familyAccountId, familyPhone) {
  if (!db || !familyAccountId || !familyPhone) return 0;
  const phone = familyPhone.trim();
  try {
    // 仅回填 family_account_id,不修改 status(保持 pending 等待家属确认)
    const result = await db.execute({
      sql: `UPDATE family_bindings
            SET family_account_id = ?
            WHERE family_phone = ? AND status = 'pending' AND (family_account_id IS NULL OR family_account_id != ?)`,
      args: [familyAccountId, phone, familyAccountId],
    });
    return toChanges(result.rowsAffected) || 0;
  } catch (err) {
    log('A05', `回填家属账号ID失败: ${err.message}`, 'error');
    return 0;
  }
}

/**
 * 反向查询: 家属账号通过family_bindings绑定的所有视障人员
 * 供家属端"我的"tab显示,确保视障端发起的邀请在家属端也能看到
 * @param {number} familyAccountId 家属账号ID
 * @returns {array} 视障人员列表(格式与users表兼容)
 */
export async function getFamilyBoundVisuallyImpairedUsers(familyAccountId) {
  if (!db || !familyAccountId) return [];
  try {
    const rs = await db.execute({
      sql: `SELECT fb.id AS binding_id, fb.user_account_id, fb.family_name, fb.relation,
                   fb.invited_at, fb.bound_at,
                   a.username, a.nickname, a.phone, a.role
            FROM family_bindings fb
            JOIN accounts a ON fb.user_account_id = a.id
            WHERE fb.family_account_id = ? AND fb.status = 'active'
            ORDER BY fb.bound_at DESC, fb.invited_at DESC`,
      args: [familyAccountId],
    });
    return rs.rows.map(r => ({
      id: `bind_${r.binding_id}`,
      name: r.nickname || r.username || '视障用户',
      age: null,
      relation: r.relation || '被守护人',
      phone: r.phone || '',
      emergency_contact: null,
      emergency_phone: null,
      health_notes: null,
      bound_at: r.bound_at || r.invited_at,
      bound_account_id: r.user_account_id,
      binding_source: 'invitation'
    }));
  } catch (err) {
    log('A05', `反向查询家属绑定的视障人员失败: ${err.message}`, 'error');
    return [];
  }
}

/**
 * 获取视障用户的已绑定(active)家属,供SOS页面紧急联系人使用
 * 关联accounts表获取家属最新nickname,确保信息同步
 * @param {number} userAccountId
 * @returns {array} [{ id, name, phone, relation, bindingId, status }]
 */
export async function getActiveFamilyBindingsAsContacts(userAccountId) {
  if (!db) return [];
  try {
    const rs = await db.execute({
      sql: `SELECT fb.id AS bindingId, fb.family_phone, fb.family_name, fb.relation, fb.status,
                   a.id AS account_id, a.nickname, a.username, a.role
            FROM family_bindings fb
            LEFT JOIN accounts a ON fb.family_account_id = a.id
            WHERE fb.user_account_id = ? AND fb.status = 'active'
            ORDER BY fb.bound_at DESC, fb.invited_at DESC`,
      args: [userAccountId],
    });
    return rs.rows.map(r => ({
      id: r.bindingId,
      name: r.family_name || r.nickname || r.username || r.family_phone,
      phone: r.family_phone,
      relation: r.relation || '家属',
      bindingId: r.bindingId,
      status: r.status
    }));
  } catch (err) {
    log('A05', `获取SOS家属联系人失败: ${err.message}`, 'error');
    return [];
  }
}

/**
 * 家属端添加/编辑使用者时,反向同步到视障端的family_bindings表
 * 新机制: status='pending', initiator='family',需要视障端确认后才升级为 'active'
 * 例外: 若视障端已发起对该家属的邀请(initiator='user' 且 status='pending'),则双方互邀请,直接 active
 * @param {number} userAccountId 视障用户账号ID
 * @param {number} familyAccountId 家属账号ID
 * @param {string} familyPhone 家属手机号
 * @param {string} familyName 家属称呼(可选)
 * @param {string} relation 关系(可选)
 * @returns {object} { success, bindingId, status, autoActivated }
 */
export async function syncFamilyBindingFromFamilySide(userAccountId, familyAccountId, familyPhone, familyName, relation) {
  if (!db) return { success: false, error: '数据库未初始化' };
  if (!userAccountId || !familyAccountId || !familyPhone) {
    return { success: false, error: '参数不完整' };
  }
  const phone = familyPhone.trim();
  try {
    // 检查是否已存在绑定记录(同一视障用户+同一家属手机号)
    const existingRs = await db.execute({
      sql: 'SELECT * FROM family_bindings WHERE user_account_id = ? AND family_phone = ?',
      args: [userAccountId, phone],
    });
    const existing = existingRs.rows[0];
    const now = new Date().toISOString();
    if (existing) {
      // 双向互邀请优化: 若已存在的是视障端发起的邀请(initiator='user' 且 pending),说明双方互邀请,直接 active
      if (existing.initiator === 'user' && existing.status === 'pending') {
        await db.execute({
          sql: `UPDATE family_bindings
                SET family_account_id = ?, family_name = COALESCE(?, family_name), relation = COALESCE(?, relation),
                    status = 'active', bound_at = COALESCE(bound_at, ?)
                WHERE id = ?`,
          args: [familyAccountId, familyName || null, relation || null, now, existing.id],
        });
        return { success: true, bindingId: existing.id, status: 'active', autoActivated: true, updated: true };
      }
      // 已存在且非互邀请场景: 更新 family_account_id,保持原 status
      await db.execute({
        sql: `UPDATE family_bindings
              SET family_account_id = ?, family_name = COALESCE(?, family_name), relation = COALESCE(?, relation)
              WHERE id = ?`,
        args: [familyAccountId, familyName || null, relation || null, existing.id],
      });
      return { success: true, bindingId: existing.id, status: existing.status, autoActivated: false, updated: true };
    }
    // 不存在: 新增 pending 绑定(initiator='family'),等待视障端确认
    const result = await db.execute({
      sql: `INSERT INTO family_bindings (user_account_id, family_account_id, family_phone, family_name, relation, status, initiator, invited_at, bound_at)
            VALUES (?, ?, ?, ?, ?, 'pending', 'family', ?, ?)`,
      args: [userAccountId, familyAccountId, phone, familyName || null, relation || null, now, null],
    });
    return { success: true, bindingId: toNumberId(result.lastInsertRowid), status: 'pending', autoActivated: false };
  } catch (err) {
    log('A05', `反向同步家属绑定失败: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

/**
 * 确认家属绑定(被邀请方确认后,status: pending → active)
 * 根据 initiator 判断确认方:
 *   - initiator='user' (视障端发起) → 家属是确认方,验证 family_account_id == confirmerAccountId
 *   - initiator='family' (家属端发起) → 视障是确认方,验证 user_account_id == confirmerAccountId
 * @param {number} bindingId 绑定记录ID
 * @param {number} confirmerAccountId 确认者账号ID
 * @param {'user'|'family'} confirmerRole 确认者角色
 * @returns {object} { success, status, binding }
 */
export async function confirmFamilyBinding(bindingId, confirmerAccountId, confirmerRole) {
  if (!db || !bindingId || !confirmerAccountId) return { success: false, error: '参数不完整' };
  try {
    const rs = await db.execute({
      sql: 'SELECT * FROM family_bindings WHERE id = ?',
      args: [bindingId],
    });
    const binding = rs.rows[0];
    if (!binding) return { success: false, error: '绑定记录不存在' };
    if (binding.status !== 'pending') return { success: false, error: `当前状态为 ${binding.status},无法确认` };

    // 权限校验: 根据 initiator 判断谁有权确认
    if (binding.initiator === 'user') {
      // 视障端发起的邀请 → 家属确认
      if (confirmerRole !== 'family') return { success: false, error: '无权确认(需家属端确认)' };
      if (!binding.family_account_id || binding.family_account_id !== confirmerAccountId) {
        return { success: false, error: '无权确认(账号不匹配)' };
      }
    } else if (binding.initiator === 'family') {
      // 家属端发起的邀请 → 视障确认
      if (confirmerRole !== 'user') return { success: false, error: '无权确认(需视障端确认)' };
      if (binding.user_account_id !== confirmerAccountId) {
        return { success: false, error: '无权确认(账号不匹配)' };
      }
    } else {
      return { success: false, error: `未知的发起方: ${binding.initiator}` };
    }

    const now = new Date().toISOString();
    await db.execute({
      sql: `UPDATE family_bindings SET status = 'active', bound_at = COALESCE(bound_at, ?) WHERE id = ?`,
      args: [now, bindingId],
    });
    log('A05', `家属绑定确认成功: bindingId=${bindingId} confirmer=${confirmerAccountId}(${confirmerRole})`);
    return { success: true, status: 'active', binding: { ...binding, status: 'active', bound_at: now } };
  } catch (err) {
    log('A05', `确认家属绑定失败: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

/**
 * 拒绝家属绑定(被邀请方拒绝,删除该 pending 记录)
 * 权限校验逻辑同 confirmFamilyBinding
 * @param {number} bindingId 绑定记录ID
 * @param {number} confirmerAccountId 拒绝者账号ID
 * @param {'user'|'family'} confirmerRole 拒绝者角色
 * @returns {object} { success, deleted }
 */
export async function rejectFamilyBinding(bindingId, confirmerAccountId, confirmerRole) {
  if (!db || !bindingId || !confirmerAccountId) return { success: false, error: '参数不完整' };
  try {
    const rs = await db.execute({
      sql: 'SELECT * FROM family_bindings WHERE id = ?',
      args: [bindingId],
    });
    const binding = rs.rows[0];
    if (!binding) return { success: false, error: '绑定记录不存在' };
    if (binding.status !== 'pending') return { success: false, error: `当前状态为 ${binding.status},无法拒绝` };

    if (binding.initiator === 'user') {
      if (confirmerRole !== 'family' || !binding.family_account_id || binding.family_account_id !== confirmerAccountId) {
        return { success: false, error: '无权拒绝(账号不匹配)' };
      }
    } else if (binding.initiator === 'family') {
      if (confirmerRole !== 'user' || binding.user_account_id !== confirmerAccountId) {
        return { success: false, error: '无权拒绝(账号不匹配)' };
      }
    } else {
      return { success: false, error: `未知的发起方: ${binding.initiator}` };
    }

    await db.execute({
      sql: 'DELETE FROM family_bindings WHERE id = ?',
      args: [bindingId],
    });
    log('A05', `家属绑定被拒绝: bindingId=${bindingId} rejector=${confirmerAccountId}(${confirmerRole})`);
    return { success: true, deleted: true };
  } catch (err) {
    log('A05', `拒绝家属绑定失败: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

/**
 * 家属端待确认列表(视障端发起的邀请,等待家属确认)
 * 查询条件: family_account_id = me AND initiator='user' AND status='pending'
 * @param {number} familyAccountId 家属账号ID
 * @returns {array} [{ id, user_account_id, family_phone, family_name, relation, invited_at, vi_account_id, vi_username, vi_nickname, vi_phone }]
 */
export async function getPendingConfirmFamilyBindings(familyAccountId) {
  if (!db || !familyAccountId) return [];
  try {
    const rs = await db.execute({
      sql: `SELECT fb.id, fb.invited_at,
                   fb.family_phone, fb.family_name, fb.relation,
                   a.id AS user_account_id, a.username AS user_username, a.nickname AS user_nickname, a.phone AS user_phone
            FROM family_bindings fb
            JOIN accounts a ON fb.user_account_id = a.id
            WHERE fb.family_account_id = ? AND fb.initiator = 'user' AND fb.status = 'pending'
            ORDER BY fb.invited_at DESC`,
      args: [familyAccountId],
    });
    return rs.rows;
  } catch (err) {
    log('A05', `查询家属端待确认列表失败: ${err.message}`, 'error');
    return [];
  }
}

/**
 * 视障端待确认列表(家属端发起的邀请,等待视障用户确认)
 * 查询条件: user_account_id = me AND initiator='family' AND status='pending'
 * @param {number} userAccountId 视障用户账号ID
 * @returns {array} [{ id, family_account_id, family_phone, family_name, relation, invited_at, family_username, family_nickname }]
 */
export async function getPendingConfirmViBindings(userAccountId) {
  if (!db || !userAccountId) return [];
  try {
    const rs = await db.execute({
      sql: `SELECT fb.id, fb.family_account_id, fb.family_phone, fb.family_name, fb.relation, fb.invited_at,
                   a.username AS family_username, a.nickname AS family_nickname
            FROM family_bindings fb
            JOIN accounts a ON fb.family_account_id = a.id
            WHERE fb.user_account_id = ? AND fb.initiator = 'family' AND fb.status = 'pending'
            ORDER BY fb.invited_at DESC`,
      args: [userAccountId],
    });
    return rs.rows;
  } catch (err) {
    log('A05', `查询视障端待确认列表失败: ${err.message}`, 'error');
    return [];
  }
}

// ===== 管理员功能 =====
/**
 * 获取所有账号列表(管理员用,过滤password_hash)
 */
export async function getAllAccounts() {
  if (!db) return [];
  const rs = await db.execute("SELECT id, username, role, user_id, created_at, nickname, avatar, phone, status FROM accounts ORDER BY created_at DESC");
  return rs.rows;
}

/**
 * 更新账号状态(管理员封禁/解封)
 */
export async function updateAccountStatus(id, status) {
  if (!db) return false;
  try {
    const result = await db.execute({
      sql: 'UPDATE accounts SET status = ? WHERE id = ?',
      args: [status, id],
    });
    return toChanges(result.rowsAffected) > 0;
  } catch (err) {
    log('A05', `更新账号状态失败: ${err.message}`, 'error');
    return false;
  }
}

/**
 * 记录管理员操作日志
 */
export async function addAdminLog(logEntry) {
  if (!db) return null;
  const { admin_id, target_account_id, action, reason, detail } = logEntry;
  const result = await db.execute({
    sql: `INSERT INTO admin_logs (admin_id, target_account_id, action, reason, detail, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [admin_id || null, target_account_id || null, action, reason || '', detail || '', new Date().toISOString()],
  });
  return toNumberId(result.lastInsertRowid);
}

/**
 * 获取管理员操作日志
 */
export async function getAdminLogs(limit = 50) {
  if (!db) return [];
  const rs = await db.execute({
    sql: 'SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT ?',
    args: [limit],
  });
  return rs.rows;
}

// ===== 路线记忆 =====
export async function searchRoutes(lat, lng, limit = 5) {
  if (!db) return [];
  // 简化版: 查找起点附近1000米内的常用路线
  const rs = await db.execute({
    sql: `SELECT *, (
            (start_lat - ?) * (start_lat - ?) + (start_lng - ?) * (start_lng - ?)
          ) as dist
          FROM routes
          ORDER BY dist ASC, visit_count DESC
          LIMIT ?`,
    args: [lat, lat, lng, lng, limit],
  });
  return rs.rows;
}

export async function addRoute(route) {
  if (!db) return null;
  const { start_lat, start_lng, end_lat, end_lng, route_name } = route;
  const now = new Date().toISOString();
  // upsert: 相同起终点路线已存在则递增visit_count,否则插入新记录
  const existingRs = await db.execute({
    sql: `SELECT id, visit_count FROM routes
          WHERE start_lat=? AND start_lng=? AND end_lat=? AND end_lng=?`,
    args: [start_lat, start_lng, end_lat, end_lng],
  });
  const existing = existingRs.rows[0];
  if (existing) {
    await db.execute({
      sql: `UPDATE routes SET visit_count=visit_count+1, last_visited=?, route_name=?
            WHERE id=?`,
      args: [now, route_name, existing.id],
    });
    return existing.id;
  }
  const result = await db.execute({
    sql: `INSERT INTO routes (start_lat, start_lng, end_lat, end_lng, route_name, visit_count, last_visited, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    args: [start_lat, start_lng, end_lat, end_lng, route_name, now, now],
  });
  return toNumberId(result.lastInsertRowid);
}

export async function getAllRoutes() {
  if (!db) return [];
  const rs = await db.execute('SELECT * FROM routes ORDER BY visit_count DESC, last_visited DESC');
  return rs.rows;
}

// ===== 熟人面孔 =====
export async function searchFaces() {
  if (!db) return [];
  const rs = await db.execute('SELECT * FROM faces ORDER BY visit_count DESC, last_seen DESC');
  return rs.rows;
}

export async function addFace(face) {
  if (!db) return null;
  const { name, relation, description } = face;
  const existingRs = await db.execute({
    sql: 'SELECT id FROM faces WHERE name = ?',
    args: [name],
  });
  const existing = existingRs.rows[0];
  if (existing) {
    await db.execute({
      sql: 'UPDATE faces SET visit_count = visit_count + 1, last_seen = ? WHERE id = ?',
      args: [new Date().toISOString(), existing.id],
    });
    return existing.id;
  }
  const result = await db.execute({
    sql: `INSERT INTO faces (name, relation, description, visit_count, last_seen, created_at)
          VALUES (?, ?, ?, 1, ?, ?)`,
    args: [name, relation, description, new Date().toISOString(), new Date().toISOString()],
  });
  return toNumberId(result.lastInsertRowid);
}

export async function forgetAllFaces() {
  if (!db) return 0;
  const result = await db.execute('DELETE FROM faces');
  return toChanges(result.rowsAffected);
}

// ===== 习惯 =====
export async function getHabit(type, key) {
  if (!db) return null;
  const rs = await db.execute({
    sql: 'SELECT * FROM habits WHERE habit_type = ? AND habit_key = ?',
    args: [type, key],
  });
  return rs.rows[0] || null;
}

export async function upsertHabit(type, key, value) {
  if (!db) return null;
  const existingRs = await db.execute({
    sql: 'SELECT id FROM habits WHERE habit_type = ? AND habit_key = ?',
    args: [type, key],
  });
  const existing = existingRs.rows[0];
  if (existing) {
    await db.execute({
      sql: 'UPDATE habits SET habit_value = ?, trigger_count = trigger_count + 1, last_triggered = ? WHERE id = ?',
      args: [value, new Date().toISOString(), existing.id],
    });
    return existing.id;
  }
  const result = await db.execute({
    sql: `INSERT INTO habits (habit_type, habit_key, habit_value, trigger_count, last_triggered, created_at)
          VALUES (?, ?, ?, 1, ?, ?)`,
    args: [type, key, value, new Date().toISOString(), new Date().toISOString()],
  });
  return toNumberId(result.lastInsertRowid);
}

export async function getAllHabits() {
  if (!db) return [];
  const rs = await db.execute('SELECT * FROM habits ORDER BY last_triggered DESC');
  return rs.rows;
}

// ===== SOS事件 =====
export async function addSosEvent(event) {
  if (!db) return null;
  const { event_type, lat, lng, address, contact_name, contact_phone } = event;
  const result = await db.execute({
    sql: `INSERT INTO sos_events (event_type, lat, lng, address, contact_name, contact_phone, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [event_type, lat, lng, address, contact_name, contact_phone, new Date().toISOString()],
  });
  return toNumberId(result.lastInsertRowid);
}

export async function updateSosStatus(id, status) {
  if (!db) return;
  await db.execute({
    sql: 'UPDATE sos_events SET status = ? WHERE id = ?',
    args: [status, id],
  });
}

export async function getSosEvents(limit = 20) {
  if (!db) return [];
  const rs = await db.execute({
    sql: 'SELECT * FROM sos_events ORDER BY created_at DESC LIMIT ?',
    args: [limit],
  });
  return rs.rows;
}

export async function clearSosEvents() {
  if (!db) return 0;
  const result = await db.execute('DELETE FROM sos_events');
  return toChanges(result.rowsAffected);
}

// ===== 记忆总览 =====
export async function getMemoryStats() {
  if (!db) return { routes: 0, faces: 0, habits: 0, sos_events: 0 };
  const [routesRs, facesRs, habitsRs, sosRs] = await Promise.all([
    db.execute('SELECT COUNT(*) as c FROM routes'),
    db.execute('SELECT COUNT(*) as c FROM faces'),
    db.execute('SELECT COUNT(*) as c FROM habits'),
    db.execute('SELECT COUNT(*) as c FROM sos_events'),
  ]);
  return {
    routes: routesRs.rows[0].c,
    faces: facesRs.rows[0].c,
    habits: habitsRs.rows[0].c,
    sos_events: sosRs.rows[0].c,
  };
}

// ===== 数据分析聚合查询(管理后台 /admin/analytics) =====

/**
 * 最近7天每天活跃用户数与SOS事件数
 * - 活跃用户: 简化为按 accounts.created_at 当天注册量统计
 * - SOS事件: sos_events.created_at 按天分组计数
 * - 返回: [{ date:'YYYY-MM-DD', active:number, sos:number }]
 */
export async function getLast7DaysStats() {
  if (!db) return [];
  // 生成最近7天日期列表(含今天)
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  // 按天统计新增账号数 (substr(1,10) 截取 ISO 字符串前10位日期)
  const accRs = await db.execute({
    sql: `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c
          FROM accounts
          WHERE created_at IS NOT NULL
            AND substr(created_at, 1, 10) >= ?
          GROUP BY d`,
    args: [days[0]],
  });
  const accMap = new Map();
  for (const r of accRs.rows) accMap.set(r.d, r.c);

  // 按天统计 SOS 事件数
  const sosRs = await db.execute({
    sql: `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c
          FROM sos_events
          WHERE created_at IS NOT NULL
            AND substr(created_at, 1, 10) >= ?
          GROUP BY d`,
    args: [days[0]],
  });
  const sosMap = new Map();
  for (const r of sosRs.rows) sosMap.set(r.d, r.c);

  return days.map(date => ({
    date,
    active: accMap.get(date) || 0,
    sos: sosMap.get(date) || 0,
  }));
}

/**
 * SOS事件按类型分布(event_type字段)
 * - 返回: [{ type:string, count:number }]
 */
export async function getSosDistribution() {
  if (!db) return [];
  const rs = await db.execute(
    `SELECT COALESCE(NULLIF(event_type, ''), 'unknown') AS type, COUNT(*) AS count
     FROM sos_events
     GROUP BY type
     ORDER BY count DESC`
  );
  return rs.rows.map(r => ({ type: r.type, count: r.count }));
}

/**
 * 账号累计增长趋势(按天累计, 最近7天)
 * - 返回: [{ date:'YYYY-MM-DD', total:number }]
 */
export async function getAccountGrowth() {
  if (!db) return [];
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  // 先取截止到7天前的累计数作为基线
  const baseRs = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM accounts
          WHERE created_at IS NOT NULL AND substr(created_at, 1, 10) < ?`,
    args: [days[0]],
  });
  let cumulative = Number(baseRs.rows[0].c) || 0;

  // 再取7天内每天的新增账号数
  const dailyRs = await db.execute({
    sql: `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c
          FROM accounts
          WHERE created_at IS NOT NULL AND substr(created_at, 1, 10) >= ?
          GROUP BY d`,
    args: [days[0]],
  });
  const dailyMap = new Map();
  for (const r of dailyRs.rows) dailyMap.set(r.d, r.c);

  return days.map(date => {
    cumulative += (dailyMap.get(date) || 0);
    return { date, total: cumulative };
  });
}
