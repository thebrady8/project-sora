import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('health, system status and client diagnostics skeletons are present', () => {
  assert.match(server, /\/api\/system\/status/);
  assert.match(server, /\/api\/client-errors/);
  assert.match(server, /client-errors\.json/);
  assert.match(server, /requestId/);
  assert.match(app, /reportClientDiagnostic/);
  assert.match(app, /unhandledrejection/);
});
