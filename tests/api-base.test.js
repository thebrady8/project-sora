const assert = require('assert');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
assert.ok(
  !appJs.includes("const API_BASE = 'http://127.0.0.1:3000';"),
  'app.js should not hard-code the 127.0.0.1 host for API requests'
);

console.log('API base test passed');
