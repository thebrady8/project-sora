const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCollectionStatistics, formatCurrency, formatPlaytime } = require('../public/statistics-utils.mjs');

function makeGame(overrides = {}) {
  return {
    id: overrides.id || 'game-1',
    title: overrides.title || 'Test Game',
    platform: overrides.platform || 'PC',
    genre: overrides.genre || 'Action',
    purchasePrice: overrides.purchasePrice ?? 20,
    currentValue: overrides.currentValue ?? 30,
    playtimeMinutes: overrides.playtimeMinutes ?? 120,
    completionPercent: overrides.completionPercent ?? 50,
    status: overrides.status || 'Backlog',
    comments: overrides.comments || [],
    addedAt: overrides.addedAt || null,
    ...overrides
  };
}

test('buildCollectionStatistics returns safe defaults for an empty library', () => {
  const stats = buildCollectionStatistics([], new Date('2026-01-15T00:00:00.000Z'));

  assert.equal(stats.totalGames, 0);
  assert.equal(stats.totalEstimatedCollectionValue, 0);
  assert.equal(stats.totalPurchaseCost, 0);
  assert.equal(stats.estimatedGainOrLoss, 0);
  assert.equal(stats.averagePersonalRating, 0);
  assert.equal(stats.totalRecordedPlaytime, 0);
  assert.equal(stats.averageCompletionPercentage, 0);
  assert.equal(stats.completedGameCount, 0);
  assert.equal(stats.backlogCount, 0);
  assert.equal(stats.mostOwnedPlatform, 'Unknown');
  assert.equal(stats.mostPlayedGenre, 'Unknown');
  assert.equal(stats.gamesAddedLast30Days, 0);
});

test('buildCollectionStatistics computes the expected metrics for a mixed library', () => {
  const stats = buildCollectionStatistics([
    makeGame({
      id: 'g1',
      platform: 'PC',
      genre: 'Action',
      purchasePrice: 50,
      currentValue: 80,
      playtimeMinutes: 180,
      completionPercent: 100,
      status: 'Completed',
      comments: [{ rating: 5 }, { rating: 4 }],
      addedAt: '2026-01-10T12:00:00.000Z'
    }),
    makeGame({
      id: 'g2',
      platform: 'Switch',
      genre: 'RPG',
      purchasePrice: 40,
      currentValue: 35,
      playtimeMinutes: 90,
      completionPercent: 70,
      status: 'Playing',
      comments: [{ rating: 3 }],
      addedAt: '2025-12-10T12:00:00.000Z'
    }),
    makeGame({
      id: 'g3',
      platform: 'PC',
      genre: 'Action',
      purchasePrice: 25,
      currentValue: 20,
      playtimeMinutes: 0,
      completionPercent: 20,
      status: 'Backlog',
      comments: [{ rating: 2 }],
      addedAt: '2026-01-14T12:00:00.000Z'
    }),
    makeGame({
      id: 'g4',
      platform: 'PlayStation',
      genre: 'Adventure',
      purchasePrice: 15,
      currentValue: 20,
      playtimeMinutes: 45,
      completionPercent: 0,
      status: 'Backlog',
      comments: [],
      addedAt: null
    })
  ], new Date('2026-01-15T00:00:00.000Z'));

  assert.equal(stats.totalGames, 4);
  assert.equal(stats.totalEstimatedCollectionValue, 155);
  assert.equal(stats.totalPurchaseCost, 130);
  assert.equal(stats.estimatedGainOrLoss, 25);
  assert.equal(stats.averagePersonalRating, 3.5);
  assert.equal(stats.totalRecordedPlaytime, 315);
  assert.equal(stats.averageCompletionPercentage, 47.5);
  assert.equal(stats.completedGameCount, 1);
  assert.equal(stats.backlogCount, 2);
  assert.equal(stats.mostOwnedPlatform, 'PC');
  assert.equal(stats.mostPlayedGenre, 'Action');
  assert.equal(stats.gamesAddedLast30Days, 2);
});

test('buildCollectionStatistics resolves deterministic ties and formats values safely', () => {
  const stats = buildCollectionStatistics([
    makeGame({ id: 'a', platform: 'PC', genre: 'Action', purchasePrice: 10, currentValue: 12, playtimeMinutes: 60, completionPercent: 100, status: 'Completed', comments: [{ rating: 5 }], addedAt: '2026-01-01T00:00:00.000Z' }),
    makeGame({ id: 'b', platform: 'PC', genre: 'Action', purchasePrice: 10, currentValue: 12, playtimeMinutes: 60, completionPercent: 100, status: 'Completed', comments: [{ rating: 5 }], addedAt: '2026-01-02T00:00:00.000Z' }),
    makeGame({ id: 'c', platform: 'Switch', genre: 'RPG', purchasePrice: 10, currentValue: 12, playtimeMinutes: 60, completionPercent: 100, status: 'Completed', comments: [{ rating: 5 }], addedAt: '2026-01-03T00:00:00.000Z' })
  ], new Date('2026-01-10T00:00:00.000Z'));

  assert.equal(stats.mostOwnedPlatform, 'PC');
  assert.equal(stats.mostPlayedGenre, 'Action');
  assert.equal(stats.gamesAddedLast30Days, 3);
  assert.equal(formatCurrency(12.5), '$12.50');
  assert.equal(formatPlaytime(90), '1h 30m');
});
