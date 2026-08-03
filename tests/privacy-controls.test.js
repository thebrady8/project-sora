const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-privacy-'));
process.env.GAMEVAULT_DATA_DIR = tempDir;
process.env.GAMEVAULT_DISABLE_RATE_LIMIT = '1';

const { createServer } = require('../server');

let server;
let port;

function createUniqueEmail(prefix) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}@example.com`;
}

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

async function registerUser(email, password) {
  const response = await requestJson('POST', '/api/register', { email, password });
  assert.equal(response.statusCode, 201);
  return response.body;
}

async function setupProfileFixture() {
  const aliceEmail = createUniqueEmail('privacy-owner');
  const bobEmail = createUniqueEmail('privacy-friend');
  const carolEmail = createUniqueEmail('privacy-stranger');

  const alice = await registerUser(aliceEmail, 'secret123');
  const bob = await registerUser(bobEmail, 'secret123');
  const carol = await registerUser(carolEmail, 'secret123');

  const aliceUsers = await requestJson('GET', '/api/friends/search?search=privacy', undefined, {
    Authorization: `Bearer ${alice.token}`
  });
  const bobHandleSeed = bobEmail.split('@')[0].toLowerCase();
  const bobUser = aliceUsers.body.users.find((user) => String(user.handle || '').toLowerCase().includes(bobHandleSeed));
  assert.ok(bobUser);

  const requestSent = await requestJson('POST', '/api/friends/requests', { userId: bobUser.id }, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(requestSent.statusCode, 201);

  const acceptRequest = await requestJson('POST', `/api/friends/requests/${encodeURIComponent(bobUser.id)}/accept`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(acceptRequest.statusCode, 200);

  const libraryResponse = await requestJson('POST', '/api/library', {
    games: [{
      id: 'privacy-game-1',
      title: 'Privacy Test Game',
      platform: 'PC',
      purchasePrice: 49.99,
      currentValue: 59.99,
      notes: 'private note',
      playtimeMinutes: 120,
      completionPercent: 60,
      coverImage: 'cover.png',
      status: 'Playing'
    }]
  }, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(libraryResponse.statusCode, 200);

  const reviewResponse = await requestJson('POST', '/api/reviews', {
    gameId: 'privacy-game-1',
    text: 'A lovely title',
    rating: 5
  }, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(reviewResponse.statusCode, 200);

  const activityResponse = await requestJson('POST', '/api/activity', {
    type: 'posted_review',
    gameId: 'privacy-game-1',
    displayTitle: 'Privacy Test Game',
    title: 'Privacy Test Game'
  }, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(activityResponse.statusCode, 200);

  return { alice, bob, carol, aliceEmail, bobEmail, carolEmail };
}

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('profile visibility applies to strangers, friends, and the owner', async () => {
  const { alice, bob, carol, aliceEmail } = await setupProfileFixture();

  const settingsPayload = { profileVisibility: 'Public', libraryVisibility: 'Public', reviewsVisibility: 'Public', activityVisibility: 'Friends Only' };
  const privacyResponse = await requestJson('POST', '/api/privacy', settingsPayload, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(privacyResponse.statusCode, 200);

  const ownerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(ownerView.statusCode, 200);
  assert.equal(ownerView.body.profile.available, true);

  const friendView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendView.statusCode, 200);
  assert.equal(friendView.body.profile.available, true);

  const strangerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${carol.token}`
  });
  assert.equal(strangerView.statusCode, 200);
  assert.equal(strangerView.body.profile.available, true);

  const privateSettings = await requestJson('POST', '/api/privacy', { ...settingsPayload, profileVisibility: 'Private' }, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(privateSettings.statusCode, 200);

  const ownerPrivateView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(ownerPrivateView.statusCode, 200);
  assert.equal(ownerPrivateView.body.profile.available, true);

  const friendPrivateView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendPrivateView.statusCode, 403);
  assert.equal(friendPrivateView.body.error, 'This profile is private.');

  const strangerPrivateView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${carol.token}`
  });
  assert.equal(strangerPrivateView.statusCode, 403);
  assert.equal(strangerPrivateView.body.error, 'This profile is private.');

  const friendOnlySettings = await requestJson('POST', '/api/privacy', { ...settingsPayload, profileVisibility: 'Friends Only' }, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(friendOnlySettings.statusCode, 200);

  const friendOnlyFriendView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendOnlyFriendView.statusCode, 200);
  assert.equal(friendOnlyFriendView.body.profile.available, true);

  const friendOnlyStrangerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${carol.token}`
  });
  assert.equal(friendOnlyStrangerView.statusCode, 403);
  assert.equal(friendOnlyStrangerView.body.error, 'This profile is private.');
});

