import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const server=fs.readFileSync(new URL('../server.js', import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js', import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
test('platform accounts are sanitized and rendered as profile badges',()=>{
 assert.match(server,/sanitizePlatformAccounts/); assert.match(server,/filterVisiblePlatformAccounts/);
 assert.match(app,/platform-badges/); assert.match(html,/Connected gaming accounts/);
});
