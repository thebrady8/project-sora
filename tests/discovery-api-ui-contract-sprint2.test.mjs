import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('server exposes a bounded authenticated recommendation endpoint', () => {
  assert.match(server, /\/api\/discovery\/recommendations/);
  assert.match(server, /ensureAuthenticated\(req, res\)/);
  assert.match(server, /limit: Math\.min\(50/);
  assert.match(server, /algorithm: 'project-sora-explainable-v1'/);
});

test('Game Finder requests small batches and preserves an offline fallback', () => {
  assert.match(app, /\/api\/discovery\/recommendations\?limit=24&cursor=/);
  assert.match(app, /buildLocalGameFinderCandidates/);
  assert.match(app, /Using on-device recommendations/);
  assert.match(app, /finderMatchPercent/);
  assert.match(app, /gameFinderNextCursor/);
});
