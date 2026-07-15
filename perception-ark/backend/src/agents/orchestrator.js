/**
 * Orchestrator - 中央协调调度器
 * 职责: 任务分发 · 优先级仲裁 · 冲突消解 · 上下文管理
 *
 * 优先级链路:
 *   P0 (A03 安全预警) - 可抢占任何Agent
 *   P1 (A01 场景感知)
 *   P2 (A02 导航引导)
 *   P3 (A04 社交辅助 / A05 环境记忆)
 */
import { visionUnderstand, ocrRecognize, faceDescribe, isConfigured } from '../services/trae-client.js';
import { planWalkRoute, searchPOI } from '../services/amap-client.js';
import {
  searchRoutes, searchFaces, getHabit, upsertHabit, addRoute, addFace, addSosEvent, updateSosStatus, getMemoryStats, getAllUsers
} from '../services/memory-store.js';
import { understandIntent } from '../services/assistant.js';
import { log, genId, now, calcDistance } from '../utils/logger.js';

// 优先级常量
export const PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3 };

// Agent定义
export const AGENTS = {
  A01: { id: 'A01', name: '场景感知', priority: PRIORITY.P1, color: '#00FFA3', active: false },
  A02: { id: 'A02', name: '导航引导', priority: PRIORITY.P2, color: '#FFB627', active: false },
  A03: { id: 'A03', name: '安全预警', priority: PRIORITY.P0, color: '#FF2E7E', active: false },
  A04: { id: 'A04', name: '社交辅助', priority: PRIORITY.P3, color: '#7B61FF', active: false },
  A05: { id: 'A05', name: '环境记忆', priority: PRIORITY.P3, color: '#00E5FF', active: false }
};

// 共享上下文
const sharedContext = {
  currentLocation: null, // 初始为null,等前端传入真实定位后更新
  sceneType: 'outdoor', // indoor | outdoor | intersection
  lastDangerEvent: null,
  userActivity: 'idle', // walking | waiting | reading | fallen
  lastSpoken: null,
  history: [],
  pendingPois: null // 附近搜索结果缓存,供用户语音选择
};

// 输出队列 - 按优先级排序
let outputQueue = [];
let currentSpeaking = null;
let speakingReleaseTimer = null; // 播报结束后自动释放currentSpeaking的计时器
// 导航延迟播报计时器列表,新导航启动时清除旧的避免冲突
const navStepTimers = [];
let preemptionLog = []; // 抢占事件日志

// 事件监听器(WebSocket推送用)
const listeners = new Set();

export function addListener(fn) { listeners.add(fn); }
export function removeListener(fn) { listeners.delete(fn); }

function emit(event) {
  event.timestamp = now();
  event.id = genId('evt');
  sharedContext.history.push(event);
  if (sharedContext.history.length > 100) sharedContext.history.shift();
  listeners.forEach(fn => {
    try { fn(event); } catch (e) { console.error('Listener error:', e); }
  });
}

function emitLog(agentId, message, level = 'info') {
  emit({ type: 'log', agentId, message, level });
}

function emitAgentState(agentId, active, output = '') {
  if (AGENTS[agentId]) AGENTS[agentId].active = active;
  emit({ type: 'agent_state', agentId, active, output });
}

