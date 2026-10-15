#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [[ ! -f .env.prod ]]; then
  echo "Missing $APP_DIR/.env.prod"
  echo "Copy .env.prod.example to .env.prod and fill in real values first."
  exit 1
fi

BRANCH="${DEPLOY_BRANCH:-main}"
COMPOSE=(docker compose --env-file .env.prod -f docker-compose.prod.yml)
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
BACKUP_FILE="$BACKUP_DIR/bronzebrawl-$(date -u +%Y%m%dT%H%M%SZ).sql"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-http://127.0.0.1:8080/api/health}"

# Never discard operator changes on a live host. The fast-forward pull is the
# only repository mutation and fails if the checkout is not clean.
git fetch origin "$BRANCH"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing deployment: working tree has local changes."
  exit 1
fi
git pull --ff-only origin "$BRANCH"

mkdir -p "$BACKUP_DIR"
echo "[deploy] Starting PostgreSQL and waiting for it to become healthy"
"${COMPOSE[@]}" up -d --wait postgres

echo "[deploy] Backing up database to $BACKUP_FILE"
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP_FILE"

# The backend image runs the reviewed, locked migration runner before Nest.
echo "[deploy] Rebuilding containers"
"${COMPOSE[@]}" up -d --wait --build --remove-orphans

echo "[deploy] Checking public JSON API health"
node scripts/health.cjs "$PUBLIC_HEALTH_URL"

# A basic frontend probe confirms the SPA remains available without using it as
# an API fallback.
curl -fsS http://127.0.0.1:8080/ >/dev/null

echo "[deploy] Done"
