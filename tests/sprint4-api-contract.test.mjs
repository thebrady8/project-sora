import fs from 'node:fs';
import assert from 'node:assert/strict';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.match(server,/\/api\/library\/insights/);
assert.match(server,/\/api\/library\/search/);
assert.match(server,/\/api\/library\/import-adapters/);
assert.match(server,/buildFranchiseCollections/);
console.log('Sprint 4 API contract passed');
