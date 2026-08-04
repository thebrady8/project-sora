import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('release carousel supports delegated desktop clicks, pointer swipes, and keyboard arrows', () => {
  assert.match(app, /initializeReleaseCarouselControls/);
  assert.match(app, /closest\('#releasePrevButton'\)/);
  assert.match(app, /closest\('#releaseNextButton'\)/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pointerup/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /ArrowRight/);
  assert.match(css, /touch-action:\s*pan-y pinch-zoom/);
  assert.match(css, /touch-action:\s*manipulation/);
});
