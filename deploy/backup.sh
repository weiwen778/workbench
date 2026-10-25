#!/usr/bin/env bash
# 备份数据库、上传文件与部署配置（含翻译加密主密钥的提示）
# 用法：deploy/backup.sh [/path/to/backup-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${1:-$ROOT/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/workbench-$STAMP"

mkdir -p "$TARGET"

if ! command -v docker >/dev/null 2>&1; then
  echo "找不到 docker，请在部署服务器上执行本脚本" >&2
  exit 1
fi

echo "→ 导出数据库"
docker compose -f "$ROOT/docker-compose.yml" exec -T db \
  pg_dump -U "${WB_DB_USER:-workbench}" -d "${WB_DB_NAME:-workbench}" \
  | gzip >"$TARGET/database.sql.gz"

echo "→ 备份上传文件"
docker run --rm \
  -v workbench_wb_storage:/data:ro \
  -v "$TARGET":/backup \
  alpine sh -c "cd /data && tar czf /backup/storage.tar.gz ."

echo "→ 复制部署配置"
cp -f "$ROOT/.env" "$TARGET/env.backup" 2>/dev/null || echo "（未找到 .env，请手工确认配置已保存）"

cat >"$TARGET/README.txt" <<'EOF'
恢复步骤：
1. 先停服务：docker compose down
2. 恢复数据库：gunzip -c database.sql.gz | docker compose exec -T db psql -U <用户> -d <库名>
3. 恢复文件：把 storage.tar.gz 解回 wb_storage 卷
4. 确认 .env 中的 WB_ENCRYPTION_KEY 与备份时一致，否则旧翻译凭据无法解密
5. 启动并检查 /api/v1/health，再登录验证关键业务
EOF

echo "✅ 备份完成：$TARGET"
du -sh "$TARGET"
