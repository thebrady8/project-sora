import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLibraryOwner, canEditViewedLibrary } from '../public/library-view-utils.mjs';

test('resolveLibraryOwner uses the active profile when browsing another user', () => {
  assert.equal(resolveLibraryOwner('viewer@example.com', 'friend@example.com'), 'friend@example.com');
  assert.equal(resolveLibraryOwner('viewer@example.com', null), 'viewer@example.com');
});

test('canEditViewedLibrary blocks edits when browsing another user', () => {
  assert.equal(canEditViewedLibrary('viewer@example.com', 'friend@example.com'), false);
  assert.equal(canEditViewedLibrary('viewer@example.com', null), true);
  assert.equal(canEditViewedLibrary('viewer@example.com', 'viewer@example.com'), true);
});
