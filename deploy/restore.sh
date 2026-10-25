#!/usr/bin/env bash
# Restore only after validating this backup in an isolated environment.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BACKUP="${1:?Usage: deploy/restore.sh /absolute/path/to/workbench-backup}"
test -s "$BACKUP/database.dump"
test -f "$BACKUP/storage.tar.gz"
DB_NAME="$(docker compose exec -T db printenv POSTGRES_DB)"
printf 'This replaces database %s and its uploaded files. Type the database name: ' "$DB_NAME"
read -r answer
test "$answer" = "$DB_NAME" || { printf 'Aborted.\n'; exit 1; }
API_ID="$(docker compose ps -aq api)"
VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/storage"}}{{.Name}}{{end}}{{end}}' "$API_ID")"
test -n "$VOLUME"
docker compose stop api
docker compose exec -T db sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
docker compose exec -T db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists --exit-on-error --single-transaction' < "$BACKUP/database.dump"
docker compose run --rm -T --no-deps --entrypoint sh -v "$VOLUME:/data" web -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xzf - -C /data' < "$BACKUP/storage.tar.gz"
docker compose start api
printf 'Restored. Keep the original WB_ENCRYPTION_KEY, then verify health and login.\n'
