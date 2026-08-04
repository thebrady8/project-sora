import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

assert.ok(app.includes('function initializeDiscoveryControls()'), 'discovery controls initializer should exist');
assert.ok(app.includes("event.target.closest('#heroPrimaryAction')"), 'featured hero action should use delegated click handling');
assert.ok(app.includes("event.target.closest('#heroSecondaryAction')"), 'browse releases action should use delegated click handling');
assert.ok(app.includes("event.target.closest('.trending-collection[data-featured-id]')"), 'trending collection buttons should be clickable');
assert.ok(css.includes('pointer-events: none !important'), 'visual overlay layers should not intercept clicks');
assert.ok(css.includes('.trending-collection__copy'), 'trending collection copy should have clean layout styles');
assert.ok(css.includes('touch-action: manipulation'), 'interactive controls should support reliable touch activation');
assert.match(sw, /const CACHE_VERSION = 'project-sora-[^']+-v\d+';/, 'service worker cache should be versioned');
console.log('Discovery controls and polish test passed');
