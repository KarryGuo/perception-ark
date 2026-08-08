/**
 * 导航服务 - 使用高德地图API
 * MOCK模式下返回模拟数据，不依赖真实API Key
 */
import axios from 'axios';
import { log } from '../utils/logger.js';

// 函数内部读取env,避免ES模块import时dotenv尚未加载的问题
function getApiKey() {
  const key = process.env.AMAP_API_KEY || '';
  const MOCK_MODE = process.env.MOCK_MODE === 'true';
  return { key, configured: MOCK_MODE || (!!key && key !== 'your_amap_api_key_here'), MOCK_MODE };
}

// ============ MOCK 模拟数据 ============
// 默认模拟起点坐标 (北京天安门附近作为演示)
const MOCK_ORIGIN = { lat: 39.9087, lng: 116.3975 };
const MOCK_DEST = { lat: 39.9187, lng: 116.4075 }; // 东北方向约1.5km

function getMockPOIs(keyword, lat, lng) {
  const baseLat = lat || MOCK_ORIGIN.lat;
  const baseLng = lng || MOCK_ORIGIN.lng;
  return [
    {
      name: `${keyword}（模拟地点1）`,
      address: '模拟地址：前方约200米',
      city: '北京市',
      distance: 200,
      lat: baseLat + 0.001,
      lng: baseLng + 0.001
    },
    {
      name: `${keyword}（模拟地点2）`,
      address: '模拟地址：右前方约500米',
      city: '北京市',
      distance: 500,
      lat: baseLat + 0.0005,
      lng: baseLng + 0.003
    },
    {
      name: `${keyword}（模拟地点3）`,
      address: '模拟地址：左前方约800米',
      city: '北京市',
      distance: 800,
      lat: baseLat + 0.004,
      lng: baseLng - 0.002
    }
  ];
}

function getMockRoute(startLat, startLng, endLat, endLng) {
  const sLat = startLat || MOCK_ORIGIN.lat;
  const sLng = startLng || MOCK_ORIGIN.lng;
  const eLat = endLat || MOCK_DEST.lat;
  const eLng = endLng || MOCK_DEST.lng;

  // 生成简单的折线坐标：起点→中间点→终点
  const midLat = (sLat + eLat) / 2 + 0.0005;
  const midLng = (sLng + eLng) / 2 - 0.0003;
  const polyline = [
    `${sLng},${sLat}`,
    `${midLng},${midLat}`,
    `${eLng},${eLat}`
  ].join(';');

  return {
    distance: 1200,
    duration: 15,
    steps: [
      { instruction: '沿当前道路向东直行约300米', distance: 300, duration: 4, step: 1, polyline: `${sLng},${sLat};${midLng},${midLat}` },
      { instruction: '在路口左转，向北直行约500米', distance: 500, duration: 6, step: 2, polyline: `${midLng},${midLat};${(midLng+eLng)/2},${(midLat+eLat)/2}` },
      { instruction: '继续前行400米，目的地在右侧', distance: 400, duration: 5, step: 3, polyline: `${(midLng+eLng)/2},${(midLat+eLat)/2};${eLng},${eLat}` }
    ],
    polyline,
    source: 'mock'
  };
}

function getMockReverseGeocode() {
  return {
    province: '北京市',
    city: '北京市',
    district: '东城区',
    address: '北京市东城区东长安街（模拟定位）',
    adcode: '110101'
  };
}

function getMockWeather() {
  return {
    province: '北京市',
    city: '北京市',
    adcode: '110000',
    date: new Date().toISOString().slice(0, 10),
    week: '一',
    dayWeather: '晴',
    nightWeather: '多云',
    dayTemp: '26',
    nightTemp: '18',
    dayWind: '东南风',
    dayPower: '≤3',
    humidity: '45',
    reportTime: new Date().toISOString(),
    casts: [
      { date: new Date().toISOString().slice(0, 10), week: '一', dayWeather: '晴', dayTemp: '26', nightTemp: '18' },
      { date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), week: '二', dayWeather: '多云', dayTemp: '24', nightTemp: '17' }
    ]
  };
}

/**
 * 步行路径规划
 * @param {number} startLat
 * @param {number} startLng
 * @param {number} endLat
 * @param {number} endLng
 * @returns {Object} { distance, duration, steps, polyline }
 */
export async function planWalkRoute(startLat, startLng, endLat, endLng) {
  const { key: AMAP_API_KEY, configured: AMAP_CONFIGURED, MOCK_MODE } = getApiKey();

  if (MOCK_MODE) {
    log('A02', '【MOCK模式】路径规划返回模拟路线');
    return getMockRoute(startLat, startLng, endLat, endLng);
  }

  if (!AMAP_CONFIGURED) {
    throw new Error('未配置 AMAP_API_KEY，无法调用导航服务');
  }

  const response = await axios.get('https://restapi.amap.com/v3/direction/walking', {
    params: {
      key: AMAP_API_KEY,
      origin: `${startLng},${startLat}`,
      destination: `${endLng},${endLat}`,
      output: 'JSON'
    },
    timeout: 5000
  });

  if (response.data.status !== '1') {
    throw new Error(response.data.info || '高德导航API返回错误');
  }

  const path = response.data.route.paths[0];
  const steps = path.steps.map((s, i) => ({
    instruction: s.instruction,
    distance: parseInt(s.distance),
    duration: Math.ceil(parseInt(s.duration) / 60),
    step: i + 1,
    polyline: s.polyline
  }));

  const fullPolyline = path.steps.map(s => s.polyline).join(';');

  return {
    distance: parseInt(path.distance),
    duration: Math.ceil(parseInt(path.duration) / 60),
    steps,
    polyline: fullPolyline,
    source: 'amap'
  };
}

