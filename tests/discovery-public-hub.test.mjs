import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');

test('public discovery hub route exists without authentication', () => {
  assert.match(server, /url\.pathname === '\/api\/discovery\/hub'/);

  const routeStart = server.indexOf(
    "url.pathname === '/api/discovery/hub'"
  );
  const routeEnd = server.indexOf(
    "url.pathname === '/api/discovery/recommendations'",
    routeStart
  );
  const routeBlock = server.slice(routeStart, routeEnd);

  assert.doesNotMatch(routeBlock, /ensureAuthenticated/);
  assert.match(routeBlock, /platform/);
  assert.match(routeBlock, /genre/);
  assert.match(routeBlock, /buildRecommendations/);
});

test('frontend genre and platform hubs use the public route', () => {
  assert.match(app, /\/api\/discovery\/hub\?\$\{q\}/);
  assert.doesNotMatch(
    app.slice(
      app.indexOf('async function openDiscoveryHub'),
      app.indexOf('async function loadVisualCollections')
    ),
    /\/api\/discovery\/recommendations/
  );
});
