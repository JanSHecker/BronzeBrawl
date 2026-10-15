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
DEPLOY_REVISION="${DEPLOY_REVISION:-}"
COMPOSE=(docker compose --env-file .env.prod -f docker-compose.prod.yml)
if [[ -z "${BACKUP_DIR:-}" ]]; then
  : "${HOME:?HOME must be set when BACKUP_DIR is not provided}"
  BACKUP_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/bronzebrawl/backups"
fi
BACKUP_FILE="$BACKUP_DIR/bronzebrawl-$(date -u +%Y%m%dT%H%M%SZ).sql"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-http://127.0.0.1:8080/api/health}"

if [[ -z "$DEPLOY_REVISION" ]]; then
  echo "Refusing deployment: DEPLOY_REVISION must be the successful CI workflow_run head SHA."
  exit 1
fi

# Never discard operator changes on a live host. Only switch a clean checkout
# to an explicitly verified CI revision.
git fetch origin "$BRANCH"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing deployment: working tree has local changes."
  exit 1
fi
if ! git cat-file -e "$DEPLOY_REVISION^{commit}" 2>/dev/null; then
  echo "Refusing deployment: CI revision $DEPLOY_REVISION is not available locally."
  exit 1
fi
if ! git merge-base --is-ancestor "$DEPLOY_REVISION" "origin/$BRANCH"; then
  echo "Refusing deployment: CI revision $DEPLOY_REVISION is not on origin/$BRANCH."
  exit 1
fi
git switch --detach "$DEPLOY_REVISION"

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
echo "[deploy] Starting PostgreSQL and waiting for it to become healthy"
"${COMPOSE[@]}" up -d --wait postgres

echo "[deploy] Backing up database to $BACKUP_FILE"
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP_FILE"

# The backend image runs the reviewed, locked migration runner before Nest.
echo "[deploy] Rebuilding containers"
"${COMPOSE[@]}" up -d --wait --build --remove-orphans

echo "[deploy] Checking public JSON API health"
# Production needs Docker, not a second Node.js installation on the host.
# Host networking keeps 127.0.0.1 pointed at the public nginx port, while the
# probe itself comes from the same reviewed image that is running the backend.
HEALTH_IMAGE="$("${COMPOSE[@]}" images -q backend)"
if [[ -z "$HEALTH_IMAGE" ]]; then
  echo "Refusing deployment: backend health probe image is unavailable."
  exit 1
fi
docker run --rm --network host --entrypoint node "$HEALTH_IMAGE" /app/scripts/health.cjs "$PUBLIC_HEALTH_URL"

# A basic frontend probe confirms the SPA remains available without using it as
# an API fallback.
curl -fsS http://127.0.0.1:8080/ >/dev/null

echo "[deploy] Done"
