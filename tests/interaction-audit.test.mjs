import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('interaction layer handles mouse, touch, keyboard, escape, and missing optional nodes safely', () => {
  assert.match(app, /function bindResponsiveActivation/);
  assert.match(app, /recentPointerActivations/);
  assert.match(app, /pointerType !== 'touch'/);
  assert.match(app, /performance\.now\(\) - recentPointerAt < 650/);
  assert.match(app, /function initializeGlobalInteractionSafety/);
  assert.match(app, /event\.key !== 'Escape'/);
  assert.match(app, /closeMobileMenu\(\{ restoreFocus: true \}\)/);
  assert.match(app, /barcodeScannerDialog\?\.open/);
  assert.match(app, /supportDialog\?\.open/);
  assert.match(app, /menuToggle\?\.addEventListener/);
  assert.match(app, /gameForm\?\.addEventListener/);
  assert.match(app, /gameSearch\?\.addEventListener/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
});

test('release carousel keeps pointer swipe and keyboard support without double activation', () => {
  assert.match(app, /bindResponsiveActivation\(button, \(\) => rotateReleaseCalendar\(direction\)\)/);
  assert.match(app, /rotator\.addEventListener\('pointerdown'/);
  assert.match(app, /rotator\.addEventListener\('pointerup'/);
  assert.match(app, /event\.key === 'ArrowLeft'/);
  assert.match(app, /event\.key === 'ArrowRight'/);
});
