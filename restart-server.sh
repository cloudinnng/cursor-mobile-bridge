#!/usr/bin/env bash
# ============================================================
# Cursor 移动桥接 — 重启服务器（供 Agent / 脚本调用）
#
# 设计要点：
#   1. 只结束占用 PORT 的 node 进程，不杀当前 Shell（Agent Shell 可存活）
#   2. 后台启动 server，本脚本立即退出，不阻塞 Shell
#   3. 使用 lsof 查端口，Mac / Linux 通用
#
# 用法: ./restart-server.sh
#       PORT=3456 ./restart-server.sh
# ============================================================

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

export PORT="${PORT:-3456}"
LOG_FILE="$ROOT/server.log"

echo ""
echo "[restart-server] 正在重启 Cursor 移动桥接..."
echo "[restart-server] 工作目录: $ROOT"
echo "[restart-server] 端口: $PORT"
echo ""

# --- 查找并结束占用端口的进程（通常仅为 node server.js）---
KILLED=0
# ponytail: lsof 只查 LISTEN；无进程时 lsof 非 0 属正常，|| true 忽略
PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    echo "[restart-server] 结束占用端口 $PORT 的进程 PID=$pid"
    if kill -9 "$pid" 2>/dev/null; then
      KILLED=1
    fi
  done <<< "$PIDS"
fi

if [ "$KILLED" = "1" ]; then
  echo "[restart-server] 旧进程已结束，等待端口释放..."
  sleep 1
else
  echo "[restart-server] 端口 $PORT 当前无监听进程，直接启动"
fi

# --- 后台启动，与当前 Shell 脱钩 ---
echo "[restart-server] 后台启动服务器（日志: $LOG_FILE）..."
# ponytail: nohup 脱钩；实时日志用 tail -f server.log
nohup "$ROOT/start-server.sh" >> "$LOG_FILE" 2>&1 &
disown 2>/dev/null || true

echo "[restart-server] 完成。本脚本已退出，Agent Shell 不受影响。"
echo "[restart-server] 若从手机端触发，请刷新浏览器重连。"
echo ""
exit 0
