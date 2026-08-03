import assert from 'node:assert/strict';
import { createDebouncedRequest } from '../public/search-utils.mjs';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const debounced = createDebouncedRequest(20);
let runCount = 0;
let latestRequestId = null;

debounced.schedule((requestId) => {
  runCount += 1;
  latestRequestId = requestId;
});

debounced.schedule((requestId) => {
  runCount += 1;
  latestRequestId = requestId;
});

await delay(50);
assert.equal(runCount, 1);
assert.equal(latestRequestId, 2);

console.log('Search debounce test passed');
