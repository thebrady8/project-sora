const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLibraryEntry, buildLibraryStats } = require('../sprint4-library-engine.cjs');
test('Sprint 4 tracks user-managed achievements and collection statistics', () => {
 const game=normalizeLibraryEntry({id:'1',title:'A',platform:'PS5',genre:'RPG',playtimeMinutes:600,achievements:{finalBoss:true}});
 assert.equal(game.achievements.finalBoss,true);
 const stats=buildLibraryStats([game]);
 assert.equal(stats.totalPlaytimeMinutes,600);
 assert.equal(stats.favoritePlatform,'PS5');
});
