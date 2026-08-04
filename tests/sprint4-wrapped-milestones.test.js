const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGamingWrapped, buildMilestones } = require('../sprint4-library-engine.cjs');
test('Sprint 4 builds Wrapped and milestones', () => {
 const year=new Date().getFullYear();
 const games=[{id:'1',title:'A',playtimeMinutes:600,status:'Completed',completedAt:`${year}-01-02T00:00:00Z`,genre:'RPG'}];
 assert.equal(buildGamingWrapped(games,year).completed,1);
 assert.ok(buildMilestones(games).some((item)=>item.id==='library-25'));
});
