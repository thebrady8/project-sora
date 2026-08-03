const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-activity-'));
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

test('creates private activity history and avoids duplicate events', async () => {
  const firstRegister = await requestJson('POST', '/api/register', {
    email: 'activity-user@example.com',
    password: 'secret123'
  });
  const token = firstRegister.body.token;

  const initialAdd = await requestJson('POST', '/api/library', {
    games: [{ id: 'game-a', title: 'Alpha', platform: 'PC', status: 'Backlog' }],
    eventId: 'activity-add-1'
  }, { Authorization: `Bearer ${token}` });
  assert.equal(initialAdd.statusCode, 200);

  const duplicateAdd = await requestJson('POST', '/api/library', {
    games: [{ id: 'game-a', title: 'Alpha', platform: 'PC', status: 'Backlog' }],
    eventId: 'activity-add-1'
  }, { Authorization: `Bearer ${token}` });
  assert.equal(duplicateAdd.statusCode, 200);

  const activityResponse = await requestJson('GET', '/api/activity', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(activityResponse.statusCode, 200);
  assert.equal(activityResponse.body.items.length, 1);
  assert.equal(activityResponse.body.items[0].type, 'added_game');
  assert.equal(activityResponse.body.items[0].gameId, 'game-a');
  assert.equal(activityResponse.body.items[0].displayTitle, 'Alpha');
  assert.ok(activityResponse.body.items[0].eventId);
  assert.ok(activityResponse.body.items[0].timestamp);
  assert.equal(activityResponse.body.items[0].email, undefined);
  assert.equal(activityResponse.body.items[0].notes, undefined);

  const secondRegister = await requestJson('POST', '/api/register', {
    email: 'activity-other@example.com',
    password: 'secret123'
  });
  const otherToken = secondRegister.body.token;
  const otherActivity = await requestJson('GET', '/api/activity', undefined, { Authorization: `Bearer ${otherToken}` });
  assert.equal(otherActivity.statusCode, 200);
  assert.deepEqual(otherActivity.body.items, []);
});

test('orders newest activity first and supports deletion', async () => {
  const register = await requestJson('POST', '/api/register', {
    email: 'activity-order@example.com',
    password: 'secret123'
  });
  const token = register.body.token;

  await requestJson('POST', '/api/library', {
    games: [{ id: 'game-b', title: 'Beta', platform: 'PC', status: 'Backlog' }],
    eventId: 'activity-add-2'
  }, { Authorization: `Bearer ${token}` });

  await requestJson('POST', '/api/wishlist', {
    gameId: 'game-c',
    title: 'Gamma',
    platform: 'PC',
    eventId: 'activity-wishlist-1'
  }, { Authorization: `Bearer ${token}` });

  const activityResponse = await requestJson('GET', '/api/activity?limit=2&offset=0', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(activityResponse.statusCode, 200);
  assert.equal(activityResponse.body.items[0].type, 'added_wishlist_item');
  assert.equal(activityResponse.body.items[1].type, 'added_game');
  assert.equal(activityResponse.body.hasMore, false);

  const clearResponse = await requestJson('DELETE', '/api/activity', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(clearResponse.statusCode, 200);

  const afterClear = await requestJson('GET', '/api/activity', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(afterClear.statusCode, 200);
  assert.deepEqual(afterClear.body.items, []);
});
