#!/usr/bin/env bash
# ============================================================
# Cursor 移动桥接 — 延迟重启（供移动桥接内 Agent 调用）
#
# 场景：Agent 跑在 server.js 进程树里，不能直接杀端口（会自杀）。
# 做法：spawn 独立子 shell，延迟数秒后再执行 restart-server.sh；
#       本脚本立即返回，Agent 可先回复用户再断开。
#
# 用法: ./schedule-restart-server.sh
#       RESTART_DELAY_SEC=3 ./schedule-restart-server.sh
# ============================================================

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RESTART_DELAY_SEC="${RESTART_DELAY_SEC:-2}"
export PORT="${PORT:-3456}"
LOG_FILE="$ROOT/server.log"

echo ""
echo "[schedule-restart] 已安排 ${RESTART_DELAY_SEC} 秒后重启（端口 $PORT）"
echo "[schedule-restart] 当前 Agent 会话可先完成回复，随后请刷新手机浏览器"
echo ""

# ponytail: sleep 秒级延迟够用；子 shell 延迟后 restart，本脚本立即返回
(
  sleep "$RESTART_DELAY_SEC"
  cd "$ROOT"
  exec "$ROOT/restart-server.sh"
) >> "$LOG_FILE" 2>&1 &

echo "[schedule-restart] 后台任务已启动，本脚本退出。"
echo ""
exit 0
