/**
 * Leaflet 地图服务 - 使用国内可访问的高德地图瓦片
 * 无需API Key，提供真实世界地图展示（暗色主题适配）
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 修复Leaflet默认图标路径问题（Vite打包兼容）
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

let defaultIconFixed = false;
function fixDefaultIcon() {
  if (defaultIconFixed) return;
  delete (L.Icon.Default.prototype)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl,
    iconRetinaUrl,
    shadowUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });
  defaultIconFixed = true;
}

let mapInstance = null;
let userMarker = null;
let routePolyline = null;
let destinationMarker = null;
let tileLayer = null;

/**
 * 初始化地图
 * @param {HTMLElement} container 地图容器DOM元素
 * @param {number} lat 初始纬度
 * @param {number} lng 初始经度
 * @param {number} zoom 初始缩放级别
 * @returns {L.Map} Leaflet地图实例
 */
export function initMap(container, lat = 39.9087, lng = 116.3975, zoom = 16) {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
  fixDefaultIcon();

  mapInstance = L.map(container, {
    center: [lat, lng],
    zoom: zoom,
    zoomControl: false,
    attributionControl: false
  });

  // 使用高德地图瓦片 - 标准样式，国内访问速度快
  // 通过CSS添加暗色遮罩层实现深色主题
  tileLayer = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    subdomains: ['1', '2', '3', '4'],
    maxZoom: 18,
    minZoom: 3,
    className: 'amap-tiles-layer'
  }).addTo(mapInstance);

  // 创建用户位置标记（发光圆点）
  const userIcon = L.divIcon({
    className: 'user-location-marker',
    html: '<div style="width:20px;height:20px;border-radius:50%;background:#00D4FF;box-shadow:0 0 20px #00D4FF,0 0 8px rgba(255,255,255,0.8);border:3px solid #fff;position:relative;"><div style="position:absolute;top:-8px;left:-8px;width:36px;height:36px;border-radius:50%;background:rgba(0,212,255,0.3);animation:pulse 2s ease-out infinite;"></div></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
  userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(mapInstance);

  return mapInstance;
}

/**
 * 更新用户位置
 * @param {number} lat 纬度
 * @param {number} lng 经度
 * @param {boolean} panTo 是否移动地图中心到用户位置
 */
export function updateUserLocation(lat, lng, panTo = true) {
  if (!mapInstance || !userMarker) return;
  userMarker.setLatLng([lat, lng]);
  if (panTo) {
    mapInstance.panTo([lat, lng], { animate: true, duration: 0.5 });
  }
}

/**
 * 设置目的地标记
 * @param {number} lat 纬度
 * @param {number} lng 经度
 * @param {string} name 目的地名称
 */
export function setDestination(lat, lng, name = '目的地') {
  if (!mapInstance) return;

  // 清除旧标记
  if (destinationMarker) {
    mapInstance.removeLayer(destinationMarker);
  }

  const destIcon = L.divIcon({
    className: 'destination-marker',
    html: `<div style="background:#FF6B35;color:#fff;padding:4px 10px;border-radius:12px;font-size:12px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid #fff;">📍 ${name}</div>`,
    iconSize: [null, null],
    iconAnchor: [40, 30]
  });
  destinationMarker = L.marker([lat, lng], { icon: destIcon }).addTo(mapInstance);

  // 自适应视野显示起点和终点
  if (userMarker) {
    const bounds = L.latLngBounds([
      userMarker.getLatLng(),
      [lat, lng]
    ]);
    mapInstance.fitBounds(bounds, { padding: [50, 50] });
  }
}

/**
 * 绘制路线
 * @param {Array<[number, number]>} path 路线坐标点数组 [[lat,lng], ...]
 * @param {string} color 路线颜色
 */
export function drawRoute(path, color = '#00FFA3') {
  if (!mapInstance) return;

  // 清除旧路线
  if (routePolyline) {
    mapInstance.removeLayer(routePolyline);
  }

  if (path && path.length > 1) {
    routePolyline = L.polyline(path, {
      color: color,
      weight: 5,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(mapInstance);

    // 自适应视野
    mapInstance.fitBounds(routePolyline.getBounds(), { padding: [50, 50] });
  }
}

/**
 * 清除路线和目的地
 */
export function clearRoute() {
  if (mapInstance) {
    if (routePolyline) {
      mapInstance.removeLayer(routePolyline);
      routePolyline = null;
    }
    if (destinationMarker) {
      mapInstance.removeLayer(destinationMarker);
      destinationMarker = null;
    }
  }
}

/**
 * 获取地图实例
 */
export function getMap() {
  return mapInstance;
}

/**
 * 销毁地图
 */
export function destroyMap() {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
    userMarker = null;
    routePolyline = null;
    destinationMarker = null;
  }
}

export { L };
