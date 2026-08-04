function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function scoreField(field, query, weight = 1) {
  const normalized = normalizeText(field);
  if (!normalized || !query) return 0;
  if (normalized === query) return 1200 * weight;
  if (normalized.startsWith(`${query} `) || normalized.startsWith(query)) return 800 * weight;
  const words = normalized.split(' ');
  if (words.some((word) => word === query)) return 650 * weight;
  if (words.some((word) => word.startsWith(query))) return 500 * weight;
  if (normalized.includes(query)) return 300 * weight;

  const queryTokens = query.split(' ').filter(Boolean);
  if (queryTokens.length > 1 && queryTokens.every((token) => normalized.includes(token))) {
    return 240 * weight;
  }
  return 0;
}

export function scoreCatalogEntry(entry, rawQuery) {
  const query = normalizeText(rawQuery);
  if (!query) return 0;

  const title = entry?.name || entry?.title || '';
  let score = scoreField(title, query, 1);
  score += scoreField(entry?.platform, query, 0.28);
  score += scoreField(entry?.genre, query, 0.22);
  score += scoreField(entry?.publisher, query, 0.18);

  const titleTokens = tokenize(title);
  const queryTokens = tokenize(query);
  const matchedTokens = queryTokens.filter((token) => titleTokens.some((word) => word === token || word.startsWith(token)));
  score += matchedTokens.length * 45;

  if (Number.isFinite(Number(entry?.metacriticScore))) {
    score += Math.max(0, Math.min(100, Number(entry.metacriticScore))) / 10;
  }

  return score;
}

export function groupCatalogEditions(entries = []) {
  const grouped = new Map();
  entries.forEach((entry) => {
    const title = String(entry?.name || entry?.title || '').trim();
    if (!title) return;
    const key = normalizeText(title);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ...entry,
        editionIds: [entry.id].filter(Boolean),
        availablePlatforms: [entry.platform].filter(Boolean)
      });
      return;
    }

    if (entry.id && !current.editionIds.includes(entry.id)) current.editionIds.push(entry.id);
    if (entry.platform && !current.availablePlatforms.includes(entry.platform)) current.availablePlatforms.push(entry.platform);

    const currentScore = Number(current.metacriticScore || 0);
    const candidateScore = Number(entry.metacriticScore || 0);
    const currentHasImage = Boolean(current.image && !String(current.image).includes('placehold'));
    const candidateHasImage = Boolean(entry.image && !String(entry.image).includes('placehold'));
    if ((!currentHasImage && candidateHasImage) || candidateScore > currentScore) {
      const metadata = {
        editionIds: current.editionIds,
        availablePlatforms: current.availablePlatforms
      };
      Object.assign(current, entry, metadata);
    }
  });
  return [...grouped.values()];
}

export function rankCatalogEntries(entries = [], rawQuery = '', options = {}) {
  const query = normalizeText(rawQuery);
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  if (!query) {
    return groupCatalogEditions(entries)
      .sort((a, b) => Number(b.metacriticScore || 0) - Number(a.metacriticScore || 0) || String(a.name || '').localeCompare(String(b.name || '')))
      .slice(0, limit);
  }

  const ranked = entries
    .map((entry) => ({ entry, score: scoreCatalogEntry(entry, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(a.entry.name || '').localeCompare(String(b.entry.name || '')))
    .map(({ entry, score }) => ({ ...entry, searchScore: Number(score.toFixed(2)) }));

  return groupCatalogEditions(ranked).slice(0, limit);
}

export function createSearchSuggestions(entries = [], rawQuery = '', limit = 8) {
  return rankCatalogEntries(entries, rawQuery, { limit }).map((entry) => ({
    ...entry,
    platformSummary: entry.availablePlatforms?.length > 1
      ? `${entry.availablePlatforms[0]} +${entry.availablePlatforms.length - 1} more`
      : (entry.platform || 'Platform unknown')
  }));
}

export { normalizeText as normalizeSearchText };
