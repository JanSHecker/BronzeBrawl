// Developer-only browser regression. All game/replay responses below are fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('../../Frontend/node_modules/@playwright/test');

test('companion exposes two tasks, one replay click and automatic forwarding after setup', async (t) => {
  const state = { gamePaired: false, feed: { enabled: false, error: null, lastSuccess: null }, jobs: [] };
  const writes = [];
  const files = { '/': ['index.html', 'text/html'], '/ui.js': ['ui.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  const server = http.createServer(async (req, res) => {
    if (files[req.url]) {
      res.setHeader('Content-Type', files[req.url][1]);
      res.end(fs.readFileSync(path.join(__dirname, '..', files[req.url][0]))); return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/bootstrap') { res.end(JSON.stringify({ token: 'fixture-local-csrf', settings: { backendUrl: 'https://bronze-brawl.de/api' } })); return; }
    if (req.url === '/api/status') { res.end(JSON.stringify(state)); return; }
    if (req.method !== 'POST') { res.statusCode = 404; res.end('{}'); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    writes.push({ route: req.url, body, token: req.headers['x-companion-token'] });
    if (req.url === '/api/jobs/fetch-replays') {
      state.jobs = [{ id: 'fixture-replay', state: 'running' }];
      res.end(JSON.stringify({ jobId: 'fixture-replay' })); return;
    }
    if (req.url === '/api/config') {
      state.gamePaired = true; state.feed = { enabled: true, error: null, lastSuccess: 1 };
      res.end('{"ok":true}'); return;
    }
    res.statusCode = 404; res.end('{"error":"Unexpected fixture endpoint"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Replays holen', exact: true })).toBeEnabled();
  assert.equal(await page.locator('#settings').evaluate(element => element.open), false);
  await expect(page.getByText(/Pool-Token|Reservieren|Direkt-Feed starten|Cache-Verwaltung/)).toHaveCount(0);
  assert.equal(writes.length, 0, 'opening the UI must not fetch replays or start a separate feed');

  await page.getByRole('button', { name: 'Replays holen', exact: true }).click();
  await expect(page.locator('#fetchReplays')).toBeDisabled();
  await page.locator('#fetchReplays').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await expect.poll(() => writes.length).toBe(1);
  assert.equal(writes[0].route, '/api/jobs/fetch-replays');
  assert.equal(writes[0].token, 'fixture-local-csrf');
  state.jobs[0] = { id: 'fixture-replay', state: 'done', result: { message: '1 Replay bereit.', items: [{ filename: 'EUW1-123.rofl' }] } };
  await expect(page.getByText('EUW1-123.rofl', { exact: true })).toBeVisible();
  await expect(page.locator('#fetchReplays')).toBeEnabled();

  await page.locator('summary').click();
  await page.getByLabel('Spiel-ID', { exact: true }).fill('17');
  await page.getByLabel('Spiel-Schlüssel', { exact: true }).fill('fixture-host-capability');
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('#configStatus')).toContainText('Verbunden.');
  await expect(page.locator('#feedStatus')).toHaveText('Live-Daten werden weitergeleitet.');
  await expect(page.getByLabel('Spiel-Schlüssel', { exact: true })).toHaveValue('');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].route, '/api/config');
  assert.equal(writes[1].body.gameId, 17);
  assert.equal(writes[1].body.hostToken, 'fixture-host-capability');
  assert.equal(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes('fixture-host-capability')), false);
});
