'use strict';

const STATUS_ORDER = ['Playing', 'Backlog', 'Completed', 'Paused', 'Dropped', 'Wishlist'];
const OWNERSHIP_TYPES = new Set(['Owned', 'Subscription', 'Borrowed', 'Wishlist']);
const MEDIA_TYPES = new Set(['Physical', 'Digital', 'Unknown']);

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function normalizeLibraryEntry(entry = {}) {
  const completionPercent = clamp(entry.completionPercent || (entry.status === 'Completed' ? 100 : 0), 0, 100);
  const status = STATUS_ORDER.includes(entry.status) ? entry.status : (completionPercent >= 100 ? 'Completed' : 'Backlog');
  return {
    ...entry,
    id: String(entry.id || '').trim(),
    title: String(entry.title || 'Untitled game').trim().slice(0, 240),
    platform: String(entry.platform || 'Unknown platform').trim().slice(0, 120),
    status,
    ownershipStatus: OWNERSHIP_TYPES.has(entry.ownershipStatus) ? entry.ownershipStatus : 'Owned',
    mediaType: MEDIA_TYPES.has(entry.mediaType) ? entry.mediaType : 'Unknown',
    purchaseDate: /^\d{4}-\d{2}-\d{2}$/.test(String(entry.purchaseDate || '')) ? String(entry.purchaseDate) : '',
    playtimeMinutes: Math.round(clamp(entry.playtimeMinutes || Number(entry.playtimeHours || 0) * 60, 0, 10_000_000)),
    completionPercent,
    personalRating: clamp(entry.personalRating || entry.rating || 0, 0, 10),
    favorite: Boolean(entry.favorite),
    replayStatus: ['No', 'Maybe', 'Planned', 'Replaying'].includes(entry.replayStatus) ? entry.replayStatus : 'No',
    abandoned: status === 'Dropped' || Boolean(entry.abandoned),
    franchise: String(entry.franchise || inferFranchise(entry.title)).trim().slice(0, 160),
    genre: String(entry.genre || entry.notes || '').trim().slice(0, 160),
    estimatedHours: clamp(entry.estimatedHours || 0, 0, 10000),
    lastPlayedAt: String(entry.lastPlayedAt || '').slice(0, 40),
    completedAt: status === 'Completed' ? String(entry.completedAt || '').slice(0, 40) : null,
    achievements: normalizeAchievements(entry.achievements)
  };
}

function normalizeAchievements(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    finished: Boolean(source.finished),
    finalBoss: Boolean(source.finalBoss),
    collectedEverything: Boolean(source.collectedEverything),
    wantToReplay: Boolean(source.wantToReplay)
  };
}

function inferFranchise(title = '') {
  const cleaned = String(title).replace(/[™®:–—-].*$/, '').replace(/\b(?:ii|iii|iv|v|vi|vii|viii|ix|x|\d+)\b.*$/i, '').trim();
  return cleaned.length >= 3 ? cleaned : String(title || '').trim();
}

function buildLibraryStats(entries = []) {
  const games = entries.map(normalizeLibraryEntry);
  const completed = games.filter((game) => game.status === 'Completed').length;
  const playing = games.filter((game) => game.status === 'Playing').length;
  const backlog = games.filter((game) => game.status === 'Backlog').length;
  const dropped = games.filter((game) => game.status === 'Dropped').length;
  const favorites = games.filter((game) => game.favorite).length;
  const rated = games.filter((game) => game.personalRating > 0);
  const averageRating = rated.length ? rated.reduce((sum, game) => sum + game.personalRating, 0) / rated.length : 0;
  const completionAverage = games.length ? games.reduce((sum, game) => sum + game.completionPercent, 0) / games.length : 0;
  const totalMinutes = games.reduce((sum, game) => sum + game.playtimeMinutes, 0);
  const platformCounts = countBy(games, (game) => game.platform);
  const genreCounts = countBy(games, (game) => game.genre || 'Uncategorized');
  return {
    total: games.length,
    completed,
    playing,
    backlog,
    dropped,
    favorites,
    averageRating: Number(averageRating.toFixed(1)),
    completionAverage: Number(completionAverage.toFixed(1)),
    totalPlaytimeMinutes: totalMinutes,
    favoritePlatform: topKey(platformCounts),
    topGenre: topKey(genreCounts),
    platformCounts,
    genreCounts
  };
}

