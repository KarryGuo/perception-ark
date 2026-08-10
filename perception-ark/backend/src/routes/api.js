import { Router } from 'express';
import multer from 'multer';
import {
  runSceneAgent, runNavigationAgent, runSafetyAgent, runSocialAgent,
  runMemoryAgent, triggerFallDetection, triggerDangerPreemption,
  handleVoiceCommand, getContext, getStats, resetAll, updateLocation,
  triggerSosButton, respondSosButton, cancelSosButton
} from '../agents/orchestrator.js';
import {
  getAllRoutes, getAllHabits, searchFaces, addFace, forgetAllFaces,
  getSosEvents, getMemoryStats
} from '../services/memory-store.js';
import { reverseGeocode, getWeather, searchPOI } from '../services/amap-client.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// 图片转base64
function imgToBase64(file) {
  if (!file) return null;
  return file.buffer.toString('base64');
}

// ===== 健康检查(增强: 含运行时长/内存/数据库状态) =====
router.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    ok: true,
    success: true,
    service: 'PerceptionArk Backend',
    version: '1.0.0',
    time: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB'
    }
  });
});

// ===== 系统状态 =====
router.get('/stats', async (req, res) => {
  res.json(await getStats());
});

router.get('/context', (req, res) => {
  res.json(getContext());
});

// ===== A01 场景感知 =====
router.post('/scene', upload.single('image'), async (req, res) => {
  try {
    const image = imgToBase64(req.file);
    // Mock模式下可不传图片,使用占位图
    const query = req.body.query || '';
    // silent: true — 结果通过HTTP响应返回,前端自行处理显示和播报
    // 不推送WebSocket事件(避免前端同时收到HTTP响应和WebSocket事件,导致重复显示/播报)
    const result = await runSceneAgent(image, query, { silent: true });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== A02 导航引导 =====
router.post('/navigate', async (req, res) => {
  try {
    const { destination, lat, lng } = req.body;
    if (!destination) return res.status(400).json({ error: '缺少目的地' });
    const result = await runNavigationAgent(destination, lat, lng);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POI搜索(实时搜索建议,类似高德输入联想) =====
router.get('/poi/search', async (req, res) => {
  try {
    const { keyword, lat, lng } = req.query;
    if (!keyword || keyword.trim().length < 1) {
      return res.json({ success: true, pois: [] });
    }
    const latNum = lat ? parseFloat(lat) : null;
    const lngNum = lng ? parseFloat(lng) : null;
    const pois = await searchPOI(keyword.trim(), latNum, lngNum);
    res.json({ success: true, pois });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== A03 安全预警 =====
router.post('/safety', upload.single('image'), async (req, res) => {
  try {
    const image = imgToBase64(req.file);
    const result = await runSafetyAgent(image, req.body.mode || 'scan');
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 跌倒检测
router.post('/fall', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const result = await triggerFallDetection(lat, lng);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 主动SOS(用户点击SOS按钮) =====
// 触发SOS: 立即发送位置给联系人,60秒后询问,再60秒无应答拨120
router.post('/sos/trigger', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const result = await triggerSosButton(lat, lng);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 用户应答SOS(说"我没事"等) - 取消120拨打
router.post('/sos/respond', (req, res) => {
  try {
    const result = respondSosButton();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 主动取消SOS
router.post('/sos/cancel', (req, res) => {
  try {
    const result = cancelSosButton();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 抢占演示 - 可视化冲突仲裁
router.post('/preemption-demo', upload.single('image'), async (req, res) => {
  try {
    const image = imgToBase64(req.file);
    await triggerDangerPreemption(image);
    res.json({ success: true, message: '抢占演示已启动' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== A04 社交辅助 =====
router.post('/social', upload.single('image'), async (req, res) => {
  try {
    const image = imgToBase64(req.file);
    // Mock模式下可不传图片
    const mode = req.body.mode || 'ocr';
    // silent: true — 结果通过HTTP响应返回,前端自行处理显示和播报
    const result = await runSocialAgent(image, mode, { silent: true });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== A05 环境记忆 =====
router.get('/memory', async (req, res) => {
  try {
    const result = await runMemoryAgent(req.query.query || '');
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 通用语音指令 =====
router.post('/voice', upload.single('image'), async (req, res) => {
  try {
    const text = req.body.text || '';
    const image = imgToBase64(req.file);
    let location = null;
    if (req.body.lat && req.body.lng) {
      location = { lat: parseFloat(req.body.lat), lng: parseFloat(req.body.lng), address: req.body.address };
    }
    const result = await handleVoiceCommand(text, image, location);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 位置更新(含输入验证) =====
router.post('/location', (req, res) => {
  try {
    const { lat, lng, address, province, city, district } = req.body;
    // 坐标验证: 必须是有效数字且在合理范围内
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({ success: false, error: 'lat/lng 必须为有效数字' });
    }
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ success: false, error: '坐标超出有效范围' });
    }
    updateLocation(latNum, lngNum, address || '', { province, city, district });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 逆地理编码 + 天气查询(小舟开机自检用) =====
router.get('/location-info', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: '缺少 lat/lng 参数' });
    }

    // 先逆地理编码拿地址和adcode(含省/市/区)
    const address = await reverseGeocode(lat, lng);
    // 用完整行政区划更新orchestrator中的位置
    updateLocation(lat, lng, address.address, {
      province: address.province, city: address.city, district: address.district
    });

    // 再用adcode查天气
    let weather = null;
    try {
      weather = await getWeather(address.adcode);
    } catch (err) {
      console.warn('[API] 天气查询失败:', err.message);
    }

    res.json({
      success: true,
      location: { lat, lng, ...address },
      weather
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 天气查询 =====
router.get('/weather', async (req, res) => {
  try {
    const adcode = req.query.adcode;
    if (!adcode) return res.status(400).json({ error: '缺少 adcode 参数' });
    const weather = await getWeather(adcode);
    res.json({ success: true, weather });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 系统重置 =====
router.post('/reset', (req, res) => {
  resetAll();
  res.json({ success: true });
});

// ===== 记忆库管理 =====
router.get('/memory/routes', async (req, res) => {
  res.json({ routes: await getAllRoutes() });
});

router.get('/memory/faces', async (req, res) => {
  res.json({ faces: await searchFaces() });
});

router.post('/memory/faces', async (req, res) => {
  const { name, relation, description } = req.body;
  if (!name) return res.status(400).json({ error: '缺少姓名' });
  const id = await addFace({ name, relation, description });
  res.json({ success: true, id });
});

router.delete('/memory/faces', async (req, res) => {
  const count = await forgetAllFaces();
  res.json({ success: true, deleted: count });
});

router.get('/memory/habits', async (req, res) => {
  res.json({ habits: await getAllHabits() });
});

router.get('/memory/stats', async (req, res) => {
  res.json(await getMemoryStats());
});

// ===== SOS事件历史 =====
router.get('/sos/events', async (req, res) => {
  res.json({ events: await getSosEvents(20) });
});

export default router;
