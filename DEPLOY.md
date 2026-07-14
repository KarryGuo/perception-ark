# 感知方舟 · 部署上线指引

> 本文档提供两种部署方案，**推荐使用方案A（一体化部署到 Render）**，部署后可获得一个公网可访问的体验链接，作为初赛提交地址。

---

## 📋 部署前准备

需要你准备的账号（均为免费）：

| 平台 | 用途 | 注册地址 |
|---|---|---|
| **GitHub** | 托管代码仓库 | https://github.com |
| **Render** | 部署后端服务（含前端） | https://render.com |
| **火山引擎方舟** | 真实豆包AI能力（可选） | https://console.volcengine.com/ark |

> 推荐方案A：仅用 Render 一个平台即可完成部署，前端构建产物由后端静态托管，无需单独部署前端。

---

## 🚀 方案A：一体化部署到 Render（推荐）

### 步骤1：推送代码到 GitHub

```bash
# 在 perception-ark 目录初始化并推送
cd f:\感知方舟\perception-ark
git init
git add .
git commit -m "PerceptionArk 全栈产品初赛版本"
git branch -M main
git remote add origin https://github.com/<你的用户名>/perception-ark.git
git push -u origin main
```

> 注意：推送前请确认 `.gitignore` 包含 `node_modules/`、`data/`、`.env`、`dist/`

### 步骤2：在 Render 创建 Blueprint

1. 登录 https://dashboard.render.com
2. 点击右上角 **New +** → **Blueprint**
3. 选择你的 GitHub 仓库 `perception-ark`
4. Render 会自动识别仓库根目录的 `render.yaml`，显示服务配置
5. 点击 **Apply** 开始部署

### 步骤3：配置环境变量

在 Render 服务详情页 → **Environment** 标签，配置以下变量：

| 变量 | 是否必填 | 值 | 说明 |
|---|---|---|---|
| `ARK_API_KEY` | ⭐ 接入真实AI必填 | 在火山引擎方舟控制台获取 | 不填则使用 MOCK 模式 |
| `AMAP_API_KEY` | 导航功能必填 | 在高德开放平台获取 | 不填则导航使用模拟数据 |
| `MOCK_MODE` | — | `false`（接入API Key后改） | 默认 `true`，配置后改 `false` |

> 修改环境变量后 Render 会自动重新部署。

### 步骤4：附加持久化磁盘（保存记忆数据）

render.yaml 已配置 1GB Disk，挂载在 `/data`，用于 SQLite 数据库持久化。免费套餐包含此磁盘。

### 步骤5：获取线上访问地址

部署完成后，Render 会分配一个公网地址，格式如：
```
https://perception-ark-backend-xxxx.onrender.com
```

直接在浏览器打开此地址即可访问 Demo 主页面。家属端访问：
```
https://perception-ark-backend-xxxx.onrender.com/#/family
```

### 步骤6：填入前端 API 地址（仅分体部署需要）

如采用一体化部署（方案A），前端构建时已由后端托管，**无需配置 VITE_API_BASE**。

如采用分体部署（前端 Vercel + 后端 Render），需在前端项目根目录创建 `.env.production`：

```bash
# frontend/.env.production
VITE_API_BASE=https://perception-ark-backend-xxxx.onrender.com
```

---

## 🌐 方案B：分体部署（Vercel + Render）

适用于希望前端 CDN 加速、后端独立扩展的场景。

### 前端部署到 Vercel

1. 登录 https://vercel.com
2. **Add New Project** → 选择 GitHub 仓库 `perception-ark`
3. **Root Directory** 设置为 `frontend`
4. **Build Command** 自动识别为 `npm run build`
5. **Output Directory** 自动识别为 `dist`
6. **Environment Variables** 添加：
   - `VITE_API_BASE` = `https://perception-ark-backend-xxxx.onrender.com`（你的 Render 后端地址）
7. 点击 **Deploy**

部署完成后获得地址：`https://perception-ark.vercel.app`

### 后端部署到 Render

同方案A步骤2-5。

