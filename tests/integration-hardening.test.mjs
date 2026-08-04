import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('external data integrations are hardened and transparent', () => {
  assert.match(server, /camera=\(self\)/);
  assert.doesNotMatch(server, /Access-Control-Allow-Origin': '\*'/);
  assert.match(server, /\/api\/integrations\/status/);
  assert.match(server, /htmlScrapingEnabled: false/);
  assert.match(server, /HTML scraping is disabled/);
  assert.match(server, /EXTERNAL_REQUEST_TIMEOUT_MS/);
  assert.match(server, /EXTERNAL_REQUEST_RETRIES/);
  assert.match(server, /sourceLabel: 'Public Steam Store data'/);
  assert.match(app, /loadIntegrationStatus/);
  assert.match(html, /Data source status/);
});
