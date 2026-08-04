import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReleaseTrustSummary, isTrustedReleaseItem, normalizeCoverageArticle } from '../public/release-trust.mjs';

test('release trust summary reports stale state and hard-date coverage', () => {
  const now = Date.parse('2026-08-04T12:00:00Z');
  const summary = buildReleaseTrustSummary({
    updatedAt: '2026-08-04T11:30:00Z', ttlMs: 3600000,
    sourceLabel: 'Public Steam Store data', sourceType: 'public-structured-endpoint',
    items: [{ hardDate: true, releaseTimestamp: now + 86400000 }]
  }, now);
  assert.equal(summary.stale, false);
  assert.equal(summary.hardDateCount, 1);
  assert.equal(summary.verifiedProviderApi, false);
});

test('release trust rejects undated or unsafe release records', () => {
  const now = Date.parse('2026-08-04T12:00:00Z');
  assert.equal(isTrustedReleaseItem({ title:'Valid', hardDate:true, releaseTimestamp:now+86400000, link:'https://store.steampowered.com/app/1/' }, now), true);
  assert.equal(isTrustedReleaseItem({ title:'TBA', hardDate:false, releaseTimestamp:now+86400000, link:'https://example.com' }, now), false);
  assert.equal(isTrustedReleaseItem({ title:'Unsafe', hardDate:true, releaseTimestamp:now+86400000, link:'javascript:alert(1)' }, now), false);
});

test('coverage normalization enforces weekly freshness and https links', () => {
  const now = Date.parse('2026-08-04T12:00:00Z');
  const valid = normalizeCoverageArticle({ title:'Review', link:'https://ign.com/article', source:'IGN', publishedAt:'2026-08-03T12:00:00Z' }, now);
  assert.ok(valid);
  assert.match(valid.attribution, /publisher/);
  assert.equal(normalizeCoverageArticle({ title:'Old', link:'https://ign.com/old', publishedAt:'2026-07-01T12:00:00Z' }, now), null);
});

test('server and UI expose release source transparency', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(server, /\/api\/releases\/status/);
  assert.ok(server.includes("This is not Valve's guaranteed Steam Web API"));
  assert.match(app, /refreshReleaseTrustStatus/);
  assert.match(html, /releaseTrustStatus/);
});
