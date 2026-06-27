#!/usr/bin/env bash
# ============================================================
# Cursor 移动桥接 — 启动服务器
# 用法: ./start-server.sh  或  bash start-server.sh
# macOS / Linux 前台启动，Ctrl+C 停止
# ============================================================

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

export PORT="${PORT:-3456}"

echo ""
echo "[start-server] Cursor 移动桥接 — 正在启动..."
echo "[start-server] 工作目录: $ROOT"
echo ""

# 检查 Node.js 是否可用
if ! command -v node >/dev/null 2>&1; then
  echo "[start-server] 错误: 未找到 node，请先安装 Node.js >= 18"
  exit 1
fi

# 若未安装依赖则自动 npm install
if [ ! -d "node_modules/ws" ]; then
  echo "[start-server] 首次运行，正在安装依赖..."
  if ! npm install; then
    echo "[start-server] 错误: npm install 失败"
    exit 1
  fi
  echo ""
fi

echo "[start-server] 端口: $PORT"
echo "[start-server] 启动后请用手机浏览器访问终端里打印的局域网地址"
echo "[start-server] 按 Ctrl+C 停止服务"
echo ""

# 启动 Node 服务器（前台阻塞，供人工启动）
node server.js
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  echo ""
  echo "[start-server] 服务器异常退出，错误码: $EXIT_CODE"
fi

exit "$EXIT_CODE"
