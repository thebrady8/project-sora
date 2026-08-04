const test = require('node:test');
const assert = require('node:assert/strict');
const { getImportAdapters } = require('../sprint4-library-engine.cjs');
test('Sprint 4 import skeleton distinguishes ready and gated adapters', () => {
 const adapters=getImportAdapters();
 assert.equal(adapters.find((a)=>a.id==='csv').status,'ready');
 assert.equal(adapters.find((a)=>a.id==='steam').status,'skeleton');
});
