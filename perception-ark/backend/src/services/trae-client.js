/**
 * 阿里千问 Qwen API 客户端 (多模型分工 + Omni兜底)
 * 模型分工:
 *   - qwen-vl-plus      视觉理解/OCR (A01场景/A03安全/A04-OCR) 速度快成本低
 *   - qwen-turbo        纯文本意图识别 (A02导航/选择POI)        最快最省
 *   - qwen-omni-turbo   全模态 (A04人脸:需视觉+语音)
 *   - qwen3.5-omni-flash 默认Omni (全模态兜底,任何专用模型失败时自动降级)
 * 平台: DashScope OpenAI兼容格式
 */
import axios from 'axios';
import { log } from '../utils/logger.js';

// 函数内部读取env,避免ES模块import时dotenv尚未加载的问题
function getConfig() {
  const API_KEY = process.env.QWEN_API_KEY || '';
  const API_BASE = process.env.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const MODEL = process.env.QWEN_MODEL || 'qwen3.5-omni-flash'; // 默认Omni(兜底模型)
  const MODEL_VL = process.env.QWEN_MODEL_VL || 'qwen-vl-plus'; // 视觉专用(A01场景/A03安全)
  const MODEL_OCR = process.env.QWEN_MODEL_OCR || MODEL_VL; // OCR专用(默认同VL,可升级到vl-max)
  const MODEL_TURBO = process.env.QWEN_MODEL_TURBO || 'qwen-turbo'; // 文本专用
  const MODEL_OMNI_TURBO = process.env.QWEN_MODEL_OMNI || 'qwen-omni-turbo'; // 全模态专用
  const MOCK_MODE = process.env.MOCK_MODE === 'true';
  return { API_KEY, API_BASE, MODEL, MODEL_VL, MODEL_OCR, MODEL_TURBO, MODEL_OMNI_TURBO, MOCK_MODE };
}

/**
 * 获取各专用模型名称,供 orchestrator 调度使用
 */
export function getModels() {
  const { MODEL, MODEL_VL, MODEL_OCR, MODEL_TURBO, MODEL_OMNI_TURBO } = getConfig();
  return { default: MODEL, vl: MODEL_VL, ocr: MODEL_OCR, turbo: MODEL_TURBO, omni: MODEL_OMNI_TURBO };
}

export const isConfigured = () => {
  const { API_KEY, MOCK_MODE } = getConfig();
  if (MOCK_MODE) return true; // MOCK模式下视为已配置
  return !!API_KEY && API_KEY.startsWith('sk-');
};

// ============ MOCK 模拟数据 (仅在MOCK_MODE=true时使用) ============
function getMockSceneDescription(prompt) {
  if (prompt && /红绿灯|红灯|绿灯|信号灯/.test(prompt)) {
    return JSON.stringify({
      safe: true,
      traffic_light: 'none',
      direction: '正前方',
      distance: 10,
      crosswalk: false,
      object: '前方道路',
      action: '请继续前行',
      urgent: false
    });
  }
  if (prompt && /障碍物|危险|安全/.test(prompt)) {
    return JSON.stringify({
      safe: true,
      direction: '正前方',
      distance: 5,
      object: '前方道路畅通',
      action: '请继续沿盲道前行',
      urgent: false
    });
  }
  return '正前方约3米处是人行道，路面平坦无障碍物。左前方2米有一棵行道树，右前方4米有一根电线杆。视线开阔，适合继续前行。';
}

function getMockOCRResult() {
  return '【模拟OCR识别】\n感知方舟\n智能出行助手\n让每一次出行都安心';
}

function getMockFaceResult() {
  return '前方约2米有一位行人，面带微笑，似乎在向您打招呼。穿着深色外套，戴着眼镜。';
}

function getMockTextChat(messages, systemPrompt) {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const text = lastUserMsg?.content || '';
  if (/导航|去|路线/.test(text)) {
    return JSON.stringify({ intent: 'navigate', entity: text.replace(/.*?(?:导航到|带我去|我要去|去)/, '').trim() || '附近的超市', reply: '好的，正在为您规划路线' });
  }
  if (/读|文字|识别/.test(text)) {
    return JSON.stringify({ intent: 'ocr', entity: null, reply: '正在为您识别文字' });
  }
  if (/谁|人|脸/.test(text)) {
    return JSON.stringify({ intent: 'face', entity: null, reply: '正在识别前方人物' });
  }
  if (/环境|前面|周围|路况/.test(text)) {
    return JSON.stringify({ intent: 'scene', entity: null, reply: '正在描述前方环境' });
  }
  if (/安全|危险|检查/.test(text)) {
    return JSON.stringify({ intent: 'safety', entity: null, reply: '正在进行安全检查' });
  }
  return '好的，我明白了。（模拟模式：当前未配置真实AI，请在backend/.env中配置QWEN_API_KEY获得完整体验）';
}

// ============ 内部单模型调用(含429重试) ============
/**
 * 视觉理解单模型调用(含429限流重试)
 * @returns {Promise<string>} AI回答
 */
