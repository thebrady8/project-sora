import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('API errors are translated into friendly user-facing messages', () => {
  assert.match(app, /function getFriendlyApiError/);
  assert.match(app, /Project Sora ran into a temporary problem/);
  assert.match(app, /Unable to reach Project Sora/);
  assert.doesNotMatch(app, /throw new Error\(data\.error \|\| `Request failed/);
});
