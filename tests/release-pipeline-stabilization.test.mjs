import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeReleaseQueue, advanceReleaseIndex, filterReleaseQueueByPlatform, DAY_MS } from '../public/release-pipeline.mjs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('release queue removes expired, invalid, duplicate, and beyond-horizon entries', () => {
  const now = Date.UTC(2026, 7, 4);
  const items = normalizeReleaseQueue([
    { id: 'soon', title: 'Soon', releaseTimestamp: now + DAY_MS },
    { id: 'later', title: 'Later', releaseTimestamp: now + 10 * DAY_MS },
    { id: 'expired', title: 'Expired', releaseTimestamp: now - 3 * DAY_MS },
    { id: 'tba', title: 'TBA', releaseTimestamp: Number.MAX_SAFE_INTEGER },
    { id: 'soon', title: 'Duplicate', releaseTimestamp: now + 2 * DAY_MS }
  ], { now, horizonDays: 365 });
  assert.deepEqual(items.map((item) => item.id), ['soon', 'later']);
});

test('release queue rotates through every item and wraps both directions', () => {
  const visited = [];
  let index = 0;
  for (let i = 0; i < 4; i += 1) {
    visited.push(index);
    index = advanceReleaseIndex(index, 1, 4);
  }
  assert.deepEqual(visited, [0, 1, 2, 3]);
  assert.equal(index, 0);
  assert.equal(advanceReleaseIndex(0, -1, 4), 3);
});

test('platform filters preserve sorted queue', () => {
  const items = [
    { id: 'a', platform: 'Windows PC', source: 'Steam' },
    { id: 'b', platform: 'PlayStation 5', source: 'PlayStation' }
  ];
  assert.deepEqual(filterReleaseQueueByPlatform(items, 'Steam').map((item) => item.id), ['a']);
  assert.deepEqual(filterReleaseQueueByPlatform(items, 'PlayStation').map((item) => item.id), ['b']);
});

test('interest state has authenticated persistence with local fallback', () => {
  assert.match(app, /loadReleaseInterests/);
  assert.match(app, /persistReleaseInterests/);
  assert.match(app, /apiRequest\('\/api\/release-interests'/);
  assert.match(server, /RELEASE_INTERESTS_FILE/);
  assert.match(server, /url\.pathname === '\/api\/release-interests'/);
});
