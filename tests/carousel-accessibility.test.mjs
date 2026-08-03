import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const html = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const appJs = readFileSync(path.join(publicDir, 'app.js'), 'utf8');

assert.ok(html.includes('id="upcomingReleaseRotator"'), 'The carousel container should exist in the markup.');
assert.ok(appJs.includes('aria-roledescription="carousel"'), 'The carousel should expose carousel semantics.');
assert.ok(appJs.includes('releaseAutoRotateEnabled = false'), 'Manual carousel navigation should pause auto-rotation.');

console.log('Carousel accessibility regression test passed');
