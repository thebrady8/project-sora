export const RELEASE_PROVIDER_TYPES = Object.freeze({
  OFFICIAL: 'official-api',
  PUBLIC: 'public-structured-endpoint',
  AGGREGATED: 'public-rss-aggregation',
  LOCAL: 'local-imported-dataset'
});

export function buildReleaseTrustSummary(payload = {}, now = Date.now()) {
  const updatedAtMs = Date.parse(payload.updatedAt || '');
  const ageMs = Number.isFinite(updatedAtMs) ? Math.max(0, now - updatedAtMs) : null;
  const ttlMs = Number(payload.ttlMs || 24 * 60 * 60 * 1000);
  const stale = ageMs === null || ageMs > ttlMs;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const hardDateCount = items.filter((item) => item?.hardDate === true && Number.isFinite(Number(item.releaseTimestamp))).length;
  return {
    sourceLabel: String(payload.sourceLabel || 'Release source unavailable'),
    sourceType: String(payload.sourceType || 'unknown'),
    verifiedProviderApi: payload.verifiedProviderApi === true,
    stale,
    ageMs,
    updatedAt: Number.isFinite(updatedAtMs) ? new Date(updatedAtMs).toISOString() : null,
    hardDateCount,
    itemCount: items.length,
    confidenceLabel: payload.verifiedProviderApi === true ? 'Official provider API' : 'Public source, independently validated'
  };
}

export function isTrustedReleaseItem(item = {}, now = Date.now(), horizonDays = 365) {
  const timestamp = Number(item.releaseTimestamp);
  const maximum = now + horizonDays * 24 * 60 * 60 * 1000;
  return Boolean(
    item &&
    item.hardDate === true &&
    Number.isFinite(timestamp) &&
    timestamp >= now - 24 * 60 * 60 * 1000 &&
    timestamp <= maximum &&
    String(item.title || '').trim() &&
    String(item.link || '').startsWith('https://')
  );
}

export function normalizeCoverageArticle(article = {}, now = Date.now(), windowDays = 7) {
  const published = Date.parse(article.publishedAt || '');
  const minimum = now - windowDays * 24 * 60 * 60 * 1000;
  const link = String(article.link || '').trim();
  if (!String(article.title || '').trim() || !link.startsWith('https://') || !Number.isFinite(published) || published < minimum || published > now + 60_000) {
    return null;
  }
  return {
    ...article,
    title: String(article.title).trim(),
    source: String(article.source || 'Gaming press').trim(),
    link,
    publishedAt: new Date(published).toISOString(),
    attribution: 'Linked coverage via public RSS aggregation; article content remains with the publisher.'
  };
}
