import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function withServer(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psora-account-'));
  process.env.GAMEVAULT_PERSISTENCE = 'JSON';
  process.env.GAMEVAULT_DATA_DIR = dataDir;
  process.env.GAMEVAULT_DISABLE_RATE_LIMIT = '1';
  delete require.cache[require.resolve('../storage.js')];
  delete require.cache[require.resolve('../server.js')];
  const { createServer } = require('../server.js');
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`, dataDir); }
  finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(dataDir, { recursive: true, force: true }); }
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json();
  return { response, body };
}

test('unique usernames, availability, export and deletion work', async () => {
  await withServer(async (base) => {
    let result = await json(`${base}/api/usernames/availability?username=Brady_Games`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.available, true);

    result = await json(`${base}/api/register`, { method: 'POST', body: JSON.stringify({ email: 'one@example.com', password: 'password123', username: 'Brady_Games' }) });
    assert.equal(result.response.status, 201);
    const token = result.body.token;
    assert.ok(token);

    result = await json(`${base}/api/usernames/availability?username=brady_games`);
    assert.equal(result.body.available, false);

    result = await json(`${base}/api/register`, { method: 'POST', body: JSON.stringify({ email: 'two@example.com', password: 'password123', username: 'BRADY_GAMES' }) });
    assert.equal(result.response.status, 409);

    result = await json(`${base}/api/account/export`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.account.email, 'one@example.com');
    assert.ok(result.body.data);

    result = await json(`${base}/api/account`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ confirmation: 'DELETE' }) });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.deleted, true);
  });
});

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
assert.match(serverSource, /allowedHosts/);
assert.match(serverSource, /Username is already taken/);
