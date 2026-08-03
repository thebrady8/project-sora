export function newGameId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return `game-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatPlaytime(minutes) {
  const totalMinutes = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export const PLAY_STATUS_OPTIONS = ['Backlog', 'Playing', 'Paused', 'Completed', 'Dropped'];

export function normalizePlayStatus(value, completionPercent = 0) {
  const candidate = String(value || '').trim();
  if (PLAY_STATUS_OPTIONS.includes(candidate)) {
    return candidate;
  }

  return Number(completionPercent || 0) >= 100 ? 'Completed' : 'Backlog';
}

export function normalizeCompletedAt(game, status) {
  if (status === 'Completed') {
    return typeof game?.completedAt === 'string' && game.completedAt.trim() ? game.completedAt : new Date().toISOString();
  }

  return null;
}

export function normalizeGame(game) {
  const safeGame = game || {};
  const status = normalizePlayStatus(safeGame.status, Number(safeGame.completionPercent || 0));
  return {
    ...safeGame,
    id: safeGame.id || newGameId(),
    comments: Array.isArray(safeGame.comments) ? safeGame.comments : [],
    metacriticScore: safeGame.metacriticScore ?? 'N/A',
    coverImage: safeGame.coverImage || '',
    playtimeMinutes: Number(safeGame.playtimeMinutes || 0),
    completionPercent: Number(safeGame.completionPercent || 0),
    status,
    completedAt: normalizeCompletedAt(safeGame, status)
  };
}
