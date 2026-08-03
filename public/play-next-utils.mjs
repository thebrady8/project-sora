function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function getPersonalRating(game) {
  const comments = Array.isArray(game?.comments) ? game.comments : [];
  const ratings = comments
    .map((comment) => normalizeNumber(comment?.rating, 0))
    .filter((rating) => rating > 0);
  if (!ratings.length) {
    return 0;
  }
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

function getStatusWeight(status) {
  switch (String(status || '').toLowerCase()) {
    case 'playing':
      return 18;
    case 'paused':
      return 10;
    case 'backlog':
      return 14;
    case 'completed':
      return 0;
    case 'dropped':
      return 0;
    default:
      return 8;
  }
}

function getBacklogAgeWeight(addedAt) {
  if (!addedAt) {
    return 0;
  }

  const parsed = new Date(addedAt);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays > 180) {
    return 12;
  }
  if (ageDays > 90) {
    return 8;
  }
  if (ageDays > 30) {
    return 5;
  }
  return 2;
}

function getGenreSimilarityScore(candidate, library) {
  if (!library.length) {
    return 0;
  }

  const genre = normalizeText(candidate?.genre, 'Unknown').toLowerCase();
  const ratedGames = library.filter((game) => getPersonalRating(game) >= 4 && normalizeText(game?.genre, 'Unknown').toLowerCase() === genre);
  if (!ratedGames.length) {
    return 0;
  }

  return ratedGames.length * 10;
}

function getPlatformPreferenceScore(candidate, library) {
  const platform = normalizeText(candidate?.platform, 'Unknown').toLowerCase();
  const matching = library.filter((game) => normalizeText(game?.platform, 'Unknown').toLowerCase() === platform);
  return matching.length * 5;
}

function getCompletionScore(game) {
  const completionPercent = normalizeNumber(game?.completionPercent, 0);
  if (completionPercent >= 80) {
    return 4;
  }
  if (completionPercent >= 40) {
    return 8;
  }
  return 10;
}

function getPlaytimeScore(game) {
  const playtimeMinutes = normalizeNumber(game?.playtimeMinutes, 0);
  if (playtimeMinutes >= 240) {
    return 6;
  }
  if (playtimeMinutes >= 120) {
    return 3;
  }
  return 1;
}

function getRatingScore(game) {
  const rating = getPersonalRating(game);
  if (rating >= 4.5) {
    return 12;
  }
  if (rating >= 3.5) {
    return 8;
  }
  if (rating >= 2.5) {
    return 4;
  }
  return 0;
}

function getHistoryPenalty(recommendationId, history = []) {
  if (!recommendationId || !Array.isArray(history) || !history.length) {
    return 0;
  }
  return history.includes(recommendationId) ? 1000 : 0;
}

function normalizeRecommendationOptions(options = {}) {
  return {
    includeCompleted: Boolean(options?.includeCompleted),
    includeDropped: Boolean(options?.includeDropped),
    history: Array.isArray(options?.history) ? options.history : [],
    platform: normalizeText(options?.platform, ''),
    genre: normalizeText(options?.genre, ''),
    maxPlaytimeMinutes: normalizeNumber(options?.maxPlaytimeMinutes, Number.POSITIVE_INFINITY)
  };
}

export function applyPlayNextFilters(games, options = {}) {
  const filters = normalizeRecommendationOptions(options);
  return games.filter((game) => {
    if (!filters.includeCompleted && String(game?.status || '').toLowerCase() === 'completed') {
      return false;
    }
    if (!filters.includeDropped && String(game?.status || '').toLowerCase() === 'dropped') {
      return false;
    }
    if (filters.platform && normalizeText(game?.platform, '').toLowerCase() !== filters.platform.toLowerCase()) {
      return false;
    }
    if (filters.genre && normalizeText(game?.genre, '').toLowerCase() !== filters.genre.toLowerCase()) {
      return false;
    }
    if (Number.isFinite(filters.maxPlaytimeMinutes) && normalizeNumber(game?.playtimeMinutes, 0) > filters.maxPlaytimeMinutes) {
      return false;
    }
    return true;
  });
}

export function buildRecommendationReasons(game) {
  const reasons = [];
  const genre = normalizeText(game?.genre, 'Unknown');
  const platform = normalizeText(game?.platform, 'Unknown');
  const status = normalizeText(game?.status, 'Backlog');
  const completionPercent = normalizeNumber(game?.completionPercent, 0);
  const rating = getPersonalRating(game);
  const playtimeMinutes = normalizeNumber(game?.playtimeMinutes, 0);

  if (genre) {
    reasons.push(`Genre matches your rated ${genre} games.`);
  }
  if (platform) {
    reasons.push(`Platform preference favors ${platform}.`);
  }
  if (status) {
    reasons.push(`Current play status is ${status}.`);
  }
  if (completionPercent >= 40) {
    reasons.push(`Progress is already ${completionPercent}% complete.`);
  } else {
    reasons.push(`Progress is still at ${completionPercent}%.`);
  }
  if (rating > 0) {
    reasons.push(`Personal rating average is ${rating.toFixed(1)}.`);
  } else {
    reasons.push(`No personal rating yet, so it stays neutral.`);
  }
  if (playtimeMinutes > 0) {
    reasons.push(`Recorded playtime is ${playtimeMinutes} minutes.`);
  }

  return reasons.slice(0, 3);
}

export function buildPlayNextRecommendations(library, options = {}) {
  const normalizedLibrary = Array.isArray(library) ? library : [];
  const filters = normalizeRecommendationOptions(options);
  const eligibleGames = applyPlayNextFilters(normalizedLibrary, filters);

  const scored = eligibleGames.map((game) => {
    const score = getGenreSimilarityScore(game, normalizedLibrary)
      + getPlatformPreferenceScore(game, normalizedLibrary)
      + getStatusWeight(game?.status)
      + getBacklogAgeWeight(game?.addedAt)
      + getCompletionScore(game)
      + getPlaytimeScore(game)
      + getRatingScore(game)
      - getHistoryPenalty(game?.id, filters.history);

    return {
      ...game,
      score,
      reasons: buildRecommendationReasons(game)
    };
  });

  return scored.sort((left, right) => right.score - left.score || String(left.title || '').localeCompare(String(right.title || '')));
}

export function createRecommendationState(initial = {}) {
  return {
    dismissed: Array.isArray(initial?.dismissed) ? initial.dismissed : [],
    history: Array.isArray(initial?.history) ? initial.history : []
  };
}
