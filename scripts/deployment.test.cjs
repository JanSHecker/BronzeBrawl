const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('readiness requires HTTP 200, application/json, and status ok; retries are bounded', async (t) => {
  const { checkHealth, waitForHealth } = require('./health.cjs');
  const server = http.createServer((req, res) => {
    if (req.url === '/html') { res.setHeader('content-type', 'text/html'); return res.end('<html>SPA</html>'); }
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.url === '/down') { res.statusCode = 503; return res.end('{"status":"ok","readiness":"ready"}'); }
    if (req.url === '/wrong') return res.end('{"status":"starting","readiness":"not_ready"}');
    if (req.url === '/bad') return res.end('{');
    if (req.url === '/hang') return;
    res.end('{"status":"ok","readiness":"ready"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  await checkHealth(`${url}/ok`);
  for (const route of ['html', 'down', 'wrong', 'bad', 'hang']) {
    await assert.rejects(checkHealth(`${url}/${route}`, { timeoutMs: 50 }));
  }
  await assert.rejects(waitForHealth(`${url}/down`, { attempts: 2, intervalMs: 1, timeoutMs: 50 }), /2 attempts/);
  await assert.rejects(waitForHealth(`${url}/ok`, { attempts: 0 }), /positive integer/);
});

test('runner uses compiled migration runner before main and includes scripts', () => {
  const pkg = JSON.parse(read('Backend/package.json'));
  assert.equal(pkg.scripts['migration:run'], 'node dist/scripts/migrate.js run');
  assert.equal(pkg.scripts['start:prod'], 'npm run migration:run && node dist/src/main.js');
  const docker = read('Backend/Dockerfile.prod');
  assert.match(docker, /COPY --from=builder \/app\/dist \.\/dist/);
  assert.match(docker, /CMD \["npm", "run", "start:prod"\]/);
});

test('production starts only healthy dependencies and probes JSON health', () => {
  const compose = read('docker-compose.prod.yml');
  assert.match(compose, /backend:[\s\S]*condition:\s+service_healthy/);
  assert.match(compose, /healthcheck:[\s\S]*health\.cjs/);
  assert.match(compose, /TYPEORM_SYNCHRONIZE: "false"/);
  assert.match(compose, /TYPEORM_DROP_SCHEMA: "false"/);
});

test('deploy never resets repository; backup precedes migration/start; public API is checked', () => {
  const deploy = read('scripts/deploy.sh');
  assert.doesNotMatch(deploy, /git reset|git checkout|git clean/);
  assert.match(deploy, /git status --porcelain/);
  assert.match(deploy, /DEPLOY_REVISION/);
  assert.match(deploy, /git switch --detach "\$DEPLOY_REVISION"/);
  assert.match(deploy, /pg_dump/);
  assert.ok(deploy.indexOf('up -d --wait postgres') < deploy.indexOf('pg_dump'));
  assert.ok(deploy.indexOf('pg_dump') < deploy.indexOf('up -d --wait --build'));
  assert.match(deploy, /PUBLIC_HEALTH_URL/);
  assert.match(deploy, /health\.cjs/);
});

test('database backups default to a private deploy-user directory outside the checkout', () => {
  const deploy = read('scripts/deploy.sh');
  const docs = read('DEPLOYMENT.md');
  assert.match(deploy, /BACKUP_DIR="\$\{XDG_STATE_HOME:-\$HOME\/\.local\/state\}\/bronzebrawl\/backups"/);
  assert.match(deploy, /mkdir -p "\$BACKUP_DIR"/);
  assert.match(deploy, /chmod 700 "\$BACKUP_DIR"/);
  assert.match(docs, /\$\{XDG_STATE_HOME:-\$HOME\/\.local\/state\}\/bronzebrawl\/backups/);
  assert.match(docs, /outside the checkout/);
  assert.doesNotMatch(deploy, /\/var\/backups\/bronzebrawl/);
});

test('public health probe uses the reviewed image without requiring host Node.js', () => {
  const deploy = read('scripts/deploy.sh');
  assert.doesNotMatch(deploy, /^\s*node scripts\/health\.cjs/m);
  assert.match(deploy, /images -q backend/);
  assert.match(deploy, /docker run --rm --network host --entrypoint node "\$HEALTH_IMAGE" \/app\/scripts\/health\.cjs "\$PUBLIC_HEALTH_URL"/);
});

test('deployment completes with Docker-only tooling and no host Node.js', (t) => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
  if (!fs.existsSync(bash)) return t.skip('Bash is required for deployment-script execution');
  const directory = fs.mkdtempSync(path.join(process.env.OPENCODE_TEST_TMP || os.tmpdir(), 'bronzebrawl-deploy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.writeFileSync(path.join(directory, '.env.prod'), '');
  const script = path.join(directory, 'scripts', 'deploy.sh');
  fs.writeFileSync(script, read('scripts/deploy.sh').replaceAll('\r\n', '\n'));
  const log = path.join(directory, 'docker-calls.txt');
  const bootstrap = `
    git() { return 0; }
    curl() { return 0; }
    node() { echo 'Host Node.js is not installed' >&2; return 127; }
    docker() {
      printf '%s\\n' "$*" >> "$TEST_DOCKER_LOG"
      case "$*" in
        *"images -q backend") echo reviewed-backend-image ;;
        *"exec -T postgres"*) echo '-- synthetic test backup' ;;
      esac
      return 0
    }
    export -f git curl node docker
    bash "$1"
  `;
  const result = spawnSync(bash, ['-c', bootstrap, 'deployment-test', script], {
    encoding: 'utf8',
    env: { ...process.env, TEST_DOCKER_LOG: log, DEPLOY_REVISION: 'reviewed-revision', BACKUP_DIR: path.join(directory, 'backups'), PUBLIC_HEALTH_URL: 'http://127.0.0.1:8080/api/health' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /\[deploy\] Done/);
  assert.match(fs.readFileSync(log, 'utf8'), /run --rm --network host --entrypoint node reviewed-backend-image \/app\/scripts\/health\.cjs http:\/\/127\.0\.0\.1:8080\/api\/health/);
});

test('nginx public api cannot fall through to SPA', () => {
  const nginx = read('deployment/nginx/bronze-brawl.conf');
  assert.match(nginx, /location \^~ \/api\//);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3000\//);
  assert.match(nginx, /location = \/api/);
});

test('both nginx examples allow the same bounded snapshot size as the backend', () => {
  for (const name of ['bronze-brawl.conf', 'bronzebrawl.conf']) {
    const nginx = read(`deployment/nginx/${name}`);
    assert.match(nginx, /location \^~ \/api\/\s*\{[^}]*client_max_body_size 4m;/);
  }
  assert.match(read('Backend/src/http.config.ts'), /JSON_BODY_LIMIT = 4 \* 1024 \* 1024/);
});

test('CI runs real postgres integration and deployment/routing tests before deployment', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /image: postgres:16-alpine/);
  assert.match(ci, /TEST_DATABASE_URL/);
  assert.match(ci, /npm run test:integration/);
  assert.match(ci, /npm run test:unit/);
  assert.match(ci, /npm test/);
  assert.match(ci, /playwright install --with-deps chromium/);
  assert.match(ci, /npm run test:e2e/);
  assert.match(ci, /node --test \.\.\/scripts\/deployment\.test\.cjs/);
  const normalizedCi = ci.replaceAll('\\x62', 'b');
  const servicePassword = normalizedCi.match(/POSTGRES_PASSWORD:\s*([^\s]+)/)?.[1];
  assert.ok(servicePassword, 'CI must define the PostgreSQL service password');
  assert.doesNotMatch(ci, /TEST_DATABASE_URL:[^\n]*\*\*\*/);
  const testUrls = [...normalizedCi.matchAll(/TEST_DATABASE_URL:\s*"?postgres:\/\/[^:]+:([^@"]+)@/g)].map((match) => match[1]);
  assert.deepEqual(testUrls, [servicePassword, servicePassword, servicePassword]);
  const deploy = read('.github/workflows/deploy.yml');
  assert.match(deploy, /workflow_run/);
  assert.match(deploy, /conclusion == 'success'/);
  assert.match(deploy, /workflow_run\.head_sha/);
  assert.match(deploy, /group: bronzebrawl-production/);
  assert.match(deploy, /cancel-in-progress: false/);
  assert.match(deploy, /git status --porcelain/);
  assert.match(deploy, /Skipping superseded CI revision/);
  assert.match(deploy, /git switch --detach/);
  assert.doesNotMatch(deploy, /git reset|checkout[^\n]*--force/);
  assert.ok(deploy.indexOf('git switch --detach') < deploy.indexOf('bash scripts/deploy.sh'), 'run the reviewed deployment script, not a stale server copy');
});

test('production ignores destructive schema overrides and all metadata is discovered in TS and JS', () => {
  process.env.TS_NODE_PROJECT = path.join(root, 'Backend/tsconfig.json');
  require(path.join(root, 'Backend/node_modules/ts-node/register/transpile-only'));
  const { ConfigService } = require(path.join(root, 'Backend/node_modules/@nestjs/config'));
  const { getDataBaseConfig } = require(path.join(root, 'Backend/ormconfig.ts'));
  const config = getDataBaseConfig(new ConfigService({ NODE_ENV: 'production', TYPEORM_SYNCHRONIZE: 'true', TYPEORM_DROP_SCHEMA: 'true' }));
  assert.equal(config.synchronize, false);
  assert.equal(config.dropSchema, false);
  assert.equal(config.migrationsRun, false);
  assert.equal(config.migrationsTableName, 'typeorm_migrations');
  assert.ok(config.entities.some((p) => p.includes('*.entity.')));
  assert.ok(config.migrations.some((p) => p.includes('*.')));
});
