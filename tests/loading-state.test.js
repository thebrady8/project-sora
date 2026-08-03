const assert = require('assert');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

assert.ok(appJs.includes('function renderLibrarySkeleton'), 'app.js should define a library skeleton renderer');
assert.ok(appJs.includes('function renderSearchSkeleton'), 'app.js should define a search skeleton renderer');
assert.ok(appJs.includes('function showReleaseCalendarSkeleton'), 'app.js should define a release calendar skeleton renderer');
assert.ok(appJs.includes('function renderDetailSkeleton'), 'app.js should define a detail skeleton renderer');
assert.ok(stylesCss.includes('.skeleton-card'), 'styles.css should include skeleton card styles');
assert.ok(stylesCss.includes('@media (prefers-reduced-motion: reduce)'), 'styles.css should respect reduced motion preferences');

console.log('Loading state test passed');
