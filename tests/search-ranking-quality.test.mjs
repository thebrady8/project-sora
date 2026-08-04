import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCatalogEntries, groupCatalogEditions, normalizeSearchText, createSearchSuggestions } from '../public/catalog-search.mjs';

const entries = [
  { id: '1', name: 'Resident Evil', platform: 'PlayStation', metacriticScore: 80 },
  { id: '2', name: 'Resident Evil', platform: 'PC', metacriticScore: 85 },
  { id: '3', name: 'Resident Evil Village', platform: 'Xbox', metacriticScore: 84 },
  { id: '4', name: 'The Evil Within', platform: 'PC', metacriticScore: 79 },
  { id: '5', name: 'Mario Kart 8 Deluxe', platform: 'Nintendo Switch', metacriticScore: 92 },
  { id: '6', name: 'Kart Racing Pro', platform: 'PC', metacriticScore: 70 }
];

test('normalizes punctuation, spacing, accents, and case', () => {
  assert.equal(normalizeSearchText('  Pokémon:  Legends! '), 'pokemon legends');
});

test('ranks exact and prefix title matches ahead of loose matches', () => {
  const results = rankCatalogEntries(entries, 'resident evil', { limit: 10 });
  assert.equal(results[0].name, 'Resident Evil');
  assert.equal(results[1].name, 'Resident Evil Village');
  assert.ok(results.findIndex((entry) => entry.name === 'The Evil Within') > 1);
});

test('groups platform editions without losing platform metadata', () => {
  const grouped = groupCatalogEditions(entries);
  const resident = grouped.find((entry) => entry.name === 'Resident Evil');
  assert.deepEqual(resident.availablePlatforms.sort(), ['PC', 'PlayStation']);
  assert.deepEqual(resident.editionIds.sort(), ['1', '2']);
});

test('supports platform and genre searches and respects result limits', () => {
  const platformResults = rankCatalogEntries(entries, 'nintendo switch', { limit: 2 });
  assert.equal(platformResults[0].name, 'Mario Kart 8 Deluxe');
  const suggestions = createSearchSuggestions(entries, 'kart', 1);
  assert.equal(suggestions.length, 1);
  assert.match(suggestions[0].name, /Kart/i);
});