async function _visionCall(imageBase64, prompt, useModel) {
  const { API_KEY, API_BASE } = getConfig();
  const startTime = Date.now();
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.post(
        `${API_BASE}/chat/completions`,
        {
          model: useModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
                }
              ]
            }
          ],
          modalities: ['text'],
          max_tokens: 500,
          temperature: 0.4
        },
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        }
      );
      const latency = Date.now() - startTime;
      const result = response.data.choices[0].message.content;
      log('A01', `视觉理解[${useModel}]完成 (${latency}ms): ${String(result).slice(0, 60)}...`);
      return result;
    } catch (err) {
      lastErr = err;
      // 429限流: 指数退避重试
      if (err.response?.status === 429 && attempt < 2) {
        const waitMs = 1500 * Math.pow(2, attempt);
        log('A01', `模型${useModel}限流(429), ${waitMs}ms后重试(第${attempt + 1}次)`, 'warn');
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      break;
    }
  }
  // 增强错误信息
  if (lastErr.response) {
    const detail = lastErr.response.data?.error?.message || lastErr.response.data?.message || lastErr.response.statusText;
    throw new Error(`千问视觉API错误(${lastErr.response.status}): ${detail}`);
  }
  throw lastErr;
}

/**
 * 视觉理解 - 图片+文本 -> 场景描述
 * @param {string} imageBase64 - base64编码的图片(不含data:image前缀)
 * @param {string} prompt - 提问文本
 * @param {string} modelOverride - 专用模型(如qwen-vl-plus),失败自动降级到默认Omni
 * @returns {Promise<string>} AI回答
 */
export async function visionUnderstand(imageBase64, prompt, modelOverride = null) {
  const { MODEL, MOCK_MODE } = getConfig();

  // MOCK模式: 返回模拟数据
  if (MOCK_MODE) {
    log('A01', '【MOCK模式】视觉理解返回模拟结果');
    return getMockSceneDescription(prompt);
  }

  if (!isConfigured()) {
    throw new Error('未配置 QWEN_API_KEY，无法调用千问视觉模型');
  }
  if (!imageBase64) {
    throw new Error('未获取到摄像头画面，无法进行视觉分析');
  }

  const primaryModel = modelOverride || MODEL;
  try {
    return await _visionCall(imageBase64, prompt, primaryModel);
  } catch (err) {
    // 专用模型失败,降级到默认Omni兜底
    if (modelOverride && modelOverride !== MODEL) {
      log('A01', `专用模型${modelOverride}失败,降级到Omni[${MODEL}]兜底: ${err.message}`, 'warn');
      return await _visionCall(imageBase64, prompt, MODEL);
    }
    throw err;
  }
}

// ============ OCR 文字识别 ============
/**
 * OCR单模型调用
 */
async function _ocrCall(imageBase64, useModel) {
  const { API_KEY, API_BASE } = getConfig();
  const startTime = Date.now();
  const response = await axios.post(
    `${API_BASE}/chat/completions`,
    {
      model: useModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别图片中的所有文字，按原文格式输出。如果是菜单/价签/路牌/药盒等结构化文本，请按"名称 价格"或"项目:内容"的格式逐行列出。仅输出识别的文字内容，不要解释。' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }
      ],
      modalities: ['text'],
      max_tokens: 800,
      temperature: 0.2
    },
    {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 20000
    }
  );
  const latency = Date.now() - startTime;
  const result = response.data.choices[0].message.content;
  log('A04', `OCR[${useModel}]识别完成 (${latency}ms): ${String(result).slice(0, 60)}...`);
  return result;
}

/**
 * OCR文字识别 - 使用千问视觉模型识别图片中的文字
 * @param {string} imageBase64 - base64编码的图片
 * @param {string} modelOverride - 专用模型(如qwen-vl-plus),失败自动降级到默认Omni
 */
export async function ocrRecognize(imageBase64, modelOverride = null) {
  const { MODEL, MOCK_MODE } = getConfig();

  if (MOCK_MODE) {
    log('A04', '【MOCK模式】OCR识别返回模拟结果');
    return getMockOCRResult();
  }

  if (!isConfigured()) {
    throw new Error('未配置 QWEN_API_KEY，无法调用千问视觉模型');
  }
  if (!imageBase64) {
    throw new Error('未获取到摄像头画面，无法进行OCR识别');
  }

  const primaryModel = modelOverride || MODEL;
  try {
    return await _ocrCall(imageBase64, primaryModel);
  } catch (err) {
    if (modelOverride && modelOverride !== MODEL) {
      log('A04', `专用模型${modelOverride}失败,降级到Omni[${MODEL}]兜底: ${err.message}`, 'warn');
      return await _ocrCall(imageBase64, MODEL);
    }
    if (err.response) {
      const detail = err.response.data?.error?.message || err.response.data?.message || err.response.statusText;
      throw new Error(`千问OCR API错误(${err.response.status}): ${detail}`);
    }
    throw err;
  }
}

// ============ 人脸描述 ============
/**
 * 人脸描述单模型调用
 */
