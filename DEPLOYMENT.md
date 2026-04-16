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
  - Pulls the latest `main`, rebuilds, restarts, and health-checks the app
- `.github/workflows/ci.yml`
  - Runs frontend build plus backend test/build on pushes and PRs
- `.github/workflows/deploy.yml`
  - Deploys automatically to Hetzner on every push to `main`
- `deployment/nginx/bronzebrawl.conf`
  - Example host-nginx reverse proxy config

## Important code changes

- Frontend API calls now default to `/api`
- The frontend build now outputs to `Frontend/dist`
- Backend now reads `PORT`, `POSTGRES_HOST`, `POSTGRES_PORT`, and TypeORM flags from env
- `dropSchema` is no longer implicitly enabled in production
- Added `GET /health` for deploy health checks

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

### 3. Install Docker if needed

Your deploy script assumes Docker and the Compose plugin already exist.

### 4. First app boot

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

This should expose:
- frontend at `127.0.0.1:8080`
- backend at `127.0.0.1:3000`

### 5. Configure host nginx

Use `deployment/nginx/bronzebrawl.conf` as the base config.

Expected routing:
- `/` -> `http://127.0.0.1:8080`
- `/api/` -> `http://127.0.0.1:3000/`

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
2. `CI` workflow runs builds and backend tests
3. Merge or push to `main`
4. `Deploy to Hetzner` workflow SSHes into the server
5. The server runs `scripts/deploy.sh`
6. Containers rebuild and restart
7. Health checks confirm the deployment

## Notes / caveats

- The repo still contains the older dev-oriented `docker-compose.yml`; keep using that for local dev if you want.
- The `/lolApi` page still depends on a local LoL proxy on the machine running the game client. That piece is separate from the Hetzner deployment.
- For long-term production safety, consider moving from `synchronize` to proper TypeORM migrations later.
