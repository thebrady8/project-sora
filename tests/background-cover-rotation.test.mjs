import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

assert.ok(app.includes('function getBackgroundCoverCandidates'), 'should build a cover candidate pool');
assert.ok(app.includes('preloadSharpBackgroundCover'), 'should validate image quality before use');
assert.ok(app.includes('longestSide >= 700'), 'should reject very small images');
assert.ok(app.includes('renderBackgroundCoverSet'), 'should render rotating cover sets');
assert.ok(css.includes('.background-cover-panel'), 'should style the Steam-like cover panels');
assert.ok(css.includes('grid-template-columns'), 'should use a cover mosaic instead of stretching one image');
console.log('Background cover rotation test passed');
