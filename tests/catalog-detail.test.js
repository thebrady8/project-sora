const assert = require('assert');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

assert.ok(appJs.includes('Add to library'), 'app.js should include the add-to-library action');
assert.ok(appJs.includes('Wishlist'), 'app.js should include the wishlist action');
assert.ok(stylesCss.includes('.detail-reviews'), 'styles.css should include review panel styles');

console.log('Catalog detail view test passed');
