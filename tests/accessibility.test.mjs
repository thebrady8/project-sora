import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const html = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const appJs = readFileSync(path.join(publicDir, 'app.js'), 'utf8');

function expectIncludes(haystack, needle, message) {
  assert.ok(haystack.includes(needle), message);
}

try {
  expectIncludes(html, 'class="skip-link"', 'The page should include a skip link for keyboard users.');
  expectIncludes(html, 'id="mainContent"', 'The main content region should be targetable by the skip link.');
  expectIncludes(html, 'aria-controls="sideMenu"', 'The menu toggle should expose its relationship to the sidebar.');
  expectIncludes(html, 'role="listbox"', 'Search result containers should expose a listbox role.');
  expectIncludes(appJs, 'aria-expanded', 'The app should update the menu button expansion state.');
  console.log('Accessibility regression test passed');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
