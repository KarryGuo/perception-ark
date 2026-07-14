# 感知方舟后端 Dockerfile
# 适用于任何容器化部署平台(Render/Railway/Fly.io/腾讯云/阿里云容器服务)
# 使用方法: docker build -t perception-ark-backend . && docker run -p 3001:3001 perception-ark-backend

FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制package文件并安装依赖
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# 复制源码
COPY . .

# 创建数据持久化目录
RUN mkdir -p /data

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data
ENV MOCK_MODE=true

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# 启动
CMD ["node", "src/index.js"]
