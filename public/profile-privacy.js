function createPublicHandle(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return 'user';
  }

  const localPart = normalized.split('@')[0] || 'user';
  const safePart = localPart.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return safePart ? `user-${safePart}` : 'user';
}

module.exports = { createPublicHandle };
