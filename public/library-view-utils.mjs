export function resolveLibraryOwner(currentUser, activeLibraryOwner) {
  const normalizedCurrentUser = String(currentUser || '').trim().toLowerCase();
  const normalizedActiveOwner = String(activeLibraryOwner || '').trim().toLowerCase();

  if (!normalizedCurrentUser) {
    return normalizedActiveOwner || '';
  }

  if (!normalizedActiveOwner || normalizedActiveOwner === normalizedCurrentUser) {
    return normalizedCurrentUser;
  }

  return normalizedActiveOwner;
}

export function canEditViewedLibrary(currentUser, activeLibraryOwner) {
  const normalizedCurrentUser = String(currentUser || '').trim().toLowerCase();
  const normalizedActiveOwner = String(activeLibraryOwner || '').trim().toLowerCase();
  return !normalizedActiveOwner || normalizedActiveOwner === normalizedCurrentUser;
}

export function createAnonymousSessionState() {
  return {
    activeLibraryOwner: null,
    friendsState: { friends: [], incoming: [], outgoing: [] },
    notifications: [],
    activityItems: [],
    queueItems: [],
    wishlistItems: []
  };
}
