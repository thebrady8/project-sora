import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'storage.js'), 'utf8');

test('profile customization UI and public route are present', () => {
  assert.match(html, /profileDisplayNameInput/);
  assert.match(html, /profileAvatarUrlInput/);
  assert.match(html, /profileBannerUrlInput/);
  assert.match(html, /favoriteGamesEditor/);
  assert.match(html, /publicProfilePage/);
  assert.match(app, /saveProfileSettings/);
  assert.match(app, /#profile\\\//);
});

test('profile data is persisted and sanitized by the server', () => {
  assert.match(server, /\/api\/profile-settings/);
  assert.match(server, /sanitizeProfileDetails/);
  assert.match(server, /favoriteGameIds/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS profiles/);
  assert.match(storage, /readProfilesStore/);
});
