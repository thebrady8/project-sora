import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('server search is ranked, limited, and edition-aware', () => {
  assert.match(server, /rankCatalogEntries\(catalog, searchTerm, \{ limit \}\)/);
  assert.match(server, /Math\.min\(100/);
  assert.match(server, /availablePlatforms/);
  assert.match(server, /editionIds/);
});

test('client requests bounded search results and uses normalized deduplication', () => {
  assert.match(app, /\/api\/games\?search=\$\{encodeURIComponent\(query\)\}&limit=30/);
  assert.match(app, /normalizeSearchText\(title\)/);
  assert.match(app, /createSearchSuggestions\(GAME_CATALOG, value, 5\)/);
});
