const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-wishlist-'));
process.env.GAMEVAULT_DATA_DIR = tempDir;

const { createServer, mergeWishlistEntries } = require('../server');

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

test('wishlist routes require authentication', async () => {
  const response = await requestJson('GET', '/api/wishlist');
  assert.equal(response.statusCode, 401);
});

test('wishlist persists entries, prevents duplicates, and supports removal', async () => {
  const registerResponse = await requestJson('POST', '/api/register', {
    email: 'wishlist@example.com',
    password: 'secret123'
  });
  assert.equal(registerResponse.statusCode, 201);
  const token = registerResponse.body.token;

  const payload = {
    gameId: 'catalog-zelda',
    title: 'The Legend of Zelda',
    platform: 'Switch',
    price: 59.99,
    image: 'https://example.com/zelda.png',
    releaseDate: '2023-05-12'
  };

  const firstAdd = await requestJson('POST', '/api/wishlist', payload, { Authorization: `Bearer ${token}` });
  assert.equal(firstAdd.statusCode, 200);
  assert.equal(firstAdd.body.items.length, 1);

  const duplicateAdd = await requestJson('POST', '/api/wishlist', payload, { Authorization: `Bearer ${token}` });
  assert.equal(duplicateAdd.statusCode, 200);
  assert.equal(duplicateAdd.body.items.length, 1);

  const listResponse = await requestJson('GET', '/api/wishlist', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.body.items[0].gameId, 'catalog-zelda');

  const deleteResponse = await requestJson('DELETE', '/api/wishlist/catalog-zelda', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(deleteResponse.statusCode, 200);

  const afterDelete = await requestJson('GET', '/api/wishlist', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(afterDelete.statusCode, 200);
  assert.deepEqual(afterDelete.body.items, []);
});

test('offline reconciliation merges local and remote wishlist entries', () => {
  const merged = mergeWishlistEntries(
    [{ gameId: 'catalog-zelda', title: 'Zelda', addedAt: '2024-01-01' }],
    [{ gameId: 'catalog-cyberpunk', title: 'Cyberpunk', addedAt: '2024-01-02' }]
  );

  assert.equal(merged.length, 2);
  assert.ok(merged.some((entry) => entry.gameId === 'catalog-zelda'));
  assert.ok(merged.some((entry) => entry.gameId === 'catalog-cyberpunk'));
});
