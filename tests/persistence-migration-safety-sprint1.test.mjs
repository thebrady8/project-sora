import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const storage = fs.readFileSync(new URL('../storage.js', import.meta.url), 'utf8');

test('migration framework and backup coverage are present', () => {
  assert.match(storage, /CURRENT_SCHEMA_VERSION = 3/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.match(storage, /runMigrations\(db\)/);
  assert.match(storage, /profile-account-fields/);
  assert.match(storage, /user-account-state/);
  for (const name of ['game-finder.json', 'release-interests.json', 'feedback.json', 'client-errors.json']) assert.ok(storage.includes(name));
});

test('JSON persistence can load without native SQLite dependency', async () => {
  process.env.GAMEVAULT_PERSISTENCE = 'JSON';
  const module = await import(`../storage.js?json=${Date.now()}`);
  assert.ok(module.default || module);
});
