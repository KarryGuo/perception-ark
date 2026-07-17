/**
 * 火山引擎方舟 (ARK) / 豆包大模型 API 客户端
 * 支持视觉理解 (多模态) 和文本对话
 * 文档: https://www.volcengine.com/docs/82379
 */
import axios from 'axios';
import { log } from '../utils/logger.js';

// 函数内部读取env,避免ES模块import时dotenv尚未加载的问题
function getConfig() {
  const API_KEY = process.env.ARK_API_KEY || '';
  const API_BASE = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';
  const VISION_MODEL = process.env.ARK_VISION_MODEL || 'doubao-1.5-vision-pro-32k';
  const TEXT_MODEL = process.env.ARK_TEXT_MODEL || 'doubao-1.5-pro-32k';
  return { API_KEY, API_BASE, VISION_MODEL, TEXT_MODEL };
}

export const isConfigured = () => {
  const { API_KEY } = getConfig();
  return !!API_KEY && API_KEY !== 'your_ark_api_key_here';
};

/**
 * 视觉理解 - 图片+文本 -> 场景描述
 * @param {string} imageBase64 - base64编码的图片(不含data:image前缀)
 * @param {string} prompt - 提问文本
 * @returns {Promise<string>} AI回答
 */
export async function visionUnderstand(imageBase64, prompt) {
  const { API_KEY, API_BASE, VISION_MODEL } = getConfig();
  if (!isConfigured()) {
    throw new Error('未配置 ARK_API_KEY，无法调用视觉模型');
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
          model: VISION_MODEL,
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
          max_tokens: 300,
          temperature: 0.4
        },
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      const latency = Date.now() - startTime;
      const result = response.data.choices[0].message.content;
      log('A01', `视觉理解完成 (${latency}ms): ${result.slice(0, 60)}...`);
      return result;
    } catch (err) {
      lastErr = err;
      // 429限流: 指数退避重试
      if (err.response?.status === 429 && attempt < 2) {
        const waitMs = 1500 * Math.pow(2, attempt); // 1.5s, 3s
        log('A01', `视觉模型限流(429), ${waitMs}ms后重试(第${attempt + 1}次)`, 'warn');
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

/**
 * OCR文字识别 - 使用视觉模型识别图片中的文字
 */
export async function ocrRecognize(imageBase64) {
  const { API_KEY, API_BASE, VISION_MODEL } = getConfig();
  if (!isConfigured()) {
    throw new Error('未配置 ARK_API_KEY，无法调用视觉模型');
  }
  if (!imageBase64) {
    throw new Error('未获取到摄像头画面，无法进行OCR识别');
  }

  const startTime = Date.now();
  const response = await axios.post(
    `${API_BASE}/chat/completions`,
    {
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别图片中的所有文字，按原文格式输出。如果是菜单/价签/路牌/药盒等结构化文本，请按"名称 价格"或"项目:内容"的格式逐行列出。仅输出识别的文字内容，不要解释。' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.2
    },
    {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 15000
    }
  );
  const latency = Date.now() - startTime;
  const result = response.data.choices[0].message.content;
  log('A04', `OCR识别完成 (${latency}ms): ${result.slice(0, 60)}...`);
  return result;
}

/**
 * 人脸描述 - 使用视觉模型描述画面中的人
 */
export async function faceDescribe(imageBase64) {
  const { API_KEY, API_BASE, VISION_MODEL } = getConfig();
  if (!isConfigured()) {
    throw new Error('未配置 ARK_API_KEY，无法调用视觉模型');
  }
  if (!imageBase64) {
    throw new Error('未获取到摄像头画面，无法进行人脸识别');
  }

  const startTime = Date.now();
  const response = await axios.post(
    `${API_BASE}/chat/completions`,
    {
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请描述画面中的人物：性别、大致年龄、衣着特征、是否在向你挥手或打招呼、面部表情。如果是熟人请描述显著特征（如戴眼镜、发型等）。50字以内。' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }
      ],
      max_tokens: 150,
      temperature: 0.5
    },
    {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 15000
    }
  );
  const latency = Date.now() - startTime;
  const result = response.data.choices[0].message.content;
  log('A04', `人脸描述完成 (${latency}ms): ${result.slice(0, 60)}...`);
  return result;
}

/**
 * 文本对话 - 用于意图识别和多轮对话
 * @param {Array} messages - 消息列表
 * @param {string} systemPrompt - 系统提示词
 * @param {object} options - { timeout, maxTokens, temperature, thinking }
 *   - thinking: 'enabled' | 'disabled' (doubao-seed系列深度思考开关,默认disabled加速响应)
 */
export async function textChat(messages, systemPrompt = '', options = {}) {
  const { API_KEY, API_BASE, TEXT_MODEL } = getConfig();
  if (!isConfigured()) {
    throw new Error('未配置 ARK_API_KEY，无法调用文本模型');
  }

  const { timeout = 60000, maxTokens = 300, temperature = 0.6, thinking = 'disabled' } = options;

  const fullMessages = [];
  if (systemPrompt) fullMessages.push({ role: 'system', content: systemPrompt });
  fullMessages.push(...messages);

  const reqBody = {
    model: TEXT_MODEL,
    messages: fullMessages,
    max_tokens: maxTokens,
    temperature
  };
  // doubao-seed系列支持thinking开关,关闭后响应更快(适合意图识别等简单任务)
  if (thinking === 'disabled') {
    reqBody.thinking = { type: 'disabled' };
  }

  const startTime = Date.now();
  try {
    const response = await axios.post(
      `${API_BASE}/chat/completions`,
      reqBody,
      {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        timeout
      }
    );
    const latency = Date.now() - startTime;
    const result = response.data.choices[0].message.content;
    log('LLM', `文本对话完成 (${latency}ms): ${result.slice(0, 80)}`);
    return result;
  } catch (err) {
    const latency = Date.now() - startTime;
    // 增强错误日志,便于定位问题
    if (err.code === 'ECONNABORTED') {
      log('LLM', `文本对话超时 (${latency}ms, limit=${timeout}ms)`, 'error');
      throw new Error(`AI响应超时(${latency}ms)`);
    }
    if (err.response) {
      const status = err.response.status;
      const detail = err.response.data?.error?.message || err.response.statusText;
      log('LLM', `文本对话API错误 ${status}: ${detail} (${latency}ms)`, 'error');
      throw new Error(`AI服务错误(${status}): ${detail}`);
    }
    log('LLM', `文本对话网络错误: ${err.message} (${latency}ms)`, 'error');
    throw new Error(`AI网络错误: ${err.message}`);
  }
}
