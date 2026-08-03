const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-queue-'));
process.env.GAMEVAULT_DATA_DIR = tempDir;

const { createServer } = require('../server');

let server;
let port;

function requestJson(method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let responseText = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseText += chunk;
      });
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = responseText ? JSON.parse(responseText) : {};
        } catch {
          parsed = { raw: responseText };
        }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('queue routes require authentication', async () => {
  const response = await requestJson('GET', '/api/queue');
  assert.equal(response.statusCode, 401);
});

test('queue persists ordering and supports moves', async () => {
  const registerResponse = await requestJson('POST', '/api/register', {
    email: 'queue@example.com',
    password: 'secret123'
  });
  const token = registerResponse.body.token;

  const first = await requestJson('POST', '/api/queue', { gameId: 'game-a', title: 'A', platform: 'PC' }, { Authorization: `Bearer ${token}` });
  const second = await requestJson('POST', '/api/queue', { gameId: 'game-b', title: 'B', platform: 'PC' }, { Authorization: `Bearer ${token}` });
  const third = await requestJson('POST', '/api/queue', { gameId: 'game-c', title: 'C', platform: 'PC' }, { Authorization: `Bearer ${token}` });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(third.statusCode, 200);

  const moved = await requestJson('POST', '/api/queue/move', { gameId: 'game-a', direction: 'up' }, { Authorization: `Bearer ${token}` });
  assert.equal(moved.statusCode, 200);
  assert.deepEqual(moved.body.items.map((entry) => entry.gameId), ['game-b', 'game-a', 'game-c']);

  const list = await requestJson('GET', '/api/queue', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.items[0].gameId, 'game-b');
});

test('queue actions update library status and remove deleted games', async () => {
  const registerResponse = await requestJson('POST', '/api/register', {
    email: 'queue-actions@example.com',
    password: 'secret123'
  });
  const token = registerResponse.body.token;

  await requestJson('POST', '/api/library', { games: [{ id: 'game-d', title: 'D', platform: 'PC', status: 'Backlog', completionPercent: 10 }] }, { Authorization: `Bearer ${token}` });
  await requestJson('POST', '/api/queue', { gameId: 'game-d', title: 'D', platform: 'PC' }, { Authorization: `Bearer ${token}` });

  const started = await requestJson('POST', '/api/queue/action', { gameId: 'game-d', action: 'start' }, { Authorization: `Bearer ${token}` });
  assert.equal(started.statusCode, 200);

  const libraryResponse = await requestJson('GET', '/api/library', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(libraryResponse.body[0].status, 'Playing');

  const finished = await requestJson('POST', '/api/queue/action', { gameId: 'game-d', action: 'finish' }, { Authorization: `Bearer ${token}` });
  assert.equal(finished.statusCode, 200);

  const deletedLibrary = await requestJson('POST', '/api/library', { games: [] }, { Authorization: `Bearer ${token}` });
  assert.equal(deletedLibrary.statusCode, 200);

  const afterDelete = await requestJson('GET', '/api/queue', undefined, { Authorization: `Bearer ${token}` });
  assert.deepEqual(afterDelete.body.items, []);
});