function emitSpeak(agentId, text, options = {}) {
  // ORCH(中央协调器)使用最低优先级,不参与抢占
  const agent = AGENTS[agentId] || { id: agentId, name: '协调器', priority: PRIORITY.P3, color: '#FFFFFF', active: false };

  // 高优先级守卫: 当前正在播报高优先级(如A03安全),低优先级(如A02导航)请求被抑制
  if (currentSpeaking && AGENTS[currentSpeaking.agentId] && agent.priority > AGENTS[currentSpeaking.agentId].priority) {
    emitLog('ORCH', `${agentId}(${agent.name})被抑制: 高优先级${currentSpeaking.agentId}正在播报`, 'warn');
    return; // 不播报低优先级内容
  }

  const event = {
    type: 'speak',
    agentId,
    text,
    priority: agent.priority,
    ...options
  };

  // 检查抢占: 高优先级抢占低优先级
  if (currentSpeaking && AGENTS[currentSpeaking.agentId] && agent.priority < AGENTS[currentSpeaking.agentId].priority) {
    // 高优先级抢占低优先级 - 清除低优先级的导航延迟播报
    if (navStepTimers.length > 0) {
      navStepTimers.forEach(t => clearTimeout(t));
      navStepTimers.length = 0;
      emitLog('ORCH', `抢占时清除导航延迟播报计时器`, 'warn');
    }
    preemptionLog.push({
      time: now(),
      preempted: currentSpeaking.agentId,
      preemptedBy: agentId,
      text
    });
    emit({
      type: 'preemption',
      preempted: currentSpeaking.agentId,
      preemptedBy: agentId,
      text,
      reason: `P${agent.priority}抢占P${AGENTS[currentSpeaking.agentId].priority}`
    });
    emitLog('ORCH', `⚠ 优先级抢占: ${agentId}(${agent.name}) 抢占 ${currentSpeaking.agentId}(${AGENTS[currentSpeaking.agentId].name})`, 'warn');
  }

  currentSpeaking = { agentId, text, ...options };
  sharedContext.lastSpoken = event;
  emit(event);

  // 播报结束后自动释放currentSpeaking,避免死锁(高优先级Agent发声后永久抑制其他Agent)
  // 估算播报时长: 中文约4字/秒,最低3秒,urgent(紧急)最长15秒
  if (speakingReleaseTimer) clearTimeout(speakingReleaseTimer);
  const estimatedDuration = Math.min(Math.max(Math.ceil(text.length / 4), 3), options.urgent ? 15 : 8) * 1000;
  speakingReleaseTimer = setTimeout(() => {
    currentSpeaking = null;
    speakingReleaseTimer = null;
  }, estimatedDuration);
}

function emitAlert(text) {
  emit({ type: 'alert', text, priority: PRIORITY.P0 });
}

function emitSos(title, sub) {
  emit({ type: 'sos', title, sub });
}

function emitSubtitle(text, priority = false) {
  emit({ type: 'subtitle', text, priority });
}

export function getContext() {
  return { ...sharedContext, agents: AGENTS, preemptionLog: preemptionLog.slice(-10) };
}

export function updateLocation(lat, lng, address, extra = {}) {
  // 保留省/市/区/县信息,供 SOS 播报等场景使用完整行政区划
  sharedContext.currentLocation = {
    lat, lng,
    address: address || `${lat.toFixed(4)},${lng.toFixed(4)}`,
    province: extra.province || '',
    city: extra.city || '',
    district: extra.district || ''
  };
  emit({ type: 'location', location: sharedContext.currentLocation });
}

/**
 * 生成完整位置描述(含省/市/区/县),用于语音播报
 */
