#!/usr/bin/env bash
# 个人工作台 · WSL 部署与启停脚本
# 用法： scripts/wb.sh install | start | stop | restart | status | logs | reset
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"
WEB_DIR="$ROOT/web"
HOST="${WB_HOST:-127.0.0.1}"
PORT="${WB_PORT:-18080}"
PID_FILE="/tmp/wb_api_${PORT}.pid"
LOG_FILE="$SERVER_DIR/data/api.log"
HEALTH="http://${HOST}:${PORT}/api/v1/health"
PIP_MIRROR="https://pypi.tuna.tsinghua.edu.cn/simple"
NPM_REGISTRY="https://registry.npmmirror.com"

# venv 识别：优先项目内 server/.venv，其次复用 ~/.venvs/workbench
pick_venv() {
  if [[ -x "$SERVER_DIR/.venv/bin/python" ]]; then echo "$SERVER_DIR/.venv"
  elif [[ -x "$HOME/.venvs/workbench/bin/python" ]]; then echo "$HOME/.venvs/workbench"
  else echo ""; fi
}

alive() { curl -fsS --max-time 2 "$HEALTH" >/dev/null 2>&1; }

do_install() {
  mkdir -p "$SERVER_DIR/data/storage"
  local venv; venv="$(pick_venv)"
  if [[ -z "$venv" ]]; then
    echo "[1/3] 创建虚拟环境 server/.venv ..."
    python3 -m venv "$SERVER_DIR/.venv" || { echo "创建 venv 失败"; return 1; }
    venv="$SERVER_DIR/.venv"
  else
    echo "[1/3] 使用已有虚拟环境：$venv"
  fi
  echo "[2/3] 安装后端依赖 ..."
  "$venv/bin/python" -m pip install -q --upgrade pip -i "$PIP_MIRROR" >/dev/null 2>&1 || true
  "$venv/bin/python" -m pip install -q -r "$SERVER_DIR/requirements.txt" -i "$PIP_MIRROR" || {
    echo "后端依赖安装失败"; return 1; }
  echo "      后端依赖就绪"

  echo "[3/3] 安装前端依赖并构建 ..."
  cd "$WEB_DIR" || return 1
  if [[ ! -d node_modules ]]; then
    npm install --registry "$NPM_REGISTRY" || { echo "npm install 失败"; return 1; }
  fi
  npm run build || { echo "前端构建失败"; return 1; }
  echo "      前端产物：$WEB_DIR/dist"
  [[ -f "$SERVER_DIR/.env" ]] || cp "$SERVER_DIR/.env.example" "$SERVER_DIR/.env"
  echo "完成。用 scripts/wb.sh start 启动。"
}

do_start() {
  if alive; then
    echo "已在运行： http://${HOST}:${PORT}"
    return 0
  fi
  local venv; venv="$(pick_venv)"
  if [[ -z "$venv" ]]; then echo "未找到虚拟环境，请先执行：scripts/wb.sh install"; return 1; fi
  if [[ ! -d "$WEB_DIR/dist" ]]; then echo "缺少前端产物 web/dist，请先执行：scripts/wb.sh install"; return 1; fi
  mkdir -p "$SERVER_DIR/data/storage"
  cd "$SERVER_DIR" || return 1
  setsid "$venv/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT" \
    >"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  for _ in $(seq 1 60); do
    if alive; then
      echo "已启动： http://${HOST}:${PORT}"
      echo "日志：   $LOG_FILE"
      return 0
    fi
    sleep 0.5
  done
  echo "启动失败，最后 25 行日志："
  tail -25 "$LOG_FILE" 2>/dev/null
  return 1
}

do_stop() {
  local stopped=0
  if [[ -f "$PID_FILE" ]]; then
    local pid; pid="$(cat "$PID_FILE")"
    if [[ -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' <"/proc/$pid/cmdline" | grep -q "uvicorn"; then
      kill "$pid" 2>/dev/null && stopped=1
    fi
    rm -f "$PID_FILE"
  fi
  # 兜底：按端口清理
  if alive; then
    pkill -f "uvicorn app.main:app --host ${HOST} --port ${PORT}" 2>/dev/null && stopped=1
  fi
  [[ $stopped -eq 1 ]] && echo "已停止" || echo "没有在运行"
}

do_status() {
  echo "项目目录： $ROOT"
  echo "虚拟环境： $(pick_venv || true)"
  echo "前端产物： $([[ -d "$WEB_DIR/dist" ]] && echo 存在 || echo 缺失)"
  if alive; then
    echo "服务状态： 运行中  http://${HOST}:${PORT}"
    curl -fsS --max-time 3 "$HEALTH" 2>/dev/null; echo
  else
    echo "服务状态： 未运行"
  fi
}

do_reset() {
  do_stop
  rm -f "$SERVER_DIR/data/workbench.db"
  rm -rf "$SERVER_DIR/data/storage"/*
  echo "开发库与附件已清空"
  do_start
}

case "${1:-start}" in
  install) do_install ;;
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  status)  do_status ;;
  logs)    tail -n 100 -f "$LOG_FILE" ;;
  reset)   do_reset ;;
  *) echo "用法：$0 {install|start|stop|restart|status|logs|reset}"; exit 1 ;;
esac
