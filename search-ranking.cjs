function normalizeText(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function scoreField(field, query, weight = 1) {
  const normalized = normalizeText(field);
  if (!normalized || !query) return 0;
  if (normalized === query) return 1200 * weight;
  if (normalized.startsWith(query)) return 800 * weight;
  const words = normalized.split(' ');
  if (words.some((word) => word === query)) return 650 * weight;
  if (words.some((word) => word.startsWith(query))) return 500 * weight;
  if (normalized.includes(query)) return 300 * weight;
  const tokens = query.split(' ').filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => normalized.includes(token)) ? 240 * weight : 0;
}
function scoreCatalogEntry(entry, rawQuery) {
  const query = normalizeText(rawQuery);
  if (!query) return 0;
  let score = scoreField(entry.name || entry.title, query, 1);
  score += scoreField(entry.platform, query, 0.28);
  score += scoreField(entry.genre, query, 0.22);
  score += scoreField(entry.publisher, query, 0.18);
  const titleTokens = normalizeText(entry.name || entry.title).split(' ');
  const queryTokens = query.split(' ');
  score += queryTokens.filter((token) => titleTokens.some((word) => word === token || word.startsWith(token))).length * 45;
  if (Number.isFinite(Number(entry.metacriticScore))) score += Math.max(0, Math.min(100, Number(entry.metacriticScore))) / 10;
  return score;
}
function groupCatalogEditions(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const title = String(entry.name || entry.title || '').trim();
    if (!title) continue;
    const key = normalizeText(title);
    if (!grouped.has(key)) {
      grouped.set(key, { ...entry, editionIds: [entry.id].filter(Boolean), availablePlatforms: [entry.platform].filter(Boolean) });
      continue;
    }
    const current = grouped.get(key);
    if (entry.id && !current.editionIds.includes(entry.id)) current.editionIds.push(entry.id);
    if (entry.platform && !current.availablePlatforms.includes(entry.platform)) current.availablePlatforms.push(entry.platform);
  }
  return [...grouped.values()];
}
function rankCatalogEntries(entries, rawQuery, options = {}) {
  const query = normalizeText(rawQuery);
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  if (!query) return groupCatalogEditions(entries).sort((a,b)=>Number(b.metacriticScore||0)-Number(a.metacriticScore||0)||String(a.name||'').localeCompare(String(b.name||''))).slice(0,limit);
  const ranked = entries.map((entry)=>({entry,score:scoreCatalogEntry(entry,query)})).filter(({score})=>score>0).sort((a,b)=>b.score-a.score||String(a.entry.name||'').localeCompare(String(b.entry.name||''))).map(({entry,score})=>({...entry,searchScore:Number(score.toFixed(2))}));
  return groupCatalogEditions(ranked).slice(0,limit);
}
module.exports = { normalizeSearchText: normalizeText, scoreCatalogEntry, groupCatalogEditions, rankCatalogEntries };
