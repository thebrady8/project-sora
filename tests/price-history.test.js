const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-price-history-'));
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

test('validates snapshots and rejects untrusted writers', async () => {
  const register = await requestJson('POST', '/api/register', { email: 'price-user@example.com', password: 'secret123' });
  const token = register.body.token;

  const invalidResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Steam',
    price: -5,
    currency: 'USD',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'catalog-integration'
  }, {
    'X-Project-Sora-Integration': 'trusted-token'
  });
  assert.equal(invalidResponse.statusCode, 400);

  const unauthorizedResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Steam',
    price: 49.99,
    currency: 'USD',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'catalog-integration'
  }, { Authorization: `Bearer ${token}` });
  assert.equal(unauthorizedResponse.statusCode, 403);
});

test('prevents duplicate same-day storefront snapshots and computes price summary safely', async () => {
  const firstResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Steam',
    price: 49.99,
    currency: 'USD',
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'catalog-integration'
  }, {
    'X-Project-Sora-Integration': 'trusted-token'
  });
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(firstResponse.body.created, true);

  const duplicateResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Steam',
    price: 49.99,
    currency: 'USD',
    capturedAt: '2026-01-01T12:00:00.000Z',
    source: 'catalog-integration'
  }, {
    'X-Project-Sora-Integration': 'trusted-token'
  });
  assert.equal(duplicateResponse.statusCode, 200);
  assert.equal(duplicateResponse.body.created, false);

  const secondPriceResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Steam',
    price: 54.99,
    currency: 'USD',
    capturedAt: '2026-01-02T00:00:00.000Z',
    source: 'catalog-integration'
  }, {
    'X-Project-Sora-Integration': 'trusted-token'
  });
  assert.equal(secondPriceResponse.statusCode, 201);

  const thirdResponse = await requestJson('POST', '/api/catalog/price-history', {
    gameId: 'game-zelda-breath',
    storefront: 'Nintendo eShop',
    price: 59.99,
    currency: 'USD',
    capturedAt: '2026-01-03T00:00:00.000Z',
    source: 'catalog-integration'
  }, {
    'X-Project-Sora-Integration': 'trusted-token'
  });
  assert.equal(thirdResponse.statusCode, 201);

  const register = await requestJson('POST', '/api/register', { email: 'price-reader@example.com', password: 'secret123' });
  const readResponse = await requestJson('GET', '/api/catalog/game-zelda-breath/price-history', undefined, { Authorization: `Bearer ${register.body.token}` });
  assert.equal(readResponse.statusCode, 200);
  assert.equal(readResponse.body.summaryByCurrency[0].latestPrice.price, 59.99);
  assert.equal(readResponse.body.summaryByCurrency[0].lowestPrice.price, 49.99);
  assert.equal(readResponse.body.summaryByCurrency[0].highestPrice.price, 59.99);
  assert.equal(readResponse.body.summaryByCurrency[0].hasEnoughHistory, true);
  assert.equal(readResponse.body.summaryByCurrency[0].label, 'Prices observed by Project Sora');
});

test('returns empty history state when there are no snapshots yet', async () => {
  const register = await requestJson('POST', '/api/register', { email: 'price-empty@example.com', password: 'secret123' });
  const response = await requestJson('GET', '/api/catalog/game-cyberpunk-2077/price-history', undefined, { Authorization: `Bearer ${register.body.token}` });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.history, []);
  assert.deepEqual(response.body.summaryByCurrency, []);
  assert.equal(response.body.emptyState, 'Not enough history yet');
});
