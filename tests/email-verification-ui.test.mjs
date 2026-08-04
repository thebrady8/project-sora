import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('combined authentication and email verification UI are present', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(html, /id="authSubmitButton"/);
  assert.match(html, /id="emailVerificationPanel"/);
  assert.doesNotMatch(html, /id="registerButton"/);
  assert.match(app, /\/api\/auth\/verify-email/);
  assert.match(server, /RESEND_API_KEY/);
  assert.match(server, /ensureEmailVerified/);
});
