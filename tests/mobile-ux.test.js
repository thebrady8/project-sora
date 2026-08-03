const assert = require('assert');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');

assert.ok(appJs.includes('role="option"'), 'app.js should expose search suggestions as keyboard-focusable options');
assert.ok(appJs.includes('tabindex="0"'), 'app.js should make suggestion items focusable');
assert.ok(appJs.includes("event.key === 'Enter'"), 'app.js should support Enter for suggestion selection');

console.log('Mobile UX regression test passed');
