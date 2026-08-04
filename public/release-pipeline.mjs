export const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeReleaseQueue(items = [], options = {}) {
  const now = Number(options.now ?? Date.now());
  const horizonDays = Number(options.horizonDays ?? 365);
  const minTimestamp = now - DAY_MS;
  const maxTimestamp = now + (horizonDays * DAY_MS);
  const seen = new Set();

  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item) => ({ ...item, releaseTimestamp: Number(item.releaseTimestamp) }))
    .filter((item) => Number.isFinite(item.releaseTimestamp))
    .filter((item) => item.releaseTimestamp >= minTimestamp && item.releaseTimestamp <= maxTimestamp)
    .filter((item) => {
      const key = String(item.id || `${item.title || ''}::${item.platform || ''}`).trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.releaseTimestamp - b.releaseTimestamp || String(a.title || '').localeCompare(String(b.title || '')));
}

export function advanceReleaseIndex(currentIndex, direction, itemCount) {
  const count = Number(itemCount || 0);
  if (!Number.isInteger(count) || count <= 0) return 0;
  const current = Number.isFinite(Number(currentIndex)) ? Number(currentIndex) : 0;
  const step = Number(direction || 1);
  return ((current + step) % count + count) % count;
}

export function filterReleaseQueueByPlatform(items = [], selection = 'All') {
  const selected = String(selection || 'All').trim().toLowerCase();
  if (selected === 'all') return [...items];
  return items.filter((item) => {
    const platform = String(item.platform || item.source || '').toLowerCase();
    const source = String(item.source || '').toLowerCase();
    if (selected === 'steam') {
      return platform.includes('windows') || platform.includes('linux') || platform.includes('mac') || platform.includes('pc') || source === 'steam';
    }
    return platform.includes(selected);
  });
}
