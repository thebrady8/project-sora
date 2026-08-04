import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const catalog = fs.readFileSync(new URL('../public/catalog-data.js', import.meta.url), 'utf8');

test('discovery queue excludes invented fallback dates and requires finite hard dates', () => {
  assert.match(catalog, /PREMIUM_RELEASE_FALLBACK = \[\]/);
  assert.match(app, /Number\.isFinite\(timestamp\)/);
  assert.match(app, /sort\(\(a, b\) => Number\(a\.releaseTimestamp\) - Number\(b\.releaseTimestamp\)\)/);
  assert.match(server, /filter\(\(item\) => item && item\.hardDate && isHardLaunchDate/);
});

test('article cards rotate and expire on a rolling seven-day window', () => {
  assert.match(app, /startReleaseArticleRotation/);
  assert.match(app, /releaseArticleIndex = \(releaseArticleIndex \+ 1\)/);
  assert.match(server, /RELEASE_ARTICLE_WINDOW_MS = 7 \* 24/);
  assert.match(server, /when:7d/);
});
