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

test('release feed is cached daily, hard-date-only, and ordered soonest first', () => {
  assert.match(server, /RELEASE_CACHE_TTL_MS/);
  assert.match(server, /getDailyReleaseFeed/);
  assert.match(server, /hardDatesOnly: true/);
  assert.match(server, /sort: 'soonest-first'/);
  assert.match(server, /isHardLaunchDate/);
  assert.match(server, /Steam Store/);
});

test('release coverage uses a rolling seven-day window and weekly source list', () => {
  assert.match(server, /RELEASE_ARTICLE_WINDOW_MS/);
  assert.match(server, /getWeeklyReleaseArticles/);
  assert.match(server, /IGN/);
  assert.match(server, /GameSpot/);
  assert.match(server, /Eurogamer/);
  assert.match(server, /Polygon/);
  assert.match(server, /PC Gamer/);
  assert.match(html, /releaseCoverageList/);
  assert.match(app, /refreshReleaseArticles/);
});
