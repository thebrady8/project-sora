const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function createStorageHarness() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-sqlite-'));
  process.env.GAMEVAULT_DATA_DIR = tempDir;
  process.env.GAMEVAULT_PERSISTENCE = 'SQLITE';
  delete require.cache[require.resolve('../storage')];
  const storage = require('../storage');
  storage.resetForTests();
  return { storage, tempDir };
}

test('stores sessions and enforces database-level uniqueness for friendships, wishlists, queues, and notifications', () => {
  const { storage } = createStorageHarness();

  storage.initializeStorage();
  storage.createUserRecord({ email: 'alice@example.com', passwordHash: 'hash-a', salt: 'salt-a', publicId: 'user-1', publicHandle: 'alice' });
  storage.createUserRecord({ email: 'bob@example.com', passwordHash: 'hash-b', salt: 'salt-b', publicId: 'user-2', publicHandle: 'bob' });

  const token = 'session-token-123';
  storage.createSession('alice@example.com', token, Date.now() + 60_000);
  assert.equal(storage.getSessionUser(token), 'alice@example.com');

  assert.doesNotThrow(() => storage.createFriendship('user-1', 'user-2'));
  assert.throws(() => storage.createFriendship('user-1', 'user-2'), /UNIQUE|duplicate/i);

  assert.doesNotThrow(() => storage.createWishlistEntry('alice@example.com', { gameId: 'game-1', title: 'Game 1' }));
  assert.throws(() => storage.createWishlistEntry('alice@example.com', { gameId: 'game-1', title: 'Game 1' }), /UNIQUE|duplicate/i);

  assert.doesNotThrow(() => storage.createQueueEntry('alice@example.com', { gameId: 'queue-1', title: 'Queue item' }));
  assert.throws(() => storage.createQueueEntry('alice@example.com', { gameId: 'queue-1', title: 'Queue item' }), /UNIQUE|duplicate/i);

  assert.doesNotThrow(() => storage.createNotification('alice@example.com', { id: 'notif-1', gameId: 'game-1', type: 'price_alert', title: 'Alert', message: 'Message', targetPrice: 10, currency: 'USD', observedPrice: 9.99 }));
  assert.throws(() => storage.createNotification('alice@example.com', { id: 'notif-2', gameId: 'game-1', type: 'price_alert', title: 'Alert', message: 'Message', targetPrice: 10, currency: 'USD', observedPrice: 9.99 }), /UNIQUE|duplicate/i);
});

test('rolls back multi-step writes and migrates JSON data into SQLite', () => {
  const { storage, tempDir } = createStorageHarness();
  storage.initializeStorage();

  fs.writeFileSync(path.join(tempDir, 'users.json'), JSON.stringify({ 'migrate@example.com': { salt: 'salt', passwordHash: 'hash', publicId: 'user-3', publicHandle: 'migrate' } }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'libraries.json'), JSON.stringify({ 'migrate@example.com': [{ id: 'game-2', title: 'Imported game', platform: 'PC', condition: 'Good', purchasePrice: 5, currentValue: 6, metacriticScore: 80, notes: 'Imported' }] }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'wishlists.json'), JSON.stringify({ 'migrate@example.com': [{ gameId: 'wishlist-1', title: 'Wishlist game', platform: 'PC', price: 10, image: '', releaseDate: '' }] }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'queues.json'), JSON.stringify({ 'migrate@example.com': [{ gameId: 'queue-2', title: 'Queued game', platform: 'PC', image: '', status: 'Queued' }] }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'activities.json'), JSON.stringify({ 'migrate@example.com': [{ eventId: 'activity-1', type: 'added_game', gameId: 'game-2', displayTitle: 'Imported game', timestamp: '2026-01-01T00:00:00.000Z' }] }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'friends.json'), JSON.stringify({ requests: [{ id: 'req-1', requesterId: 'user-3', targetId: 'user-4', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' }], friendships: [{ userIdA: 'user-3', userIdB: 'user-4', createdAt: '2026-01-01T00:00:00.000Z' }] }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'price-history.json'), JSON.stringify({ 'game-2': [{ gameId: 'game-2', storefront: 'Steam', price: 5.5, currency: 'USD', capturedAt: '2026-01-01T00:00:00.000Z', source: 'catalog-integration' }] }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'price-alerts.json'), JSON.stringify({ 'migrate@example.com': [{ gameId: 'game-2', targetPrice: 6, currency: 'USD', enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'notifications.json'), JSON.stringify({ 'migrate@example.com': [{ id: 'notif-a', gameId: 'game-2', type: 'price_alert', title: 'Imported alert', message: 'Imported', read: false, createdAt: '2026-01-01T00:00:00.000Z', targetPrice: 6, currency: 'USD', observedPrice: 5.5 }] }, null, 2));

  assert.doesNotThrow(() => storage.migrateFromJsonFiles());
  const migratedUsers = storage.readUsersStore();
  assert.ok(migratedUsers['migrate@example.com']);
  const migratedLibrary = storage.readLibrariesStore();
  assert.equal(migratedLibrary['migrate@example.com'][0].title, 'Imported game');
  const migratedWishlist = storage.readWishlistsStore();
  assert.equal(migratedWishlist['migrate@example.com'][0].gameId, 'wishlist-1');

  assert.throws(() => {
    storage.withTransaction(() => {
      storage.createUserRecord({ email: 'rollback@example.com', passwordHash: 'hash', salt: 'salt' });
      throw new Error('rollback');
    });
  }, /rollback/);

  const rolledBack = storage.readUsersStore();
  assert.equal(rolledBack['rollback@example.com'], undefined);
});
