import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCatalogDetail, isUsableArtworkUrl, formatCatalogRelease } from '../public/catalog-detail-utils.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
assert.equal(catalog.length, 16500);

for (const entry of catalog) {
  const detail = normalizeCatalogDetail(entry);
  assert.ok(detail.id, 'every detail record needs an id');
  assert.ok(detail.title, 'every detail record needs a title');
  assert.ok(detail.platform, 'every detail record needs a platform fallback');
  assert.ok(['complete', 'partial'].includes(detail.metadataStatus));
  assert.ok(Array.isArray(detail.missingMetadata));
}

assert.equal(isUsableArtworkUrl('https://placehold.co/72x72?text=Game'), false);
assert.equal(isUsableArtworkUrl('https://cdn.example.com/cover.jpg'), true);
assert.equal(formatCatalogRelease(null), 'Release date unavailable');
assert.equal(normalizeCatalogDetail({ name: 'Test Game' }).userScore, null, 'missing scores must not be invented');
assert.equal(normalizeCatalogDetail({ name: 'Test Game' }).release, null, 'missing dates must not be invented');

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
assert.ok(app.includes('No community reviews have been submitted'), 'detail page should not show fabricated reviews');
assert.ok(app.includes('Catalog data is incomplete'), 'detail page should disclose incomplete metadata');
assert.ok(!app.includes("selectedEntry.userScore || 89"), 'detail page must not invent a user score');
assert.ok(!app.includes("|| '2025-02-25'"), 'detail page must not invent a release date');

console.log('Catalog detail reliability test passed');
