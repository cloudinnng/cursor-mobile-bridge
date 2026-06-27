@echo off
REM ============================================================
REM Cursor 移动桥接 — 启动服务器
REM 双击运行或在 cmd 中执行: start-server.bat
REM 自动请求管理员权限（UAC 提升）
REM ============================================================

REM --- 管理员权限：未提升则用 UAC 重新启动本脚本 ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [start-server] 需要管理员权限，正在请求 UAC 提升...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs -WorkingDirectory '%~dp0'"
    exit /b 0
)
echo [start-server] 已以管理员身份运行

REM 切换到 bat 所在目录（项目根目录）
cd /d "%~dp0"

REM 控制台 UTF-8，避免中文 log 乱码
chcp 65001 >nul 2>&1

echo.
echo [start-server] Cursor 移动桥接 — 正在启动...
echo [start-server] 工作目录: %CD%
echo.

REM 检查 Node.js 是否可用
where node >nul 2>&1
if errorlevel 1 (
    echo [start-server] 错误: 未找到 node，请先安装 Node.js ^>= 18
    pause
    exit /b 1
)

REM 若未安装依赖则自动 npm install
if not exist "node_modules\ws" (
    echo [start-server] 首次运行，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [start-server] 错误: npm install 失败
        pause
        exit /b 1
    )
    echo.
)

REM 默认端口 3456，可通过环境变量 PORT 覆盖
if not defined PORT set PORT=3456
echo [start-server] 端口: %PORT%
echo [start-server] 启动后请用手机浏览器访问终端里打印的局域网地址
echo [start-server] 按 Ctrl+C 停止服务
echo.

REM 启动 Node 服务器
node server.js

REM 异常退出时暂停，方便看到错误信息
if errorlevel 1 (
    echo.
    echo [start-server] 服务器异常退出，错误码: %ERRORLEVEL%
    pause
)
