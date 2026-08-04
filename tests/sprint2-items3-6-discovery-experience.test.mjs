import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const app=fs.readFileSync('public/app.js','utf8'),html=fs.readFileSync('public/index.html','utf8'),server=fs.readFileSync('server.js','utf8'),css=fs.readFileSync('public/styles.css','utf8');
test('personalized home endpoint and rendering exist',()=>{assert.match(server,/\/api\/discovery\/home/);assert.match(app,/loadPersonalizedHomeFeed/);assert.match(app,/renderPersonalizedHomeFeed/)});
test('genre and platform hubs exist',()=>{assert.match(html,/genreHubList/);assert.match(html,/platformHubList/);assert.match(server,/\/api\/discovery\/hubs/);assert.match(app,/openDiscoveryHub/)});
test('visual collections use real catalog groupings',()=>{assert.match(server,/\/api\/discovery\/collections/);assert.match(html,/visualCollectionsGrid/);assert.match(app,/loadVisualCollections/)});
test('pagination and low bandwidth behavior exist',()=>{assert.match(app,/DISCOVERY_PAGE_SIZE/);assert.match(app,/isLowBandwidthMode/);assert.match(app,/saveData/);assert.match(app,/effectiveType/)});
test('mobile collection and hub styles exist',()=>{assert.match(css,/hub-result-grid/);assert.match(css,/visual-collections-grid/);assert.match(css,/@media\(max-width:640px\)/)});
