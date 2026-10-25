#!/usr/bin/env bash
# 本地开发辅助：启动 / 停止 / 查看状态（不会误杀调用它的 shell）
# 说明：本机同时有一个 systemd 服务 workbench.service 常驻同一端口，
#       脚本检测到端口已被占用时会直接复用，不会重复启动。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"
PORT="${WB_PORT:-18080}"
HOST="${WB_HOST:-127.0.0.1}"
PID_FILE="/tmp/wb_api_${PORT}.pid"
LOG_FILE="/tmp/wb_api_${PORT}.log"
HEALTH="http://127.0.0.1:${PORT}/api/v1/health"

alive() { curl -fsS "$HEALTH" >/dev/null 2>&1; }

start() {
  if alive; then
    echo "端口 ${PORT} 已有服务在运行 → http://127.0.0.1:${PORT}"
    echo "（若由 systemd 托管：systemctl status workbench）"
    return 0
  fi
  cd "$SERVER_DIR"
  setsid .venv/bin/uvicorn app.main:app --host "$HOST" --port "$PORT" \
    >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  for _ in $(seq 1 40); do
    if alive; then
      echo "已启动 http://127.0.0.1:${PORT}（日志 $LOG_FILE）"
      return 0
    fi
    sleep 0.3
  done
  echo "启动失败，查看 $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2 || true
  return 1
}

stop() {
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE")"
    if [[ -r "/proc/$PID/cmdline" ]] && tr '\0' ' ' <"/proc/$PID/cmdline" | grep -q "uvicorn app.main:app"; then
      kill "$PID" 2>/dev/null || true
      echo "已停止 pid=$PID"
    else
      echo "记录中的进程已不是本服务，跳过"
    fi
    rm -f "$PID_FILE"
    return 0
  fi
  echo "没有脚本启动的进程"
  if alive; then
    echo "但端口 ${PORT} 仍在服务：可能由 systemd 托管，用 sudo systemctl stop workbench 停止"
  fi
}

reset() {
  stop || true
  rm -rf "$SERVER_DIR/data"
  echo "已清空开发数据库与附件目录"
}

status() {
  if alive; then
    echo "运行中 → http://127.0.0.1:${PORT}（守护：$(systemctl is-active workbench 2>/dev/null || echo 未知)）"
  else
    echo "未在 ${PORT} 端口运行；执行 $0 start 或 sudo systemctl start workbench"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop || true; start ;;
  reset) reset; start ;;
  status) status ;;
  *) echo "用法: $0 {start|stop|restart|reset|status}" >&2; exit 1 ;;
esac
