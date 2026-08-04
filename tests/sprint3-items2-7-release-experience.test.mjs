import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getReleaseCountdown, groupReleasesByMonth, normalizeReminderPreferences, reminderIsDue, matchCoverageForRelease } from '../public/release-experience.mjs';

test('countdowns and month grouping use hard dates', () => {
  assert.equal(getReleaseCountdown('2026-08-05', new Date('2026-08-04T12:00:00Z')).label, 'Releases tomorrow');
  assert.equal(getReleaseCountdown('Coming Soon').state, 'unknown');
  const groups = groupReleasesByMonth([{ title: 'B', releaseDate: '2026-09-02' }, { title: 'A', releaseDate: '2026-08-10' }]);
  assert.deepEqual(groups.map((g) => g.key), ['2026-08', '2026-09']);
});

test('reminder preferences are bounded and due calculations are deterministic', () => {
  assert.deepEqual(normalizeReminderPreferences({ offsets: [99, 7, 1, 1] }).offsets, [7, 1]);
  assert.equal(reminderIsDue('2026-08-11', { enabled: true, offsetDays: 7 }, new Date('2026-08-04T12:00:00Z')), true);
});

test('coverage is matched to the release title', () => {
  const result = matchCoverageForRelease({ title: 'Resident Evil Requiem' }, [
    { title: 'Resident Evil Requiem hands-on preview' },
    { title: 'Unrelated racing game review' }
  ]);
  assert.equal(result.length, 1);
});

test('server exposes reminder endpoints and frontend renders reminder controls', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /\/api\/release-reminders/);
  assert.match(app, /data-release-action="reminder"/);
  assert.match(app, /groupReleasesByMonth/);
  assert.match(app, /Price tracking will appear when a verified store provider is connected/);
});

test('service worker cache is updated for Sprint 3', () => {
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /project-sora-sprint4-v2/);
});
