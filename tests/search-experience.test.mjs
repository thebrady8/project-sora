import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebouncedRequest } from '../public/search-utils.mjs';
import { createEmptySearchStateMarkup, createSearchResultMarkup, handleSuggestionKeyboard } from '../public/search-experience.mjs';

test('debounces rapid search requests', async () => {
  let callCount = 0;
  const controller = createDebouncedRequest(50);

  controller.schedule(() => {
    callCount += 1;
  });
  controller.schedule(() => {
    callCount += 1;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(callCount, 0);

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(callCount, 1);
});

test('ignores stale request ids once a newer request is active', () => {
  const controller = createDebouncedRequest(50);
  const firstRequest = controller.schedule(() => {});
  const secondRequest = controller.schedule(() => {});

  assert.equal(controller.isLatest(firstRequest), false);
  assert.equal(controller.isLatest(secondRequest), true);
});

test('supports keyboard navigation and escape handling for search results', () => {
  const firstItem = { classList: { toggle() {}, remove() {} }, dataset: {} };
  const secondItem = { classList: { toggle() {}, remove() {} }, dataset: {} };
  const items = [firstItem, secondItem];
  const container = {
    classList: {
      contains: () => false,
      add: () => {}
    },
    querySelectorAll: () => items
  };
  const activeIndexRef = { value: -1 };
  let selectedItem = null;

  const handled = handleSuggestionKeyboard({
    key: 'ArrowDown',
    preventDefault() {}
  }, container, activeIndexRef, '.result', (item) => {
    selectedItem = item;
  });

  assert.equal(handled, true);
  assert.equal(activeIndexRef.value, 0);

  const handledEscape = handleSuggestionKeyboard({
    key: 'Escape',
    preventDefault() {}
  }, container, activeIndexRef, '.result', () => {});

  assert.equal(handledEscape, true);
  assert.equal(activeIndexRef.value, -1);

  const handledEnter = handleSuggestionKeyboard({
    key: 'Enter',
    preventDefault() {}
  }, container, activeIndexRef, '.result', (item) => {
    selectedItem = item;
  });

  assert.equal(handledEnter, false);
  assert.equal(selectedItem, null);
});

test('renders friendly empty-state markup and highlights matching text', () => {
  const markup = createEmptySearchStateMarkup('No games found');
  assert.match(markup, /No games found/);
  assert.match(markup, /role="status"/);

  const resultMarkup = createSearchResultMarkup({
    title: 'The Legend of Zelda',
    subtitle: 'Nintendo Switch',
    id: 'zelda'
  }, 'game', 0, 'zelda');

  assert.match(resultMarkup, /<mark>zelda<\/mark>/i);
});