/**
 * POI搜索 - 搜索地点
 */
export async function searchPOI(keyword, lat, lng, radius = 50000) {
  const { key: AMAP_API_KEY, configured: AMAP_CONFIGURED, MOCK_MODE } = getApiKey();

  if (MOCK_MODE) {
    log('A02', `【MOCK模式】POI搜索返回模拟结果: ${keyword}`);
    return getMockPOIs(keyword, lat, lng);
  }

  if (!AMAP_CONFIGURED) {
    throw new Error('未配置 AMAP_API_KEY，无法调用POI搜索');
  }

  let pois = [];

  if (lat && lng) {
    try {
      const response = await axios.get('https://restapi.amap.com/v3/place/around', {
        params: {
          key: AMAP_API_KEY,
          keywords: keyword,
          location: `${lng},${lat}`,
          radius,
          output: 'JSON',
          offset: 5
        },
        timeout: 5000
      });
      if (response.data.status === '1') {
        pois = (response.data.pois || []).slice(0, 5).map(poi => ({
          name: poi.name,
          address: poi.address || '',
          city: poi.cityname || '',
          distance: parseInt(poi.distance || '0'),
          lat: parseFloat(poi.location.split(',')[1]),
          lng: parseFloat(poi.location.split(',')[0])
        }));
      }
    } catch (err) {
      log('A02', `周边搜索失败,尝试全局搜索: ${err.message}`, 'warn');
    }
  }

  if (pois.length === 0) {
    log('A02', `周边搜索无结果,改用全局关键词搜索: ${keyword}`);
    const response = await axios.get('https://restapi.amap.com/v3/place/text', {
      params: {
        key: AMAP_API_KEY,
        keywords: keyword,
        output: 'JSON',
        offset: 5,
        extensions: 'base'
      },
      timeout: 5000
    });
    if (response.data.status !== '1') {
      throw new Error(response.data.info || 'POI搜索失败');
    }
    pois = (response.data.pois || []).slice(0, 5).map(poi => {
      const loc = poi.location ? poi.location.split(',') : ['0', '0'];
      return {
        name: poi.name,
        address: poi.address || poi.cityname || '',
        city: poi.cityname || '',
        distance: 0,
        lat: parseFloat(loc[1]),
        lng: parseFloat(loc[0])
      };
    });
  }

  return pois;
}

/**
 * 逆地理编码 - 坐标转地址
 */
export async function reverseGeocode(lat, lng) {
  const { key: AMAP_API_KEY, configured: AMAP_CONFIGURED, MOCK_MODE } = getApiKey();

  if (MOCK_MODE) {
    log('A02', '【MOCK模式】逆地理编码返回模拟地址');
    return getMockReverseGeocode();
  }

  if (!AMAP_CONFIGURED) {
    throw new Error('未配置 AMAP_API_KEY，无法进行逆地理编码');
  }
  const response = await axios.get('https://restapi.amap.com/v3/geocode/regeo', {
    params: {
      key: AMAP_API_KEY,
      location: `${lng},${lat}`,
      extensions: 'base',
      output: 'JSON'
    },
    timeout: 5000
  });
  if (response.data.status !== '1') throw new Error(response.data.info || '逆地理编码失败');
  const addr = response.data.regeocode.addressComponent;
  return {
    province: addr.province || '',
    city: Array.isArray(addr.city) ? (addr.city[0] || '') : (addr.city || ''),
    district: addr.district || '',
    address: response.data.regeocode.formatted_address || '',
    adcode: addr.adcode || ''
  };
}

/**
 * 天气查询 - 返回预报天气
 */
export async function getWeather(adcode) {
  const { key: AMAP_API_KEY, configured: AMAP_CONFIGURED, MOCK_MODE } = getApiKey();

  if (MOCK_MODE) {
    log('A02', '【MOCK模式】天气查询返回模拟数据');
    return getMockWeather();
  }

  if (!AMAP_CONFIGURED || !adcode) {
    throw new Error('未配置 AMAP_API_KEY 或缺少 adcode，无法查询天气');
  }
  const response = await axios.get('https://restapi.amap.com/v3/weather/weatherInfo', {
    params: {
      key: AMAP_API_KEY,
      city: adcode,
      extensions: 'all',
      output: 'JSON'
    },
    timeout: 5000
  });
  if (response.data.status !== '1') throw new Error(response.data.info || '天气查询失败');
  const forecasts = response.data.forecasts || [];
  if (forecasts.length === 0 || !forecasts[0].casts || forecasts[0].casts.length === 0) {
    throw new Error('天气数据为空');
  }
  const today = forecasts[0].casts[0];
  return {
    province: forecasts[0].province || response.data.province || '',
    city: forecasts[0].city || response.data.city || '',
    adcode,
    date: today.date,
    week: today.week,
    dayWeather: today.dayweather,
    nightWeather: today.nightweather,
    dayTemp: today.daytemp,
    nightTemp: today.nighttemp,
    dayWind: today.daywind,
    dayPower: today.daypower,
    humidity: today.humidity || '',
    reportTime: forecasts[0].reporttime || response.data.reporttime,
    casts: forecasts[0].casts.slice(0, 4).map(c => ({
      date: c.date,
      week: c.week,
      dayWeather: c.dayweather,
      dayTemp: c.daytemp,
      nightTemp: c.nighttemp
    }))
  };
}
