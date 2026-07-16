/**
 * 小舟智能助手服务
 * - 多轮对话记忆(按会话ID)
 * - 意图识别 + 调用五大Agent能力
 * - 视障者友好的温暖语气
 */
import { textChat, isConfigured } from './trae-client.js';
import { log, genId, now } from '../utils/logger.js';

// 会话记忆库: sessionId -> { messages: [], createdAt, lastActive }
const sessions = new Map();
const HISTORY_LIMIT = parseInt(process.env.ASSISTANT_HISTORY_LIMIT || '20', 10);

// 系统提示词 - 定义小舟人格
const SYSTEM_PROMPT = `你是"小舟"，感知方舟AI感知眼镜的语音助手，服务视障用户。

## 你的角色
- 温暖、简洁、主动，像一位可靠的朋友
- 回答控制在50字以内，复杂信息分条说明
- 涉及安全的信息用"注意"开头，紧急情况用"紧急"开头

## 你能调用的能力(通过函数调用)
- navigate(目的地): 步行导航，如"带我去超市"
- ocr(): 读取面前文字(菜单/招牌/药盒)
- face(): 描述面前的人
- scene(): 描述当前环境
- safety(): 安全检查
- memory(): 检索历史记忆
- fall(): 跌倒SOS

## 行为规则
1. 用户指令明确时直接调用对应能力，不要重复确认
2. 不确定时简短询问，如"您是想读文字还是识别人脸？"
3. 调用能力后，将结果转化为视障者易懂的自然语言
4. 用户无明确指令时，主动询问"需要我帮您做什么？"

## 上下文
当前用户是视障者，佩戴AI感知眼镜，你在眼镜中运行。`;

/**
 * 创建或获取会话
 */
export function getOrCreateSession(sessionId) {
  const id = sessionId || genId('sess');
  if (!sessions.has(id)) {
    sessions.set(id, {
      messages: [],
      createdAt: now(),
      lastActive: now()
    });
    log('小舟', `新会话创建: ${id}`);
  }
  const session = sessions.get(id);
  session.lastActive = now();
  return { id, ...session };
}

/**
 * 添加消息到会话历史
 */
export function appendMessage(sessionId, role, content) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.messages.push({ role, content, time: now() });
  // 超长时裁剪，保留system提示
  if (session.messages.length > HISTORY_LIMIT) {
    session.messages = session.messages.slice(-HISTORY_LIMIT);
  }
}

/**
 * 获取会话历史
 */
export function getSessionHistory(sessionId) {
  const session = sessions.get(sessionId);
  return session ? session.messages.slice() : [];
}

/**
 * 清空会话
 */
export function clearSession(sessionId) {
  if (sessions.has(sessionId)) {
    sessions.set(sessionId, {
      messages: [],
      createdAt: now(),
      lastActive: now()
    });
    log('小舟', `会话已清空: ${sessionId}`);
  }
}

/**
 * 意图识别 + 回复生成 (单次LLM调用,同时完成两件事)
 * 返回 { intent, entity, reply }
 *   - intent: 'navigate'|'ocr'|'face'|'scene'|'safety'|'memory'|'fall'|'chat'
 *   - entity: 调用能力时的参数(如目的地)
 *   - reply: 给用户的回复(action类意图告知正在执行,chat类意图为自然回复)
 */
