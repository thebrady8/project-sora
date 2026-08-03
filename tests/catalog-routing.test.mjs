import assert from 'node:assert/strict';
import { createCatalogSlug, findCatalogEntryBySlug } from '../public/catalog-routing.mjs';

const catalog = [{ name: 'The Witcher 3' }, { name: 'Portal 2' }];
assert.equal(createCatalogSlug('The Witcher 3'), 'the-witcher-3');
assert.equal(createCatalogSlug('Portal 2'), 'portal-2');
assert.deepEqual(findCatalogEntryBySlug(catalog, 'the-witcher-3'), catalog[0]);
assert.equal(findCatalogEntryBySlug(catalog, 'unknown'), null);

console.log('Catalog routing test passed');
