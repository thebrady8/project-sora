const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSmartCollections } = require('../sprint4-library-engine.cjs');
test('Sprint 4 smart collections update from metadata', () => {
  const result = buildSmartCollections([{id:'1',title:'Gem',personalRating:9,metacriticScore:70,favorite:true,status:'Backlog',estimatedHours:4}]);
  const ids = result.map((entry) => entry.id);
  assert.ok(ids.includes('favorites'));
  assert.ok(ids.includes('hidden-gems'));
  assert.ok(ids.includes('backlog-under-5-hours'));
});
