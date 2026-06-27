@echo off
REM ============================================================
REM Cursor 移动桥接 — 延迟重启（供移动桥接内 Agent 调用）
REM
REM 场景：Agent 跑在 server.js 进程树里，不能直接杀端口（会自杀）。
REM 做法：spawn 独立 cmd，延迟数秒后再执行 restart-server.bat；
REM       本脚本立即返回，Agent 可先回复用户再断开。
REM
REM 用法: schedule-restart-server.bat
REM       set RESTART_DELAY_SEC=3 && schedule-restart-server.bat
REM ============================================================

cd /d "%~dp0"
chcp 65001 >nul 2>&1

if not defined RESTART_DELAY_SEC set RESTART_DELAY_SEC=2
if not defined PORT set PORT=3456

echo.
echo [schedule-restart] 已安排 %RESTART_DELAY_SEC% 秒后重启（端口 %PORT%）
echo [schedule-restart] 当前 Agent 会话可先完成回复，随后请刷新手机浏览器
echo.

REM ponytail: 用 ping 做秒级延迟，精度约 1s，够用；要更准可换 timeout /t
start "" /MIN cmd /c "ping -n %RESTART_DELAY_SEC% 127.0.0.1 >nul && cd /d "%~dp0" && call restart-server.bat"

echo [schedule-restart] 后台任务已启动，本脚本退出。
echo.
exit /b 0
