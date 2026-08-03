const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPlayNextRecommendations, applyPlayNextFilters, buildRecommendationReasons, createRecommendationState } = require('../public/play-next-utils.cjs');

function makeGame(overrides = {}) {
  return {
    id: overrides.id || 'game-1',
    title: overrides.title || 'Test Game',
    platform: overrides.platform || 'PC',
    genre: overrides.genre || 'Action',
    playtimeMinutes: overrides.playtimeMinutes ?? 120,
    completionPercent: overrides.completionPercent ?? 20,
    status: overrides.status || 'Backlog',
    purchasePrice: overrides.purchasePrice ?? 20,
    currentValue: overrides.currentValue ?? 30,
    comments: overrides.comments || [],
    addedAt: overrides.addedAt || null,
    ...overrides
  };
}

test('excludes completed and dropped games by default', () => {
  const library = [
    makeGame({ id: 'a', title: 'A', status: 'Completed' }),
    makeGame({ id: 'b', title: 'B', status: 'Dropped' }),
    makeGame({ id: 'c', title: 'C', status: 'Backlog' })
  ];

  const recommendations = buildPlayNextRecommendations(library, { includeCompleted: false, includeDropped: false });
  assert.deepEqual(recommendations.map((game) => game.id), ['c']);
});

test('scores and ranks recommendations deterministically', () => {
  const library = [
    makeGame({ id: 'target-1', title: 'Target One', genre: 'Action', platform: 'PC', status: 'Backlog', completionPercent: 10, comments: [{ rating: 5 }], playtimeMinutes: 180, addedAt: '2026-01-03T00:00:00.000Z' }),
    makeGame({ id: 'target-2', title: 'Target Two', genre: 'RPG', platform: 'Switch', status: 'Playing', completionPercent: 40, comments: [{ rating: 4 }], playtimeMinutes: 90, addedAt: '2026-01-01T00:00:00.000Z' })
  ];

  const recommendations = buildPlayNextRecommendations(library, { includeCompleted: false, includeDropped: false, history: ['target-2'] });
  assert.equal(recommendations[0].id, 'target-1');
  assert.ok(recommendations[0].score > recommendations[1].score);
});

test('avoids immediately repeating the same recommendation', () => {
  const library = [
    makeGame({ id: 'one', title: 'One', status: 'Backlog', genre: 'Action' }),
    makeGame({ id: 'two', title: 'Two', status: 'Backlog', genre: 'Action' }),
    makeGame({ id: 'three', title: 'Three', status: 'Backlog', genre: 'RPG' })
  ];

  const state = createRecommendationState({ history: [] });
  const first = buildPlayNextRecommendations(library, { includeCompleted: false, includeDropped: false, history: state.history });
  const second = buildPlayNextRecommendations(library, { includeCompleted: false, includeDropped: false, history: [first[0].id] });

  assert.notEqual(first[0].id, second[0].id);
});

test('applies platform, genre, and playtime filters', () => {
  const library = [
    makeGame({ id: 'pc-action', title: 'PC Action', genre: 'Action', platform: 'PC', playtimeMinutes: 120 }),
    makeGame({ id: 'switch-rpg', title: 'Switch RPG', genre: 'RPG', platform: 'Switch', playtimeMinutes: 240 }),
    makeGame({ id: 'pc-rpg', title: 'PC RPG', genre: 'RPG', platform: 'PC', playtimeMinutes: 60 })
  ];

  const filtered = applyPlayNextFilters(library, { platform: 'PC', genre: 'Action', maxPlaytimeMinutes: 180 });
  assert.deepEqual(filtered.map((game) => game.id), ['pc-action']);
});

test('tracks dismissals and can reset them', () => {
  const state = createRecommendationState({ dismissed: ['game-1'] });
  assert.deepEqual(state.dismissed, ['game-1']);
  const reset = createRecommendationState({ dismissed: [] });
  assert.deepEqual(reset.dismissed, []);
});

test('builds clear reasons for recommendations', () => {
  const reasons = buildRecommendationReasons(makeGame({ genre: 'Action', platform: 'PC', playtimeMinutes: 180, completionPercent: 25, status: 'Backlog', comments: [{ rating: 5 }] }), { score: 92 });
  assert.equal(reasons.length, 3);
  assert.match(reasons.join(' '), /Action|PC|Backlog|playtime|rating/i);
});