test('library visibility is enforced for strangers, friends, and the owner', async () => {
  const { alice, bob, carol, aliceEmail } = await setupProfileFixture();

  await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Public',
    reviewsVisibility: 'Public',
    activityVisibility: 'Private'
  }, {
    Authorization: `Bearer ${alice.token}`
  });

  const ownerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(ownerView.body.library.available, true);
  assert.equal(ownerView.body.library.items[0].title, 'Privacy Test Game');
  assert.equal(ownerView.body.library.items[0].purchasePrice, undefined);

  const friendView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendView.body.library.available, true);
  assert.equal(friendView.body.library.items[0].title, 'Privacy Test Game');

  const strangerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${carol.token}`
  });
  assert.equal(strangerView.body.library.available, true);

  await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Friends Only',
    reviewsVisibility: 'Public',
    activityVisibility: 'Private'
  }, {
    Authorization: `Bearer ${alice.token}`
  });

  const friendRestricted = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendRestricted.body.library.available, true);

  const strangerRestricted = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${carol.token}`
  });
  assert.equal(strangerRestricted.body.library.available, false);
  assert.equal(strangerRestricted.body.library.message, 'Library access is restricted by privacy settings.');

  await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Private',
    reviewsVisibility: 'Public',
    activityVisibility: 'Private'
  }, {
    Authorization: `Bearer ${alice.token}`
  });

  const friendPrivateView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendPrivateView.body.library.available, false);
  assert.equal(friendPrivateView.body.library.message, 'Library access is restricted by privacy settings.');
});

test('reviews visibility is enforced for strangers, friends, and the owner', async () => {
  const { alice, bob, carol, aliceEmail } = await setupProfileFixture();

  await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Public',
    reviewsVisibility: 'Public',
    activityVisibility: 'Private'
  }, {
    Authorization: `Bearer ${alice.token}`
  });

  const ownerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(ownerView.body.reviews.available, true);
  assert.equal(ownerView.body.reviews.items[0].text, 'A lovely title');

  const friendView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendView.body.reviews.available, true);

  const strangerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${carol.token}`
  });
  assert.equal(strangerView.body.reviews.available, true);

  await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Public',
    reviewsVisibility: 'Friends Only',
    activityVisibility: 'Private'
  }, {
    Authorization: `Bearer ${alice.token}`
  });

  const friendRestricted = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendRestricted.body.reviews.available, true);

  const strangerRestricted = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${carol.token}`
  });
  assert.equal(strangerRestricted.body.reviews.available, false);
  assert.equal(strangerRestricted.body.reviews.message, 'Reviews are restricted by privacy settings.');

  await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Public',
    reviewsVisibility: 'Private',
    activityVisibility: 'Private'
  }, {
    Authorization: `Bearer ${alice.token}`
  });

  const friendPrivateView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendPrivateView.body.reviews.available, false);
  assert.equal(friendPrivateView.body.reviews.message, 'Reviews are restricted by privacy settings.');
});

test('activity visibility is enforced for strangers, friends, and the owner', async () => {
  const { alice, bob, carol, aliceEmail } = await setupProfileFixture();

  await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Public',
    reviewsVisibility: 'Public',
    activityVisibility: 'Friends Only'
  }, {
    Authorization: `Bearer ${alice.token}`
  });

  const ownerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${alice.token}`
  });
  assert.equal(ownerView.body.activity.available, true);
  assert.equal(ownerView.body.activity.items[0].type, 'posted_review');

  const friendView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendView.body.activity.available, true);

  const strangerView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${carol.token}`
  });
  assert.equal(strangerView.body.activity.available, false);
  assert.equal(strangerView.body.activity.message, 'Activity is restricted by privacy settings.');

  await requestJson('POST', '/api/privacy', {
    profileVisibility: 'Public',
    libraryVisibility: 'Public',
    reviewsVisibility: 'Public',
    activityVisibility: 'Private'
  }, {
    Authorization: `Bearer ${alice.token}`
  });

  const friendPrivateView = await requestJson('GET', `/api/profile/${encodeURIComponent(aliceEmail)}`, undefined, {
    Authorization: `Bearer ${bob.token}`
  });
  assert.equal(friendPrivateView.body.activity.available, false);
  assert.equal(friendPrivateView.body.activity.message, 'Activity is restricted by privacy settings.');
});
