const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
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
  assert.match(deploy, /pg_dump/);
  assert.ok(deploy.indexOf('up -d --wait postgres') < deploy.indexOf('pg_dump'));
  assert.ok(deploy.indexOf('pg_dump') < deploy.indexOf('up -d --wait --build'));
  assert.match(deploy, /PUBLIC_HEALTH_URL/);
  assert.match(deploy, /health\.cjs/);
});

test('nginx public api cannot fall through to SPA', () => {
  const nginx = read('deployment/nginx/bronze-brawl.conf');
  assert.match(nginx, /location \^~ \/api\//);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3000\//);
  assert.match(nginx, /location = \/api/);
});

test('CI runs real postgres integration and deployment/routing tests before deployment', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /image: postgres:16-alpine/);
  assert.match(ci, /TEST_DATABASE_URL/);
  assert.match(ci, /npm run test:integration/);
  assert.match(ci, /npm run test:unit/);
  assert.match(ci, /node --test \.\.\/scripts\/deployment\.test\.cjs/);
  const deploy = read('.github/workflows/deploy.yml');
  assert.match(deploy, /workflow_run/);
  assert.match(deploy, /conclusion == 'success'/);
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