function countBy(entries, selector) {
  return entries.reduce((result, entry) => {
    const key = String(selector(entry) || 'Unknown');
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function topKey(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
}

function buildFranchiseCollections(entries = []) {
  const groups = new Map();
  for (const entry of entries.map(normalizeLibraryEntry)) {
    const key = entry.franchise || inferFranchise(entry.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.entries()]
    .filter(([, games]) => games.length >= 2)
    .map(([name, games]) => ({
      id: slugify(name),
      name: `${name} Collection`,
      total: games.length,
      completed: games.filter((game) => game.status === 'Completed').length,
      progress: Math.round((games.filter((game) => game.status === 'Completed').length / games.length) * 100),
      games: games.sort((a, b) => a.title.localeCompare(b.title))
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function buildSmartCollections(entries = []) {
  const games = entries.map(normalizeLibraryEntry);
  const collections = [
    ['favorites', 'Favorites', (game) => game.favorite],
    ['under-10-hours', 'Under 10 Hours', (game) => game.estimatedHours > 0 && game.estimatedHours <= 10],
    ['weekend', 'Weekend Games', (game) => game.estimatedHours >= 4 && game.estimatedHours <= 15 && game.status !== 'Completed'],
    ['story-rich', 'Story Rich', (game) => /story|narrative|rpg|adventure/i.test(game.genre)],
    ['hidden-gems', 'Hidden Gems', (game) => game.personalRating >= 8 && Number(game.metacriticScore || 0) < 80],
    ['finished-this-year', 'Finished This Year', (game) => new Date(game.completedAt || 0).getFullYear() === new Date().getFullYear()],
    ['backlog-under-5-hours', 'Backlog Under 5 Hours', (game) => game.status === 'Backlog' && game.estimatedHours > 0 && game.estimatedHours <= 5],
    ['replay-planned', 'Replay Planned', (game) => ['Planned', 'Replaying'].includes(game.replayStatus)]
  ];
  return collections.map(([id, name, predicate]) => ({ id, name, games: games.filter(predicate) })).filter((collection) => collection.games.length);
}

function buildBacklogPlan(entries = [], availableMinutes = 60) {
  const minutes = clamp(availableMinutes, 15, 1440);
  return entries.map(normalizeLibraryEntry)
    .filter((game) => !['Completed', 'Dropped'].includes(game.status))
    .map((game) => {
      const remaining = game.estimatedHours > 0 ? Math.max(15, Math.round(game.estimatedHours * 60 * (1 - game.completionPercent / 100))) : 180;
      const fit = 100 - Math.min(100, Math.abs(remaining - minutes) / Math.max(minutes, 1) * 60);
      const momentum = game.status === 'Playing' ? 22 : game.completionPercent > 0 ? 12 : 0;
      const favorite = game.favorite ? 10 : 0;
      const rating = game.personalRating * 2;
      return { game, score: fit + momentum + favorite + rating, remainingMinutes: remaining };
    })
    .sort((a, b) => b.score - a.score || a.remainingMinutes - b.remainingMinutes)
    .slice(0, 5)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

function buildGamingWrapped(entries = [], year = new Date().getFullYear()) {
  const games = entries.map(normalizeLibraryEntry);
  const completed = games.filter((game) => new Date(game.completedAt || 0).getFullYear() === year);
  const played = games.filter((game) => game.playtimeMinutes > 0);
  const topGenre = topKey(countBy(played, (game) => game.genre || 'Uncategorized'));
  const topPlatform = topKey(countBy(played, (game) => game.platform));
  const mostPlayed = [...played].sort((a, b) => b.playtimeMinutes - a.playtimeMinutes)[0] || null;
  const monthCounts = countBy(completed, (game) => new Date(game.completedAt).toLocaleString('en-US', { month: 'long' }));
  return {
    year,
    totalHours: Math.round(played.reduce((sum, game) => sum + game.playtimeMinutes, 0) / 60),
    gamesPlayed: played.length,
    completed: completed.length,
    topGenre,
    topPlatform,
    mostPlayed: mostPlayed ? { id: mostPlayed.id, title: mostPlayed.title, playtimeMinutes: mostPlayed.playtimeMinutes } : null,
    favoriteMonth: topKey(monthCounts)
  };
}

function buildMilestones(entries = [], reviewCount = 0) {
  const stats = buildLibraryStats(entries);
  const targets = [
    ['library-25', '25 Games', stats.total, 25],
    ['library-100', '100 Games', stats.total, 100],
    ['library-500', '500 Games', stats.total, 500],
    ['completed-25', '25 Completed', stats.completed, 25],
    ['completed-100', '100 Completed', stats.completed, 100],
    ['reviews-10', '10 Reviews', reviewCount, 10],
    ['favorites-25', '25 Favorites', stats.favorites, 25]
  ];
  return targets.map(([id, label, value, target]) => ({ id, label, value, target, completed: value >= target, progress: Math.min(100, Math.round(value / target * 100)) }));
}

function searchLibrary(entries = [], filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  return entries.map(normalizeLibraryEntry).filter((game) => {
    if (query && ![game.title, game.platform, game.genre, game.franchise].join(' ').toLowerCase().includes(query)) return false;
    if (filters.status && filters.status !== 'All' && game.status !== filters.status) return false;
    if (filters.platform && filters.platform !== 'All' && game.platform !== filters.platform) return false;
    if (filters.mediaType && filters.mediaType !== 'All' && game.mediaType !== filters.mediaType) return false;
    if (filters.ownershipStatus && filters.ownershipStatus !== 'All' && game.ownershipStatus !== filters.ownershipStatus) return false;
    if (filters.favorite === true && !game.favorite) return false;
    return true;
  });
}

function getImportAdapters() {
  return [
    { id: 'csv', label: 'CSV', status: 'ready', official: false },
    { id: 'manual', label: 'Manual entry', status: 'ready', official: false },
    { id: 'steam', label: 'Steam', status: 'skeleton', official: true },
    { id: 'playstation', label: 'PlayStation', status: 'skeleton', official: true },
    { id: 'xbox', label: 'Xbox', status: 'skeleton', official: true },
    { id: 'nintendo', label: 'Nintendo', status: 'skeleton', official: true }
  ];
}

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

module.exports = {
  normalizeLibraryEntry,
  buildLibraryStats,
  buildFranchiseCollections,
  buildSmartCollections,
  buildBacklogPlan,
  buildGamingWrapped,
  buildMilestones,
  searchLibrary,
  getImportAdapters,
  inferFranchise
};
