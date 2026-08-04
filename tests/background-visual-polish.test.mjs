import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

assert.ok(/placehold\\?\.co|placehold\.co/.test(app), 'placeholder-hosted artwork should be filtered');
assert.ok(app.includes('width >= 1000 && height >= 450'), 'background artwork should meet the higher quality threshold');
assert.ok(css.includes('opacity: 0.56'), 'background artwork should remain visible through a lighter overlay');
assert.ok(css.includes('backdrop-filter: blur(2px)'), 'overlay blur should be subtle');
assert.ok(css.includes('brightness(0.96)'), 'artwork should not be excessively darkened');
console.log('Background visual polish test passed');
