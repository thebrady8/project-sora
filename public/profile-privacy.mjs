function hashSeed(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function createPublicHandle(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return 'user';
  }

  const localPart = normalized.split('@')[0] || 'user';
  const safePart = localPart.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const seed = hashSeed(normalized);
  return safePart ? `user-${safePart}-${seed}` : `user-${seed}`;
}
