const PLACEHOLDER_PATTERN = /(?:placehold\.co|placeholder|game-cover-placeholder|text=)/i;

export function isUsableArtworkUrl(value) {
  const url = String(value || '').trim();
  if (!url || PLACEHOLDER_PATTERN.test(url)) return false;
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeCatalogDetail(entry = {}, fallbackEntry = null) {
  const fallback = fallbackEntry || {};
  const title = String(entry.title || entry.name || fallback.name || fallback.title || 'Unknown game').trim();
  const release = entry.release || entry.releaseDate || entry.releaseYear || fallback.release || fallback.releaseDate || fallback.releaseYear || null;
  const score = entry.userScore ?? fallback.userScore ?? null;
  const critic = entry.metacriticScore ?? fallback.metacriticScore ?? null;
  const rawImage = entry.image || entry.coverImage || fallback.image || fallback.coverImage || '';
  const publisher = entry.publisher || fallback.publisher || entry.developer || fallback.developer || '';
  const developer = entry.developer || fallback.developer || entry.publisher || fallback.publisher || '';
  const description = String(entry.description || entry.blurb || fallback.description || fallback.blurb || '').trim();
  const tags = Array.isArray(entry.tags) && entry.tags.length
    ? entry.tags.filter(Boolean)
    : Array.isArray(fallback.tags) ? fallback.tags.filter(Boolean) : [];

  const missing = [];
  if (!isUsableArtworkUrl(rawImage)) missing.push('artwork');
  if (!description) missing.push('description');
  if (!publisher) missing.push('publisher');
  if (!release) missing.push('release date');
  if (critic === null || critic === '' || Number.isNaN(Number(critic))) missing.push('critic score');

  return {
    ...fallback,
    ...entry,
    id: String(entry.id || fallback.id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).trim(),
    title,
    name: String(entry.name || title),
    platform: String(entry.platform || fallback.platform || 'Platform unavailable'),
    price: Number(entry.price ?? fallback.price ?? 0) || 0,
    metacriticScore: critic === null || critic === '' || Number.isNaN(Number(critic)) ? null : Number(critic),
    userScore: score === null || score === '' || Number.isNaN(Number(score)) ? null : Number(score),
    image: isUsableArtworkUrl(rawImage) ? rawImage : '',
    description,
    developer,
    publisher,
    tags,
    release,
    source: String(entry.source || fallback.source || 'Local Project Sora catalog'),
    metadataStatus: missing.length ? 'partial' : 'complete',
    missingMetadata: missing
  };
}

export function formatCatalogRelease(value) {
  if (value === null || value === undefined || value === '') return 'Release date unavailable';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = String(value).trim();
  return text || 'Release date unavailable';
}
