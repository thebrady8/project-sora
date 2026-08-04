import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('account form and main content have accessible semantics', () => {
  assert.match(html, /id="authUsername"/);
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /id="authUsernameStatus"[^>]+aria-live="polite"/);
  assert.match(html, /id="mainContent" tabindex="-1"/);
  assert.match(html, /class="skip-link"/);
});

test('safe areas, focus, touch targets and contrast preferences are supported', () => {
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /focus-visible/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-contrast: more/);
  assert.match(css, /font-size: 16px/);
});
