/**
 * 小舟智能助手路由
 * - POST /api/assistant/chat  多轮对话(支持文本+图片)
 * - POST /api/assistant/clear 清空会话
 * - GET  /api/assistant/history/:sessionId 获取历史
 */
import { Router } from 'express';
import multer from 'multer';
import {
  getOrCreateSession, appendMessage, getSessionHistory, clearSession,
  understandIntent, generateReply
} from '../services/assistant.js';
import {
  runSceneAgent, runNavigationAgent, runSafetyAgent, runSocialAgent,
  runMemoryAgent, triggerFallDetection, updateLocation, cancelFallSos
} from '../agents/orchestrator.js';
import { log } from '../utils/logger.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function imgToBase64(file) {
  if (!file) return null;
  return file.buffer.toString('base64');
}

/**
 * POST /api/assistant/chat
 * body: { text, sessionId?, lat?, lng?, address? }
 * file: image (可选)
 */
router.post('/chat', upload.single('image'), async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    const sessionId = req.body.sessionId || '';
    const image = imgToBase64(req.file);
    let location = null;
    if (req.body.lat && req.body.lng) {
      location = {
        lat: parseFloat(req.body.lat),
        lng: parseFloat(req.body.lng),
        address: req.body.address || ''
      };
    }

    if (!text) {
      return res.status(400).json({ error: '缺少对话文本' });
    }

    // 获取/创建会话
    const session = getOrCreateSession(sessionId);
    appendMessage(session.id, 'user', text);

    // 更新位置到共享上下文(确保SOS等场景能获取最新位置含省市区)
    if (location?.lat && location?.lng) {
      updateLocation(location.lat, location.lng, location.address, { province: location.province, city: location.city, district: location.district });
    }

    log('小舟', `收到消息 [${session.id}]: ${text}`);

    // 意图识别
    const intent = await understandIntent(text, session.id);
    log('小舟', `意图: ${intent.intent}${intent.entity ? ` · 实体: ${intent.entity}` : ''}`);

    let reply = '';
    let action = null;

    // 根据意图调用对应Agent能力
    const replies = {
      navigate: [`好的，正在为您规划到${intent.entity || '目的地'}的路线。`, `马上带您去${intent.entity || '目的地'}，路线规划中。`, `收到，正在导航到${intent.entity || '目的地'}。`],
      ocr: ['正在读取面前的文字。', '好的，我来帮您看看上面写了什么。', '正在识别文字内容。'],
      face: ['正在为您辨认面前的人。', '好的，让我看看是谁。', '正在识别人脸特征。'],
      scene: ['正在为您观察周围环境。', '好的，我来描述一下当前的场景。', '正在分析周围情况。'],
      safety: ['正在为您检查前方安全。', '好的，我来看看有没有危险。', '正在扫描周围安全隐患。'],
      memory: ['正在为您回忆相关信息。', '好的，让我想想之前的情况。', '正在检索您的记忆库。'],
      fall: ['紧急情况已触发，正在为您联系紧急联系人。', '检测到跌倒，SOS已启动。']
    };
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    switch (intent.intent) {
      case 'navigate': {
        const dest = (intent.entity || '').trim();
        if (!dest) {
          reply = '您想去哪里呢？请告诉我目的地，比如"带我去五一广场"。';
          break;
        }
        action = 'navigate';
        await runNavigationAgent(dest, location?.lat, location?.lng);
        reply = pick(replies.navigate).replace(/目的地/g, dest);
        break;
      }

      case 'ocr':
        action = 'ocr';
        await runSocialAgent(image, 'ocr');
        reply = pick(replies.ocr);
        break;

      case 'face':
        action = 'face';
        await runSocialAgent(image, 'face');
        reply = pick(replies.face);
        break;

      case 'scene':
        action = 'scene';
        await runSceneAgent(image, text);
        reply = pick(replies.scene);
        break;

      case 'safety':
        action = 'safety';
        await runSafetyAgent(image, 'scan');
        reply = pick(replies.safety);
        break;

      case 'memory':
        action = 'memory';
        await runMemoryAgent(text);
        reply = pick(replies.memory);
        break;

      case 'fall':
        action = 'fall';
        await triggerFallDetection(location?.lat, location?.lng);
        reply = pick(replies.fall);
        break;

      case 'cancel_sos':
        action = 'cancel_sos';
        {
          const cancelled = cancelFallSos();
          reply = cancelled ? '好的，已取消SOS。' : '当前没有进行中的SOS倒计时。';
        }
        break;

      case 'chat':
      default:
        // 纯对话 - 调LLM生成回复
        reply = intent.reply || await generateReply(text, session.id);
        break;
    }

    // 保存助手回复到会话
    appendMessage(session.id, 'assistant', reply);

    res.json({
      success: true,
      sessionId: session.id,
      reply,
      intent: intent.intent,
      action,
      entity: intent.entity || null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    log('小舟', `对话失败: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/assistant/clear
 * body: { sessionId }
 */
router.post('/clear', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) clearSession(sessionId);
  res.json({ success: true });
});

/**
 * GET /api/assistant/history/:sessionId
 */
router.get('/history/:sessionId', (req, res) => {
  const history = getSessionHistory(req.params.sessionId);
  res.json({ success: true, messages: history });
});

export default router;
