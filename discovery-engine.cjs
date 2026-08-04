'use strict';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function splitTags(value) {
  return String(value || '')
    .split(/[,/|;]/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function addWeight(target, key, amount) {
  if (!key || !Number.isFinite(Number(amount))) return;
  target[key] = clamp(Number(target[key] || 0) + Number(amount), -12, 18);
}

function findCatalogMatch(catalog, item) {
  const id = String(item?.catalogGameId || item?.gameId || item?.id || '').trim();
  if (id) {
    const byId = catalog.find((entry) => String(entry.id || '') === id);
    if (byId) return byId;
  }
  const title = normalizeText(item?.title || item?.name);
  const platform = normalizeText(item?.platform);
  return catalog.find((entry) => normalizeText(entry.name || entry.title) === title && (!platform || normalizeText(entry.platform) === platform))
    || catalog.find((entry) => normalizeText(entry.name || entry.title) === title)
    || null;
}

function buildPreferenceProfile({ catalog = [], library = [], wishlist = [], favoriteGameIds = [], decisions = [], preferences = {} } = {}) {
  const genreWeights = {};
  const platformWeights = {};
  const publisherWeights = {};
  const positiveTitles = new Set();
  const negativeTitles = new Set();

  for (const item of library) {
    const game = findCatalogMatch(catalog, item) || item;
    const rating = Number(item.userRating ?? item.rating ?? item.metacriticScore ?? 0);
    const completed = item.status === 'Completed' || Number(item.completionPercent || 0) >= 100;
    const playtimeHours = Number(item.playtimeMinutes || 0) / 60;
    const base = rating >= 8 && rating <= 10 ? 4 : rating >= 80 ? 4 : completed ? 2.5 : playtimeHours >= 10 ? 1.75 : 0.8;
    splitTags(game.genre).forEach((tag) => addWeight(genreWeights, tag, base));
    addWeight(platformWeights, normalizeText(item.platform || game.platform), completed ? 2 : 1);
    addWeight(publisherWeights, normalizeText(game.publisher), base * 0.4);
    const title = normalizeText(game.name || item.title);
    if (title && (rating >= 8 || rating >= 80 || completed)) positiveTitles.add(title);
  }

  for (const item of wishlist) {
    const game = findCatalogMatch(catalog, item) || item;
    splitTags(game.genre).forEach((tag) => addWeight(genreWeights, tag, 1.5));
    addWeight(platformWeights, normalizeText(item.platform || game.platform), 0.75);
    addWeight(publisherWeights, normalizeText(game.publisher), 0.4);
  }

  for (const id of favoriteGameIds) {
    const game = catalog.find((entry) => String(entry.id || '') === String(id || ''));
    if (!game) continue;
    splitTags(game.genre).forEach((tag) => addWeight(genreWeights, tag, 5));
    addWeight(platformWeights, normalizeText(game.platform), 2.5);
    addWeight(publisherWeights, normalizeText(game.publisher), 1.5);
    positiveTitles.add(normalizeText(game.name));
  }

  for (const decision of decisions) {
    const game = findCatalogMatch(catalog, decision) || decision;
    const action = String(decision.action || '').toLowerCase();
    const amount = action === 'strong' ? 3.5 : action === 'like' ? 1.75 : action === 'pass' ? -1 : 0;
    splitTags(game.genre).forEach((tag) => addWeight(genreWeights, tag, amount));
    addWeight(platformWeights, normalizeText(game.platform || decision.platform), amount * 0.55);
    addWeight(publisherWeights, normalizeText(game.publisher), amount * 0.35);
    const title = normalizeText(game.name || decision.title);
    if (title && amount > 0) positiveTitles.add(title);
    if (title && amount < 0) negativeTitles.add(title);
  }

  const topKeys = (weights, count = 4) => Object.entries(weights)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([key]) => key);

  const mutedGenres = new Set((Array.isArray(preferences.mutedGenres) ? preferences.mutedGenres : []).map(normalizeText).filter(Boolean));
  const mutedPlatforms = new Set((Array.isArray(preferences.mutedPlatforms) ? preferences.mutedPlatforms : []).map(normalizeText).filter(Boolean));
  return {
    genreWeights,
    platformWeights,
    publisherWeights,
    positiveTitles,
    negativeTitles,
    mutedGenres,
    mutedPlatforms,
    topGenres: topKeys(genreWeights),
    topPlatforms: topKeys(platformWeights, 3),
    signalCount: library.length + wishlist.length + favoriteGameIds.length + decisions.length,
    coldStart: library.length + favoriteGameIds.length + decisions.length < 3
  };
}

function scoreCandidate(game, profile) {
  const genres = splitTags(game.genre);
  const platform = normalizeText(game.platform);
  const publisher = normalizeText(game.publisher);
  const genreScore = genres.reduce((sum, tag) => sum + Number(profile.genreWeights[tag] || 0), 0);
  const platformScore = Number(profile.platformWeights[platform] || 0);
  const publisherScore = Number(profile.publisherWeights[publisher] || 0);
  const critic = clamp(game.metacriticScore, 0, 100);
  const sales = clamp(game.globalSales, 0, 50);

  let score = 18;
  score += genreScore * 4.1;
  score += platformScore * 3.2;
  score += publisherScore * 1.8;
  if (critic >= 90) score += 12;
  else if (critic >= 80) score += 8;
  else if (critic >= 70) score += 4;
  score += Math.min(7, sales * 0.45);

  const reasons = [];
  const matchingGenres = genres
    .map((tag) => [tag, Number(profile.genreWeights[tag] || 0)])
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
  if (matchingGenres.length) reasons.push(`Matches your interest in ${matchingGenres.slice(0, 2).join(' and ')}`);
  if (platformScore > 0 && game.platform) reasons.push(`Available on ${game.platform}, a platform you use`);
  if (publisherScore > 1 && game.publisher) reasons.push(`From ${game.publisher}, similar to publishers in your collection`);
  if (critic >= 85) reasons.push(`Highly rated with a critic score of ${critic}`);
  else if (critic >= 75) reasons.push(`Well reviewed with a critic score of ${critic}`);
  if (!reasons.length && profile.coldStart) reasons.push('A highly rated, diverse pick while Project Sora learns your taste');
  else if (!reasons.length) reasons.push('A discovery pick outside your usual genres for variety');

  const matchPercent = clamp(Math.round(50 + Math.min(48, Math.max(0, score - 18) * 0.8)), 50, 98);
  return {
    ...game,
    recommendationScore: Number(score.toFixed(3)),
    matchPercent,
    recommendationReasons: reasons.slice(0, 3),
    scoreBreakdown: {
      genre: Number((genreScore * 4.1).toFixed(2)),
      platform: Number((platformScore * 3.2).toFixed(2)),
      publisher: Number((publisherScore * 1.8).toFixed(2)),
      quality: critic >= 90 ? 12 : critic >= 80 ? 8 : critic >= 70 ? 4 : 0
    }
  };
}

function buildRecommendations(catalog, userData = {}, options = {}) {
  const limit = clamp(options.limit || 20, 1, 50);
  const cursor = Math.max(0, Number.parseInt(options.cursor || 0, 10) || 0);
  const platformFilter = normalizeText(options.platform);
  const genreFilter = normalizeText(options.genre);
  const profile = buildPreferenceProfile({ catalog, ...userData });
  const ownedTitles = new Set((userData.library || []).map((item) => normalizeText(item.title || item.name)));
  const wishlistedTitles = new Set((userData.wishlist || []).map((item) => normalizeText(item.title || item.name)));
  const decidedIds = new Set((userData.decisions || []).map((item) => String(item.gameId || item.id || '')));
  const decidedTitles = new Set((userData.decisions || []).map((item) => normalizeText(item.title || item.name)));
  const uniqueTitles = new Set();
  const scored = [];

  for (const game of Array.isArray(catalog) ? catalog : []) {
    const id = String(game.id || `${game.name}-${game.platform}`);
    const title = normalizeText(game.name || game.title);
    const candidateGenres = splitTags(game.genre);
    const candidatePlatform = normalizeText(game.platform);
    if (!title || ownedTitles.has(title) || decidedIds.has(id) || decidedTitles.has(title) || uniqueTitles.has(title)) continue;
    if (candidateGenres.some((tag) => profile.mutedGenres.has(tag))) continue;
    if (candidatePlatform && profile.mutedPlatforms.has(candidatePlatform)) continue;
    if (options.excludeWishlist !== false && wishlistedTitles.has(title)) continue;
    if (platformFilter && !normalizeText(game.platform).includes(platformFilter)) continue;
    if (genreFilter && !splitTags(game.genre).some((tag) => tag.includes(genreFilter))) continue;
    if (!game.genre && !game.platform && !game.metacriticScore) continue;
    uniqueTitles.add(title);
    scored.push(scoreCandidate(game, profile));
  }

  scored.sort((a, b) => b.recommendationScore - a.recommendationScore || b.matchPercent - a.matchPercent || String(a.name).localeCompare(String(b.name)));

  // Keep the queue personal without becoming repetitive: every fifth slot is a quality-weighted diversity pick.
  const topPool = scored.slice(0, Math.min(300, scored.length));
  const personalized = topPool.slice(0, Math.min(220, topPool.length));
  const diversity = topPool.slice(Math.min(80, topPool.length));
  const ordered = [];
  let personalIndex = 0;
  let diversityIndex = 0;
  while (personalIndex < personalized.length && ordered.length < topPool.length) {
    if ((ordered.length + 1) % 5 === 0 && diversityIndex < diversity.length) {
      ordered.push(diversity[diversityIndex++]);
    } else {
      ordered.push(personalized[personalIndex++]);
    }
  }
  const deduped = [];
  const seenIds = new Set();
  for (const item of ordered) {
    const id = String(item.id || `${item.name}-${item.platform}`);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    deduped.push(item);
  }

  const items = deduped.slice(cursor, cursor + limit);
  const nextCursor = cursor + items.length < deduped.length ? cursor + items.length : null;
  return {
    items,
    nextCursor,
    totalEligible: deduped.length,
    profile: {
      coldStart: profile.coldStart,
      signalCount: profile.signalCount,
      topGenres: profile.topGenres,
      topPlatforms: profile.topPlatforms
    }
  };
}

module.exports = {
  normalizeText,
  splitTags,
  buildPreferenceProfile,
  scoreCandidate,
  buildRecommendations
};
