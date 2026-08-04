import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

assert.match(app, /let releaseRefreshPromise = null;/, 'release refreshes should be deduplicated');
assert.match(app, /if \(window\.location\.hash === '#upcoming\/calendar'\) \{\s*renderReleaseCalendarList\(\);/s, 'calendar page should rerender after the API response');
assert.match(app, /void refreshReleaseCalendar\(\);/, 'calendar route should request fresh release data');
assert.doesNotMatch(app, /async function refreshReleaseCalendar\(\) \{\s*const container[\s\S]{0,180}if \(!container\) \{\s*return;/, 'release fetching must not depend on the homepage carousel being present');
assert.match(sw, /const CACHE_VERSION = 'project-sora-[^']+';/, 'service worker should use a versioned Project Sora cache');
assert.match(sw, /const CACHE_VERSION = 'project-sora-[^']+-v\d+';/, 'service worker cache should be versioned');
console.log('Release calendar refresh regression test passed');
