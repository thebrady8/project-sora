function escapeSearchText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createEmptySearchStateMarkup(message = 'No games found') {
  return `
    <div class="suggestion-item suggestion-item--empty" role="status" aria-live="polite">
      <div>
        <strong>${escapeSearchText(message)}</strong>
        <div>Try a broader search term.</div>
      </div>
    </div>
  `;
}

export function createSearchResultMarkup(item, kind = 'game', searchIndex = -1, query = '') {
  const title = String(item?.title || item?.name || '').trim();
  const subtitle = String(item?.subtitle || item?.platform || 'Platform unknown').trim();
  const image = item?.image || item?.coverImage || 'https://placehold.co/72x72/0f172a/ffffff?text=Game';
  const safeId = escapeSearchText(item?.id || title);
  const safeTitle = escapeSearchText(title);
  const safeSubtitle = escapeSearchText(subtitle);
  const searchAttributes = searchIndex >= 0 ? `data-search-index="${searchIndex}"` : '';
  const highlightText = query ? escapeSearchText(query) : '';
  const highlightedTitle = query && title ? title.replace(new RegExp(`(${escapeRegExp(query)})`, 'ig'), '<mark>$1</mark>') : safeTitle;

  if (kind === 'profile') {
    return `
      <div class="suggestion-item" data-profile="${safeId}" ${searchAttributes} role="option" tabindex="0" aria-selected="false">
        <div>
          <strong>${highlightedTitle}</strong>
          <div>${safeSubtitle}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="suggestion-item" data-game-id="${safeId}" ${searchAttributes} role="option" tabindex="0" aria-selected="false">
      <img src="${escapeSearchText(image)}" alt="${safeTitle}" />
      <div>
        <strong>${highlightedTitle}</strong>
        <div>${safeSubtitle}</div>
      </div>
    </div>
  `;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateSuggestionState(item, isActive) {
  if (!item) {
    return;
  }

  if (item.classList?.toggle) {
    item.classList.toggle('is-active', isActive);
  }

  if (item.setAttribute) {
    item.setAttribute('aria-selected', String(isActive));
  }

  if (isActive && item.focus) {
    item.focus({ preventScroll: true });
  }
}

export function handleSuggestionKeyboard(event, container, activeIndexRef, selector, onEnter) {
  if (!container || container.classList.contains('hidden')) {
    return false;
  }

  const items = Array.from(container.querySelectorAll(selector));
  if (!items.length) {
    return false;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndexRef.value = (activeIndexRef.value + 1) % items.length;
    items.forEach((item, index) => {
      const isActive = index === activeIndexRef.value;
      updateSuggestionState(item, isActive);
    });
    return true;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndexRef.value = (activeIndexRef.value <= 0) ? items.length - 1 : activeIndexRef.value - 1;
    items.forEach((item, index) => {
      const isActive = index === activeIndexRef.value;
      updateSuggestionState(item, isActive);
    });
    return true;
  }

  if (event.key === 'Enter' && activeIndexRef.value >= 0) {
    event.preventDefault();
    onEnter(items[activeIndexRef.value]);
    return true;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    container.classList.add('hidden');
    activeIndexRef.value = -1;
    items.forEach((item) => {
      if (item.classList?.remove) {
        item.classList.remove('is-active');
      }
      if (item.setAttribute) {
        item.setAttribute('aria-selected', 'false');
      }
    });
    return true;
  }

  return false;
}
