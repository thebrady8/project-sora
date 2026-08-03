export function createCatalogSlug(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function findCatalogEntryBySlug(catalog, slug) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  return (Array.isArray(catalog) ? catalog : []).find((entry) => {
    const title = String(entry?.title || entry?.name || '').trim();
    return createCatalogSlug(title) === normalizedSlug;
  }) || null;
}
