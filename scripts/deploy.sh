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

echo "[deploy] Updating repository to origin/${BRANCH}"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[deploy] Rebuilding containers"
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build --remove-orphans

echo "[deploy] Running health checks"
curl -fsS http://127.0.0.1:3000/health >/dev/null
curl -fsS http://127.0.0.1:8080 >/dev/null

echo "[deploy] Done"