function describeLocation() {
  const loc = sharedContext.currentLocation;
  if (!loc) return '位置未知';
  const parts = [loc.province, loc.city, loc.district].filter(Boolean);
  // 有行政区划信息时优先用省市区,否则用 formatted_address
  if (parts.length > 0) return parts.join('');
  return loc.address || `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
}

export function getStats() {
  return {
    ...getMemoryStats(),
    preemptionCount: preemptionLog.length,
    agentStatus: Object.fromEntries(Object.entries(AGENTS).map(([k, v]) => [k, v.active])),
    traeConfigured: isConfigured()
  };
}

// ============================================================
// A01 场景感知 Agent
// ============================================================
export async function runSceneAgent(imageBase64, userQuery = '') {
  emitAgentState('A01', true, '正在分析环境...');
  emitLog('A01', '场景感知 Agent 启动');

  try {
    const prompt = userQuery || '请用一段话描述当前场景，包括：路面状况、前方主要物体及大致距离、场景类型(室内/室外/路口)。50-100字。专为视障者设计，重点突出可能影响出行的信息。';
    const result = await visionUnderstand(imageBase64, prompt);

    // 更新场景类型到共享上下文(供其他Agent消费)
    if (result.includes('室内')) sharedContext.sceneType = 'indoor';
    else if (result.includes('路口') || result.includes('交叉口')) sharedContext.sceneType = 'intersection';
    else if (result.includes('室外') || result.includes('道路') || result.includes('街道')) sharedContext.sceneType = 'outdoor';

    // 注入记忆上下文
    const nearbyRoutes = sharedContext.currentLocation
      ? searchRoutes(sharedContext.currentLocation.lat, sharedContext.currentLocation.lng, 3)
      : [];
    let memoryHint = '';
    if (nearbyRoutes.length > 0) {
      const route = nearbyRoutes[0];
      memoryHint = ` (记忆: 这附近您常去"${route.route_name}"，已走过${route.visit_count}次)`;
    }

    emitAgentState('A01', true, result);
    emitSpeak('A01', result + memoryHint);
    emitSubtitle(`👁️ ${result + memoryHint}`);
    return result;
  } catch (err) {
    emitLog('A01', `场景感知失败: ${err.message}`, 'error');
    emitSpeak('A01', '抱歉，当前场景分析失败，请稍后再试。');
    return null;
  } finally {
    setTimeout(() => emitAgentState('A01', false), 1000);
  }
}

// ============================================================
// A02 导航引导 Agent
// ============================================================
export async function runNavigationAgent(destination, startLat, startLng) {
  emitAgentState('A02', true, '正在规划路径...');
  emitLog('A02', `导航引导 Agent 启动 · 目的地: ${destination}`);

  try {
    sharedContext.userActivity = 'navigating';

    // 1. 确定起点: 优先用传入坐标,其次用共享上下文
    let startLatVal = startLat;
    let startLngVal = startLng;
    if (!startLatVal || !startLngVal) {
      if (sharedContext.currentLocation) {
        startLatVal = sharedContext.currentLocation.lat;
        startLngVal = sharedContext.currentLocation.lng;
      }
    }

    // 2. POI搜索目的地(支持无位置时全局搜索)
    const pois = await searchPOI(destination, startLatVal, startLngVal);

    if (pois.length === 0) {
      emitSpeak('A02', `未找到"${destination}"，请换个关键词试试。`);
      return null;
    }

    // 智能选择模式: 用户说"最近的XX"/"附近XX"时,展示多个结果供选择
    const isNearbySearch = /最近|附近|周边|就近/.test(destination);
    if (isNearbySearch && pois.length > 1 && startLatVal && startLngVal) {
      // 按距离排序
      pois.sort((a, b) => a.distance - b.distance);
      // 缓存搜索结果供用户选择
      sharedContext.pendingPois = pois;

      // 推送poi_list事件到前端,地图上显示多个标记
      emit({
        type: 'poi_list',
        keyword: destination,
        pois: pois.map((p, i) => ({
          index: i + 1,
          name: p.name,
          address: p.address,
          city: p.city || '',
          distance: p.distance,
          lat: p.lat,
          lng: p.lng
        })),
        origin: { lat: startLatVal, lng: startLngVal }
      });

      // 语音播报搜索结果
      const top3 = pois.slice(0, 3);
      let speakText = `附近找到${pois.length}个结果。`;
      top3.forEach((p, i) => {
        speakText += `第${i + 1}个，${p.name}，距离${p.distance}米。`;
      });
      speakText += `说"去第一个"即可开始导航。`;
      emitSpeak('A02', speakText);
      emitSubtitle(`🧭 ${speakText}`);
      emitAgentState('A02', false, `找到${pois.length}个结果,等待用户选择`);
      return { pois, route: null, mode: 'select' };
    }

    // 精确搜索: 全局搜索可能返回多个城市的同名地点,优先选用户当前所在城市
    let target = pois[0];
    const userCity = sharedContext.currentLocation?.city;
    if (userCity && pois.length > 1) {
      const cityMatch = pois.find(p => p.city && p.city.includes(userCity));
      if (cityMatch) {
        target = cityMatch;
        emitLog('A02', `从${pois.length}个结果中匹配到${userCity}的目的地: ${target.name}`);
      }
    }
    emitLog('A02', `找到目的地: ${target.name}${target.city ? `(${target.city})` : ''} (距离${target.distance}米)`);

    // 3. 路径规划(需要起点坐标)
    if (!startLatVal || !startLngVal) {
      // 无起点坐标: 只告知目的地位置,不规划路线
      const speakText = `找到${target.name}，位于${target.address}。请允许定位权限后为您规划路线。`;
      emitSpeak('A02', speakText);
      emitSubtitle(`🧭 ${speakText}`);
      // 推送目的地标记到前端
      emit({
        type: 'route',
        polyline: null,
        destination: { name: target.name, lat: target.lat, lng: target.lng },
        origin: null,
        distance: 0,
        duration: 0
      });
      return { target, route: null };
    }

    const route = await planWalkRoute(startLatVal, startLngVal, target.lat, target.lng);
    emitLog('A02', `路径规划完成: 距离${route.distance}米, 预计${route.duration}分钟`);

    // 3. 注入记忆
    const nearbyRoutes = searchRoutes(startLatVal, startLngVal, 3);
    let memoryHint = '';
    if (nearbyRoutes.length > 0 && nearbyRoutes[0].route_name.includes(destination)) {
      memoryHint = `这条路您过去30天走过${nearbyRoutes[0].visit_count}次。`;
    }

    // 4. 输出导航信息
    const firstStep = route.steps[0];
    const speakText = `路径已规划。目的地：${target.name}，距离${route.distance}米，预计步行${route.duration}分钟。${memoryHint}请${firstStep.instruction}。`;
    emitSpeak('A02', speakText);
    emitSubtitle(`🧭 ${speakText}`);

    // 5. 推送路线到前端地图绘制(polyline格式: lng,lat;lng,lat;...)
    if (route.polyline) {
      emit({
        type: 'route',
        polyline: route.polyline,
        destination: { name: target.name, lat: target.lat, lng: target.lng },
        origin: { lat: startLatVal, lng: startLngVal },
        distance: route.distance,
        duration: route.duration
      });
    }

    // 后续步骤延迟播报 - 使用可清除计时器,新导航启动时自动取消旧的延迟播报
    if (navStepTimers.length > 0) {
      navStepTimers.forEach(t => clearTimeout(t));
      navStepTimers.length = 0;
    }

    // 记录路线到记忆库(A05环境记忆的数据来源)
    if (startLatVal && startLngVal) {
      try {
        addRoute({
          start_lat: startLatVal,
          start_lng: startLngVal,
          end_lat: target.lat,
          end_lng: target.lng,
          route_name: target.name,
          visit_count: 1
        });
        emitLog('A05', `已记录路线记忆: ${target.name}`, 'info');
      } catch (e) {
        emitLog('A05', `路线记忆写入失败: ${e.message}`, 'warn');
      }
    }

    if (route.steps.length > 1) {
      navStepTimers.push(setTimeout(() => {
        emitSpeak('A02', `继续前行。${route.steps[1].instruction}。`);
        emitSubtitle(`🧭 ${route.steps[1].instruction}`);
      }, 5000));
    }

    if (route.steps.length > 2) {
      navStepTimers.push(setTimeout(() => {
        emitSpeak('A02', `即将到达。${route.steps[route.steps.length - 1].instruction}。`);
        emitSubtitle(`🧭 即将到达目的地`);
      }, 10000));
    }

    return route;
  } catch (err) {
    emitLog('A02', `导航失败: ${err.message}`, 'error');
    emitSpeak('A02', '导航规划失败，请稍后再试。');
    return null;
  } finally {
    setTimeout(() => {
      emitAgentState('A02', false);
      sharedContext.userActivity = 'idle';
    }, Math.max(3000, 12000));
  }
}

/**
 * 选择POI并导航 - 用户说"去第一个"/"去最近的"时调用
 * @param {string} selection - "第一个"/"第二个"/"最近"/"最近的"
 * @param {number} startLat
 * @param {number} startLng
 */
export async function selectPoiAndNavigate(selection, startLat, startLng) {
  emitAgentState('A02', true, '正在规划路径...');

  try {
    const pois = sharedContext.pendingPois;
    if (!pois || pois.length === 0) {
      emitSpeak('A02', '请先搜索目的地，比如说"附近的药店"。');
      return null;
    }

    // 解析用户选择: 第几个 / 最近 / 最远
    let target = null;
    const numMatch = selection.match(/第([一二三四五六七八九\d]+)个?/);
    if (numMatch) {
      const numMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
      let idx = numMap[numMatch[1]] || parseInt(numMatch[1]);
      if (idx >= 1 && idx <= pois.length) {
        target = pois[idx - 1];
      }
    } else if (/最近|第一/.test(selection)) {
      target = pois[0]; // 已按距离排序,第一个就是最近的
    }

    if (!target) {
      emitSpeak('A02', `没有第${selection}个结果，请说第一到第${pois.length}个。`);
      return null;
    }

    // 清除待选择缓存
    sharedContext.pendingPois = null;

    emitLog('A02', `用户选择了: ${target.name} (距离${target.distance}米)`);

    // 确定起点
    let startLatVal = startLat;
    let startLngVal = startLng;
    if (!startLatVal || !startLngVal) {
      if (sharedContext.currentLocation) {
        startLatVal = sharedContext.currentLocation.lat;
        startLngVal = sharedContext.currentLocation.lng;
      }
    }

    if (!startLatVal || !startLngVal) {
      emitSpeak('A02', `已选择${target.name}，但无法获取您的位置，请允许定位后重试。`);
      return null;
    }

    // 规划路线
    const route = await planWalkRoute(startLatVal, startLngVal, target.lat, target.lng);
    emitLog('A02', `路径规划完成: 距离${route.distance}米, 预计${route.duration}分钟`);

    const firstStep = route.steps[0];
    const speakText = `好的，正在导航到${target.name}，距离${route.distance}米，预计步行${route.duration}分钟。${firstStep.instruction}。`;
    emitSpeak('A02', speakText);
    emitSubtitle(`🧭 ${speakText}`);

    // 推送路线
    if (route.polyline) {
      emit({
        type: 'route',
        polyline: route.polyline,
        destination: { name: target.name, lat: target.lat, lng: target.lng },
        origin: { lat: startLatVal, lng: startLngVal },
        distance: route.distance,
        duration: route.duration
      });
    }

    // 记忆写入
    try {
      addRoute({
        start_lat: startLatVal,
        start_lng: startLngVal,
        end_lat: target.lat,
        end_lng: target.lng,
        route_name: target.name,
        visit_count: 1
      });
    } catch (e) {}

    return { target, route };
  } catch (err) {
    emitLog('A02', `选择导航失败: ${err.message}`, 'error');
    emitSpeak('A02', '导航失败，请稍后再试。');
    return null;
  } finally {
    setTimeout(() => {
      emitAgentState('A02', false);
    }, Math.max(3000, 12000));
  }
}

// ============================================================
// A03 安全预警 Agent
// ============================================================
export async function runSafetyAgent(imageBase64, mode = 'scan') {
  emitAgentState('A03', true, '安全扫描中...');
  emitLog('A03', '安全预警 Agent 启动');

  if (!imageBase64) {
    emitAgentState('A03', false);
    emitSpeak('A03', '未获取到摄像头画面，无法进行安全扫描。请先启动摄像头。');
    emitSubtitle('⚠️ 未获取到摄像头画面，无法进行安全扫描');
    return null;
  }

  try {
    const result = await visionUnderstand(imageBase64, '请检查画面中是否存在以下危险：1.靠近的车辆/电动车/自行车 2.地面障碍物(水坑/台阶/坑洞) 3.高空坠物风险 4.其他出行危险。如有危险请按以下格式回答:"注意,[左前方/正前方/右前方/左方/右方]约[X]米处有[障碍物名称]，建议[避让方向]绕行"。如无危险请回答"前方安全"。40字以内。');

    emitAgentState('A03', true, result);
    if (result.includes('安全') && !result.includes('不安全')) {
      emitSpeak('A03', result);
      emitSubtitle(`🛡️ ${result}`);
    } else {
      // 检测到危险 - 触发抢占
      emitAlert(result);
      emitSpeak('A03', `注意！${result}请立即避让！`, { urgent: true });
      emitSubtitle(`⚠️ ${result}`, true);
      sharedContext.lastDangerEvent = { time: now(), description: result };
    }
    return result;
  } catch (err) {
    emitLog('A03', `安全扫描失败: ${err.message}`, 'error');
    emitSpeak('A03', `安全扫描失败：${err.message}`);
    return null;
  } finally {
    setTimeout(() => emitAgentState('A03', false), 3000);
  }
}

// 紧急联系人配置: 优先从users表读取(家属端绑定),环境变量作为兜底
function getEmergencyContact() {
  try {
    const users = getAllUsers();
    const userWithContact = users.find(u => u.emergency_contact && u.emergency_phone);
    if (userWithContact) {
      return { name: userWithContact.emergency_contact, phone: userWithContact.emergency_phone };
    }
  } catch (e) { /* 数据库未就绪,走环境变量兜底 */ }
  const envName = process.env.EMERGENCY_CONTACT_NAME || '';
  const envPhone = process.env.EMERGENCY_CONTACT_PHONE || '';
  return { name: envName, phone: envPhone };
}

/**
 * 跌倒检测 - 由前端IMU触发
 */
// 跌倒SOS倒计时句柄,允许取消
let fallSosTimer = null;

export async function triggerFallDetection(lat, lng) {
  emitAgentState('A03', true, '⚠ 跌倒检测触发！');
  emitLog('A03', '⚠ 跌倒检测触发！IMU检测到突然冲击', 'warn');
  sharedContext.userActivity = 'fallen';

  const contact = getEmergencyContact();

  // 防重入: 如果已有倒计时进行中,不清除也不重启,只提示
  if (fallSosTimer) {
    emitSpeak('A03', '检测到再次跌倒。SOS倒计时仍在进行中，说"我没事"可以取消。', { urgent: true });
    return { triggered: true, countdown: 10, contactConfigured: !!contact.name, alreadyCounting: true };
  }

  if (!contact.name || !contact.phone) {
    emitSpeak('A03', '检测到跌倒。您还好吗？注意：尚未设置紧急联系人，请在家属端绑定使用者时填写紧急联系人信息。', { urgent: true });
    emitSubtitle('⚠️ 检测到跌倒，但未设置紧急联系人', true);
    setTimeout(() => emitAgentState('A03', false), 3000);
    return { triggered: true, countdown: 10, contactConfigured: false };
  }

  emitSos('⚠ FALL DETECTED', `检测到跌倒 · 10秒倒计时... · 说"我没事"取消`);
  const fallLocation = describeLocation();
  emitSpeak('A03', `检测到跌倒。您当前位于${fallLocation}。您还好吗？10秒后未响应将联系紧急联系人${contact.name}。说"我没事"可以取消。`, { urgent: true });
  emitSubtitle('⚠️ 检测到跌倒，10秒倒计时中... 说"我没事"取消', true);

  // 10秒后触发SOS
  fallSosTimer = setTimeout(() => {
    fallSosTimer = null;
    emitSos('SOS SENT', `紧急联系人 ${contact.name} 已通知 · 位置已同步`);
    emitSpeak('A03', `已自动联系紧急联系人${contact.name}。您的位置是${fallLocation}，已同步给救援方。请保持不动，救援正在路上。`, { urgent: true });

    // 记录SOS事件到记忆库 - SOS已发送,直接标记为sent
    try {
      const sosLat = lat || sharedContext.currentLocation?.lat || null;
      const sosLng = lng || sharedContext.currentLocation?.lng || null;
      const sosAddr = sharedContext.currentLocation?.address || '';
      const sosId = addSosEvent({
        event_type: 'fall',
        lat: sosLat,
        lng: sosLng,
        address: sosAddr,
        contact_name: contact.name,
        contact_phone: contact.phone
      });
      // SOS已实际发送,立即更新状态为sent(旧代码updateSosStatus(null,'sent')因WHERE id=null不生效)
      if (sosId) {
        updateSosStatus(sosId, 'sent');
      }
      emitLog('A03', `SOS已发送至紧急联系人: ${contact.name} (${contact.phone})`, 'warn');
    } catch (e) {
      emitLog('A03', `SOS事件记录失败: ${e.message}`, 'error');
    }
  }, 10000);

  return { triggered: true, countdown: 10, contactConfigured: true };
}

/**
 * 取消跌倒SOS倒计时
 * 用户说"我没事"或主动取消时调用
 */
export function cancelFallSos() {
  if (fallSosTimer) {
    clearTimeout(fallSosTimer);
    fallSosTimer = null;
    sharedContext.userActivity = 'idle';
    emitSpeak('A03', '好的，已取消SOS。如果您需要帮助，随时告诉我。');
    emitSubtitle('✓ SOS已取消', false);
    emitAgentState('A03', false);
    emitLog('A03', '跌倒SOS已由用户取消', 'info');
    return true;
  }
  return false;
}

/**
 * 安全预警抢占演示 - 基于真实视觉检测
 * 1. 先激活A02导航播报(真实路径规划结果)
 * 2. 调用视觉模型分析当前画面
 * 3. 如检测到危险,A03紧急抢占
 * 4. 如未检测到危险,提示当前安全
 */
export async function triggerDangerPreemption(imageBase64) {
  emitLog('A03', '🎯 触发抢占演示: A02导航播报中,A03实时视觉检测', 'warn');

  if (!imageBase64) {
    emitLog('A03', '未获取到摄像头画面，无法进行抢占演示', 'error');
    emitSpeak('A03', '未获取到摄像头画面，无法进行安全检测。请先启动摄像头。');
    return null;
  }

  // 1. 先激活A02播报(使用真实导航上下文)
  emitAgentState('A02', true, '正在播报导航信息');
  const navText = '请沿当前方向直行，注意路口来车。前方斑马线处等待通行。';
  emitSpeak('A02', navText);
  emitSubtitle('🧭 导航播报中...');

  // 2. 1.5秒后A03进行真实视觉检测
  setTimeout(async () => {
    emitAgentState('A03', true, '安全视觉检测中...');
    emitLog('A03', 'A03启动视觉安全检测，判断是否需要抢占', 'warn');

    try {
      const dangerResult = await visionUnderstand(imageBase64, '请检查画面中是否存在以下危险：1.靠近的车辆/电动车/自行车 2.地面障碍物(水坑/台阶/坑洞) 3.高空坠物风险 4.其他出行危险。如有危险请说明方向、距离、物体；如无危险请回答"安全"。50字以内。');

      const isSafe = dangerResult.includes('安全') && !dangerResult.includes('不安全');

      if (isSafe) {
        // 未检测到危险 - A03正常播报后退出,A02恢复
        emitAgentState('A03', true, '当前安全');
        emitSpeak('A03', `安全检测完成：${dangerResult}`);
        emitSubtitle('🛡️ 安全检测完成，未发现危险');

        setTimeout(() => {
          emitAgentState('A03', false);
          emitLog('ORCH', '✓ A03检测完成：当前安全，A02导航恢复');
          emitSpeak('A02', '安全确认，请继续前行。');
          emitSubtitle('🧭 安全，继续前行');
          setTimeout(() => emitAgentState('A02', false), 3000);
        }, 2000);
      } else {
        // 检测到危险 - A03抢占
        emitAgentState('A03', true, `⚠ ${dangerResult}`);
        emitAlert(dangerResult);
        emitSpeak('A03', `注意！${dangerResult}请立即避让！`, { urgent: true });
        emitSubtitle(`⚠️ ${dangerResult}`, true);
        sharedContext.lastDangerEvent = { time: now(), description: dangerResult };

        // 3秒后A03播报完成，A02恢复
        setTimeout(() => {
          emitAgentState('A03', false);
          emitLog('ORCH', '✓ A03播报完成，A02被挂起的输出恢复');
          emitSpeak('A02', '危险已解除。请确认安全后继续前行。');
          emitSubtitle('🧭 危险已解除，继续前行');
          setTimeout(() => emitAgentState('A02', false), 3000);
        }, 3000);
      }
    } catch (err) {
      emitLog('A03', `视觉检测失败: ${err.message}`, 'error');
      emitAgentState('A03', false);
      emitSpeak('A03', `安全检测失败：${err.message}`);
    }
  }, 1500);
}

// ============================================================
// A04 社交辅助 Agent
// ============================================================
export async function runSocialAgent(imageBase64, mode = 'ocr') {
  emitAgentState('A04', true, mode === 'ocr' ? 'OCR识别中...' : '人脸识别中...');
  emitLog('A04', `社交辅助 Agent 启动 · 模式: ${mode}`);

  try {
    let result = '';
    let memoryHint = '';

    if (mode === 'ocr') {
      result = await ocrRecognize(imageBase64);
      const lastOrder = getHabit('food', 'last_order');
      if (lastOrder && result.includes(lastOrder.habit_value)) {
        memoryHint = ` 上次您点过${lastOrder.habit_value}，要再来一份吗？`;
      }
      // 记录OCR识别内容到习惯库(菜单类识别)
      if (result.length > 5 && result.length < 200) {
        try {
          upsertHabit('food', 'last_order', result.slice(0, 100));
          emitLog('A05', `已记录OCR内容到习惯库`, 'info');
        } catch (e) { /* 忽略写入失败 */ }
      }
      // 长文本智能总结: OCR结果超过100字时,追加AI总结
      if (result.length > 100) {
        try {
          emitLog('A04', `OCR长文本(${result.length}字), 正在生成智能总结...`, 'info');
          const summary = await visionUnderstand(imageBase64, `以下文字是OCR识别结果,请用一句话总结核心内容(30字以内):\n${result}`);
          if (summary && summary.length < result.length) {
            result = `${result}\n\n【内容总结】${summary}`;
          }
        } catch (e) {
          emitLog('A04', `智能总结生成失败: ${e.message}`, 'warn');
        }
      }
    } else if (mode === 'face') {
      result = await faceDescribe(imageBase64);
      // 匹配本地熟人库
      const faces = searchFaces();
      if (faces.length > 0) {
        const matched = faces[0]; // 简化: 取最常访问的
        memoryHint = ` 这是您的${matched.relation}${matched.name}，上次见面是${new Date(matched.last_seen).toLocaleDateString('zh-CN')}。`;
      } else {
        // 记录新面孔到记忆库
        try {
          addFace({ name: '陌生人', relation: '未识别', description: result.slice(0, 100) });
          emitLog('A05', `已记录新面孔到记忆库`, 'info');
        } catch (e) { /* 忽略写入失败 */ }
      }
    }

    const speakText = result + memoryHint;
    emitAgentState('A04', true, speakText);
    emitSpeak('A04', speakText);
    emitSubtitle(mode === 'ocr' ? `📖 ${speakText}` : `👤 ${speakText}`);
    return speakText;
  } catch (err) {
    emitLog('A04', `社交辅助失败: ${err.message}`, 'error');
    emitSpeak('A04', '识别失败，请稍后再试。');
    return null;
  } finally {
    setTimeout(() => emitAgentState('A04', false), 2000);
  }
}

// ============================================================
// A05 环境记忆 Agent
// ============================================================
export async function runMemoryAgent(query) {
  emitAgentState('A05', true, '检索本地记忆库...');
  emitLog('A05', '环境记忆 Agent 启动');

  try {
    const routes = sharedContext.currentLocation
      ? searchRoutes(sharedContext.currentLocation.lat, sharedContext.currentLocation.lng, 5)
      : [];
    const faces = searchFaces();
    const foodHabit = getHabit('food', 'last_order');
    const commuteHabit = getHabit('route', 'commute');

    let result = '';
    if (routes.length > 0) {
      const r = routes[0];
      result = `这附近您有常用路线"${r.route_name}"，过去已走过${r.visit_count}次，最近一次是${new Date(r.last_visited).toLocaleDateString('zh-CN')}。`;
    } else {
      result = '暂无常用路线记忆，多走几次后我会记住您的偏好。';
    }

    if (faces.length > 0) {
      const f = faces[0];
      result += ` 记忆中有${faces.length}位熟人，最常见的是${f.relation}${f.name}。`;
    }

    if (foodHabit) {
      result += ` 您最近点过${foodHabit.habit_value}。`;
    }
    if (commuteHabit) {
      result += ` 通常这个时间您会乘坐${commuteHabit.habit_value}。`;
    }

    if (routes.length === 0 && faces.length === 0 && !foodHabit && !commuteHabit) {
      result = '记忆库当前为空。随着您的使用，我会记住您的常用路线、熟人和偏好。';
    }

    emitAgentState('A05', true, result);
    emitSpeak('A05', result);
    emitSubtitle(`🧠 ${result}`);
    return result;
  } catch (err) {
    emitLog('A05', `记忆检索失败: ${err.message}`, 'error');
    return null;
  } finally {
    setTimeout(() => emitAgentState('A05', false), 2000);
  }
}

// ============================================================
// 路由 - 处理用户指令
// 统一复用 services/assistant.js 的 understandIntent,
// 与 /api/assistant/chat 共享同一意图识别器,避免双重逻辑不一致
// ============================================================
export async function handleVoiceCommand(text, imageBase64, location) {
  emitLog('ORCH', `处理语音指令: ${text}`);
  if (location) updateLocation(location.lat, location.lng, location.address, { province: location.province, city: location.city, district: location.district });

  const intent = await understandIntent(text, '');

  switch (intent.intent) {
    case 'navigate': {
      const dest = (intent.entity || '').trim();
      if (!dest) {
        emitSpeak('A02', '请告诉我您要去哪里，例如说带我去五一广场。');
        return null;
      }
      return await runNavigationAgent(dest, location?.lat, location?.lng);
    }
    case 'ocr':
      return await runSocialAgent(imageBase64, 'ocr');
    case 'face':
      return await runSocialAgent(imageBase64, 'face');
    case 'scene':
      return await runSceneAgent(imageBase64, text);
    case 'safety':
      return await runSafetyAgent(imageBase64, 'scan');
    case 'memory':
      return await runMemoryAgent(text);
    case 'fall':
      return await triggerFallDetection(location?.lat, location?.lng);
    case 'cancel_sos':
      return cancelFallSos();
    default:
      // 普通对话 - understandIntent 已生成回复
      if (intent.reply) {
        emitSpeak('ORCH', intent.reply);
        return intent.reply;
      }
      emitSpeak('ORCH', '我收到了您的指令，但当前未配置AI能力。');
      return null;
  }
}

// 重置所有Agent状态
export function resetAll() {
  Object.keys(AGENTS).forEach(id => {
    AGENTS[id].active = false;
  });
  // 清除所有计时器
  if (navStepTimers.length > 0) {
    navStepTimers.forEach(t => clearTimeout(t));
    navStepTimers.length = 0;
  }
  if (fallSosTimer) {
    clearTimeout(fallSosTimer);
    fallSosTimer = null;
  }
  if (speakingReleaseTimer) {
    clearTimeout(speakingReleaseTimer);
    speakingReleaseTimer = null;
  }
  currentSpeaking = null;
  sharedContext.userActivity = 'idle';
  emit({ type: 'reset' });
  emitLog('ORCH', '系统重置 · 所有Agent回到待机状态');
}
