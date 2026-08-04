import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('Game Finder exposes swipe, button, keyboard, history, and quick-action controls', () => {
  assert.match(html, /id="gameFinderPage"/);
  assert.match(html, /id="gameFinderPassButton"/);
  assert.match(html, /id="gameFinderLikeButton"/);
  assert.match(html, /id="gameFinderStrongButton"/);
  assert.match(html, /id="gameFinderUndoButton"/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /pointerdown/);
  assert.match(app, /buildBaseFinderPreferences/);
  assert.match(app, /favoriteGameIds/);
  assert.match(app, /Add to Wishlist/);
  assert.match(css, /prefers-reduced-motion/);
});

test('Game Finder decisions are private and authenticated on the server', () => {
  assert.match(server, /\/api\/game-finder\/decision/);
  assert.match(server, /ensureAuthenticated/);
  assert.match(server, /GAME_FINDER_FILE/);
});
