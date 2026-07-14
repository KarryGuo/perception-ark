@echo off
chcp 65001 >nul
title PerceptionArk 启动器
color 0A

echo.
echo  ╔═══════════════════════════════════════════════════════╗
echo  ║                                                       ║
echo  ║   PerceptionArk · 感知方舟                             ║
echo  ║   视障人群AI感知眼镜 · TRAE五智能体协作                 ║
echo  ║                                                       ║
echo  ╚═══════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: 检查 node 是否安装
where node >nul 2>&1
if errorlevel 1 (
    echo  [错误] 未检测到 Node.js,请先安装: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查依赖是否安装
if not exist "backend\node_modules" (
    echo  [初始化] 正在安装后端依赖...
    cd backend && npm install --no-audit --no-fund && cd ..
)
if not exist "frontend\node_modules" (
    echo  [初始化] 正在安装前端依赖...
    cd frontend && npm install --no-audit --no-fund && cd ..
)
if not exist "node_modules" (
    echo  [初始化] 正在安装根目录依赖...
    call npm install --no-audit --no-fund
)

:: 检查 .env 文件
if not exist "backend\.env" (
    echo  [初始化] 创建 backend\.env 配置文件...
    copy "backend\.env.example" "backend\.env" >nul
)

echo.
echo  [启动] 后端服务 (端口 3001)...
start "PerceptionArk Backend" cmd /k "cd /d %~dp0backend && color 0B && title PerceptionArk Backend && npm run dev"

echo  [启动] 前端服务 (端口 5173)...
start "PerceptionArk Frontend" cmd /k "cd /d %~dp0frontend && color 0D && title PerceptionArk Frontend && npm run dev"

echo.
echo  ╔═══════════════════════════════════════════════════════╗
echo  ║  ✓ 启动完成                                            ║
echo  ║                                                       ║
echo  ║  Demo主页面:  http://localhost:5173/                  ║
echo  ║  家属端页面:  http://localhost:5173/#/family          ║
echo  ║  API健康检查: http://localhost:3001/api/health        ║
echo  ║                                                       ║
echo  ║  当前模式: MOCK (无需API Key即可体验全部功能)          ║
echo  ║  接入真实AI: 编辑 backend\.env 填写 ARK_API_KEY       ║
echo  ║             并将 MOCK_MODE 改为 false                 ║
echo  ║                                                       ║
echo  ║  关闭服务: 直接关闭弹出的两个窗口                      ║
echo  ╚═══════════════════════════════════════════════════════╝
echo.

:: 等待3秒后自动打开浏览器
echo  [提示] 3秒后自动打开浏览器...
timeout /t 3 /nobreak >nul
start http://localhost:5173/

pause
