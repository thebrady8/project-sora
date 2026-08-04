import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import { createRequire } from 'node:module';
const require=createRequire(import.meta.url); const {buildRecommendations}=require('../discovery-engine.cjs');
const app=fs.readFileSync('public/app.js','utf8'); const html=fs.readFileSync('public/index.html','utf8'); const server=fs.readFileSync('server.js','utf8');
test('preference controls and API skeleton exist',()=>{assert.match(html,/gameFinderMuteGenreButton/);assert.match(app,/saveGameFinderPreferences/);assert.match(server,/\/api\/game-finder\/preferences/)});
test('muted genres are excluded',()=>{const out=buildRecommendations([{id:'1',name:'A',genre:'Sports',platform:'PC'},{id:'2',name:'B',genre:'RPG',platform:'PC'}],{preferences:{mutedGenres:['sports']}},{limit:10});assert.deepEqual(out.items.map(x=>x.id),['2'])});
