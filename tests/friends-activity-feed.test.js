const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-friends-feed-'));
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

test('friends activity feed respects privacy and supports hiding individual events', async () => {
  const ownerRegister = await requestJson('POST', '/api/register', { email: 'feed-owner@example.com', password: 'secret123' });
  const friendRegister = await requestJson('POST', '/api/register', { email: 'feed-friend@example.com', password: 'secret123' });
  const strangerRegister = await requestJson('POST', '/api/register', { email: 'feed-stranger@example.com', password: 'secret123' });

  const ownerToken = ownerRegister.body.token;
  const friendToken = friendRegister.body.token;
  const strangerToken = strangerRegister.body.token;

  const privacyResponse = await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Public',
    reviewsVisibility: 'Public',
    activityVisibility: 'Friends Only',
    feedSharingEnabled: true
  }, { Authorization: `Bearer ${ownerToken}` });
  assert.equal(privacyResponse.statusCode, 200);

  const searchResponse = await requestJson('GET', '/api/friends/search?search=feed', undefined, { Authorization: `Bearer ${ownerToken}` });
  const friendUser = searchResponse.body.users.find((entry) => entry.handle.includes('feed-friend'));
  assert.ok(friendUser);

  const friendRequestResponse = await requestJson('POST', '/api/friends/requests', { userId: friendUser.id }, { Authorization: `Bearer ${ownerToken}` });
  assert.equal(friendRequestResponse.statusCode, 201);

  const acceptRequestResponse = await requestJson('POST', `/api/friends/requests/${encodeURIComponent(friendUser.id)}/accept`, undefined, { Authorization: `Bearer ${friendToken}` });
  assert.equal(acceptRequestResponse.statusCode, 200);

  const addLibraryResponse = await requestJson('POST', '/api/library', {
    games: [{ id: 'feed-game-1', title: 'Feed Test Game', platform: 'PC', status: 'Backlog' }],
    eventId: 'feed-added-game-1'
  }, { Authorization: `Bearer ${ownerToken}` });
  assert.equal(addLibraryResponse.statusCode, 200);

  const reviewResponse = await requestJson('POST', '/api/reviews', {
    gameId: 'feed-game-1',
    text: 'A test review',
    rating: 5
  }, { Authorization: `Bearer ${ownerToken}` });
  assert.equal(reviewResponse.statusCode, 200);

  const friendFeedResponse = await requestJson('GET', '/api/friends/activity?limit=20&offset=0', undefined, { Authorization: `Bearer ${friendToken}` });
  assert.equal(friendFeedResponse.statusCode, 200);
  assert.equal(friendFeedResponse.body.items.length > 0, true);
  assert.equal(friendFeedResponse.body.items.some((entry) => entry.type === 'added_game'), true);
  assert.equal(friendFeedResponse.body.items.some((entry) => entry.type === 'posted_review'), true);

  const strangerFeedResponse = await requestJson('GET', '/api/friends/activity?limit=20&offset=0', undefined, { Authorization: `Bearer ${strangerToken}` });
  assert.equal(strangerFeedResponse.statusCode, 200);
  assert.equal(strangerFeedResponse.body.items.length, 0);

  const hiddenEventId = friendFeedResponse.body.items.find((entry) => entry.type === 'added_game').eventId;
  const hideResponse = await requestJson('POST', '/api/activity/hide', { eventId: hiddenEventId }, { Authorization: `Bearer ${ownerToken}` });
  assert.equal(hideResponse.statusCode, 200);

  const afterHideResponse = await requestJson('GET', '/api/friends/activity?limit=20&offset=0', undefined, { Authorization: `Bearer ${friendToken}` });
  assert.equal(afterHideResponse.statusCode, 200);
  assert.equal(afterHideResponse.body.items.some((entry) => entry.eventId === hiddenEventId), false);
});
