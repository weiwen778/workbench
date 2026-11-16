#!/usr/bin/env bash
# Consistent database/files/config backup, using the existing application image.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BASE="${1:-$ROOT/backups}"
mkdir -p "$BASE"
BASE="$(cd "$BASE" && pwd)"
TARGET="$BASE/workbench-$(date +%Y%m%d-%H%M%S)"
test ! -e "$TARGET"
mkdir "$TARGET"
test -f .env
API_ID="$(docker compose ps -aq api)"
test -n "$API_ID"
VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/storage"}}{{.Name}}{{end}}{{end}}' "$API_ID")"
test -n "$VOLUME"
RUNNING="$(docker inspect --format '{{.State.Running}}' "$API_ID")"
if test "$RUNNING" = true; then
  docker compose stop api
  trap 'docker compose start api >/dev/null 2>&1' EXIT
fi
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TARGET/database.dump"
docker compose run --rm -T --no-deps --entrypoint tar -v "$VOLUME:/data:ro" web czf - -C /data . > "$TARGET/storage.tar.gz"
# Never put .env (DB password, admin password, Fernet master key) next to the
# database dump. Keep those in a password manager / separate secret store.
grep -E '^(WB_(DB_PASSWORD|ADMIN_PASSWORD|ENCRYPTION_KEY|COOKIE_SECURE|PUBLIC_BASE_URL))=' .env \
  | sed 's/=.*/=<keep separately>/' > "$TARGET/env.keys" || true
printf 'Restore with: bash deploy/restore.sh "%s"\nThis directory does NOT contain .env secrets. Restore WB_DB_PASSWORD, WB_ADMIN_PASSWORD and WB_ENCRYPTION_KEY from your password manager before starting the API. Never publish this directory.\n' "$TARGET" > "$TARGET/README.txt"
printf 'Backup complete: %s\n' "$TARGET"