---

## 🤖 方案C：Docker 容器化部署（任意平台）

适用于腾讯云/阿里云容器服务、Railway、Fly.io 等。

```bash
# 在 perception-ark/backend 目录构建镜像
cd f:\感知方舟\perception-ark\backend
docker build -t perception-ark-backend .

# 本地运行测试
docker run -p 3001:3001 \
  -e ARK_API_KEY=your_key \
  -e MOCK_MODE=false \
  -v perception-ark-data:/data \
  perception-ark-backend

# 推送到镜像仓库
docker tag perception-ark-backend your-registry/perception-ark-backend:latest
docker push your-registry/perception-ark-backend:latest
```

---

## ✅ 部署后验证清单

部署完成后，请逐项验证：

- [ ] 访问首页 `https://你的域名/` 能看到 Demo 主页面
- [ ] 访问家属端 `https://你的域名/#/family` 能看到家属端页面
- [ ] 点击"健康检查" `https://你的域名/api/health` 返回 JSON
- [ ] Demo 页面右上角显示 WebSocket 已连接（绿色圆点）
- [ ] 点击"自动演示"按钮能播放场景
- [ ] 点击"模拟跌倒"能触发 SOS 流程
- [ ] 点击"抢占演示"能看到 P0 抢占 P2 提示
- [ ] 家属端能看到位置、SOS 记录、紧急联系人

---

## 🔧 常见问题

### Q1：Render 免费套餐会休眠吗？
Render 免费套餐在 15 分钟无请求后会休眠，首次唤醒约 50 秒。初赛评审期间建议：
- 评审前手动访问一次唤醒
- 或升级到 Starter 套餐（$7/月）保持常驻

### Q2：MOCK 模式和真实 AI 模式的区别？
- **MOCK 模式**：所有 AI 响应返回预设文案，无需 API Key，便于评审快速体验
- **真实 AI 模式**：调用豆包 1.5 Vision Pro 进行真实视觉理解、OCR、人脸描述
- **推荐**：提交前先在 MOCK 模式验证流程，再配置 API Key 切换真实模式

### Q3：SQLite 数据会丢失吗？
- 配置了 `DATA_DIR=/data` 并附加了 Render Disk，数据会持久化
- 重新部署不会丢失数据，但删除服务会清除磁盘

### Q4：WebSocket 在 HTTPS 下能正常工作吗？
- 浏览器在 HTTPS 页面下会自动使用 `wss://` 协议
- Render 自动提供 SSL 证书，WebSocket Secure 无需额外配置

### Q5：如何更新部署？
- 推送代码到 GitHub main 分支，Render 会自动重新部署
- 修改环境变量也会触发重新部署

---

## 📞 部署后下一步

1. **整理 TRAE 实践过程**：导出 Session ID ≥ 3 个，截取开发关键步骤截图 ≥ 3 张
2. **撰写初赛帖**：按官方模板填写 Demo 简介、创作思路、体验地址、TRAE 实践过程
3. **提交到社区**：https://forum.trae.cn/c/38-category/40-category/40
4. **截止时间**：2026年7月15日 23:59（北京时间）

---

## 📁 部署相关文件清单

| 文件 | 用途 |
|---|---|
| [render.yaml](file:///f:/感知方舟/perception-ark/render.yaml) | Render Blueprint 配置 |
| [backend/Dockerfile](file:///f:/感知方舟/perception-ark/backend/Dockerfile) | Docker 容器化部署 |
| [backend/.dockerignore](file:///f:/感知方舟/perception-ark/backend/.dockerignore) | Docker 构建排除项 |
| [frontend/vercel.json](file:///f:/感知方舟/perception-ark/frontend/vercel.json) | Vercel 部署配置 |
| [frontend/.vercelignore](file:///f:/感知方舟/perception-ark/frontend/.vercelignore) | Vercel 部署排除项 |
| [frontend/.env.production.example](file:///f:/感知方舟/perception-ark/frontend/.env.production.example) | 前端生产环境变量模板 |
