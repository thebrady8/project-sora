import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('upcoming releases have calendar, detail routes, and interest controls', () => {
  assert.match(html, /releasePlatformFilter/);
  assert.match(html, /releaseDetailPage/);
  assert.match(app, /#upcoming\/calendar/);
  assert.match(app, /data-release-action=\"interest\"/);
  assert.match(app, /data-release-action=\"wishlist\"/);
});

test('release feed is cached daily and aggregates major platform sources', () => {
  assert.match(server, /RELEASE_CACHE_TTL_MS/);
  assert.match(server, /getDailyReleaseFeed/);
  assert.match(server, /Steam/);
  assert.match(server, /Xbox Wire/);
  assert.match(server, /PlayStation Blog/);
  assert.match(server, /Nintendo News/);
});
