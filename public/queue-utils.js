const QUEUE_STORAGE_KEY = 'gamevault-queue';

export function getQueueStorageKey() {
  return QUEUE_STORAGE_KEY;
}

export function getLocalQueueItems() {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalQueueItems(items) {
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
}

export function normalizeQueueEntry(entry, fallbackTitle = '') {
  const gameId = String(entry?.gameId || entry?.id || entry?.title || '').trim() || `queue-${String(fallbackTitle || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return {
    gameId,
    title: String(entry?.title || fallbackTitle || ''),
    platform: String(entry?.platform || ''),
    image: String(entry?.image || ''),
    status: String(entry?.status || 'Queued'),
    addedAt: String(entry?.addedAt || new Date().toISOString())
  };
}

export function reconcileQueueEntries(localItems = [], remoteItems = []) {
  const merged = [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(remoteItems) ? remoteItems : [])];
  const byGameId = new Map();
  merged.forEach((entry) => {
    const normalized = normalizeQueueEntry(entry, entry?.title || '');
    const existing = byGameId.get(normalized.gameId);
    if (!existing || (normalized.addedAt || '') > (existing.addedAt || '')) {
      byGameId.set(normalized.gameId, normalized);
    }
  });
  return Array.from(byGameId.values()).sort((left, right) => (left.addedAt || '').localeCompare(right.addedAt || ''));
}
