import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnonymousSessionState } from '../public/library-view-utils.mjs';

test('anonymous session state clears profile, friend, queue, wishlist, and notification state', () => {
  const state = createAnonymousSessionState();

  assert.equal(state.activeLibraryOwner, null);
  assert.deepEqual(state.friendsState, { friends: [], incoming: [], outgoing: [] });
  assert.deepEqual(state.notifications, []);
  assert.deepEqual(state.activityItems, []);
  assert.deepEqual(state.queueItems, []);
  assert.deepEqual(state.wishlistItems, []);
});
