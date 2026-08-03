import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const html = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const appJs = readFileSync(path.join(publicDir, 'app.js'), 'utf8');

assert.ok(html.includes('id="syncStatus"'), 'The UI should include a sync status element.');
assert.ok(appJs.includes('function setSyncStatus'), 'The app should expose a sync status helper.');
assert.ok(appJs.includes('syncLibraryToServer'), 'The app should route sync state through the sync helper.');

console.log('Sync status regression test passed');
