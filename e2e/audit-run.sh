#!/usr/bin/env bash
# 巡检启动器：从 server/.env 取管理员密码，避免在命令行/聊天里明文出现
set -euo pipefail
cd "$(dirname "$0")"
export WB_BASE="${WB_BASE:-http://127.0.0.1:18080}"
export WB_E2E_PASSWORD="$(sed -n 's/^WB_ADMIN_PASSWORD=//p' ../server/.env | head -1)"
if [[ -z "${WB_E2E_PASSWORD}" ]]; then echo "server/.env 缺少 WB_ADMIN_PASSWORD" >&2; exit 1; fi
exec node "$@"
