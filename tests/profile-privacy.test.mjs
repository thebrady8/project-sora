import assert from 'node:assert/strict';
import { createPublicHandle } from '../public/profile-privacy.mjs';

const handle = createPublicHandle('player@example.com');
assert.equal(handle.startsWith('user-'), true);
assert.equal(handle.includes('@'), false);
assert.equal(createPublicHandle('player@example.com'), handle);
assert.notEqual(handle, 'player@example.com');

console.log('Profile privacy test passed');
