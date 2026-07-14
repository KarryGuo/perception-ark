/**
 * 导航服务 - 使用高德地图API
 * 出错时抛出真实错误，不返回模拟数据
 */
import axios from 'axios';
import { log } from '../utils/logger.js';

// 函数内部读取env,避免ES模块import时dotenv尚未加载的问题
function getApiKey() {
  const key = process.env.AMAP_API_KEY || '';
  return { key, configured: !!key && key !== 'your_amap_api_key_here' };
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
  const { key: AMAP_API_KEY, configured: AMAP_CONFIGURED } = getApiKey();
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
    polyline: s.polyline  // 保留原始折线坐标,用于地图绘制
  }));

  // 提取完整路线的折线坐标
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
 * 先周边搜索(大半径),搜不到则全局关键词搜索
 * @param {string} keyword - 搜索关键词
 * @param {number} lat - 纬度(可为null,全局搜索时不需要)
 * @param {number} lng - 经度(可为null,全局搜索时不需要)
 * @param {number} radius - 周边搜索半径(米),默认50km
 */
export async function searchPOI(keyword, lat, lng, radius = 50000) {
  const { key: AMAP_API_KEY, configured: AMAP_CONFIGURED } = getApiKey();
  if (!AMAP_CONFIGURED) {
    throw new Error('未配置 AMAP_API_KEY，无法调用POI搜索');
  }

  let pois = [];

  // 1. 有位置时先周边搜索(大半径)
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
          distance: parseInt(poi.distance || '0'),
          lat: parseFloat(poi.location.split(',')[1]),
          lng: parseFloat(poi.location.split(',')[0])
        }));
      }
    } catch (err) {
      log('A02', `周边搜索失败,尝试全局搜索: ${err.message}`, 'warn');
    }
  }

  // 2. 周边搜索无结果时,全局关键词搜索(不带位置限制)
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
  const { key: AMAP_API_KEY, configured: AMAP_CONFIGURED } = getApiKey();
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
  const { key: AMAP_API_KEY, configured: AMAP_CONFIGURED } = getApiKey();
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
  // 高德预报天气返回结构: { forecasts: [{ casts: [...] }] }
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
