function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getAverageRating(comments) {
  if (!Array.isArray(comments) || !comments.length) {
    return 0;
  }

  const ratings = comments
    .map((comment) => normalizeNumber(comment?.rating, 0))
    .filter((rating) => rating > 0);

  if (!ratings.length) {
    return 0;
  }

  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

function getTopLabel(entries) {
  if (!entries.length) {
    return 'Unknown';
  }

  const counts = new Map();
  entries.forEach((entry) => {
    const label = entry || 'Unknown';
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  let winner = 'Unknown';
  let winnerCount = -1;
  const ordered = [...counts.entries()].sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel));

  ordered.forEach(([label, count]) => {
    if (count > winnerCount) {
      winner = label;
      winnerCount = count;
    }
  });

  return winner;
}

export function buildCollectionStatistics(library, asOfDate = new Date()) {
  const games = Array.isArray(library) ? library : [];
  const safeAsOfDate = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);

  const totalGames = games.length;
  const totalEstimatedCollectionValue = games.reduce((sum, game) => sum + normalizeNumber(game?.currentValue, 0), 0);
  const totalPurchaseCost = games.reduce((sum, game) => sum + normalizeNumber(game?.purchasePrice, 0), 0);
  const estimatedGainOrLoss = totalEstimatedCollectionValue - totalPurchaseCost;
  const averagePersonalRating = getAverageRating(games.flatMap((game) => Array.isArray(game?.comments) ? game.comments : []));
  const totalRecordedPlaytime = games.reduce((sum, game) => sum + normalizeNumber(game?.playtimeMinutes, 0), 0);
  const averageCompletionPercentage = totalGames
    ? games.reduce((sum, game) => sum + normalizeNumber(game?.completionPercent, 0), 0) / totalGames
    : 0;
  const completedGameCount = games.filter((game) => String(game?.status || '').toLowerCase() === 'completed').length;
  const backlogCount = games.filter((game) => String(game?.status || '').toLowerCase() === 'backlog').length;
  const mostOwnedPlatform = getTopLabel(games.map((game) => String(game?.platform || 'Unknown').trim() || 'Unknown'));
  const mostPlayedGenre = getTopLabel(games.map((game) => String(game?.genre || 'Unknown').trim() || 'Unknown'));
  const gamesAddedLast30Days = games.filter((game) => {
    const addedAt = game?.addedAt;
    if (!addedAt) {
      return false;
    }

    const parsedDate = new Date(addedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return false;
    }

    return parsedDate >= new Date(safeAsOfDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  }).length;

  return {
    totalGames,
    totalEstimatedCollectionValue,
    totalPurchaseCost,
    estimatedGainOrLoss,
    averagePersonalRating,
    totalRecordedPlaytime,
    averageCompletionPercentage,
    completedGameCount,
    backlogCount,
    mostOwnedPlatform,
    mostPlayedGenre,
    gamesAddedLast30Days
  };
}

export function formatCurrency(value) {
  return `$${normalizeNumber(value, 0).toFixed(2)}`;
}

export function formatPlaytime(minutes) {
  const totalMinutes = Math.max(0, normalizeNumber(minutes, 0));
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
