/**
 * PerceptionArk 后端入口
 * - Express REST API
 * - WebSocket 实时推送 (Agent事件/抢占/告警)
 */
// dotenv必须在所有其他import之前加载,否则amap-client/trae-client等模块在import时
// 读取process.env会是undefined(ES模块import在dotenv.config()之前执行)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';

import apiRouter from './routes/api.js';
import familyRouter from './routes/family.js';
import assistantRouter from './routes/assistant.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import { initMemoryStore } from './services/memory-store.js';
import { addListener, removeListener } from './agents/orchestrator.js';
import { log } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件 - 生产环境部署前端build产物
// index.html 不缓存(每次请求都拉最新,确保引用最新的hash文件名)
// /assets/ 长缓存(文件名带hash,内容变化时hash自动变化)
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      // index.html 禁止缓存,确保用户总能拿到最新版本引用
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.includes(path.sep + 'assets' + path.sep)) {
      // hash文件名资源,1年长缓存
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// 路由
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);
app.use('/api/family', familyRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/admin', adminRouter);

// 未知API路由返回JSON 404
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'API not found' });
});

// 前端路由回退(SPA)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  // SPA回退的index.html也禁止缓存,确保用户拿到最新hash文件名
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(frontendDist, 'index.html'), err => {
    if (err) next();
  });
});

// 全局错误处理中间件 - 统一JSON错误响应格式
app.use((err, req, res, next) => {
  // multer 文件超限
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, error: '文件过大(限制5MB)' });
  }
  log('SYS', `未捕获错误: ${err.message}`, 'error');
  res.status(err.status || 500).json({
    success: false,
    error: err.message || '服务器内部错误'
  });
});

// HTTP服务器 + WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  log('SYS', 'WebSocket客户端已连接');

  // 推送Agent事件给客户端
  const listener = (event) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(event));
    }
  };
  addListener(listener);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }));
      }
    } catch (e) {
      log('SYS', `WebSocket消息解析失败: ${e.message}`, 'warn');
    }
  });

  ws.on('close', () => {
    removeListener(listener);
    log('SYS', 'WebSocket客户端已断开');
  });

  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'PerceptionArk WebSocket已连接',
    time: new Date().toISOString()
  }));
});

// 启动
initMemoryStore();

server.listen(PORT, () => {
  log('SYS', `═══════════════════════════════════════════`);
  log('SYS', `PerceptionArk Backend 启动成功`);
  log('SYS', `HTTP: http://localhost:${PORT}`);
  log('SYS', `WebSocket: ws://localhost:${PORT}/ws`);
  log('SYS', `API文档: http://localhost:${PORT}/api/health`);
  log('SYS', `═══════════════════════════════════════════`);

  if (!process.env.QWEN_API_KEY || !process.env.QWEN_API_KEY.startsWith('sk-')) {
    log('SYS', '⚠ 未配置 QWEN_API_KEY，将使用MOCK模式运行', 'warn');
    log('SYS', '  配置方法: 编辑 backend/.env 并填写真实千问API Key', 'warn');
  } else {
    log('SYS', '✓ 已检测到 QWEN_API_KEY，将使用真实千问大模型');
  }

  const wakeWord = process.env.ASSISTANT_WAKE_WORD || '小舟小舟';
  log('SYS', `✓ 小舟智能助手已就绪 · 唤醒词: "${wakeWord}"`);
});

// 优雅关闭: 收到终止信号时关闭HTTP服务器和WebSocket
function gracefulShutdown(signal) {
  log('SYS', `收到 ${signal} 信号,开始优雅关闭...`);
  server.close(() => {
    log('SYS', 'HTTP服务器已关闭');
    wss.close(() => {
      log('SYS', 'WebSocket服务器已关闭');
      process.exit(0);
    });
  });
  // 5秒后强制退出(防止连接不释放)
  setTimeout(() => {
    log('SYS', '强制退出', 'warn');
    process.exit(1);
  }, 5000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// 未捕获异常兜底(防止进程崩溃)
process.on('uncaughtException', (err) => {
  log('SYS', `未捕获异常: ${err.message}`, 'error');
});
process.on('unhandledRejection', (reason) => {
  log('SYS', `未处理的Promise拒绝: ${reason}`, 'error');
});
