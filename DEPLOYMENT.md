# BronzeBrawl deployment pipeline

This repository now includes a production-oriented deployment setup for a Hetzner server.

## What is included

- `docker-compose.prod.yml`
  - Production stack with:
    - frontend on `127.0.0.1:8080`
    - backend on `127.0.0.1:3000`
    - postgres as an internal container
- `Frontend/Dockerfile.prod`
  - Builds the Vite app and serves it with nginx
- `Backend/Dockerfile.prod`
  - Builds the NestJS app and runs the compiled output
- `scripts/deploy.sh`
  - Fast-forward updates only, backs up PostgreSQL, rebuilds, migrates, and checks public JSON health
- `.github/workflows/ci.yml`
  - Runs the frontend build plus backend migration, PostgreSQL integration, unit tests, and build
- `.github/workflows/deploy.yml`
  - Deploys only after the `main` CI workflow succeeds, pinned to that workflow run's commit
- `deployment/nginx/bronzebrawl.conf`
  - Example host-nginx reverse proxy config; `/api` is isolated from the SPA fallback

## Important code changes

- Frontend API calls now default to `/api`
- The frontend build now outputs to `Frontend/dist`
- Backend now reads `PORT`, `POSTGRES_HOST`, and `POSTGRES_PORT` from env
- Production always uses `synchronize: false` and `dropSchema: false`
- `npm run start:prod` runs the versioned migration runner before Nest starts
- `GET /health` returns JSON `status`/`readiness` and returns HTTP 503 until PostgreSQL and every application table exist

## Server setup

### 1. Clone the repo on the server

Example target:

```bash
sudo mkdir -p /opt/bronzebrawl
sudo chown -R "$USER":"$USER" /opt/bronzebrawl
git clone https://github.com/JanSHecker/BronzeBrawl.git /opt/bronzebrawl
cd /opt/bronzebrawl
```

### 2. Create production env file

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Set real values for:
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- optionally `VITE_API_BASE_URL` (default `/api` is correct when using nginx reverse proxy)

The deploy script stores database backups outside the checkout, in the SSH
deploy user's state directory: `${XDG_STATE_HOME:-$HOME/.local/state}/bronzebrawl/backups`.
The directory is created with restrictive permissions (`700`), so no
root-owned `/var/backups` setup is required. Set `BACKUP_DIR` explicitly when
using a separately provisioned backup volume; it must be writable by the SSH
deploy user.

### 3. Install Docker if needed

Your deploy script assumes Docker and the Compose plugin already exist.

### 4. First app boot

```bash
chmod +x scripts/deploy.sh
DEPLOY_REVISION="$(git rev-parse HEAD)" ./scripts/deploy.sh
```

This should expose:
- frontend at `127.0.0.1:8080`
- backend at `127.0.0.1:3000`

### 5. Configure host nginx

Use `deployment/nginx/bronze-brawl.conf` (or the compatibility-named `bronzebrawl.conf`) as the base config.

Expected routing:
- `/` -> `http://127.0.0.1:8080`
- `/api/` -> `http://127.0.0.1:3000/`
- `/api` -> redirects to `/api/`; API responses never use the SPA `index.html` fallback

After copying the config into `/etc/nginx/sites-available/`, enable it and reload nginx.

### 6. HTTPS

After nginx is serving the domain correctly, issue or renew the Let’s Encrypt certificate as usual.

## GitHub Actions secrets

Add these repository secrets in GitHub:

- `HETZNER_HOST`
- `HETZNER_USER`
- `HETZNER_SSH_KEY`
- `HETZNER_DEPLOY_PATH`

Recommended value for `HETZNER_DEPLOY_PATH`:

```text
/opt/bronzebrawl
```

## Deployment flow

1. Push branch / open PR
2. `CI` workflow runs the frontend build, backend tests, and migrations against PostgreSQL
3. Merge or push to `main`
4. Successful `CI` completion triggers `Deploy to Hetzner` for the exact tested commit
5. The server backs up PostgreSQL and runs `scripts/deploy.sh`
6. Containers run the locked migration runner before the backend starts
7. Public JSON health and frontend checks confirm the deployment

## Notes / caveats

- The repo still contains the older dev-oriented `docker-compose.yml`; keep using that for local dev if you want.
- The `/lolApi` page still depends on a local LoL proxy on the machine running the game client. That piece is separate from the Hetzner deployment.
- Never enable TypeORM `synchronize` or `dropSchema` in production; schema changes belong in reviewed, versioned migrations.
