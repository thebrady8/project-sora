import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPreferenceProfile, buildRecommendations, scoreCandidate } = require('../discovery-engine.cjs');

const catalog = [
  { id: 'rpg-1', name: 'Dragon Realm', platform: 'PC', genre: 'RPG; Adventure', publisher: 'Studio A', metacriticScore: 92, globalSales: 8 },
  { id: 'rpg-2', name: 'Dragon Realm', platform: 'PlayStation 5', genre: 'RPG; Adventure', publisher: 'Studio A', metacriticScore: 91, globalSales: 7 },
  { id: 'rpg-3', name: 'Kingdom Quest', platform: 'PC', genre: 'RPG', publisher: 'Studio A', metacriticScore: 88, globalSales: 4 },
  { id: 'race-1', name: 'Turbo Track', platform: 'PC', genre: 'Racing', publisher: 'Studio B', metacriticScore: 84, globalSales: 5 },
  { id: 'puzzle-1', name: 'Quiet Blocks', platform: 'Nintendo Switch', genre: 'Puzzle', publisher: 'Studio C', metacriticScore: 78, globalSales: 1 },
  { id: 'action-1', name: 'Steel Hero', platform: 'Xbox Series X|S', genre: 'Action', publisher: 'Studio D', metacriticScore: 89, globalSales: 6 },
  { id: 'sim-1', name: 'Cozy Fields', platform: 'PC', genre: 'Simulation', publisher: 'Studio E', metacriticScore: 81, globalSales: 3 }
];

test('personal taste signals raise matching genres and platforms', () => {
  const profile = buildPreferenceProfile({
    catalog,
    library: [{ title: 'Kingdom Quest', platform: 'PC', userRating: 9, status: 'Completed' }],
    wishlist: [], favoriteGameIds: ['rpg-1'], decisions: []
  });
  const rpg = scoreCandidate(catalog[0], profile);
  const racing = scoreCandidate(catalog[3], profile);
  assert.ok(rpg.recommendationScore > racing.recommendationScore);
  assert.ok(rpg.matchPercent > racing.matchPercent);
  assert.match(rpg.recommendationReasons.join(' '), /RPG/i);
});

test('owned, wishlisted, and decided games are excluded by default', () => {
  const result = buildRecommendations(catalog, {
    library: [{ title: 'Kingdom Quest', platform: 'PC' }],
    wishlist: [{ title: 'Turbo Track', platform: 'PC' }],
    favoriteGameIds: [],
    decisions: [{ gameId: 'action-1', title: 'Steel Hero', action: 'pass' }]
  }, { limit: 20 });
  const ids = result.items.map((item) => item.id);
  assert.ok(!ids.includes('rpg-3'));
  assert.ok(!ids.includes('race-1'));
  assert.ok(!ids.includes('action-1'));
});

test('duplicate platform editions are grouped to one title', () => {
  const result = buildRecommendations(catalog, {}, { limit: 20 });
  assert.equal(result.items.filter((item) => item.name === 'Dragon Realm').length, 1);
});

test('recommendations are explainable and match percentages are bounded', () => {
  const result = buildRecommendations(catalog, { favoriteGameIds: ['rpg-1'] }, { limit: 5 });
  assert.ok(result.items.length > 0);
  result.items.forEach((item) => {
    assert.ok(item.matchPercent >= 50 && item.matchPercent <= 98);
    assert.ok(Array.isArray(item.recommendationReasons) && item.recommendationReasons.length > 0);
    assert.equal(typeof item.scoreBreakdown, 'object');
  });
});

test('pagination is stable and returns a next cursor', () => {
  const page1 = buildRecommendations(catalog, {}, { limit: 2, cursor: 0 });
  const page2 = buildRecommendations(catalog, {}, { limit: 2, cursor: page1.nextCursor });
  assert.equal(page1.items.length, 2);
  assert.equal(page2.items.length, 2);
  assert.equal(new Set([...page1.items, ...page2.items].map((item) => item.id)).size, 4);
});

test('cold start is clearly identified and quality weighted', () => {
  const result = buildRecommendations(catalog, {}, { limit: 3 });
  assert.equal(result.profile.coldStart, true);
  assert.ok(result.items[0].metacriticScore >= result.items[2].metacriticScore || result.items[0].globalSales >= result.items[2].globalSales);
  assert.match(result.items[0].recommendationReasons.join(' '), /rated|diverse|reviewed/i);
});
