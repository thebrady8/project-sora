const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-friends-'));
process.env.GAMEVAULT_DATA_DIR = tempDir;
process.env.GAMEVAULT_DISABLE_RATE_LIMIT = '1';

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

test('requires authentication and never exposes emails for public user searches', async () => {
  const aliceResponse = await requestJson('POST', '/api/register', {
    email: 'friend-auth-alice@example.com',
    password: 'secret123'
  });
  const bobResponse = await requestJson('POST', '/api/register', {
    email: 'friend-auth-bob@example.com',
    password: 'secret123'
  });

  const unauthenticated = await requestJson('GET', '/api/friends/search?search=friend-auth');
  assert.equal(unauthenticated.statusCode, 401);

  const authenticated = await requestJson('GET', '/api/friends/search?search=friend-auth', undefined, {
    Authorization: `Bearer ${aliceResponse.body.token}`
  });

  assert.equal(authenticated.statusCode, 200);
  assert.ok(Array.isArray(authenticated.body.users));
  assert.ok(authenticated.body.users.length >= 1);
  assert.ok(authenticated.body.users.every((user) => typeof user.id === 'string' && typeof user.handle === 'string'));
  assert.ok(authenticated.body.users.every((user) => !user.email));
  assert.ok(authenticated.body.users.every((user) => !String(user.handle).includes('@')));
  assert.ok(authenticated.body.users.every((user) => !String(user.id).includes('@')));
});

test('prevents self requests and duplicate friend requests', async () => {
  const aliceResponse = await requestJson('POST', '/api/register', {
    email: 'friend-self-alice@example.com',
    password: 'secret123'
  });
  const bobResponse = await requestJson('POST', '/api/register', {
    email: 'friend-self-bob@example.com',
    password: 'secret123'
  });

  const search = await requestJson('GET', '/api/friends/search?search=friend-self', undefined, {
    Authorization: `Bearer ${aliceResponse.body.token}`
  });
  const bobUser = search.body.users.find((user) => user.handle.includes('friend-self-bob'));
  assert.ok(bobUser);

  const selfRequest = await requestJson('POST', '/api/friends/requests', { userId: bobUser.id }, {
    Authorization: `Bearer ${bobResponse.body.token}`
  });
  assert.equal(selfRequest.statusCode, 400);

  const firstRequest = await requestJson('POST', '/api/friends/requests', { userId: bobUser.id }, {
    Authorization: `Bearer ${aliceResponse.body.token}`
  });
  assert.equal(firstRequest.statusCode, 201);

  const duplicateRequest = await requestJson('POST', '/api/friends/requests', { userId: bobUser.id }, {
    Authorization: `Bearer ${aliceResponse.body.token}`
  });
  assert.equal(duplicateRequest.statusCode, 409);
});

test('tracks pending, accepted, and declined friend request states', async () => {
  const aliceResponse = await requestJson('POST', '/api/register', {
    email: 'friend-flow-alice@example.com',
    password: 'secret123'
  });
  const carolResponse = await requestJson('POST', '/api/register', {
    email: 'friend-flow-carol@example.com',
    password: 'secret123'
  });

  const search = await requestJson('GET', '/api/friends/search?search=friend-flow', undefined, {
    Authorization: `Bearer ${aliceResponse.body.token}`
  });
  const carolUser = search.body.users.find((user) => user.handle.includes('friend-flow-carol'));
  assert.ok(carolUser);

  const sentRequest = await requestJson('POST', '/api/friends/requests', { userId: carolUser.id }, {
    Authorization: `Bearer ${aliceResponse.body.token}`
  });
  assert.equal(sentRequest.statusCode, 201);

  const incoming = await requestJson('GET', '/api/friends/requests/incoming', undefined, {
    Authorization: `Bearer ${carolResponse.body.token}`
  });
  assert.equal(incoming.statusCode, 200);
  assert.equal(incoming.body.requests[0].status, 'pending');

  const declined = await requestJson('POST', `/api/friends/requests/${encodeURIComponent(carolUser.id)}/decline`, undefined, {
    Authorization: `Bearer ${carolResponse.body.token}`
  });
  assert.equal(declined.statusCode, 200);

  const incomingAfterDecline = await requestJson('GET', '/api/friends/requests/incoming', undefined, {
    Authorization: `Bearer ${carolResponse.body.token}`
  });
  assert.equal(incomingAfterDecline.statusCode, 200);
  assert.equal(incomingAfterDecline.body.requests[0].status, 'declined');

  const accepted = await requestJson('POST', `/api/friends/requests/${encodeURIComponent(carolUser.id)}/accept`, undefined, {
    Authorization: `Bearer ${carolResponse.body.token}`
  });
  assert.equal(accepted.statusCode, 404);
});
