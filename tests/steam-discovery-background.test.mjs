import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

assert.ok(app.includes('preloadSharpBackgroundCover'), 'high-resolution artwork preloading should exist');
assert.ok(app.includes('width >= 1000 && height >= 450'), 'low-resolution artwork should be rejected');
assert.ok(app.includes('12000 + Math.floor(Math.random() * 3001)'), 'rotation should use a 12–15 second interval');
assert.ok(app.includes('placehold\\.co|placeholder|text=') || app.includes('placehold\.co|placeholder|text='), 'placeholder artwork URLs should be rejected');
assert.ok(app.includes('shuffledWithoutImmediateRepeat'), 'consecutive cover sets should avoid repeats');
assert.ok(app.includes('setupBackgroundParallax'), 'parallax behavior should be initialized');
assert.ok(app.includes('buildTrendingCollections'), 'trending collections should be generated dynamically');
assert.ok(app.includes('renderDiscoveryHero'), 'featured landing hero should be rendered dynamically');
assert.ok(css.includes('backdrop-filter: blur(2px)'), 'background should include a dark blur overlay');
assert.ok(css.includes('.discovery-hero'), 'discovery hero styles should exist');
assert.ok(css.includes('.trending-collections'), 'trending collection styles should exist');
assert.ok(html.includes('id="discoveryHero"'), 'landing hero markup should exist');
assert.ok(html.includes('id="trendingCollections"'), 'trending collection markup should exist');
assert.ok(sw.includes('project-sora-closed-beta-v18'), 'service worker cache should be bumped');
console.log('Steam discovery background test passed');
