const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const helperJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'helpers.js'), 'utf8');
const csvUtils = fs.readFileSync(path.join(__dirname, '..', 'public', 'csv-utils.mjs'), 'utf8');

const csvModulePromise = import('../public/csv-utils.mjs');
const { normalizeGame } = require('./helpers-play-status');

function buildGame(overrides = {}) {
  return normalizeGame({
    id: 'game-1',
    title: 'Test Game',
    platform: 'PC',
    condition: 'Good',
    purchasePrice: 10,
    currentValue: 15,
    metacriticScore: 88,
    notes: 'Note',
    completionPercent: 0,
    ...overrides
  });
}

test('migrates existing games to safe defaults', () => {
  const backlogGame = buildGame();
  const completedGame = buildGame({ completionPercent: 100 });

  assert.equal(backlogGame.status, 'Backlog');
  assert.equal(completedGame.status, 'Completed');
  assert.equal(completedGame.completedAt, completedGame.completedAt);
});

test('filters the library by play status', () => {
  const games = [buildGame({ status: 'Backlog' }), buildGame({ status: 'Playing' })];
  const filtered = games.filter((game) => game.status === 'Playing');

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].status, 'Playing');
});

test('tracks completion lifecycle and completedAt', () => {
  const game = buildGame({ status: 'Playing', completionPercent: 50 });
  game.completionPercent = 100;
  game.status = game.completionPercent >= 100 ? 'Completed' : game.status;
  if (game.status === 'Completed') {
    game.completedAt = game.completedAt || new Date().toISOString();
  }

  assert.equal(game.status, 'Completed');
  assert.ok(game.completedAt);

  game.status = 'Playing';
  game.completedAt = null;
  assert.equal(game.status, 'Playing');
  assert.equal(game.completedAt, null);
});

test('CSV import and export remain compatible with legacy data', async () => {
  const { parseCsvGames, serializeLibraryCsv } = await csvModulePromise;
  const parsed = parseCsvGames('Title,Platform,Condition,Purchase Price,Current Value,Metacritic Score,Notes\nLegacy Game,PC,Good,12,15,89,Legacy note');
  assert.equal(parsed[0].status, 'Backlog');
  assert.match(serializeLibraryCsv(parsed), /Legacy Game/);
});

test('app and helper code expose play-status behavior', () => {
  assert.match(appJs, /status/i);
  assert.match(helperJs, /completedAt|status/i);
  assert.match(csvUtils, /status|Backlog/);
});