async function _faceCall(imageBase64, useModel) {
  const { API_KEY, API_BASE } = getConfig();
  const startTime = Date.now();
  const response = await axios.post(
    `${API_BASE}/chat/completions`,
    {
      model: useModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请描述画面中的人物：性别、大致年龄、衣着特征、是否在向您挥手或打招呼、面部表情。如果是熟人请描述显著特征（如戴眼镜、发型等）。50字以内。' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }
      ],
      modalities: ['text'],
      max_tokens: 200,
      temperature: 0.5
    },
    {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 20000
    }
  );
  const latency = Date.now() - startTime;
  const result = response.data.choices[0].message.content;
  log('A04', `人脸描述[${useModel}]完成 (${latency}ms): ${String(result).slice(0, 60)}...`);
  return result;
}

/**
 * 人脸描述 - 使用千问模型描述画面中的人
 * @param {string} imageBase64 - base64编码的图片
 * @param {string} modelOverride - 专用模型(如qwen-omni-turbo),失败自动降级到默认Omni
 */
export async function faceDescribe(imageBase64, modelOverride = null) {
  const { MODEL, MOCK_MODE } = getConfig();

  if (MOCK_MODE) {
    log('A04', '【MOCK模式】人脸描述返回模拟结果');
    return getMockFaceResult();
  }

  if (!isConfigured()) {
    throw new Error('未配置 QWEN_API_KEY，无法调用千问视觉模型');
  }
  if (!imageBase64) {
    throw new Error('未获取到摄像头画面，无法进行人脸识别');
  }

  const primaryModel = modelOverride || MODEL;
  try {
    return await _faceCall(imageBase64, primaryModel);
  } catch (err) {
    if (modelOverride && modelOverride !== MODEL) {
      log('A04', `专用模型${modelOverride}失败,降级到Omni[${MODEL}]兜底: ${err.message}`, 'warn');
      return await _faceCall(imageBase64, MODEL);
    }
    if (err.response) {
      const detail = err.response.data?.error?.message || err.response.data?.message || err.response.statusText;
      throw new Error(`千问人脸API错误(${err.response.status}): ${detail}`);
    }
    throw err;
  }
}

// ============ 文本对话 ============
/**
 * 文本对话单模型调用
 */
async function _textCall(messages, fullMessages, useModel, options) {
  const { API_KEY, API_BASE } = getConfig();
  const { timeout = 60000, maxTokens = 500, temperature = 0.6 } = options;
  const startTime = Date.now();
  try {
    const response = await axios.post(
      `${API_BASE}/chat/completions`,
      {
        model: useModel,
        messages: fullMessages,
        modalities: ['text'],
        max_tokens: maxTokens,
        temperature
      },
      {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        timeout
      }
    );
    const latency = Date.now() - startTime;
    const result = response.data.choices[0].message.content;
    log('LLM', `文本对话[${useModel}]完成 (${latency}ms): ${String(result).slice(0, 80)}`);
    return result;
  } catch (err) {
    const latency = Date.now() - startTime;
    if (err.code === 'ECONNABORTED') {
      log('LLM', `文本对话[${useModel}]超时 (${latency}ms, limit=${timeout}ms)`, 'error');
      throw new Error(`AI响应超时(${latency}ms)`);
    }
    if (err.response) {
      const status = err.response.status;
      const detail = err.response.data?.error?.message || err.response.data?.message || err.response.statusText;
      log('LLM', `文本对话[${useModel}]API错误 ${status}: ${detail} (${latency}ms)`, 'error');
      throw new Error(`AI服务错误(${status}): ${detail}`);
    }
    log('LLM', `文本对话[${useModel}]网络错误: ${err.message} (${latency}ms)`, 'error');
    throw new Error(`AI网络错误: ${err.message}`);
  }
}

/**
 * 文本对话 - 用于意图识别和多轮对话
 * @param {Array} messages - 消息列表
 * @param {string} systemPrompt - 系统提示词
 * @param {object} options - { timeout, maxTokens, temperature }
 * @param {string} modelOverride - 专用模型(如qwen-turbo),失败自动降级到默认Omni
 */
export async function textChat(messages, systemPrompt = '', options = {}, modelOverride = null) {
  const { MODEL, MOCK_MODE } = getConfig();

  if (MOCK_MODE) {
    log('LLM', '【MOCK模式】文本对话返回模拟结果');
    return getMockTextChat(messages, systemPrompt);
  }

  if (!isConfigured()) {
    throw new Error('未配置 QWEN_API_KEY，无法调用千问文本模型');
  }

  const fullMessages = [];
  if (systemPrompt) fullMessages.push({ role: 'system', content: systemPrompt });
  fullMessages.push(...messages);

  const primaryModel = modelOverride || MODEL;
  try {
    return await _textCall(messages, fullMessages, primaryModel, options);
  } catch (err) {
    // 专用模型失败,降级到默认Omni兜底
    if (modelOverride && modelOverride !== MODEL) {
      log('LLM', `专用模型${modelOverride}失败,降级到Omni[${MODEL}]兜底: ${err.message}`, 'warn');
      return await _textCall(messages, fullMessages, MODEL, options);
    }
    throw err;
  }
}
