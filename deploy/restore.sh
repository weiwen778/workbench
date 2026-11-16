#!/usr/bin/env bash
# Restore only after validating this backup in an isolated environment.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BACKUP="${1:?Usage: deploy/restore.sh /absolute/path/to/workbench-backup}"
test -s "$BACKUP/database.dump"
test -f "$BACKUP/storage.tar.gz"
DB_NAME="$(docker compose exec -T db printenv POSTGRES_DB </dev/null)"
printf 'This replaces database %s and its uploaded files. Type the database name: ' "$DB_NAME"
read -r answer
test "$answer" = "$DB_NAME" || { printf 'Aborted.\n'; exit 1; }

# Inspect the archive before touching the live database. BusyBox tar runs as
# root inside the web container, so path traversal or link entries are fatal.
LIST="$(mktemp)"
TYPE_LIST="$(mktemp)"
trap 'status=$?; rm -f "$LIST" "$TYPE_LIST"; if test "$status" -ne 0; then printf "恢复失败，正在尝试重新启动 api。预恢复备份在 %s\n" "${SAFETY:-未创建}" >&2; docker compose start api >/dev/null 2>&1 || true; fi' EXIT
tar -tzf "$BACKUP/storage.tar.gz" > "$LIST"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$LIST"; then
  printf '拒绝恢复：storage.tar.gz 包含绝对路径或 .. 路径。\n' >&2
  exit 1
fi
tar -tvzf "$BACKUP/storage.tar.gz" > "$TYPE_LIST"
if awk 'BEGIN{bad=0} {t=substr($0,1,1); if(t!="-" && t!="d") bad=1} END{exit bad?0:1}' "$TYPE_LIST"; then
  printf '拒绝恢复：storage.tar.gz 包含符号链接、硬链接或设备文件。\n' >&2
  exit 1
fi

API_ID="$(docker compose ps -aq api)"
VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/storage"}}{{.Name}}{{end}}{{end}}' "$API_ID")"
test -n "$VOLUME"

# Keep a consistent copy of the current state before dropping the schema.
SAFETY="$BACKUP/pre-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SAFETY"
printf 'Creating safety backup in %s ...\n' "$SAFETY"
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$SAFETY/database.dump"
docker compose run --rm -T --no-deps --entrypoint tar -v "$VOLUME:/data:ro" web czf - -C /data . > "$SAFETY/storage.tar.gz"

docker compose stop api
docker compose exec -T db sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
docker compose exec -T db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists --exit-on-error --single-transaction' < "$BACKUP/database.dump"
docker compose run --rm -T --no-deps --entrypoint sh -v "$VOLUME:/data" web -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xzf - -C /data' < "$BACKUP/storage.tar.gz"
docker compose start api
printf 'Restored. Keep the original WB_ENCRYPTION_KEY, then verify health and login.\n'
