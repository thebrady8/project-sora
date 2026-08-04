import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidGtin, normalizeTitle, normalizePlatform } from '../scripts/import-open-barcodes.mjs';

test('validates standard GTIN checksums without inventing values', () => {
  assert.equal(isValidGtin('014633070224'), true);
  assert.equal(isValidGtin('4938833000491'), true);
  assert.equal(isValidGtin('123456789013'), false);
  assert.equal(isValidGtin('not-a-barcode'), false);
});

test('normalizes titles and common platforms conservatively', () => {
  assert.equal(normalizeTitle("Pokémon: Red Version"), 'pokemon red version');
  assert.equal(normalizePlatform('PS5'), 'playstation 5');
  assert.equal(normalizePlatform('Nintendo Switch'), 'nintendo switch');
});
