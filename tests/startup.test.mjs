import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const appJs = readFileSync(path.join(publicDir, 'app.js'), 'utf8');

assert.ok(appJs.includes('async function initializeApp()'), 'The app should define a safe startup initializer.');
assert.ok(appJs.includes('setSyncStatus(\'Application ready.\'') || appJs.includes('Application ready.'), 'The initializer should report a successful startup state.');

console.log('Startup regression test passed');
