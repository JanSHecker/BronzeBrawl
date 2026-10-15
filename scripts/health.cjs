const http = require('node:http');
const https = require('node:https');

function checkHealth(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('health URL is invalid'));
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
    if (!transport) {
      reject(new Error('health URL must use http or https'));
      return;
    }

    const request = transport.get(parsed, { headers: { accept: 'application/json' } }, (response) => {
      const chunks = [];
      let size = 0;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 1024 * 1024) chunks.push(chunk);
      });
      response.on('end', () => {
        const body = chunks.join('');
        const contentType = String(response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (response.statusCode !== 200) {
          reject(new Error(`health returned HTTP ${response.statusCode}`));
          return;
        }
        if (contentType !== 'application/json') {
          reject(new Error(`health returned ${contentType || 'no'} JSON content type`));
          return;
        }
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          reject(new Error('health returned invalid JSON'));
          return;
        }
        if (payload?.status !== 'ok' || payload?.readiness !== 'ready') {
          reject(new Error('health is not ready'));
          return;
        }
        resolve(payload);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`health timed out after ${timeoutMs}ms`)));
    request.on('error', (error) => reject(error));
  });
}

async function waitForHealth(url, options = {}) {
  const attempts = options.attempts ?? 30;
  const intervalMs = options.intervalMs ?? 1000;
  if (!Number.isInteger(attempts) || attempts <= 0) throw new Error('attempts must be a positive integer');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await checkHealth(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(`${attempts} attempts exhausted: ${lastError?.message || 'health unavailable'}`);
}

async function main(url = process.argv[2]) {
  if (!url) throw new Error('usage: node health.cjs <url>');
  await waitForHealth(url);
  console.log('health ready');
}

module.exports = { checkHealth, waitForHealth, main };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
