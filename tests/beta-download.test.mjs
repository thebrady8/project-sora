import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const html = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const serverJs = readFileSync(path.join(rootDir, 'server.js'), 'utf8');

assert.ok(!html.includes('/downloads/beta-build'), 'The UI should no longer expose the beta ZIP download URL.');
assert.ok(!serverJs.includes('/downloads/beta-build') && !serverJs.includes('beta-test-build.zip'), 'The server should not expose a beta ZIP download route.');

console.log('Beta download regression test passed');