export async function understandIntent(text, sessionId) {
  // 1. 规则优先匹配(快速路径,免LLM调用,延迟最低)
  // 注意: memory规则必须在navigate之前,避免"之前去过哪里"被navigate的"去"误匹配
  const rules = [
    { intent: 'select_poi', patterns: [/去第([一二三四五六七八九\d]+)个?/, /去最近的/, /去第一/, /第([一二三四五六七八九\d]+)个/], extract: (m) => m[0] },
    { intent: 'memory', patterns: [/记忆/, /上次/, /之前/, /最近/, /常去/, /习惯/, /去过哪里/, /来过/, /去过/] },
    { intent: 'navigate', patterns: [/带我去(.+)/, /导航到(.+)/, /怎么去(.+)/, /帮我去(.+)/, /我要去(.+)/, /附近(.+)/, /去(?!过|来|回|出)(.+)/], extract: (m) => m[1] },
    { intent: 'ocr', patterns: [/读.{0,4}(文字|菜单|招牌|说明书|药盒|价签)/, /识别.{0,4}(文字|菜单)/, /^读/, /^念/] },
    { intent: 'face', patterns: [/前面是谁/, /谁.{0,2}走过/, /认识.{0,2}他/, /识别人脸/] },
    { intent: 'scene', patterns: [/前面是什么/, /前方.{0,2}什么/, /描述.{0,2}环境/, /路况/, /周围/] },
    { intent: 'safety', patterns: [/安全/, /危险/, /检查.{0,2}(前方|周围)/] },
    { intent: 'fall', patterns: [/跌倒/, /摔倒/, /sos/i, /救命/] },
    { intent: 'cancel_sos', patterns: [/我没事/, /取消/, /误报/, /没(有)?(摔倒|跌倒)/] }
  ];

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        // 清理entity: 去除语气词/标点/多余问句,保留纯目的地
        let entity = null;
        if (rule.extract) {
          entity = rule.extract(match)
            .replace(/的|了|吗|。|，|,$/g, '')
            .replace(/(怎么走|怎么去|怎么走呢|怎么去呢|谢谢|请|请问|麻烦).*/g, '')
            .replace(/^[，,。.\s]+|[，,。.\s]+$/g, '')
            .trim();
          // 清理后为空则视为无目的地
          if (!entity) entity = null;
        }
        return {
          intent: rule.intent,
          entity,
          reply: null
        };
      }
    }
  }

  // 2. 未配置AI时返回默认对话
  if (!isConfigured()) {
    return {
      intent: 'chat',
      reply: '我听到了。目前我还没接入AI大脑，请在backend/.env中配置ARK_API_KEY后我就能完整理解您了。'
    };
  }

  // 3. LLM 一次调用同时完成: 意图识别 + 对话回复
  // (旧实现分两次调用understandIntent+generateReply,延迟翻倍且双倍失败率)
  try {
    const history = getSessionHistory(sessionId);
    const result = await textChat(
      [
        ...history.slice(-6),
        { role: 'user', content: text }
      ],
      SYSTEM_PROMPT + `

## 当前任务
判断用户意图并给出回复。必须严格返回JSON格式(不要markdown代码块):
{"intent":"navigate|ocr|face|scene|safety|memory|fall|chat","entity":"目的地或null","reply":"给用户的回复"}

规则:
- navigate: 导航请求,entity为目的地,reply如"好的，正在为您规划路线"
- ocr/face/scene/safety/memory/fall: entity为null,reply简短告知正在执行
- chat: 普通对话,entity为null,reply为自然温暖回复(50字以内)
- 只返回JSON,不要任何其他文字`,
      { timeout: 10000, maxTokens: 200, temperature: 0.5 }
    );

    const match = result.match(/\{[\s\S]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        intent: parsed.intent || 'chat',
        entity: parsed.entity || null,
        reply: parsed.reply
      };
    }
    // LLM返回了非JSON文本,直接作为chat回复(豆包有时不按格式返回)
    return { intent: 'chat', entity: null, reply: result };
  } catch (err) {
    log('小舟', `LLM调用失败: ${err.message}`, 'error');
    // 根据错误类型给出不同的兜底回复
    if (err.message.includes('超时')) {
      return { intent: 'chat', entity: null, reply: '我思考有点慢，请稍等再说一次。' };
    }
    if (err.message.includes('401') || err.message.includes('认证')) {
      return { intent: 'chat', entity: null, reply: 'AI服务认证失败，请检查密钥配置。' };
    }
    return { intent: 'chat', entity: null, reply: '抱歉，我没跟上，能换个方式说说吗？' };
  }
}

/**
 * 生成对话回复(仅当understandIntent返回chat但reply为空时的fallback)
 */
export async function generateReply(text, sessionId) {
  if (!isConfigured()) {
    return '我收到了您的消息，但当前未接入AI能力。';
  }
  try {
    const history = getSessionHistory(sessionId);
    const reply = await textChat(
      [
        ...history.slice(-6),
        { role: 'user', content: text }
      ],
      SYSTEM_PROMPT,
      { timeout: 20000, maxTokens: 200, temperature: 0.6 }
    );
    return reply;
  } catch (err) {
    log('小舟', `对话生成失败: ${err.message}`, 'error');
    if (err.message.includes('超时')) return '我思考有点慢，请稍等再说一次。';
    return '抱歉，我没跟上，能换个方式说说吗？';
  }
}

/**
 * 清理过期会话(超过30分钟未活跃)
 */
export function cleanupSessions() {
  const threshold = Date.now() - 30 * 60 * 1000;
  let cleaned = 0;
  for (const [id, session] of sessions.entries()) {
    if (new Date(session.lastActive).getTime() < threshold) {
      sessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) log('小舟', `清理 ${cleaned} 个过期会话`);
}

// 每10分钟清理一次
setInterval(cleanupSessions, 10 * 60 * 1000);
