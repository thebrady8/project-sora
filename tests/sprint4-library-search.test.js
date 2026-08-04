const test = require('node:test');
const assert = require('node:assert/strict');
const { searchLibrary } = require('../sprint4-library-engine.cjs');
test('Sprint 4 collection search combines query and filters', () => {
 const games=[{id:'1',title:'Halo',platform:'Xbox',status:'Completed',mediaType:'Physical',favorite:true},{id:'2',title:'Mario',platform:'Switch',status:'Backlog'}];
 assert.equal(searchLibrary(games,{query:'halo',status:'Completed',favorite:true}).length,1);
 assert.equal(searchLibrary(games,{platform:'Switch'}).length,1);
});
