@echo off
REM ============================================================
REM Cursor 移动桥接 — 重启服务器（供 Agent / 脚本调用）
REM
REM 设计要点：
REM   1. 只结束占用 PORT 的 node 进程，不杀当前 cmd（Agent Shell 可存活）
REM   2. 在新窗口启动 server，本脚本立即退出，不阻塞 Shell
REM   3. 纯 cmd + netstat，避免 PowerShell 里 $PID 只读变量踩坑
REM
REM 用法: restart-server.bat
REM       set PORT=3456 && restart-server.bat
REM ============================================================

cd /d "%~dp0"
chcp 65001 >nul 2>&1

if not defined PORT set PORT=3456

echo.
echo [restart-server] 正在重启 Cursor 移动桥接...
echo [restart-server] 工作目录: %CD%
echo [restart-server] 端口: %PORT%
echo.

REM --- 查找并结束占用端口的进程（通常仅为 node server.js）---
set "KILLED=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    if not "%%P"=="0" (
        echo [restart-server] 结束占用端口 %PORT% 的进程 PID=%%P
        taskkill /F /PID %%P >nul 2>&1
        if not errorlevel 1 set "KILLED=1"
    )
)

if "%KILLED%"=="1" (
    echo [restart-server] 旧进程已结束，等待端口释放...
    ping -n 2 127.0.0.1 >nul
) else (
    echo [restart-server] 端口 %PORT% 当前无监听进程，直接启动
)

REM --- 在新窗口启动，与当前 Shell 脱钩 ---
echo [restart-server] 在新窗口启动服务器...
start "CursorMobileWS" /MIN cmd /c "cd /d "%~dp0" && call start-server.bat"

echo [restart-server] 完成。本脚本已退出，Agent Shell 不受影响。
echo [restart-server] 若从手机端触发，请刷新浏览器重连。
echo.
exit /b 0
