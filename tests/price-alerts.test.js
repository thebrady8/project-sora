const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-price-alerts-'));
process.env.GAMEVAULT_DATA_DIR = tempDir;
process.env.GAMEVAULT_DISABLE_RATE_LIMIT = '1';
process.env.PROJECT_SORA_TRUSTED_INTEGRATION_TOKEN = 'trusted-token';

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

test('creates alert targets, ignores currency mismatches, and generates notifications once', async () => {
  const register = await requestJson('POST', '/api/register', { email: 'alert-user@example.com', password: 'secret123' });
  const token = register.body.token;

  const wishlistResponse = await requestJson('POST', '/api/wishlist', {
    gameId: 'game-zelda-breath',
    title: 'The Legend of Zelda: Breath of the Wild',
    platform: 'Switch',
    price: 49.99,
    image: ''
  }, { Authorization: `Bearer ${token}` });
  assert.equal(wishlistResponse.statusCode, 200);

  const alertResponse = await requestJson('POST', '/api/wishlist/alerts', {
    gameId: 'game-zelda-breath',
    targetPrice: 50,
    currency: 'USD',
    enabled: true
  }, { Authorization: `Bearer ${token}` });
  assert.equal(alertResponse.statusCode, 201);
  assert.equal(alertResponse.body.alert.enabled, true);

  const mismatchResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Steam',
    price: 49.5,
    currency: 'EUR',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'catalog-integration'
  }, { 'X-Project-Sora-Integration': 'trusted-token' });
  assert.equal(mismatchResponse.statusCode, 201);

  const firstCrossingResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Steam',
    price: 49.99,
    currency: 'USD',
    capturedAt: '2026-01-02T00:00:00.000Z',
    source: 'catalog-integration'
  }, { 'X-Project-Sora-Integration': 'trusted-token' });
  assert.equal(firstCrossingResponse.statusCode, 201);

  const notificationsResponse = await requestJson('GET', '/api/notifications', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(notificationsResponse.statusCode, 200);
  assert.equal(notificationsResponse.body.items.length, 1);
  assert.equal(notificationsResponse.body.items[0].type, 'price_alert');
  assert.equal(notificationsResponse.body.items[0].read, false);

  const secondCrossingResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Steam',
    price: 49.5,
    currency: 'USD',
    capturedAt: '2026-01-03T00:00:00.000Z',
    source: 'catalog-integration'
  }, { 'X-Project-Sora-Integration': 'trusted-token' });
  assert.equal(secondCrossingResponse.statusCode, 201);

  const duplicateNotificationsResponse = await requestJson('GET', '/api/notifications', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(duplicateNotificationsResponse.statusCode, 200);
  assert.equal(duplicateNotificationsResponse.body.items.length, 1);
});

test('requires authorization and supports editing, disabling, and deleting alerts', async () => {
  const register = await requestJson('POST', '/api/register', { email: 'alert-editor@example.com', password: 'secret123' });
  const token = register.body.token;

  const wishlistResponse = await requestJson('POST', '/api/wishlist', {
    gameId: 'game-cyberpunk-2077',
    title: 'Cyberpunk 2077',
    platform: 'PC',
    price: 39.99,
    image: ''
  }, { Authorization: `Bearer ${token}` });
  assert.equal(wishlistResponse.statusCode, 200);

  const createResponse = await requestJson('POST', '/api/wishlist/alerts', {
    gameId: 'game-cyberpunk-2077',
    targetPrice: 40,
    currency: 'USD',
    enabled: true
  }, { Authorization: `Bearer ${token}` });
  assert.equal(createResponse.statusCode, 201);

  const unauthorizedResponse = await requestJson('POST', '/api/wishlist/alerts', {
    gameId: 'game-cyberpunk-2077',
    targetPrice: 38,
    currency: 'USD',
    enabled: true
  });
  assert.equal(unauthorizedResponse.statusCode, 401);

  const updateResponse = await requestJson('PATCH', '/api/wishlist/alerts', {
    gameId: 'game-cyberpunk-2077',
    targetPrice: 35,
    currency: 'USD',
    enabled: false
  }, { Authorization: `Bearer ${token}` });
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.alert.enabled, false);
  assert.equal(updateResponse.body.alert.targetPrice, 35);

  const deleteResponse = await requestJson('DELETE', '/api/wishlist/alerts', {
    gameId: 'game-cyberpunk-2077'
  }, { Authorization: `Bearer ${token}` });
  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.body.deleted, true);
});
