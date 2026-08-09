# 感知方舟 · AI 智能感知眼镜系统 🛰️👓

一个面向视障人群的 AI 智能感知辅助系统，以**手机替代传统电子眼镜**为核心设计理念，集成五大智能体协作架构，提供实时避障、场景识别、智能导航、文字读取、人脸描述、SOS 紧急求助等功能。采用千问大模型多模型分工调度，兼顾响应速度与识别精度。

> 本项目为交流学习用途，请勿直接给视障人群使用。

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [系统架构](#-系统架构) • [使用说明](#-使用说明) • [配置说明](#-配置说明)

---

## 📋 目录

- [功能特性](#-功能特性)
- [设计理念](#-设计理念)
- [系统要求](#-系统要求)
- [快速开始](#-快速开始)
- [系统架构](#-系统架构)
- [使用说明](#-使用说明)
- [配置说明](#-配置说明)
- [项目结构](#-项目结构)
- [开发文档](#-开发文档)
- [License](#-license)

---

## ✨ 功能特性

### 🤖 五大智能体协作架构

感知方舟采用多智能体协作设计，每个智能体专注一个感知域，由 Orchestrator 统一调度：

- **A01 场景感知 Agent** — 描述前方环境、路况、障碍物分布
- **A02 导航 Agent** — POI 搜索、步行路径规划、实时导航引导
- **A03 安全预警 Agent** — 障碍物检测、红绿灯识别、危险预emption
- **A04 文字/人脸识别 Agent** — OCR 文字读取（菜单/招牌/药盒）+ 人脸描述
- **A05 环境记忆 Agent** — 路线记忆、熟人记忆、习惯学习

### 🎯 多模型分工调度

基于千问大模型家族，每个智能体使用专用模型，失败自动降级到 Omni 兜底：

| 智能体 | 专用模型 | 用途 | 兜底 |
|--------|---------|------|------|
| A01 场景感知 | `qwen-vl-plus` | 纯视觉理解，速度快 | Omni |
| A02 导航意图 | `qwen-turbo` | 纯文本意图识别，最快最省 | Omni |
| A03 安全预警 | `qwen-vl-plus` | 障碍物/红绿灯视觉判断 | Omni |
| A04 OCR | `qwen-vl-plus` | 文字识别（可升级 vl-max） | Omni |
| A04 人脸 | `qwen-omni-turbo` | 视觉+语音协同 | Omni |
| 兜底模型 | `qwen3.5-omni-flash` | 全模态，任何专用模型失败自动降级 | — |

### 🚶 智能导航系统

- **POI 智能搜索** — 基于高德地图 API，支持"附近超市""带我去药店"等自然语言
- **步行路径规划** — 实时路线引导，语音播报转向提示
- **最后 10 米视觉锚定** — 到达 GPS 终点后，用 VLM 识别门面招牌 + OCR 读文字，引导用户精准定位
- **路线记忆** — 常用路线自动记忆，支持"上次去过的地方"

### 🛡️ 实时安全预警

- **障碍物检测** — 基于 VLM 视觉判断，分级震动反馈（紧急/警告/提示）
- **红绿灯识别** — Canvas 颜色阈值快速通道 + VLM 确认，红灯触发全屏红色动画+震动+语音
- **方向空间音频** — Web Audio API StereoPannerNode，左前方/正前方/右前方定向提示
- **危险预emption** — 检测到危险立即打断当前播报，优先播报安全警告

### 📝 文字识别（OCR）

- **多场景支持** — 菜单/招牌/药盒/价签/说明书
- **结构化输出** — 自动按"名称 价格"或"项目:内容"格式整理
- **长文本摘要** — 超过 100 字自动生成一句话摘要

### 👥 人脸描述

- **人物描述** — 性别、年龄、衣着、表情、是否挥手打招呼
- **熟人记忆** — 显著特征记忆（戴眼镜/发型等）

### 🆘 SOS 紧急求助系统

- **一键 SOS** — 立即发送当前位置给家属，同步云端
- **跌倒检测** — 基于 IMU 传感器数据，10 秒倒计时（可语音"我没事"取消）
- **60 秒语音检查** — SOS 触发后 60 秒内无响应自动拨打 120
- **家属绑定** — 输入家属手机号绑定，未注册自动短信邀请
- **家属端 App** — 家属可查看视障亲人位置、接收 SOS 通知

### 🎙️ 语音交互

- **语音唤醒** — 唤醒词"小舟小舟"/"小周小周"，唤醒后蓝色脉冲指示
- **按住说话** — 按住按钮说话，松开识别
- **语音合成（TTS）** — 中文语音播报，支持语速/音色配置
- **回声抑制** — TTS 播报期间屏蔽 ASR，防止 TTS 音频被识别形成回声循环

### 🎨 无障碍设计

- **大字体模式** — 默认开启，视障友好
- **高对比度** — 清晰的字体颜色对比
- **触觉反馈** — 所有按钮 :active 缩放反馈 + 震动反馈
- **ARIA 标签** — 完整的 role/aria-label/aria-live 无障碍属性
- **48px 最小触控** — 所有交互按钮 ≥ 48px，符合无障碍标准

---

## 💡 设计理念

### 为什么用手机替代电子眼镜？

传统电子眼镜存在三个痛点：

1. **电池续航短** — 电子眼镜电池容量 500-800mAh，难以支撑全天使用
2. **硬件研发门槛高** — 需要传感器/摄像头/麦克风集成，团队无硬件能力时难以落地
3. **迭代速度慢** — 硬件迭代以月计，软件迭代以天计

感知方舟的方案：

- **手机作为"眼镜"** — 利用手机摄像头/麦克风/陀螺仪/GPS/震动马达
- **挂件模式** — 手机挂在胸口，解放双手，用于行走避障
- **手持模式** — 手机拿在手上，用于主动扫描前方物体
- **骨传导耳机** — 音频输出不堵耳朵，保证环境音感知

### 为什么用多模型分工？

全用 Omni 全模态模型存在三个问题：

1. **延迟高** — 全模态融合开销大，避障场景响应不够快
2. **成本高** — 纯文本任务用 Omni 是杀鸡用牛刀
3. **幻觉率高** — 通用模型在专精任务上不如专用模型

感知方舟的方案：

- **专用模型** — 每个 Agent 用最合适的模型（VL/Turbo/Omni-Turbo）
- **Omni 兜底** — 任何专用模型失败，自动降级到 Omni 全模态
- **成本降 50%+** — Turbo 比 Omni 便宜一个数量级
- **延迟降 40-60%** — VL 比 Omni 快

---

## 💻 系统要求

### 硬件要求

- **视障端**（用户）：
  - 智能手机（Android 8.0+ / iOS 13+），支持摄像头、麦克风、GPS、震动
  - 骨传导耳机（推荐，不堵耳朵保证安全）
  - 手机挂件（可选，挂胸口使用）

- **家属端**（家属）：
  - 智能手机，用于接收 SOS 通知、查看亲人位置

- **服务器**（开发者）：
  - Node.js 18+ 运行环境
  - 1GB RAM（推荐 2GB）
  - 10GB 可用存储

### 软件要求

- **后端**：Node.js 18+，Express 4，better-sqlite3
- **前端**：React 18 + Vite 5
- **移动端**：Capacitor 6（打包 Android/iOS）
- **浏览器**：Chrome 90+，Safari 14+（需支持 Web Speech API、Web Audio API、MediaDevices）

### API 密钥

- **阿里云千问 API Key**（必需）— 视觉理解/OCR/人脸/对话
  - 申请地址：https://dashscope.console.aliyun.com/
- **高德地图 API Key**（必需）— 导航/POI/逆地理编码
  - 申请地址：https://lbs.amap.com/
- **短信服务**（可选）— 家属邀请注册
  - 阿里云短信 / 腾讯云短信

---

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/KarryGuo/perception-ark.git
cd perception-ark
```

### 2. 配置后端

```bash
cd backend
npm install

# 复制环境变量配置
cp .env.example .env

# 编辑 .env 填入真实 API Key
# QWEN_API_KEY=sk-your-qwen-key
# AMAP_API_KEY=your-amap-key
```

### 3. 配置前端

```bash
cd ../frontend
npm install

# 复制环境变量配置
cp .env.example .env

# 编辑 .env 填入前端配置
# VITE_AMAP_JS_KEY=your-amap-js-key
# VITE_API_BASE=http://localhost:3001
```

### 4. 启动服务

```bash
# 启动后端（端口 3001）
cd backend
npm run dev

# 启动前端（端口 5173）
cd frontend
npm run dev
```

打开浏览器访问 `http://localhost:5173` 即可使用。

### 5. 打包移动端（可选）

```bash
cd frontend-app
npm install
npx cap sync

# Android
npx cap open android

# iOS
npx cap open ios
```

---

## 🏗️ 系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ 视障端 App   │  │ 家属端 App   │  │ 管理后台     │       │
│  │ (手机挂件)   │  │ (手机)       │  │ (Web)        │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │ REST + WebSocket │                  │
┌─────────┼──────────────────┼──────────────────┼─────────────┐
│         │     后端服务层    │                  │              │
│  ┌──────▼──────────────────▼──────────────────▼────────┐     │
│  │ Express 主服务 (index.js)                           │     │
│  │ - REST API 路由                                      │     │
│  │ - WebSocket 实时通信                                 │     │
│  │ - JWT 认证                                           │     │
│  └────┬────────────────┬────────────────┬─────────────┘     │
│       │                │                │                    │
│  ┌────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐            │
│  │ Auth 路由 │  │ API 路由    │  │ Family 路由 │            │
│  │ (auth.js) │  │ (api.js)    │  │ (family.js) │            │
│  └───────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                   智能体协作层                                │
│  ┌─────────────────────────────────────────────────┐        │
│  │ Orchestrator (orchestrator.js)                  │        │
│  │ - 五大 Agent 统一调度                            │        │
│  │ - 意图识别 + 任务分发                            │        │
│  │ - 多模型分工 + Omni 兜底                         │        │
│  └───┬──────────┬──────────┬──────────┬───────────┘        │
│      │          │          │          │                      │
│  ┌───▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────┐ ┌──────────┐  │
│  │ A01    │ │ A02    │ │ A03    │ │ A04    │ │ A05      │  │
│  │ 场景   │ │ 导航   │ │ 安全   │ │ 识别   │ │ 记忆     │  │
│  │ 感知   │ │        │ │ 预警   │ │        │ │          │  │
│  └────────┘ └────────┘ └────────┘ └────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                   大模型服务层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ qwen-vl-plus │  │ qwen-turbo   │  │qwen-omni-turbo│      │
│  │ (视觉/OCR)   │  │ (文本意图)   │  │ (人脸全模态)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────────────────────────────────────┐           │
│  │ qwen3.5-omni-flash (全模态兜底)               │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                   外部服务层                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ 高德地图 API │  │ 阿里云短信   │  │ SQLite 数据库│       │
│  │ (导航/POI)   │  │ (家属邀请)   │  │ (用户/记忆)  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 核心模块说明

| 模块 | 文件 | 功能 |
|------|------|------|
| **主服务** | `backend/src/index.js` | Express 服务、路由挂载、WebSocket |
| **智能体调度** | `backend/src/agents/orchestrator.js` | 五大 Agent 调度、多模型分工 |
| **千问客户端** | `backend/src/services/trae-client.js` | 多模型调用 + Omni 兜底 |
| **助手服务** | `backend/src/services/assistant.js` | 意图识别、多轮对话 |
| **高德客户端** | `backend/src/services/amap-client.js` | POI/导航/逆地理编码 |
| **记忆存储** | `backend/src/services/memory-store.js` | SQLite 数据库、用户/路线/记忆 |
| **认证服务** | `backend/src/services/auth.js` | JWT 生成/验证 |
| **认证路由** | `backend/src/routes/auth.js` | 注册/登录/家属绑定 |
| **API 路由** | `backend/src/routes/api.js` | 视觉/OCR/导航接口 |
| **家属路由** | `backend/src/routes/family.js` | 家属端功能 |
| **管理后台** | `backend/src/routes/admin.js` | 用户管理/日志查看 |

### 前端核心模块

| 模块 | 文件 | 功能 |
|------|------|------|
| **主应用** | `frontend/src/pages/AppMobile.jsx` | 视障端主界面、语音交互、SOS |
| **设置** | `frontend/src/pages/Settings.jsx` | 账户/音频/无障碍/家属绑定 |
| **家属端** | `frontend/src/pages/Family.jsx` | 家属端界面 |
| **登录注册** | `frontend/src/pages/Login.jsx` | 用户名/手机验证码登录 |
| **语音 Hook** | `frontend/src/hooks/useSpeech.js` | ASR + TTS + 唤醒词 |
| **空间音频** | `frontend/src/hooks/useSpatialAudio.js` | 方向性语音播报 |
| **摄像头** | `frontend/src/hooks/useCamera.js` | 摄像头采集 + Canvas 分析 |
| **地图** | `frontend/src/components/MapView.jsx` | 高德地图导航渲染 |

---

## 📖 使用说明

### 语音指令

系统支持唤醒词"小舟小舟"激活，激活后可说以下指令：

#### 场景感知

```
"前面是什么"      → 描述前方环境
"周围有什么"      → 描述周围路况
"描述一下环境"    → 详细环境描述
```

#### 导航控制

```
"带我去超市"      → 搜索附近超市并导航
"导航到药店"      → 导航到指定地点
"附近有什么"      → 搜索附近 POI
"去第一个"        → 选择 POI 列表第 1 项
"停止导航"        → 结束当前导航
```

#### 文字识别

```
"读文字"          → 识别前方文字
"读菜单"          → 读取菜单内容
"读药盒"          → 读取药盒说明
"读招牌"          → 读取前方招牌
```

#### 人脸识别

```
"前面是谁"        → 描述前方人物
"认识他吗"        → 识别是否熟人
```

#### 安全检查

```
"检查安全"        → 主动安全检查
（行走中自动检测） → 无需指令，自动避障
```

#### SOS 紧急

```
"救命"            → 触发 SOS
"我没事"          → 取消 SOS
```

### 交互模式

1. **语音唤醒模式** — 说"小舟小舟"唤醒，蓝色脉冲指示，8 秒内说话
2. **按住说话模式** — 长按按钮说话，松开识别
3. **持续监测模式** — 出行/红绿灯模式下，自动每 2.5 秒检测一次

### 无障碍设置

在设置页面可配置：

- **大字体模式** — 默认开启，放大所有文字
- **高对比度** — 增强字体颜色对比
- **语速调节** — TTS 播报速度 0.5-2.0x
- **音色选择** — 选择中文语音音色
- **震动强度** — 紧急/警告/提示分级震动

---

## ⚙️ 配置说明

### 后端环境变量

创建 `backend/.env` 文件：

```env
# 服务端口
PORT=3001

# ===== 阿里千问 Qwen API (多模型分工) =====
QWEN_API_KEY=sk-your-qwen-key
QWEN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
# 多模型分工(失败自动降级到 QWEN_MODEL 兜底)
QWEN_MODEL=qwen3.5-omni-flash          # 默认兜底(全模态)
QWEN_MODEL_VL=qwen-vl-plus             # 视觉专用(场景/安全)
QWEN_MODEL_OCR=qwen-vl-plus            # OCR专用(可升级 vl-max)
QWEN_MODEL_TURBO=qwen-turbo            # 文本专用(意图识别)
QWEN_MODEL_OMNI=qwen-omni-turbo        # 全模态专用(人脸)

# ===== 高德地图 API =====
AMAP_API_KEY=your-amap-key

# ===== JWT 密钥 =====
JWT_SECRET=your-jwt-secret

# ===== 短信服务(可选) =====
SMS_PROVIDER=none                      # none/aliyun/tencent

# ===== 模拟模式(无 API Key 时设为 true) =====
MOCK_MODE=false
```

### 前端环境变量

创建 `frontend/.env` 文件：

```env
VITE_API_BASE=http://localhost:3001
VITE_AMAP_JS_KEY=your-amap-js-key
VITE_AMAP_SECURITY_CODE=your-security-code
```

### 模拟模式

未配置 API Key 时，设置 `MOCK_MODE=true`，系统将：

- 返回模拟的视觉理解/OCR/人脸结果
- 模拟 POI 搜索和路径规划
- 保留完整交互流程，便于开发演示

---

## 📁 项目结构

```
perception-ark/
├── backend/                      # 后端服务
│   ├── src/
│   │   ├── agents/
│   │   │   └── orchestrator.js   # 五大智能体调度
│   │   ├── routes/
│   │   │   ├── admin.js          # 管理后台
│   │   │   ├── api.js            # 核心 API
│   │   │   ├── auth.js           # 认证/家属绑定
│   │   │   └── family.js         # 家属端
│   │   ├── services/
│   │   │   ├── amap-client.js    # 高德地图
│   │   │   ├── assistant.js      # 意图识别
│   │   │   ├── auth.js           # JWT 认证
│   │   │   ├── memory-store.js   # SQLite 存储
│   │   │   ├── sms.js            # 短信服务
│   │   │   └── trae-client.js    # 千问多模型客户端
│   │   ├── utils/
│   │   │   └── logger.js         # 日志工具
│   │   └── index.js              # 主入口
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── frontend/                     # Web 前端
│   ├── src/
│   │   ├── components/
│   │   │   ├── AssistantWidget.jsx  # 助手浮窗
│   │   │   ├── LVAProcess.jsx       # LVA 进度
│   │   │   └── MapView.jsx          # 地图导航
│   │   ├── hooks/
│   │   │   ├── useAssistant.js      # 助手 Hook
│   │   │   ├── useAuth.jsx          # 认证 Hook
│   │   │   ├── useCamera.js         # 摄像头 Hook
│   │   │   ├── useGeolocation.js    # 定位 Hook
│   │   │   ├── useIMU.js            # IMU 传感器
│   │   │   ├── useSpatialAudio.js   # 空间音频
│   │   │   ├── useSpeech.js         # 语音 ASR/TTS
│   │   │   └── useWebSocket.js      # WebSocket
│   │   ├── pages/
│   │   │   ├── AppMobile.jsx        # 视障端主界面
│   │   │   ├── Family.jsx           # 家属端
│   │   │   ├── Login.jsx            # 登录
│   │   │   ├── Register.jsx         # 注册
│   │   │   ├── ForgotPassword.jsx   # 找回密码
│   │   │   ├── Settings.jsx         # 设置
│   │   │   └── Guide.jsx            # 使用引导
│   │   ├── services/
│   │   │   ├── amap.js              # 高德前端
│   │   │   └── api.js               # API 封装
│   │   ├── styles/
│   │   │   └── global.css           # 全局样式
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
├── frontend-app/                 # Capacitor 移动端
│   ├── android/                  # Android 工程
│   ├── ios/                      # iOS 工程
│   ├── src/                      # 同步自 frontend
│   └── capacitor.config.json
├── render.yaml                   # Render 部署配置
├── start.bat                     # Windows 启动脚本
└── package.json
```

---

## 🛠️ 开发文档

### 添加新的语音指令

在 `backend/src/services/assistant.js` 的 `understandIntent` 函数中添加规则：

```javascript
const rules = [
  // 添加新指令
  { intent: 'new_feature', patterns: [/新功能关键词/], extract: (m) => m[1] },
  // ... 现有规则
];
```

在 `backend/src/agents/orchestrator.js` 中处理新意图：

```javascript
case 'new_feature':
  result = await newFeatureAgent(imageBase64, location, MODEL_VL);
  break;
```

### 添加新的智能体

1. 在 `orchestrator.js` 中新增 Agent 函数：

```javascript
async function runNewAgent(imageBase64, location, model) {
  const result = await visionUnderstand(imageBase64, '新 Agent 提示词', model);
  return { agent: 'A06-新Agent', result };
}
```

2. 在 `runOrchestrator` 中注册调度逻辑

### 切换专用模型

修改 `backend/.env` 即可切换模型，无需改代码：

```env
# OCR 升级到 vl-max 提升小字精度
QWEN_MODEL_OCR=qwen-vl-max

# 场景感知用最新模型
QWEN_MODEL_VL=qwen3.6-plus
```

### 调整安全检测频率

在 `frontend/src/pages/AppMobile.jsx` 中：

```javascript
// 出行/红绿灯模式: 2.5 秒
// 其他模式: 5 秒
const SCAN_INTERVAL = isTravelMode ? 2500 : 5000;
```

---

## 📄 License

MIT License - 详见 [LICENSE](LICENSE)

---

> **免责声明**：本项目为交流学习用途，请勿直接给视障人群使用。实际应用于视障人群前，需经过充分测试与专业评估。
