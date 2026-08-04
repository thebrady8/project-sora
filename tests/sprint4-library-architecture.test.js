const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLibraryEntry, buildLibraryStats } = require('../sprint4-library-engine.cjs');
test('Sprint 4 library architecture normalizes ownership and progress', () => {
  const game = normalizeLibraryEntry({ id:'1', title:'Test', status:'Completed', ownershipStatus:'Owned', mediaType:'Physical', personalRating:9, favorite:true });
  assert.equal(game.completionPercent, 100);
  assert.equal(game.mediaType, 'Physical');
  assert.equal(game.favorite, true);
  const stats = buildLibraryStats([game]);
  assert.equal(stats.completed, 1);
  assert.equal(stats.averageRating, 9);
});
