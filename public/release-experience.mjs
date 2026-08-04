export const REMINDER_OFFSETS = Object.freeze([0, 1, 3, 7, 14, 30]);

export function parseHardReleaseDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) return null;
  const date = new Date(text.length === 10 ? `${text}T12:00:00Z` : text);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getReleaseCountdown(value, now = new Date()) {
  const date = parseHardReleaseDate(value);
  const current = now instanceof Date ? now : new Date(now);
  if (!date || !Number.isFinite(current.getTime())) return { state: 'unknown', label: 'Date unavailable', days: null };
  const diff = date.getTime() - current.getTime();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return { state: 'released', label: 'Released', days };
  if (days === 0) return { state: 'today', label: 'Releases today', days: 0 };
  if (days === 1) return { state: 'tomorrow', label: 'Releases tomorrow', days: 1 };
  return { state: 'upcoming', label: `Releases in ${days} days`, days };
}

export function groupReleasesByMonth(items = []) {
  const groups = new Map();
  for (const item of items) {
    const date = parseHardReleaseDate(item?.releaseDate || item?.release);
    if (!date) continue;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, entries]) => ({
    key,
    label: new Date(`${key}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    items: [...entries].sort((a, b) => parseHardReleaseDate(a.releaseDate || a.release) - parseHardReleaseDate(b.releaseDate || b.release))
  }));
}

export function normalizeReminderPreferences(value = {}) {
  const offsets = Array.isArray(value.offsets) ? value.offsets : [7, 1, 0];
  return {
    enabled: value.enabled !== false,
    offsets: [...new Set(offsets.map(Number).filter((entry) => REMINDER_OFFSETS.includes(entry)))].sort((a, b) => b - a),
    wishlistReleaseDay: value.wishlistReleaseDay !== false,
    browserNotifications: Boolean(value.browserNotifications)
  };
}

export function reminderIsDue(releaseDate, reminder, now = new Date()) {
  const date = parseHardReleaseDate(releaseDate);
  if (!date || !reminder?.enabled) return false;
  const current = now instanceof Date ? now : new Date(now);
  const offset = Number(reminder.offsetDays || 0);
  const target = new Date(date.getTime() - offset * 86400000);
  return current >= target && current < new Date(target.getTime() + 86400000);
}

export function matchCoverageForRelease(release, articles = [], limit = 4) {
  const title = String(release?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!title) return [];
  const words = title.split(/\s+/).filter((word) => word.length > 2);
  return articles.filter((article) => {
    const haystack = `${article?.title || ''} ${article?.matchedTitle || ''}`.toLowerCase();
    return words.length > 0 && words.filter((word) => haystack.includes(word)).length >= Math.min(2, words.length);
  }).slice(0, limit);
}
