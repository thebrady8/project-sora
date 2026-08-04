const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFranchiseCollections } = require('../sprint4-library-engine.cjs');
test('Sprint 4 groups franchise collections and progress', () => {
  const result = buildFranchiseCollections([{id:'1',title:'Halo 2',franchise:'Halo',status:'Completed'},{id:'2',title:'Halo 3',franchise:'Halo',status:'Backlog'}]);
  assert.equal(result[0].total, 2);
  assert.equal(result[0].progress, 50);
});
