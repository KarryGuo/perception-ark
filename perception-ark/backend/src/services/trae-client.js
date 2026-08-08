/**
 * 阿里千问 Qwen API 客户端 (全模态大模型)
 * 使用 Qwen3.5-Omni-Flash 模型,支持文本+图片+音频+视频输入
 * 平台: qianwenai.com (OpenAI兼容格式)
 * 文档: https://www.qianwenai.com/models/qwen3.5-omni-flash
 */
import axios from 'axios';
import { log } from '../utils/logger.js';

// 函数内部读取env,避免ES模块import时dotenv尚未加载的问题
function getConfig() {
  const API_KEY = process.env.QWEN_API_KEY || '';
  const API_BASE = process.env.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const MODEL = process.env.QWEN_MODEL || 'qwen3.5-omni-flash';
  const MOCK_MODE = process.env.MOCK_MODE === 'true';
  return { API_KEY, API_BASE, MODEL, MOCK_MODE };
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

/**
 * 视觉理解 - 图片+文本 -> 场景描述
 * 千问Omni模型支持OpenAI兼容的多模态格式:image_url或image(base64)
 * @param {string} imageBase64 - base64编码的图片(不含data:image前缀)
 * @param {string} prompt - 提问文本
 * @returns {Promise<string>} AI回答
 */
export async function visionUnderstand(imageBase64, prompt, modelOverride = null) {
  const { API_KEY, API_BASE, MODEL, MOCK_MODE } = getConfig();
  const useModel = modelOverride || MODEL;

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

  // 429限流自动重试(最多2次,指数退避)
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
      log('A01', `视觉理解完成 (${latency}ms): ${String(result).slice(0, 60)}...`);
      return result;
    } catch (err) {
      lastErr = err;
      // 429限流: 指数退避重试
      if (err.response?.status === 429 && attempt < 2) {
        const waitMs = 1500 * Math.pow(2, attempt);
        log('A01', `千问模型限流(429), ${waitMs}ms后重试(第${attempt + 1}次)`, 'warn');
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
 * OCR文字识别 - 使用千问模型识别图片中的文字
 */
export async function ocrRecognize(imageBase64) {
  const { API_KEY, API_BASE, MODEL, MOCK_MODE } = getConfig();

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

  const startTime = Date.now();
  try {
    const response = await axios.post(
      `${API_BASE}/chat/completions`,
      {
        model: MODEL,
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
    log('A04', `OCR识别完成 (${latency}ms): ${String(result).slice(0, 60)}...`);
    return result;
  } catch (err) {
    if (err.response) {
      const detail = err.response.data?.error?.message || err.response.data?.message || err.response.statusText;
      throw new Error(`千问OCR API错误(${err.response.status}): ${detail}`);
    }
    throw err;
  }
}

/**
 * 人脸描述 - 使用千问模型描述画面中的人
 */
export async function faceDescribe(imageBase64) {
  const { API_KEY, API_BASE, MODEL, MOCK_MODE } = getConfig();

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

  const startTime = Date.now();
  try {
    const response = await axios.post(
      `${API_BASE}/chat/completions`,
      {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '请描述画面中的人物：性别、大致年龄、衣着特征、是否在向你挥手或打招呼、面部表情。如果是熟人请描述显著特征（如戴眼镜、发型等）。50字以内。' },
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
    log('A04', `人脸描述完成 (${latency}ms): ${String(result).slice(0, 60)}...`);
    return result;
  } catch (err) {
    if (err.response) {
      const detail = err.response.data?.error?.message || err.response.data?.message || err.response.statusText;
      throw new Error(`千问人脸API错误(${err.response.status}): ${detail}`);
    }
    throw err;
  }
}

/**
 * 文本对话 - 用于意图识别和多轮对话
 * @param {Array} messages - 消息列表
 * @param {string} systemPrompt - 系统提示词
 * @param {object} options - { timeout, maxTokens, temperature }
 */
export async function textChat(messages, systemPrompt = '', options = {}) {
  const { API_KEY, API_BASE, MODEL, MOCK_MODE } = getConfig();

  if (MOCK_MODE) {
    log('LLM', '【MOCK模式】文本对话返回模拟结果');
    return getMockTextChat(messages, systemPrompt);
  }

  if (!isConfigured()) {
    throw new Error('未配置 QWEN_API_KEY，无法调用千问文本模型');
  }

  const { timeout = 60000, maxTokens = 500, temperature = 0.6 } = options;

  const fullMessages = [];
  if (systemPrompt) fullMessages.push({ role: 'system', content: systemPrompt });
  fullMessages.push(...messages);

  const startTime = Date.now();
  try {
    const response = await axios.post(
      `${API_BASE}/chat/completions`,
      {
        model: MODEL,
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
    log('LLM', `文本对话完成 (${latency}ms): ${String(result).slice(0, 80)}`);
    return result;
  } catch (err) {
    const latency = Date.now() - startTime;
    if (err.code === 'ECONNABORTED') {
      log('LLM', `文本对话超时 (${latency}ms, limit=${timeout}ms)`, 'error');
      throw new Error(`AI响应超时(${latency}ms)`);
    }
    if (err.response) {
      const status = err.response.status;
      const detail = err.response.data?.error?.message || err.response.data?.message || err.response.statusText;
      log('LLM', `文本对话API错误 ${status}: ${detail} (${latency}ms)`, 'error');
      throw new Error(`AI服务错误(${status}): ${detail}`);
    }
    log('LLM', `文本对话网络错误: ${err.message} (${latency}ms)`, 'error');
    throw new Error(`AI网络错误: ${err.message}`);
  }
}
