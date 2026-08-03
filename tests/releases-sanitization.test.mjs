import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const appJs = readFileSync(path.join(publicDir, 'app.js'), 'utf8');

assert.ok(appJs.includes('escapeHtml(hero.title'), 'Release rendering should escape hero title content.');
assert.ok(appJs.includes('escapeHtml(hero.blurb'), 'Release rendering should escape hero blurb content.');
assert.ok(appJs.includes('escapeHtml(item.title'), 'Release rendering should escape list item title content.');

console.log('Release sanitization regression test passed');
