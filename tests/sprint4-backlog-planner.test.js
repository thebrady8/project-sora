const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBacklogPlan } = require('../sprint4-library-engine.cjs');
test('Sprint 4 backlog planner favors a session fit', () => {
  const result = buildBacklogPlan([{id:'1',title:'Short',status:'Backlog',estimatedHours:1},{id:'2',title:'Long',status:'Backlog',estimatedHours:40}],60);
  assert.equal(result[0].game.title, 'Short');
});
