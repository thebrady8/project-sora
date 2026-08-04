import { getReleaseCountdown, groupReleasesByMonth, matchCoverageForRelease, normalizeReminderPreferences } from './release-experience.mjs';
import { newGameId, normalizeEmail, isValidEmail, escapeHtml, formatPlaytime, normalizeGame, normalizePlayStatus, PLAY_STATUS_OPTIONS } from './helpers.js';
import { GAME_CATALOG, PREMIUM_RELEASE_FALLBACK, normalizeReleaseEntry, parseReleaseDate, sortReleaseDataChronologically, mergeReleaseCalendar } from './catalog-data.js';
import { parseCsvGames, serializeLibraryCsv } from './csv-utils.mjs';
import { createDebouncedRequest } from './search-utils.mjs';
import { createSearchSuggestions, normalizeSearchText } from './catalog-search.mjs';
import { createCatalogSlug, findCatalogEntryBySlug } from './catalog-routing.mjs';
import { normalizeCatalogDetail, formatCatalogRelease } from './catalog-detail-utils.mjs';
import { createPublicHandle } from './profile-privacy.mjs';
import { createEmptySearchStateMarkup, createSearchResultMarkup as createSearchExperienceMarkup, handleSuggestionKeyboard as handleSearchKeyboard } from './search-experience.mjs';
import { buildCollectionStatistics, formatCurrency } from './statistics-utils.mjs';
import { resolveLibraryOwner, canEditViewedLibrary, createAnonymousSessionState } from './library-view-utils.mjs';
import { buildPlayNextRecommendations, createRecommendationState } from './play-next-utils.mjs';
import { getLocalQueueItems, saveLocalQueueItems, normalizeQueueEntry, reconcileQueueEntries } from './queue-utils.js';
import { normalizeReleaseQueue, advanceReleaseIndex, filterReleaseQueueByPlatform } from './release-pipeline.mjs';
import { buildReleaseTrustSummary, normalizeCoverageArticle } from './release-trust.mjs';

// --- App state and configuration ---
const STORAGE_KEY = 'gamevault-users';
const PROFILE_DATA_KEY = 'gamevault-profiles';
const API_BASE = '';
const REMEMBER_ME_KEY = 'gamevault-remember-me';
const AUTH_SESSION_KEY = 'gamevault-auth-session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const GAME_IMAGE_FALLBACK = '/icons/game-cover-placeholder.svg';
const GAME_LANDSCAPE_FALLBACK = '/icons/game-landscape-placeholder.svg';

function decodeHtmlEntities(value = '') {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value);
  return textarea.value;
}

function installGlobalImageFallback() {
  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (image.dataset.fallbackApplied === 'true') return;

    image.dataset.fallbackApplied = 'true';
    image.classList.add('image-fallback');
    image.removeAttribute('srcset');
    image.src = GAME_IMAGE_FALLBACK;
  }, true);
}

installGlobalImageFallback();

const usernameInput = document.getElementById('username');
const switchUserButton = document.getElementById('switchUser');
const gameForm = document.getElementById('gameForm');
const gamesList = document.getElementById('gamesList');
const summaryGrid = document.getElementById('summaryGrid');
const emptyState = document.getElementById('emptyState');
const clearLibraryButton = document.getElementById('clearLibrary');
const csvUpload = document.getElementById('csvUpload');
const exportCsvButton = document.getElementById('exportCsv');
const betaDownloadStatus = document.getElementById('betaDownloadStatus');
const syncStatus = document.getElementById('syncStatus');
const detailPage = document.getElementById('detailPage');
const mainContent = document.getElementById('mainContent');
const detailTitle = document.getElementById('detailTitle');
const gameDetailContent = document.getElementById('gameDetailContent');
const backToLibraryButton = document.getElementById('backToLibrary');
const gameMatchCard = document.getElementById('gameMatchCard');
const playNextPlatformFilter = document.getElementById('playNextPlatformFilter');
const playNextGenreFilter = document.getElementById('playNextGenreFilter');
const playNextMaxPlaytimeFilter = document.getElementById('playNextMaxPlaytimeFilter');
const playNextResetFiltersButton = document.getElementById('playNextResetFiltersButton');
const titleInput = document.getElementById('titleInput');
const titleSuggestions = document.getElementById('titleSuggestions');
const barcodeInput = document.getElementById('barcodeInput');
const scanBarcodeButton = document.getElementById('scanBarcodeButton');
const lookupBarcodeButton = document.getElementById('lookupBarcodeButton');
const barcodeStatus = document.getElementById('barcodeStatus');
const barcodeScannerDialog = document.getElementById('barcodeScannerDialog');
const barcodeVideo = document.getElementById('barcodeVideo');
const barcodeScannerStatus = document.getElementById('barcodeScannerStatus');
const closeBarcodeScannerButton = document.getElementById('closeBarcodeScanner');
const msrpInput = document.getElementById('msrpInput');
const msrpSource = document.getElementById('msrpSource');
const gameSearch = document.getElementById('gameSearch');
const gameSearchResults = document.getElementById('gameSearchResults');
const friendInput = document.getElementById('friendInput');
const addFriendButton = document.getElementById('addFriendButton');
const friendsList = document.getElementById('friendsList');
const incomingRequestsList = document.getElementById('incomingRequestsList');
const outgoingRequestsList = document.getElementById('outgoingRequestsList');
const profilePlaytime = document.getElementById('profilePlaytime');
const profileCompletion = document.getElementById('profileCompletion');
const prevGameButton = document.getElementById('prevGame');
const nextGameButton = document.getElementById('nextGame');
const authSubmitButton = document.getElementById('authSubmitButton');
const authUsername = document.getElementById('authUsername');
const authUsernameStatus = document.getElementById('authUsernameStatus');
const authLoginMode = document.getElementById('authLoginMode');
const authRegisterMode = document.getElementById('authRegisterMode');
const authEmailInput = document.getElementById('authEmail');
const authPasswordInput = document.getElementById('authPassword');
const authHeading = document.getElementById('authHeading');
const authStatus = document.getElementById('authStatus');
const logoutButton = document.getElementById('logoutButton');
const menuToggle = document.getElementById('menuToggle');
const releasePrevButton = document.getElementById('releasePrevButton');
const releaseNextButton = document.getElementById('releaseNextButton');
const releasePlatformFilter = document.getElementById('releasePlatformFilter');
const releaseCalendarButton = document.getElementById('releaseCalendarButton');
const releaseDetailPage = document.getElementById('releaseDetailPage');
const releaseDetailContent = document.getElementById('releaseDetailContent');
const backFromReleaseButton = document.getElementById('backFromReleaseButton');
const releaseDataUpdatedAt = document.getElementById('releaseDataUpdatedAt');
const sideMenu = document.getElementById('sideMenu');
const accountProfileCard = document.getElementById('accountProfileCard');
const accountAvatar = document.getElementById('accountAvatar');
const accountDisplayName = document.getElementById('accountDisplayName');
const accountHandle = document.getElementById('accountHandle');
const compactViewProfileButton = document.getElementById('compactViewProfileButton');
const rememberMeCheckbox = document.getElementById('rememberMe');
const rememberMeLoginCheckbox = document.getElementById('rememberMeLogin');
const statusFilter = document.getElementById('statusFilter');
const statisticsNavButton = document.getElementById('statisticsNavButton');
const statisticsPage = document.getElementById('statisticsPage');
const statisticsContent = document.getElementById('statisticsContent');

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  let reloadingForServiceWorker = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForServiceWorker) return;
    reloadingForServiceWorker = true;

    const reloadKey = 'project-sora-sw-reload';
    if (sessionStorage.getItem(reloadKey) !== '1') {
      sessionStorage.setItem(reloadKey, '1');
      window.location.reload();
    }
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none'
      });

      sessionStorage.removeItem('project-sora-sw-reload');
      await registration.update();

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      window.setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
    } catch (error) {
      console.warn('Service worker registration failed', error);
    }
  });
}

function initInstallButton() {
  const installButton = document.getElementById('installButton');
  if (!installButton) {
    return;
  }

  let deferredPrompt = null;
  const userAgent = window.navigator.userAgent || '';
  const isIos = /iPhone|iPad|iPod/i.test(userAgent);
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const hideInstallButton = () => {
    installButton.hidden = true;
    installButton.disabled = false;
  };

  const showIosInstallButton = () => {
    installButton.hidden = false;
    installButton.disabled = false;
    installButton.textContent = 'Install on iPhone';
    installButton.setAttribute(
      'aria-label',
      'Show instructions for adding Project Sora to the iPhone Home Screen'
    );
  };

  const showBrowserInstallButton = () => {
    installButton.hidden = false;
    installButton.disabled = false;
    installButton.textContent = 'Install App';
    installButton.setAttribute('aria-label', 'Install Project Sora');
  };

  if (isStandalone()) {
    hideInstallButton();
    return;
  }

  // iOS Safari does not expose beforeinstallprompt. Show platform-specific
  // instructions instead of a nonfunctional browser prompt button.
  if (isIos) {
    showIosInstallButton();
  } else {
    // On desktop and Android, keep the button hidden until the browser confirms
    // that a native install prompt is available.
    hideInstallButton();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showBrowserInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallButton();
  });

  installButton?.addEventListener('click', async () => {
    if (isIos) {
      window.alert(
        'To install Project Sora on iPhone: tap Safari’s Share button, choose Add to Home Screen, then tap Add.'
      );
      return;
    }

    if (!deferredPrompt) {
      hideInstallButton();
      return;
    }

    installButton.disabled = true;

    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (error) {
      console.error('Project Sora installation prompt failed.', error);
    } finally {
      deferredPrompt = null;
      hideInstallButton();
    }
  });
}

const backToLibraryFromStatsButton = document.getElementById('backToLibraryFromStats');
const queueContainer = document.getElementById('queueContainer');
const notificationsContainer = document.getElementById('notificationsContainer');
const activityContainer = document.getElementById('activityContainer');
const activityLoadMoreButton = document.getElementById('activityLoadMoreButton');
const activityClearButton = document.getElementById('activityClearButton');
const previewProfileButton = document.getElementById('previewProfileButton');
const savePrivacyButton = document.getElementById('savePrivacyButton');
const privacyStatus = document.getElementById('privacyStatus');
const profilePreviewPanel = document.getElementById('profilePreviewPanel');
const profileVisibilitySelect = document.getElementById('profileVisibilitySelect');
const libraryVisibilitySelect = document.getElementById('libraryVisibilitySelect');
const reviewsVisibilitySelect = document.getElementById('reviewsVisibilitySelect');
const activityVisibilitySelect = document.getElementById('activityVisibilitySelect');
const profileDisplayNameInput = document.getElementById('profileDisplayNameInput');
const profileBioInput = document.getElementById('profileBioInput');
const profileAvatarUrlInput = document.getElementById('profileAvatarUrlInput');
const profileBannerUrlInput = document.getElementById('profileBannerUrlInput');
const PLATFORM_ACCOUNT_META = {
  steam: { label: 'Steam', symbol: 'ST' },
  xbox: { label: 'Xbox', symbol: 'XB' },
  playstation: { label: 'PlayStation', symbol: 'PS' },
  nintendo: { label: 'Nintendo', symbol: 'NI' }
};
const platformAccountInputs = Object.fromEntries(Object.keys(PLATFORM_ACCOUNT_META).map((platform) => [platform, {
  handle: document.getElementById(`${platform}HandleInput`),
  profileUrl: document.getElementById(`${platform}ProfileUrlInput`),
  visibility: document.getElementById(`${platform}VisibilitySelect`)
}]));
const favoriteGamesEditor = document.getElementById('favoriteGamesEditor');
const saveProfileButton = document.getElementById('saveProfileButton');
const viewOwnProfileButton = document.getElementById('viewOwnProfileButton');
const profileEditorStatus = document.getElementById('profileEditorStatus');
const publicProfilePage = document.getElementById('publicProfilePage');
const supportNavButton = document.getElementById('supportNavButton');
const supportDialog = document.getElementById('supportDialog');
const closeSupportDialog = document.getElementById('closeSupportDialog');
const feedbackForm = document.getElementById('feedbackForm');
const submitFeedbackButton = document.getElementById('submitFeedbackButton');
const feedbackStatus = document.getElementById('feedbackStatus');
const integrationStatusList = document.getElementById('integrationStatusList');
const refreshIntegrationStatusButton = document.getElementById('refreshIntegrationStatus');

const publicProfileContent = document.getElementById('publicProfileContent');
const publicProfileHeading = document.getElementById('publicProfileHeading');
const backFromProfileButton = document.getElementById('backFromProfileButton');


const rememberMePreference = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
let currentUser = rememberMePreference ? localStorage.getItem('gamevault-current-user') || '' : '';
let authToken = rememberMePreference ? localStorage.getItem('gamevault-auth-token') || '' : '';
let activeLibraryOwner = null;
let currentDetailGameIndex = -1;
let currentDetailGameId = null;
let searchTerm = '';
let gameMatchCandidates = [];
let gameMatchIndex = 0;
let latestSearchResults = [];
let playNextState = createRecommendationState();
let playNextFilters = { platform: '', genre: '', maxPlaytimeMinutes: Number.POSITIVE_INFINITY, includeCompleted: false, includeDropped: false };
let currentProfileSettings = { displayName: '', bio: '', avatarUrl: '', bannerUrl: '', favoriteGameIds: [] };


function getPlayNextStorageKey() {
  return 'gamevault-play-next-state';
}

function loadPlayNextState() {
  try {
    const raw = localStorage.getItem(getPlayNextStorageKey());
    const parsed = raw ? JSON.parse(raw) : null;
    return createRecommendationState(parsed || {});
  } catch {
    return createRecommendationState();
  }
}

function savePlayNextState() {
  localStorage.setItem(getPlayNextStorageKey(), JSON.stringify(playNextState));
}

function syncPlayNextFiltersFromInputs() {
  if (!playNextPlatformFilter || !playNextGenreFilter || !playNextMaxPlaytimeFilter) {
    return;
  }

  playNextFilters = {
    ...playNextFilters,
    platform: playNextPlatformFilter.value.trim(),
    genre: playNextGenreFilter.value.trim(),
    maxPlaytimeMinutes: playNextMaxPlaytimeFilter.value ? Number(playNextMaxPlaytimeFilter.value) : Number.POSITIVE_INFINITY
  };
}

function resetPlayNextFilters() {
  if (playNextPlatformFilter) {
    playNextPlatformFilter.value = '';
  }
  if (playNextGenreFilter) {
    playNextGenreFilter.value = '';
  }
  if (playNextMaxPlaytimeFilter) {
    playNextMaxPlaytimeFilter.value = '';
  }
  playNextFilters = { platform: '', genre: '', maxPlaytimeMinutes: Number.POSITIVE_INFINITY, includeCompleted: false, includeDropped: false };
  buildGameMatchCandidates();
}

playNextState = loadPlayNextState();
let currentCatalogDetailEntry = null;
let activeSearchRequestId = 0;
let wishlistItems = [];
let wishlistSyncPending = false;
let queueItems = [];
let notifications = [];
let activityItems = [];
let activityOffset = 0;
let friendsState = { friends: [], incoming: [], outgoing: [] };
let activityHasMore = false;
let activityBusy = false;
let searchDebounceController = null;
let currentStatusFilter = 'All';
const gameSearchKeyboardState = { value: -1 };
const profileSearchKeyboardState = { value: -1 };

let releaseCalendarData = [];
let releaseInterestsCache = {};
let releaseHeroIndex = 0;
let releaseRotationTimer = null;
let releaseAutoRotateEnabled = true;
let releasePlatformSelection = 'All';
let releaseFeedUpdatedAt = '';
let releaseRefreshPromise = null;
let currentReleaseDetailId = '';
let releaseArticlesData = [];
let releaseReminderState = { preferences: normalizeReminderPreferences({}), reminders: {} };
let releaseArticleIndex = 0;
let releaseArticleTimer = null;
let releaseTrustStatus = null;
const RELEASE_INTEREST_KEY = 'project-sora-release-interests';

function renderLibrarySkeleton() {
  if (!gamesList) {
    return;
  }

  emptyState.style.display = 'none';
  gamesList.innerHTML = `
    <div class="skeleton-stack" role="status" aria-live="polite" aria-busy="true">
      ${Array.from({ length: 3 }, () => `
        <article class="skeleton-card skeleton-card--library">
          <div class="skeleton-line skeleton-line--title"></div>
          <div class="skeleton-line skeleton-line--meta"></div>
          <div class="skeleton-line skeleton-line--meta"></div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderProfileSkeleton() {
  if (summaryGrid) {
    summaryGrid.innerHTML = Array.from({ length: 4 }, () => `
      <div class="summary-card">
        <span class="skeleton-line skeleton-line--label"></span>
        <strong><span class="skeleton-line skeleton-line--value"></span></strong>
      </div>
    `).join('');
  }

  if (friendsList) {
    friendsList.innerHTML = `
      <div class="skeleton-row">
        <span class="skeleton-line skeleton-line--pill"></span>
        <span class="skeleton-line skeleton-line--pill"></span>
      </div>
    `;
  }

  if (incomingRequestsList) {
    incomingRequestsList.innerHTML = `
      <div class="skeleton-row">
        <span class="skeleton-line skeleton-line--pill"></span>
      </div>
    `;
  }

  if (outgoingRequestsList) {
    outgoingRequestsList.innerHTML = `
      <div class="skeleton-row">
        <span class="skeleton-line skeleton-line--pill"></span>
      </div>
    `;
  }

  if (profilePlaytime) {
    profilePlaytime.innerHTML = '<span class="skeleton-line skeleton-line--value"></span>';
  }

  if (profileCompletion) {
    profileCompletion.innerHTML = '<span class="skeleton-line skeleton-line--value"></span>';
  }
}

function renderSearchSkeleton(query = '') {
  if (!gameSearchResults) {
    return;
  }

  gameSearchResults.classList.remove('hidden');
  gameSearchResults.setAttribute('aria-busy', 'true');
  gameSearchResults.setAttribute('aria-hidden', 'false');
  gameSearchResults.setAttribute('aria-label', query ? 'Loading search results' : 'Loading suggestions');
  gameSearch.setAttribute('aria-expanded', 'true');
  gameSearchResults.innerHTML = `
    <div class="skeleton-stack skeleton-stack--compact" role="status" aria-live="polite">
      ${Array.from({ length: 3 }, () => `
        <div class="skeleton-card skeleton-card--search">
          <div class="skeleton-block skeleton-block--icon"></div>
          <div class="skeleton-stack skeleton-stack--compact">
            <div class="skeleton-line skeleton-line--title"></div>
            <div class="skeleton-line skeleton-line--meta"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function showReleaseCalendarSkeleton() {
  const container = document.getElementById('upcomingReleaseRotator');
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="skeleton-card skeleton-card--release" role="status" aria-live="polite" aria-busy="true">
      <div class="skeleton-block skeleton-block--hero"></div>
      <div class="skeleton-stack">
        <div class="skeleton-line skeleton-line--title"></div>
        <div class="skeleton-line skeleton-line--meta"></div>
        <div class="skeleton-line skeleton-line--meta"></div>
      </div>
    </div>
  `;
}

function renderDetailSkeleton(title = 'Loading details') {
  if (!gameDetailContent || !detailTitle) {
    return;
  }

  detailTitle.textContent = title;
  gameDetailContent.innerHTML = `
    <div class="skeleton-card skeleton-card--detail">
      <div class="skeleton-block skeleton-block--hero"></div>
      <div class="skeleton-stack">
        <div class="skeleton-line skeleton-line--title"></div>
        <div class="skeleton-line skeleton-line--meta"></div>
        <div class="skeleton-line skeleton-line--meta"></div>
      </div>
    </div>
  `;

  if (mainContent) {
    mainContent.classList.remove('content-area--profile-view');
    mainContent.classList.add('hidden');
  }
  if (detailPage) {
    detailPage.classList.remove('hidden');
  }
  if (publicProfilePage) {
    publicProfilePage.classList.add('hidden');
  }
}

function getBucketedCounts(games, field) {
  return games.reduce((accumulator, game) => {
    const label = String(game?.[field] || 'Unknown').trim() || 'Unknown';
    accumulator[label] = (accumulator[label] || 0) + 1;
    return accumulator;
  }, {});
}

function getBucketedValues(games, field, valueField) {
  return games.reduce((accumulator, game) => {
    const label = String(game?.[field] || 'Unknown').trim() || 'Unknown';
    const value = Number(game?.[valueField] || 0);
    accumulator[label] = (accumulator[label] || 0) + value;
    return accumulator;
  }, {});
}

function renderCollectionStatistics() {
  if (!statisticsContent) {
    return;
  }

  const games = getCurrentLibrary().map(normalizeGame);
  const stats = buildCollectionStatistics(games, new Date());
  const platformCounts = getBucketedCounts(games, 'platform');
  const genreCounts = getBucketedCounts(games, 'genre');
  const statusCounts = getBucketedCounts(games, 'status');
  const platformValueCounts = getBucketedValues(games, 'platform', 'currentValue');

  const maxPlatformCount = Math.max(1, ...Object.values(platformCounts).map((count) => Number(count || 0)));
  const maxGenreCount = Math.max(1, ...Object.values(genreCounts).map((count) => Number(count || 0)));
  const maxStatusCount = Math.max(1, ...Object.values(statusCounts).map((count) => Number(count || 0)));
  const maxValue = Math.max(1, ...Object.values(platformValueCounts).map((value) => Number(value || 0)));

  const createChartMarkup = (title, buckets, maxBucketCount, valueFormatter = (value) => String(value)) => {
    const entries = Object.entries(buckets).filter(([, count]) => Number(count || 0) > 0);
    if (!entries.length) {
      return `
        <div class="stats-chart">
          <h3>${escapeHtml(title)}</h3>
          <p class="empty-state">No entries yet for ${escapeHtml(title.toLowerCase())}.</p>
          <ul class="stats-chart__text-list">
            <li>No data recorded.</li>
          </ul>
        </div>
      `;
    }

    const rowsMarkup = entries.map(([label, value]) => {
      const safeLabel = escapeHtml(label);
      const safeValue = escapeHtml(valueFormatter(value));
      const width = Math.max(8, (Number(value || 0) / maxBucketCount) * 100);
      return `
        <li class="stats-chart__item">
          <div class="stats-chart__header">
            <span>${safeLabel}</span>
            <strong>${safeValue}</strong>
          </div>
          <div class="stats-chart__bar-track" role="img" aria-label="${safeLabel}: ${value}">
            <div class="stats-chart__bar" style="width: ${width}%;"></div>
          </div>
        </li>
      `;
    }).join('');

    const textMarkup = entries.map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(valueFormatter(value))}</li>`).join('');

    return `
      <div class="stats-chart">
        <h3>${escapeHtml(title)}</h3>
        <ul class="stats-chart__list">${rowsMarkup}</ul>
        <p class="sr-only">Text summary: ${escapeHtml(entries.map(([label, value]) => `${label}: ${valueFormatter(value)}`).join(', '))}</p>
        <ul class="stats-chart__text-list">
          ${textMarkup}
        </ul>
      </div>
    `;
  };

  statisticsContent.innerHTML = `
    <div class="stats-summary-grid">
      <article class="stats-card">
        <span>Total games</span>
        <strong>${stats.totalGames}</strong>
      </article>
      <article class="stats-card">
        <span>Total collection value</span>
        <strong>${formatCurrency(stats.totalEstimatedCollectionValue)}</strong>
      </article>
      <article class="stats-card">
        <span>Total purchase cost</span>
        <strong>${formatCurrency(stats.totalPurchaseCost)}</strong>
      </article>
      <article class="stats-card">
        <span>Estimated gain/loss</span>
        <strong>${formatCurrency(stats.estimatedGainOrLoss)}</strong>
      </article>
      <article class="stats-card">
        <span>Average personal rating</span>
        <strong>${stats.averagePersonalRating > 0 ? stats.averagePersonalRating.toFixed(1) : 'N/A'}</strong>
      </article>
      <article class="stats-card">
        <span>Total playtime</span>
        <strong>${formatPlaytime(stats.totalRecordedPlaytime)}</strong>
      </article>
      <article class="stats-card">
        <span>Average completion</span>
        <strong>${Math.round(stats.averageCompletionPercentage)}%</strong>
      </article>
      <article class="stats-card">
        <span>Completed games</span>
        <strong>${stats.completedGameCount}</strong>
      </article>
      <article class="stats-card">
        <span>Backlog count</span>
        <strong>${stats.backlogCount}</strong>
      </article>
      <article class="stats-card">
        <span>Most-owned platform</span>
        <strong>${escapeHtml(stats.mostOwnedPlatform)}</strong>
      </article>
      <article class="stats-card">
        <span>Most-played genre</span>
        <strong>${escapeHtml(stats.mostPlayedGenre)}</strong>
      </article>
      <article class="stats-card">
        <span>Added last 30 days</span>
        <strong>${stats.gamesAddedLast30Days}</strong>
      </article>
    </div>
    <div class="stats-chart-grid">
      ${createChartMarkup('Games by platform', platformCounts, maxPlatformCount, (value) => `${value} game${value === 1 ? '' : 's'}`)}
      ${createChartMarkup('Games by genre', genreCounts, maxGenreCount, (value) => `${value} game${value === 1 ? '' : 's'}`)}
      ${createChartMarkup('Games by play status', statusCounts, maxStatusCount, (value) => `${value} game${value === 1 ? '' : 's'}`)}
      ${createChartMarkup('Library value by platform', platformValueCounts, maxValue, (value) => formatCurrency(value))}
    </div>
  `;
}

function showStatisticsView() {
  if (mainContent) {
    mainContent.classList.remove('content-area--profile-view');
    mainContent.classList.add('hidden');
  }
  if (detailPage) {
    detailPage.classList.add('hidden');
  }
  if (statisticsPage) {
    statisticsPage.classList.remove('hidden');
  }
  if (publicProfilePage) {
    publicProfilePage.classList.add('hidden');
  }
  renderCollectionStatistics();
  window.location.hash = '#statistics';
}



async function loadReleaseReminders() {
  if (!currentUser || !authToken) return releaseReminderState;
  try {
    const response = await apiRequest('/api/release-reminders');
    releaseReminderState = {
      preferences: normalizeReminderPreferences(response?.preferences || {}),
      reminders: response?.reminders && typeof response.reminders === 'object' ? response.reminders : {}
    };
  } catch {
    // Keep local defaults when offline.
  }
  return releaseReminderState;
}

async function toggleReleaseReminder(item, offsetDays = 1) {
  if (!currentUser || !authToken) {
    setSyncStatus('Sign in to save release reminders across devices.', 'error');
    return;
  }
  const existing = releaseReminderState.reminders?.[item.id];
  const response = await apiRequest('/api/release-reminders', {
    method: 'PUT',
    body: JSON.stringify(existing ? { removeId: item.id } : { reminder: { id: item.id, title: item.title, releaseDate: item.releaseDate || item.release, offsetDays, enabled: true } })
  });
  releaseReminderState = { preferences: normalizeReminderPreferences(response?.preferences || {}), reminders: response?.reminders || {} };
  renderReleaseDetail(item);
}

function getReleaseInterests() {
  return releaseInterestsCache && typeof releaseInterestsCache === 'object' ? releaseInterestsCache : {};
}

function saveReleaseInterests(value) {
  releaseInterestsCache = value && typeof value === 'object' ? value : {};
  localStorage.setItem(RELEASE_INTEREST_KEY, JSON.stringify(releaseInterestsCache));
}

async function loadReleaseInterests() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RELEASE_INTEREST_KEY) || '{}');
    releaseInterestsCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    releaseInterestsCache = {};
  }
  if (!currentUser || !authToken) return releaseInterestsCache;
  try {
    const response = await apiRequest('/api/release-interests');
    releaseInterestsCache = response?.items && typeof response.items === 'object' ? response.items : releaseInterestsCache;
    localStorage.setItem(RELEASE_INTEREST_KEY, JSON.stringify(releaseInterestsCache));
  } catch {
    // Keep the local cache available while offline.
  }
  return releaseInterestsCache;
}

async function persistReleaseInterests(value) {
  saveReleaseInterests(value);
  if (!currentUser || !authToken) return;
  try {
    await apiRequest('/api/release-interests', { method: 'PUT', body: JSON.stringify({ items: releaseInterestsCache }) });
  } catch {
    setSyncStatus('Interested titles saved locally and will sync when the server is available.', 'error');
  }
}

function getFilteredReleaseCalendar() {
  const normalized = normalizeReleaseQueue(releaseCalendarData, { horizonDays: 365 });
  return filterReleaseQueueByPlatform(normalized, releasePlatformSelection);
}

function releaseSlug(item) {
  return encodeURIComponent(String(item?.id || item?.title || 'upcoming-release').trim());
}

function openReleaseDetail(item) {
  if (!item) return;
  window.location.hash = `#upcoming/${releaseSlug(item)}`;
}

function renderReleaseCalendarList() {
  const items = getFilteredReleaseCalendar();
  if (!releaseDetailPage || !releaseDetailContent) return;
  currentReleaseDetailId = 'calendar';
  mainContent?.classList.add('hidden');
  detailPage?.classList.add('hidden');
  statisticsPage?.classList.add('hidden');
  publicProfilePage?.classList.add('hidden');
  releaseDetailPage.classList.remove('hidden');
  releaseDataUpdatedAt.textContent = releaseFeedUpdatedAt ? `Updated ${new Date(releaseFeedUpdatedAt).toLocaleString()}` : 'Updated daily';
  const monthGroups = groupReleasesByMonth(items);
  releaseDetailContent.innerHTML = `
    <div class="release-calendar-heading"><div><p class="eyebrow">Next 12 months</p><h2 id="releaseDetailHeading">Upcoming game calendar</h2><p class="section-caption">Verified hard-date releases, grouped chronologically. Confirm availability with the linked store or publisher.</p></div></div>
    <div class="release-timeline">${monthGroups.map((group) => `<section class="release-month-group"><h3>${escapeHtml(group.label)}</h3><div class="release-calendar-grid">${group.items.map((item) => { const countdown = getReleaseCountdown(item.releaseDate || item.release); return `
      <button type="button" class="release-calendar-entry" data-release-id="${escapeHtml(item.id)}">
        <img src="${escapeHtml(item.image || GAME_IMAGE_FALLBACK)}" alt="" loading="lazy" />
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.platform)} · ${escapeHtml(item.release)} · ${escapeHtml(countdown.label)}</small></span>
        <span aria-hidden="true">→</span>
      </button>`; }).join('')}</div></section>`).join('') || '<div class="empty-state">No releases match this platform filter right now.</div>'}</div>`;
}

function renderReleaseDetail(item) {
  if (!item || !releaseDetailPage || !releaseDetailContent) {
    showHomeView();
    return;
  }
  currentReleaseDetailId = item.id;
  mainContent?.classList.add('hidden');
  detailPage?.classList.add('hidden');
  statisticsPage?.classList.add('hidden');
  publicProfilePage?.classList.add('hidden');
  releaseDetailPage.classList.remove('hidden');
  const interests = getReleaseInterests();
  const interested = Boolean(interests[item.id]);
  const wishlisted = getWishlistItems().some((entry) => entry.gameId === item.id || entry.title === item.title);
  const countdown = getReleaseCountdown(item.releaseDate || item.release);
  const reminder = releaseReminderState.reminders?.[item.id];
  const relatedCoverage = matchCoverageForRelease(item, releaseArticlesData);
  releaseDataUpdatedAt.textContent = releaseFeedUpdatedAt ? `Calendar updated ${new Date(releaseFeedUpdatedAt).toLocaleString()}` : 'Calendar updated daily';
  releaseDetailContent.innerHTML = `
    <article class="release-detail-hero">
      <img src="${escapeHtml(item.image || GAME_IMAGE_FALLBACK)}" alt="${escapeHtml(item.title)}" />
      <div>
        <p class="eyebrow">${escapeHtml(countdown.label)}</p>
        <h2 id="releaseDetailHeading">${escapeHtml(item.title)}</h2>
        <div class="release-meta"><span class="release-pill">${escapeHtml(item.genre)}</span><span class="release-pill">${escapeHtml(item.platform)}</span><span class="release-pill">${escapeHtml(item.release)}</span><span class="release-pill">Source: ${escapeHtml(item.source || 'Project Sora')}</span></div>
        <p>${escapeHtml(decodeHtmlEntities(item.blurb || item.title))}</p>
        <div class="release-detail-actions">
          <button type="button" data-release-action="interest" data-release-id="${escapeHtml(item.id)}" class="${interested ? 'is-active' : ''}">${interested ? 'Interested ✓' : 'Mark Interested'}</button>
          <button type="button" data-release-action="wishlist" data-release-id="${escapeHtml(item.id)}" class="${wishlisted ? 'is-active' : ''}">${wishlisted ? 'Wishlisted ✓' : 'Add to Wishlist'}</button>
          <button type="button" data-release-action="reminder" data-release-id="${escapeHtml(item.id)}" class="${reminder ? 'is-active' : ''}">${reminder ? 'Reminder set ✓' : 'Remind me'}</button>
          ${item.link ? `<a class="button-link ghost" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Open official article or store ↗</a>` : ''}
        </div>
        <section class="release-detail-section"><h3>Latest coverage</h3>${relatedCoverage.length ? relatedCoverage.map((article) => `<a class="release-article-card" href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer"><span class="release-article-card__source">${escapeHtml(article.source || 'Gaming press')}</span><strong>${escapeHtml(article.title)}</strong></a>`).join('') : '<p class="section-caption">No recent verified coverage is available for this title.</p>'}</section>
        <section class="release-detail-section"><h3>Price history</h3><p class="section-caption">Price tracking will appear when a verified store provider is connected. Project Sora will not estimate or invent prices.</p></section>
      </div>
    </article>`;
}

function findReleaseById(id) {
  const decoded = decodeURIComponent(String(id || ''));
  return releaseCalendarData.find((item) => String(item.id) === decoded || releaseSlug(item) === id || item.title === decoded);
}

function renderReleaseCalendar() {
  const container = document.getElementById('upcomingReleaseRotator');
  if (!container) {
    return;
  }

  const filteredItems = getFilteredReleaseCalendar();
  const items = filteredItems;

  if (!items.length) {
    container.innerHTML = '<div class="empty-state">No verified releases with hard launch dates are available for this filter right now.</div>';
    return;
  }

  const safeHeroIndex = Math.min(Math.max(releaseHeroIndex, 0), items.length - 1);
  const hero = items[safeHeroIndex] || items[0];
  const remaining = items.filter((item) => item.title !== hero.title).slice(0, 3);

  const heroImage = escapeHtml(hero.image || GAME_IMAGE_FALLBACK);
  const heroTitle = escapeHtml(hero.title || 'Featured release');
  const heroBlurb = escapeHtml(hero.blurb ? decodeHtmlEntities(hero.blurb) : (hero.title || 'Featured release'));
  const heroGenre = escapeHtml(hero.genre || 'Game');
  const heroPlatform = escapeHtml(hero.platform || 'PC / Console');
  const heroRelease = escapeHtml(hero.release || 'Upcoming');

  const listMarkup = remaining.map((item) => {
    const itemTitle = escapeHtml(item.title || 'Upcoming release');
    const itemGenre = escapeHtml(item.genre || 'Game');
    const itemPlatform = escapeHtml(item.platform || 'PC / Console');
    const itemRelease = escapeHtml(item.release || 'Upcoming');
    const itemImage = escapeHtml(item.image || GAME_IMAGE_FALLBACK);
    return `
      <button type="button" class="release-list-card" data-release-id="${escapeHtml(item.id)}">
        <div class="release-list-card__image-wrap">
          <img src="${itemImage}" alt="${itemTitle}" loading="lazy" decoding="async" />
        </div>
        <div class="release-list-card__body">
          <div class="release-list-card__header">
            <h3>${itemTitle}</h3>
            <span class="release-arrow" aria-hidden="true">→</span>
          </div>
          <div class="release-meta">
            <span class="release-pill">${itemGenre}</span>
            <span class="release-pill">${itemPlatform}</span>
            <span class="release-pill">${itemRelease}</span>
          </div>
        </div>
      </button>
    `;
  }).join('');

  container.innerHTML = `
    <button type="button" class="release-hero" data-release-id="${escapeHtml(hero.id)}" role="group" aria-roledescription="carousel" aria-label="Upcoming releases carousel" aria-live="polite">
      <div class="release-hero__image">
        <img src="${heroImage}" alt="${heroTitle}" loading="eager" decoding="async" fetchpriority="high" />
      </div>
      <div class="release-hero__body">
        <div class="release-hero__eyebrow">Featured release</div>
        <div class="release-title-row">
          <h3>${heroTitle}</h3>
          <span class="release-arrow" aria-hidden="true">→</span>
        </div>
        <p>${heroBlurb}</p>
        <div class="release-meta">
          <span class="release-pill">${heroGenre}</span>
          <span class="release-pill">${heroPlatform}</span>
          <span class="release-pill">${heroRelease}</span>
        </div>
      </div>
    </button>
    <div class="release-list-grid" role="list" aria-label="More upcoming releases">${listMarkup}</div>
  `;

  const heroElement = container.querySelector('.release-hero');
  if (heroElement) {
    heroElement.setAttribute('aria-label', `Featured release: ${heroTitle}`);
  }
}

function stopReleaseCalendarRotation() {
  if (releaseRotationTimer) {
    window.clearInterval(releaseRotationTimer);
    releaseRotationTimer = null;
  }
}

function startReleaseCalendarRotation() {
  const container = document.getElementById('upcomingReleaseRotator');
  if (!container || container.dataset.releaseRotationStarted === 'true') return;

  container.dataset.releaseRotationStarted = 'true';
  renderReleaseCalendar();
  stopReleaseCalendarRotation();
  releaseRotationTimer = window.setInterval(() => {
    const items = getFilteredReleaseCalendar();
    if (!releaseAutoRotateEnabled || items.length < 2) return;
    releaseHeroIndex = advanceReleaseIndex(releaseHeroIndex, 1, items.length);
    renderReleaseCalendar();
  }, 7000);

  container.addEventListener('mouseenter', () => { releaseAutoRotateEnabled = false; });
  container.addEventListener('mouseleave', () => { releaseAutoRotateEnabled = true; });
  container.addEventListener('focusin', () => { releaseAutoRotateEnabled = false; });
  container.addEventListener('focusout', () => { releaseAutoRotateEnabled = true; });
}

function rotateReleaseCalendar(direction) {
  const items = getFilteredReleaseCalendar();
  if (!items.length) return;
  releaseHeroIndex = advanceReleaseIndex(releaseHeroIndex, direction, items.length);
  releaseAutoRotateEnabled = false;
  renderReleaseCalendar();
  window.setTimeout(() => { releaseAutoRotateEnabled = true; }, 5000);
}

const recentPointerActivations = new WeakMap();

function bindResponsiveActivation(element, handler, options = {}) {
  if (!element || element.dataset.responsiveActivationBound === 'true') return;
  element.dataset.responsiveActivationBound = 'true';
  const preventDefault = options.preventDefault !== false;

  const activate = (event) => {
    if (preventDefault) event.preventDefault();
    event.stopPropagation();
    handler(event);
  };

  element.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    recentPointerActivations.set(element, performance.now());
    activate(event);
  });

  element.addEventListener('click', (event) => {
    const recentPointerAt = recentPointerActivations.get(element) || 0;
    if (performance.now() - recentPointerAt < 650) return;
    activate(event);
  });
}

function closeMobileMenu({ restoreFocus = false } = {}) {
  if (!document.body.classList.contains('menu-open')) return;
  document.body.classList.remove('menu-open');
  menuToggle?.setAttribute('aria-expanded', 'false');
  menuToggle?.setAttribute('aria-label', 'Open menu');
  if (restoreFocus) menuToggle?.focus();
}

function initializeGlobalInteractionSafety() {
  if (document.documentElement.dataset.globalInteractionSafetyReady === 'true') return;
  document.documentElement.dataset.globalInteractionSafetyReady = 'true';

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (supportDialog?.open) {
      event.preventDefault();
      closeSupport();
      supportNavButton?.focus();
      return;
    }

    if (barcodeScannerDialog?.open) {
      event.preventDefault();
      stopBarcodeScanner();
      scanBarcodeButton?.focus();
      return;
    }

    if (document.body.classList.contains('menu-open')) {
      event.preventDefault();
      closeMobileMenu({ restoreFocus: true });
    }
  });

  document.addEventListener('pointerdown', (event) => {
    const interactive = event.target.closest('button, a, input, select, textarea, [role="button"], [role="option"]');
    if (interactive) interactive.classList.add('is-pointer-active');
  }, { passive: true });

  document.addEventListener('pointerup', (event) => {
    event.target.closest('button, a, [role="button"], [role="option"]')?.classList.remove('is-pointer-active');
  }, { passive: true });

  document.addEventListener('pointercancel', () => {
    document.querySelectorAll('.is-pointer-active').forEach((element) => element.classList.remove('is-pointer-active'));
  }, { passive: true });
}

function initializeReleaseCarouselControls() {
  const rotator = document.getElementById('upcomingReleaseRotator');
  const previousButton = document.getElementById('releasePrevButton');
  const nextButton = document.getElementById('releaseNextButton');
  if (!rotator) {
    return;
  }

  // Bind the two persistent toolbar buttons directly. They live outside the
  // dynamically rendered carousel, so these listeners survive every render.
  const bindButton = (button, direction) => {
    if (!button || button.dataset.releaseControlBound === 'true') {
      return;
    }

    button.dataset.releaseControlBound = 'true';
    bindResponsiveActivation(button, () => rotateReleaseCalendar(direction));
  };

  bindButton(previousButton, -1);
  bindButton(nextButton, 1);

  // Delegated fallback keeps desktop clicks working if the toolbar is replaced
  // by a future render or browser accessibility layer.
  if (document.documentElement.dataset.releaseDelegationBound !== 'true') {
    document.documentElement.dataset.releaseDelegationBound = 'true';
    document.addEventListener('click', (event) => {
    const hub=event.target.closest('[data-hub-type][data-hub-value]'); if(hub){void openDiscoveryHub(hub.dataset.hubType,hub.dataset.hubValue);return;}
    const hubGame=event.target.closest('[data-catalog-id]'); if(hubGame){const item=GAME_CATALOG.find(x=>String(x.id)===String(hubGame.dataset.catalogId));if(item)showCatalogDetail(item);return;}
    const collection=event.target.closest('[data-collection-id]'); if(collection){const mapping={'top-rated':'','hidden-gems':'','rpg-essentials':'rpg','local-multiplayer':'multiplayer'};void openDiscoveryHub('genre',mapping[collection.dataset.collectionId]||'');document.getElementById('hubResults')?.scrollIntoView({behavior:'smooth'});return;}

      if (event.target.closest('#releasePrevButton')) {
        event.preventDefault();
        rotateReleaseCalendar(-1);
      } else if (event.target.closest('#releaseNextButton')) {
        event.preventDefault();
        rotateReleaseCalendar(1);
      }
    });
  }

  if (rotator.dataset.controlsReady === 'true') {
    return;
  }

  rotator.dataset.controlsReady = 'true';
  let pointerStart = null;

  rotator.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    rotator.setPointerCapture?.(event.pointerId);
  });

  rotator.addEventListener('pointerup', (event) => {
    if (!pointerStart || event.pointerId !== pointerStart.id) {
      return;
    }

    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    pointerStart = null;

    // Keep vertical page scrolling natural; only treat a clear horizontal gesture as a swipe.
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    rotateReleaseCalendar(deltaX < 0 ? 1 : -1);
  });

  const cancelPointer = () => {
    pointerStart = null;
  };
  rotator.addEventListener('pointercancel', cancelPointer);
  rotator.addEventListener('lostpointercapture', cancelPointer);

  rotator.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      rotateReleaseCalendar(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      rotateReleaseCalendar(1);
    }
  });
}

function renderReleaseArticles() {
  const container = document.getElementById('releaseCoverageList');
  const updated = document.getElementById('releaseCoverageUpdated');
  if (!container) return;
  if (!releaseArticlesData.length) {
    container.innerHTML = '<div class="empty-state">No recent matching release coverage was found in the current seven-day window.</div>';
    if (updated) updated.textContent = 'Rolling 7-day window';
    return;
  }
  const visibleCount = Math.min(3, releaseArticlesData.length);
  const visible = Array.from({ length: visibleCount }, (_, offset) => releaseArticlesData[(releaseArticleIndex + offset) % releaseArticlesData.length]);
  container.innerHTML = visible.map((article) => `
    <a class="release-article-card" href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">
      <span class="release-article-card__source">${escapeHtml(article.source || 'Gaming press')}</span>
      <h3>${escapeHtml(article.title)}</h3>
      <p>${escapeHtml(new Date(article.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</p>
      <span class="release-article-card__link">Read coverage ↗</span>
    </a>`).join('');
}

function startReleaseArticleRotation() {
  if (releaseArticleTimer) window.clearInterval(releaseArticleTimer);
  renderReleaseArticles();
  if (releaseArticlesData.length <= 3) return;
  releaseArticleTimer = window.setInterval(() => {
    releaseArticleIndex = (releaseArticleIndex + 1) % releaseArticlesData.length;
    renderReleaseArticles();
  }, 9000);
}

function renderReleaseTrustStatus() {
  const container = document.getElementById('releaseTrustStatus');
  if (!container) return;
  if (!releaseTrustStatus) {
    container.textContent = 'Checking release data sources…';
    return;
  }
  const releaseSummary = releaseTrustStatus.releases || {};
  const coverageSummary = releaseTrustStatus.coverage || {};
  const releaseState = releaseSummary.stale ? 'Using last known release data' : 'Release data current';
  const coverageState = coverageSummary.stale ? 'Coverage cache may be stale' : 'Coverage refreshed';
  container.innerHTML = `
    <div><strong>${escapeHtml(releaseState)}</strong><span>${escapeHtml(releaseSummary.sourceLabel || 'Public source')} · ${Number(releaseSummary.hardDateCount || 0)} hard-date releases</span></div>
    <div><strong>${escapeHtml(coverageState)}</strong><span>${Number(coverageSummary.itemCount || 0)} attributed links · ${Number(coverageSummary.windowDays || 7)}-day window</span></div>
    <p>${escapeHtml(releaseSummary.disclosure || 'Release dates are validated before display.')}</p>`;
}

async function refreshReleaseTrustStatus() {
  try {
    releaseTrustStatus = await apiRequest('/api/releases/status');
  } catch (error) {
    console.warn('Release source status could not be loaded:', error);
    releaseTrustStatus = { releases: { stale: true, sourceLabel: 'Release source unavailable', hardDateCount: 0 }, coverage: { stale: true, itemCount: 0, windowDays: 7 } };
  }
  renderReleaseTrustStatus();
}

async function refreshReleaseArticles() {
  try {
    const data = await apiRequest('/api/release-articles');
    releaseArticlesData = (Array.isArray(data?.items) ? data.items : []).map((article) => normalizeCoverageArticle(article)).filter(Boolean);
    releaseArticleIndex = 0;
    const updated = document.getElementById('releaseCoverageUpdated');
    if (updated) updated.textContent = data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleDateString()}` : 'Rolling 7-day window';
  } catch (error) {
    console.warn('Release coverage could not be loaded:', error);
    releaseArticlesData = [];
  }
  startReleaseArticleRotation();
  void refreshReleaseTrustStatus();
}

async function refreshReleaseCalendar() {
  if (releaseRefreshPromise) {
    return releaseRefreshPromise;
  }

  releaseRefreshPromise = (async () => {
    const container = document.getElementById('upcomingReleaseRotator');
    if (container) {
      showReleaseCalendarSkeleton();
    }

    try {
      const data = await apiRequest('/api/releases');
      const liveItems = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.releases)
          ? data.releases
          : Array.isArray(data)
            ? data
            : [];
      releaseFeedUpdatedAt = String(data?.updatedAt || '');
      releaseCalendarData = normalizeReleaseQueue(liveItems.map(normalizeReleaseEntry), { horizonDays: 365 });
    } catch (error) {
      console.warn('Using fallback release calendar data:', error);
      releaseCalendarData = [];
    }

    if (container) {
      renderReleaseCalendar();
    }

    if (window.location.hash === '#upcoming/calendar') {
      renderReleaseCalendarList();
    } else if (window.location.hash.startsWith('#upcoming/')) {
      const releaseId = window.location.hash.slice('#upcoming/'.length);
      const release = findReleaseById(releaseId);
      if (release) {
        renderReleaseDetail(release);
      }
    }

    return releaseCalendarData;
  })();

  try {
    return await releaseRefreshPromise;
  } finally {
    releaseRefreshPromise = null;
  }
}

function getGameArtworkUrl(item) {
  const raw = item?.heroImage || item?.headerImage || item?.image || item?.coverImage || '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function isPreferredCapsuleArtwork(url) {
  return /(?:header|hero|capsule|library_hero|wide|landscape)\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url)
    || /steamstatic|steamusercontent|akamaihd/i.test(url);
}

function getBackgroundCoverCandidates() {
  const records = [...releaseCalendarData, ...PREMIUM_RELEASE_FALLBACK, ...GAME_CATALOG];
  const seen = new Set();
  return records.map((item) => ({
    id: String(item?.id || item?.appId || item?.name || item?.title || ''),
    title: String(item?.title || item?.name || 'Featured game'),
    image: getGameArtworkUrl(item),
    platform: String(item?.platform || item?.platforms || ''),
    genre: String(item?.genre || item?.genres || ''),
    score: Number(item?.metacriticScore || item?.score || item?.rating || 0),
    release: item?.release || item?.releaseDate || '',
    source: item
  })).filter((item) => {
    if (!/^https?:\/\//i.test(item.image)) return false;
    if (/game-cover-placeholder|placehold\.co|placeholder|text=/i.test(item.image)) return false;
    if (seen.has(item.image)) return false;
    seen.add(item.image);
    return true;
  }).sort((a, b) => Number(isPreferredCapsuleArtwork(b.image)) - Number(isPreferredCapsuleArtwork(a.image)) || b.score - a.score);
}

function preloadSharpBackgroundCover(item) {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      const width = image.naturalWidth || 0;
      const height = image.naturalHeight || 0;
      resolve(width >= 1000 && height >= 450 && width >= height * 1.35 ? { ...item, naturalWidth: width, naturalHeight: height } : null);
    };
    image.onerror = () => resolve(null);
    image.src = item.image;
  });
}

function renderBackgroundCoverSet(layer, covers) {
  layer.replaceChildren();
  covers.forEach((cover, index) => {
    const panel = document.createElement('div');
    panel.className = `background-cover-panel background-cover-panel--${index + 1}`;
    panel.style.backgroundImage = `url("${String(cover.image || cover).replace(/"/g, '%22')}")`;
    panel.setAttribute('role', 'presentation');
    layer.append(panel);
  });
}

function shuffledWithoutImmediateRepeat(items, previousIds = []) {
  const previous = new Set(previousIds);
  const preferred = items.filter((item) => !previous.has(item.id || item.image));
  const pool = preferred.length >= 6 ? preferred : items;
  return pool.map((item) => ({ item, sort: Math.random() })).sort((a, b) => a.sort - b.sort).map(({ item }) => item);
}

function setupBackgroundParallax() {
  if (document.documentElement.dataset.backgroundParallaxReady === 'true') return;
  document.documentElement.dataset.backgroundParallaxReady = 'true';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let targetX = 0, targetY = 0, currentX = 0, currentY = 0, rafId = 0;
  const animate = () => {
    currentX += (targetX - currentX) * 0.075;
    currentY += (targetY - currentY) * 0.075;
    document.documentElement.style.setProperty('--background-parallax-x', `${currentX.toFixed(2)}px`);
    document.documentElement.style.setProperty('--background-parallax-y', `${currentY.toFixed(2)}px`);
    rafId = requestAnimationFrame(animate);
  };
  window.addEventListener('pointermove', (event) => {
    targetX = ((event.clientX / Math.max(window.innerWidth, 1)) - 0.5) * -18;
    targetY = ((event.clientY / Math.max(window.innerHeight, 1)) - 0.5) * -12;
  }, { passive: true });
  window.addEventListener('scroll', () => { targetY = Math.max(-16, Math.min(16, window.scrollY * -0.015)); }, { passive: true });
  rafId = requestAnimationFrame(animate);
  window.addEventListener('pagehide', () => cancelAnimationFrame(rafId), { once: true });
}

function buildTrendingCollections(items) {
  const container = document.getElementById('trendingCollections');
  if (!container) return;
  const groups = [
    { title: 'Top Rated', icon: '★', items: [...items].sort((a, b) => b.score - a.score).slice(0, 4) },
    { title: 'Coming Soon', icon: '◷', items: items.filter((item) => item.release).slice(0, 4) },
    { title: 'PC Favorites', icon: '▣', items: items.filter((item) => /pc|windows|steam/i.test(item.platform)).slice(0, 4) }
  ].filter((group) => group.items.length);
  container.innerHTML = groups.map((group) => `
    <button type="button" class="trending-collection" data-featured-id="${escapeHtml(group.items[0]?.id || '')}" aria-label="Open ${escapeHtml(group.title)} collection">
      <span class="trending-collection__icon" aria-hidden="true">${group.icon}</span>
      <span class="trending-collection__copy"><strong>${escapeHtml(group.title)}</strong><small>${group.items.length} featured titles</small></span>
      <span class="trending-collection__arrow" aria-hidden="true">→</span>
    </button>`).join('');
}

function renderDiscoveryHero(items, index = 0) {
  const hero = document.getElementById('discoveryHero');
  const artwork = document.getElementById('discoveryHeroArtwork');
  const title = document.getElementById('discoveryHeroTitle');
  const copy = document.getElementById('discoveryHeroCopy');
  const chips = document.getElementById('heroPlatformChips');
  const progress = document.getElementById('heroProgress');
  const primary = document.getElementById('heroPrimaryAction');
  if (!hero || !artwork || !title || !copy || !items.length) return;
  const item = items[index % items.length];
  hero.dataset.featuredId = item.id;
  artwork.style.backgroundImage = `url("${String(item.image).replace(/"/g, '%22')}")`;
  title.textContent = item.title;
  copy.textContent = item.source?.blurb || item.source?.description || `${item.genre || 'Featured'} title${item.platform ? ` for ${item.platform}` : ''}.`;
  if (chips) chips.innerHTML = [item.platform, item.genre].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join('');
  if (progress) progress.innerHTML = items.slice(0, 5).map((_, dotIndex) => `<span class="${dotIndex === index % Math.min(items.length, 5) ? 'is-active' : ''}"></span>`).join('');
  if (primary) {
    primary.dataset.featuredId = item.id;
    primary.setAttribute('aria-label', `View ${item.title}`);
  }
}


function initializeDiscoveryControls() {
  if (document.documentElement.dataset.discoveryControlsReady === 'true') return;
  document.documentElement.dataset.discoveryControlsReady = 'true';

  document.addEventListener('click', (event) => {
    const primary = event.target.closest('#heroPrimaryAction');
    if (primary) {
      event.preventDefault();
      event.stopPropagation();
      const featuredId = primary.dataset.featuredId || document.getElementById('discoveryHero')?.dataset.featuredId || '';
      const release = featuredId ? findReleaseById(featuredId) : null;
      window.location.hash = release ? `#upcoming/${encodeURIComponent(featuredId)}` : '#game-finder';
      return;
    }

    const secondary = event.target.closest('#heroSecondaryAction');
    if (secondary) {
      event.preventDefault();
      event.stopPropagation();
      document.getElementById('upcomingReleaseRotator')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const collection = event.target.closest('.trending-collection[data-featured-id]');
    if (collection) {
      event.preventDefault();
      event.stopPropagation();
      const featuredId = collection.dataset.featuredId || '';
      const release = featuredId ? findReleaseById(featuredId) : null;
      window.location.hash = release ? `#upcoming/${encodeURIComponent(featuredId)}` : '#game-finder';
    }
  });
}

async function startBackgroundRotation() {
  const rotator = document.getElementById('backgroundRotator');
  const rotatorSecondary = document.getElementById('backgroundRotatorSecondary');
  if (!rotator || !rotatorSecondary || rotator.dataset.rotationReady === 'true') return;
  rotator.dataset.rotationReady = 'true';
  setupBackgroundParallax();
  const candidates = getBackgroundCoverCandidates();
  if (!candidates.length) return;
  const preferredSample = candidates.slice(0, 60);
  const checked = await Promise.all(preferredSample.map(preloadSharpBackgroundCover));
  const sharpCovers = checked.filter(Boolean);
  const images = sharpCovers.length ? sharpCovers : preferredSample.filter((item) => isPreferredCapsuleArtwork(item.image));
  if (!images.length) return;
  buildTrendingCollections(images);
  const heroItems = images.slice(0, Math.min(8, images.length));
  let heroIndex = 0;
  renderDiscoveryHero(heroItems, heroIndex);
  initializeDiscoveryControls();
  let activeLayer = rotator;
  let upcomingLayer = rotatorSecondary;
  let previousIds = [];
  const getNextSet = () => {
    const shuffled = shuffledWithoutImmediateRepeat(images, previousIds);
    const uniqueSet = shuffled.slice(0, Math.min(6, shuffled.length));
    const set = Array.from({ length: 6 }, (_, index) => uniqueSet[index % uniqueSet.length]);
    previousIds = set.map((item) => item.id || item.image);
    return set;
  };
  renderBackgroundCoverSet(activeLayer, getNextSet());
  activeLayer.classList.add('is-active');
  const rotate = () => {
    renderBackgroundCoverSet(upcomingLayer, getNextSet());
    upcomingLayer.classList.add('is-active');
    heroIndex = (heroIndex + 1) % heroItems.length;
    renderDiscoveryHero(heroItems, heroIndex);
    window.setTimeout(() => {
      activeLayer.classList.remove('is-active');
      [activeLayer, upcomingLayer] = [upcomingLayer, activeLayer];
    }, 1800);
    window.setTimeout(rotate, 12000 + Math.floor(Math.random() * 3001));
  };
  window.setTimeout(rotate, 12000 + Math.floor(Math.random() * 3001));
}

function refreshGameMatchRecommendations() {
  buildGameMatchCandidates();
}

function getPlayNextLibraryGames() {
  return getCurrentLibrary().map(normalizeGame);
}

function getPlayNextRecommendationOptions() {
  return {
    ...playNextFilters,
    history: playNextState.history
  };
}

function updatePlayNextCardState() {
  if (!gameMatchCard) {
    return;
  }

  if (!gameMatchCandidates.length) {
    gameMatchCard.innerHTML = '<p class="empty-state">No Play Next picks yet. Add a few games to your library to start personalizing recommendations.</p>';
    return;
  }

  const currentMatch = gameMatchCandidates[gameMatchIndex];
  const safeTitle = escapeHtml(currentMatch.title || currentMatch.name || 'Untitled game');
  const safePlatform = escapeHtml(currentMatch.platform || 'Platform unknown');
  const safeImage = escapeHtml(currentMatch.image || 'https://placehold.co/180x240/0f172a/ffffff?text=Game');
  const actionLabel = isGameWishlisted(currentMatch.id || currentMatch.title || currentMatch.name) ? 'Wishlisted' : 'Add to Wishlist';
  const reasonsMarkup = (currentMatch.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');

  gameMatchCard.innerHTML = `
    <article class="match-swipe-card" data-match-id="${escapeHtml(currentMatch.id || currentMatch.title || currentMatch.name)}">
      <img src="${safeCoverImage}" alt="${safeTitle}" loading="eager" />
      <div class="match-content">
        <div class="match-badge">Play Next ${gameMatchIndex + 1}/${gameMatchCandidates.length}</div>
        <h3>${safeTitle}</h3>
        <div class="release-meta">
          <span class="release-pill">${safePlatform}</span>
          <span class="release-pill">Score ${Math.round(currentMatch.score || 0)}</span>
          <span class="release-pill">${escapeHtml(currentMatch.status || 'Backlog')}</span>
        </div>
        <ul class="match-reasons">${reasonsMarkup}</ul>
        <div class="match-actions">
          <button type="button" data-match-action="wishlist">${actionLabel}</button>
          <button type="button" class="danger" data-match-action="dismiss">Not interested</button>
        </div>
        <div class="match-actions match-actions--secondary">
          <button type="button" class="ghost" data-match-action="next">Recommend another</button>
          <button type="button" class="ghost" data-match-action="reset">Reset dismissed</button>
        </div>
      </div>
    </article>
  `;
}

function buildCatalogSearchIndex() {
  const fallbackCatalog = Array.isArray(GAME_CATALOG) ? GAME_CATALOG : [];
  return fallbackCatalog.map((game) => ({
    id: game.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: game.name,
    platform: game.platform,
    image: game.image,
    price: game.price,
    metacriticScore: game.metacriticScore,
    description: game.description
  }));
}

function clearStoredAuth() {
  localStorage.removeItem('gamevault-current-user');
  localStorage.removeItem('gamevault-auth-token');
  localStorage.removeItem(AUTH_SESSION_KEY);
}

function setRememberPreference(enabled) {
  const shouldRemember = Boolean(enabled);
  localStorage.setItem(REMEMBER_ME_KEY, shouldRemember ? 'true' : 'false');

  if (!shouldRemember) {
    clearStoredAuth();
  }
}

function readStoredSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    if (!saved || !saved.user || !saved.token || !saved.expiresAt) {
      return null;
    }

    if (Number(saved.expiresAt) <= Date.now()) {
      clearStoredAuth();
      return null;
    }

    return saved;
  } catch {
    clearStoredAuth();
    return null;
  }
}

function persistSession(user, token, remember) {
  if (remember) {
    const sessionData = {
      user,
      token,
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData));
    localStorage.setItem('gamevault-current-user', user);
    localStorage.setItem('gamevault-auth-token', token);
    return;
  }

  clearStoredAuth();
}

function syncRememberCheckboxes() {
  const rememberEnabled = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
  if (rememberMeCheckbox) {
    rememberMeCheckbox.checked = rememberEnabled;
  }
  if (rememberMeLoginCheckbox) {
    rememberMeLoginCheckbox.checked = rememberEnabled;
  }
}

async function logout() {
  const previousUser = currentUser;
  clearProfilePreview();
  currentUser = '';
  authToken = '';
  usernameInput.value = '';
  if (authEmailInput) authEmailInput.value = '';
  if (authPasswordInput) authPasswordInput.value = '';
  setEmailVerificationState(false);
  setRememberPreference(false);
  clearStoredAuth();
  syncRememberCheckboxes();

  const anonymousState = createAnonymousSessionState();
  activeLibraryOwner = anonymousState.activeLibraryOwner;
  friendsState = anonymousState.friendsState;
  notifications = anonymousState.notifications;
  activityItems = anonymousState.activityItems;
  queueItems = anonymousState.queueItems;
  wishlistItems = anonymousState.wishlistItems;

  try {
    if (previousUser) {
      await apiRequest('/api/logout', { method: 'POST' });
    }
  } catch {
    // ignore logout sync errors and keep the client session cleared
  }

  renderLibrary();
  updateSummary();
  renderCollectionStatistics();
  renderWishlistView();
  renderQueueView();
  renderNotifications();
  renderActivityView();
  renderFriendHub();
}

async function restoreRememberedSession() {
  const rememberEnabled = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
  if (!rememberEnabled) {
    clearStoredAuth();
    return false;
  }

  const storedSession = readStoredSession();
  if (!storedSession) {
    return false;
  }

  currentUser = storedSession.user || '';
  authToken = storedSession.token || '';
  usernameInput.value = currentUser;

  try {
    const authStatusResponse = await apiRequest('/api/auth/status');
    setEmailVerificationState(true);
    updateCompactAccountCard();
    await Promise.all([loadLibraryFromServer(), loadWishlistFromServer(), loadQueueFromServer()]);
    await loadFriendState();
    await loadPrivacySettings();
    await loadProfileSettings();
    await loadNotifications();
    renderLibrary();
    updateSummary();
    updateProfileHub();
    renderWishlistView();
    renderQueueView();
    return true;
  } catch {
    clearStoredAuth();
    currentUser = '';
    authToken = '';
    return false;
  }
}

function setSyncStatus(message, tone = 'idle') {
  if (!syncStatus) {
    return;
  }

  syncStatus.textContent = message;
  syncStatus.dataset.tone = tone;
}

function safeParseJson(rawValue, fallback) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed;
  } catch {
    return fallback;
  }
}

function safeStringifyJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function sanitizeLibraryData(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(Boolean).map((game) => ({
    ...game,
    id: String(game?.id || ''),
    title: String(game?.title || ''),
    platform: String(game?.platform || ''),
    condition: String(game?.condition || 'Good'),
    purchasePrice: Number(game?.purchasePrice || 0),
    currentValue: Number(game?.currentValue || 0),
    metacriticScore: Number(game?.metacriticScore || 0),
    notes: String(game?.notes || ''),
    comments: Array.isArray(game?.comments) ? game.comments : [],
    playtimeMinutes: Number(game?.playtimeMinutes || 0),
    completionPercent: Number(game?.completionPercent || 0),
    coverImage: String(game?.coverImage || ''),
    status: normalizePlayStatus(game?.status, Number(game?.completionPercent || 0)),
    completedAt: game?.status === 'Completed' ? (game?.completedAt || new Date().toISOString()) : null
  }));
}

function sanitizeUserStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, storedValue]) => storedValue !== undefined).map(([key, storedValue]) => [String(key), sanitizeLibraryData(storedValue)])
  );
}

function sanitizeProfileStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, storedValue]) => {
      if (!storedValue || typeof storedValue !== 'object' || Array.isArray(storedValue)) {
        return [String(key), { playtimeMinutes: 0 }];
      }

      return [String(key), {
        playtimeMinutes: Number(storedValue.playtimeMinutes || 0)
      }];
    })
  );
}

function loadUsers() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return sanitizeUserStore(safeParseJson(raw, {}));
}

function saveUsers(users) {
  localStorage.setItem(STORAGE_KEY, safeStringifyJson(sanitizeUserStore(users)));
}

function getFriendlyApiError(status, serverMessage = '') {
  const cleanMessage = String(serverMessage || '').trim();
  if (cleanMessage && !/internal server error/i.test(cleanMessage)) return cleanMessage;

  const messages = {
    400: 'Please check the information you entered and try again.',
    401: 'Please log in to continue.',
    403: 'You do not have permission to perform that action.',
    404: 'That item could not be found.',
    409: 'That information is already in use. Please choose something different.',
    413: 'That upload is too large.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: 'Project Sora ran into a temporary problem. Please try again.',
    502: 'The service is temporarily unavailable. Please try again shortly.',
    503: 'The service is temporarily unavailable. Please try again shortly.'
  };

  return messages[Number(status)] || `Request failed (${status}). Please try again.`;
}

async function apiRequest(path, options = {}) {
  const requestUrl = new URL(path, window.location.origin);

  try {
    const response = await fetch(requestUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      }
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error(getFriendlyApiError(response.status, data.error));
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Unable to reach Project Sora. Check your connection and try again.');
    }
    throw error;
  }
}

function getLibraryForOwner(owner) {
  const users = loadUsers();
  if (!owner) {
    return [];
  }

  const library = users[owner] || [];
  return Array.isArray(library) ? library : [];
}

function applyPlayStatusToGame(game, overrides = {}) {
  const safeGame = game || {};
  const nextCompletionPercent = Math.max(0, Math.min(100, Number(overrides.completionPercent ?? safeGame.completionPercent ?? 0)));
  const nextStatus = overrides.status ?? safeGame.status ?? '';
  return normalizeGame({
    ...safeGame,
    ...overrides,
    completionPercent: nextCompletionPercent,
    status: nextStatus,
    completedAt: overrides.completedAt ?? safeGame.completedAt ?? null
  });
}

function getCurrentLibrary() {
  return getLibraryForOwner(currentUser);
}

function getDisplayedLibrary() {
  const owner = resolveLibraryOwner(currentUser, activeLibraryOwner);
  return getLibraryForOwner(owner);
}

function setCurrentLibrary(games) {
  const users = loadUsers();
  const owner = resolveLibraryOwner(currentUser, activeLibraryOwner);
  users[owner] = Array.isArray(games) ? games.map((game) => applyPlayStatusToGame(game)) : [];
  saveUsers(users);
}

function clearProfilePreview() {
  activeLibraryOwner = null;
}

async function showProfilePreview(profileName) {
  const normalizedHandle = String(profileName || '').trim().replace(/^@/, '');
  if (!normalizedHandle) {
    return false;
  }

  try {
    renderPublicProfileSkeleton();
    const response = await apiRequest(`/api/profile/${encodeURIComponent(normalizedHandle)}`);
    renderPublicProfilePage(response);
    const nextHash = `#profile/${encodeURIComponent(response?.profile?.handle || normalizedHandle)}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash);
    }
    return true;
  } catch (error) {
    if (publicProfileContent) {
      publicProfileContent.innerHTML = `<div class="empty-state">${escapeHtml(error?.message || 'Unable to load this profile.')}</div>`;
    }
    showPublicProfileView();
    return false;
  }
}

function sanitizeActivityEventForClient(event) {
  return {
    eventId: String(event?.eventId || ''),
    type: String(event?.type || ''),
    gameId: String(event?.gameId || ''),
    displayTitle: String(event?.displayTitle || ''),
    timestamp: String(event?.timestamp || new Date().toISOString())
  };
}

async function pushActivityEvent(event) {
  if (!authToken || !currentUser || !event || !event.type) {
    return null;
  }

  try {
    const response = await apiRequest('/api/activity', {
      method: 'POST',
      body: JSON.stringify(event)
    });
    if (Array.isArray(response?.items)) {
      activityItems = response.items.map((entry) => sanitizeActivityEventForClient(entry));
      activityOffset = 0;
      activityHasMore = false;
      renderActivityView();
    }
    return response?.item || null;
  } catch {
    return null;
  }
}

async function loadActivityHistory(reset = true) {
  if (!authToken || !currentUser || activityBusy) {
    return;
  }

  activityBusy = true;
  if (reset) {
    activityOffset = 0;
  }

  try {
    const response = await apiRequest(`/api/activity?limit=8&offset=${activityOffset}`);
    const nextItems = Array.isArray(response?.items) ? response.items.map((entry) => sanitizeActivityEventForClient(entry)) : [];
    activityItems = reset ? nextItems : [...activityItems, ...nextItems];
    activityHasMore = Boolean(response?.hasMore);
    activityOffset = reset ? nextItems.length : activityOffset + nextItems.length;
    renderActivityView();
  } catch {
    if (reset) {
      activityItems = [];
      activityHasMore = false;
      renderActivityView();
    }
  } finally {
    activityBusy = false;
  }
}

async function clearActivityHistory() {
  if (!authToken || !currentUser) {
    activityItems = [];
    renderActivityView();
    return;
  }

  try {
    await apiRequest('/api/activity', { method: 'DELETE' });
    activityItems = [];
    activityHasMore = false;
    activityOffset = 0;
    renderActivityView();
  } catch {
    activityItems = [];
    renderActivityView();
  }
}

function renderActivityView() {
  if (!activityContainer) {
    return;
  }

  if (!authToken || !currentUser) {
    activityContainer.innerHTML = '<div class="empty-state">Sign in to keep a private activity history.</div>';
    if (activityLoadMoreButton) activityLoadMoreButton.hidden = true;
    if (activityClearButton) activityClearButton.hidden = true;
    return;
  }

  if (!activityItems.length) {
    activityContainer.innerHTML = '<div class="empty-state">No activity yet. Your private history will appear here.</div>';
  } else {
    activityContainer.innerHTML = activityItems.map((event) => `
      <article class="activity-item">
        <div class="activity-item__meta">
          <strong>${escapeHtml(event.type.replace(/_/g, ' '))}</strong>
          <span>${escapeHtml(new Date(event.timestamp).toLocaleString())}</span>
        </div>
        <p>${escapeHtml(event.displayTitle || event.gameId || 'Activity item')}</p>
      </article>
    `).join('');
  }

  if (activityLoadMoreButton) {
    activityLoadMoreButton.hidden = !activityHasMore;
  }
  if (activityClearButton) {
    activityClearButton.hidden = false;
  }
}

async function persistLibraryState(games, options = {}) {
  const { renderAfterSave = true, updateProfile = true } = options;
  setCurrentLibrary(games);

  if (renderAfterSave) {
    renderLibrary();
    updateSummary();
    renderCollectionStatistics();
    if (updateProfile) {
      updateProfileHub();
    }
  }

  setSyncStatus('Syncing library…', 'pending');
  try {
    await syncLibraryToServer(games);
    if (authToken && currentUser) {
      await loadActivityHistory(true);
    }
    setSyncStatus('Library synced to the server.', 'success');
  } catch (error) {
    const message = error?.message || 'Unable to sync library to the server.';
    setSyncStatus(`Sync pending: ${message}`, 'error');
  }

  return games;
}

function getWishlistStorageKey() {
  return 'gamevault-wishlist';
}

function getLocalWishlistItems() {
  const raw = localStorage.getItem(getWishlistStorageKey());
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalWishlistItems(items) {
  localStorage.setItem(getWishlistStorageKey(), JSON.stringify(items));
}

function getWishlistEntryKey(entry) {
  return String(entry?.gameId || entry?.id || entry?.title || '').trim();
}

function normalizeWishlistEntry(entry, fallbackTitle = '') {
  const gameId = String(entry?.gameId || entry?.id || entry?.title || '').trim() || `catalog-${String(fallbackTitle || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return {
    gameId,
    title: String(entry?.title || fallbackTitle || ''),
    platform: String(entry?.platform || ''),
    price: Number(entry?.price || 0),
    image: String(entry?.image || ''),
    releaseDate: String(entry?.releaseDate || entry?.release || ''),
    addedAt: String(entry?.addedAt || new Date().toISOString())
  };
}

function getWishlistItems() {
  return wishlistItems;
}

function setWishlistItems(nextItems) {
  wishlistItems = Array.isArray(nextItems) ? nextItems.map((entry) => normalizeWishlistEntry(entry, entry?.title || '')) : [];
}

function isGameWishlisted(gameId) {
  return getWishlistItems().some((entry) => entry.gameId === gameId);
}

function getWishlistItemByGameId(gameId) {
  return getWishlistItems().find((entry) => entry.gameId === gameId) || null;
}

async function syncWishlistToServer(items = getWishlistItems()) {
  if (!authToken || !currentUser) {
    saveLocalWishlistItems(items);
    return;
  }

  try {
    const response = await apiRequest('/api/wishlist', {
      method: 'POST',
      body: JSON.stringify(items[0] || { gameId: '__empty__', title: '' })
    });
    if (Array.isArray(response?.items)) {
      setWishlistItems(response.items);
    }
    saveLocalWishlistItems(getWishlistItems());
  } catch (error) {
    saveLocalWishlistItems(items);
    throw error;
  }
}

async function loadWishlistFromServer() {
  const localItems = getLocalWishlistItems();
  if (!authToken || !currentUser) {
    setWishlistItems(localItems);
    return;
  }

  try {
    const response = await apiRequest('/api/wishlist');
    const remoteItems = Array.isArray(response?.items) ? response.items : [];
    const reconciled = mergeWishlistEntries(localItems, remoteItems);
    setWishlistItems(reconciled);
    saveLocalWishlistItems(getWishlistItems());
    setSyncStatus('Wishlist loaded from the server.', 'success');
  } catch (error) {
    setWishlistItems(localItems);
    setSyncStatus(`Using local wishlist data. ${error?.message || 'Unable to reach the server.'}`, 'error');
  }
}

function mergeWishlistEntries(localItems = [], remoteItems = []) {
  const combined = [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(remoteItems) ? remoteItems : [])];
  const mergedMap = new Map();
  combined.forEach((entry) => {
    const normalized = normalizeWishlistEntry(entry, entry?.title || '');
    const existing = mergedMap.get(normalized.gameId);
    if (!existing || (normalized.addedAt || '') > (existing.addedAt || '')) {
      mergedMap.set(normalized.gameId, normalized);
    }
  });
  return Array.from(mergedMap.values()).sort((left, right) => (left.addedAt || '').localeCompare(right.addedAt || ''));
}

async function addGameToWishlist(entry) {
  const normalized = normalizeWishlistEntry(entry, entry?.title || entry?.name || '');
  if (!normalized.gameId) {
    return null;
  }

  const existingItems = getWishlistItems();
  if (existingItems.some((item) => item.gameId === normalized.gameId)) {
    return existingItems.find((item) => item.gameId === normalized.gameId);
  }

  const nextItems = [...existingItems, normalized];
  setWishlistItems(nextItems);
  saveLocalWishlistItems(getWishlistItems());

  if (authToken && currentUser) {
    try {
      const response = await apiRequest('/api/wishlist', {
        method: 'POST',
        body: JSON.stringify({ ...normalized, type: 'added_wishlist_item', eventId: `wishlist-add-${normalized.gameId}-${Date.now()}` })
      });
      if (Array.isArray(response?.items)) {
        setWishlistItems(response.items);
        saveLocalWishlistItems(getWishlistItems());
      }
      setSyncStatus('Added to wishlist.', 'success');
      return getWishlistItemByGameId(normalized.gameId);
    } catch (error) {
      setWishlistItems(nextItems);
      saveLocalWishlistItems(getWishlistItems());
      setSyncStatus(`Wishlist pending: ${error?.message || 'Unable to sync wishlist.'}`, 'error');
      return getWishlistItemByGameId(normalized.gameId);
    }
  }

  setSyncStatus('Added to wishlist locally.', 'success');
  return getWishlistItemByGameId(normalized.gameId);
}

async function removeGameFromWishlist(gameId) {
  const nextItems = getWishlistItems().filter((item) => item.gameId !== gameId);
  setWishlistItems(nextItems);
  saveLocalWishlistItems(getWishlistItems());

  if (authToken && currentUser) {
    try {
      const response = await apiRequest(`/api/wishlist/${encodeURIComponent(gameId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ type: 'removed_wishlist_item', eventId: `wishlist-remove-${gameId}-${Date.now()}`, gameId, title: gameId })
      });
      if (Array.isArray(response?.items)) {
        setWishlistItems(response.items);
        saveLocalWishlistItems(getWishlistItems());
      }
      setSyncStatus('Removed from wishlist.', 'success');
      return true;
    } catch (error) {
      setWishlistItems(nextItems);
      saveLocalWishlistItems(getWishlistItems());
      setSyncStatus(`Wishlist pending: ${error?.message || 'Unable to sync removal.'}`, 'error');
      return false;
    }
  }

  setSyncStatus('Removed from wishlist locally.', 'success');
  return true;
}

async function loadNotifications() {
  if (!authToken || !currentUser) {
    notifications = [];
    renderNotifications();
    return;
  }

  try {
    const response = await apiRequest('/api/notifications');
    notifications = Array.isArray(response?.items) ? response.items : [];
    renderNotifications();
  } catch {
    notifications = [];
    renderNotifications();
  }
}

function renderNotifications() {
  if (!notificationsContainer) {
    return;
  }

  if (!notifications.length) {
    notificationsContainer.innerHTML = '<div class="empty-state">No notifications yet. Price alerts will appear here when a trusted snapshot crosses your target.</div>';
    return;
  }

  notificationsContainer.innerHTML = notifications.map((notification) => `
    <article class="wishlist-card ${notification.read ? '' : 'wishlist-card--unread'}">
      <div class="wishlist-card__body">
        <div class="wishlist-card__header">
          <div>
            <h3>${escapeHtml(notification.title || 'Price alert')}</h3>
            <p>${escapeHtml(notification.message || 'A price alert crossed your target.')}</p>
          </div>
          <span class="release-badge">${notification.read ? 'Read' : 'Unread'}</span>
        </div>
        <div class="wishlist-card__meta">
          <span>${escapeHtml(notification.currency || 'USD')} ${Number(notification.observedPrice || 0).toFixed(2)}</span>
          <span>${new Date(notification.createdAt).toLocaleDateString()}</span>
        </div>
        <div class="wishlist-card__actions">
          <button type="button" class="wishlist-action wishlist-action--secondary" data-notification-action="toggle-read" data-notification-id="${escapeHtml(notification.id)}">${notification.read ? 'Mark unread' : 'Mark read'}</button>
        </div>
      </div>
    </article>
  `).join('');
}

function renderWishlistView() {
  const wishlistContainer = document.getElementById('wishlistContainer');
  if (!wishlistContainer) {
    return;
  }

  const items = getWishlistItems();
  if (!items.length) {
    wishlistContainer.innerHTML = '<div class="empty-state">Your wishlist is empty. Save a few featured games to plan your next acquisitions.</div>';
    return;
  }

  wishlistContainer.innerHTML = items.map((item) => `
    <article class="wishlist-card">
      <img src="${escapeHtml(item.image || 'https://placehold.co/180x240/0f172a/ffffff?text=Game')}" alt="${escapeHtml(item.title || 'Wishlist game')}" />
      <div class="wishlist-card__body">
        <div class="wishlist-card__header">
          <div>
            <h3>${escapeHtml(item.title || 'Untitled game')}</h3>
            <p>${escapeHtml(item.platform || 'Platform unknown')}</p>
          </div>
          <span class="release-badge">${item.releaseDate ? escapeHtml(item.releaseDate) : 'Pending release'}</span>
        </div>
        <div class="wishlist-card__meta">
          <span>$${Number(item.price || 0).toFixed(2)}</span>
          <span>${item.addedAt ? new Date(item.addedAt).toLocaleDateString() : 'Recently added'}</span>
        </div>
        <div class="wishlist-card__actions">
          <button type="button" class="wishlist-action wishlist-action--primary" data-wishlist-action="library" data-wishlist-game-id="${escapeHtml(item.gameId)}">Add to Library</button>
          <button type="button" class="wishlist-action wishlist-action--secondary" data-wishlist-action="remove" data-wishlist-game-id="${escapeHtml(item.gameId)}">Remove</button>
          <button type="button" class="wishlist-action wishlist-action--secondary" data-wishlist-action="alert" data-wishlist-game-id="${escapeHtml(item.gameId)}">Set alert</button>
        </div>
      </div>
    </article>
  `).join('');
}

function getQueueItems() {
  return queueItems;
}

function setQueueItems(nextItems) {
  queueItems = Array.isArray(nextItems) ? nextItems.map((entry) => normalizeQueueEntry(entry, entry?.title || '')) : [];
}

function saveQueueStateLocally(items = getQueueItems()) {
  saveLocalQueueItems(items);
}

async function loadQueueFromServer() {
  const localItems = getLocalQueueItems();
  if (!authToken || !currentUser) {
    setQueueItems(localItems);
    renderQueueView();
    return;
  }

  try {
    const response = await apiRequest('/api/queue');
    const remoteItems = Array.isArray(response?.items) ? response.items : [];
    const reconciled = reconcileQueueEntries(localItems, remoteItems);
    setQueueItems(reconciled);
    saveQueueStateLocally(getQueueItems());
    renderQueueView();
  } catch {
    setQueueItems(localItems);
    renderQueueView();
  }
}

function renderQueueView() {
  if (!queueContainer) {
    return;
  }

  const items = getQueueItems().filter((entry) => String(entry?.gameId || '').trim());
  if (!items.length) {
    queueContainer.innerHTML = '<div class="empty-state">Your queue is empty. Add a game from your library or a recommendation to keep your next session focused.</div>';
    return;
  }

  const upNext = items[0];
  queueContainer.innerHTML = `
    <div class="queue-up-next">
      <h3>Up Next</h3>
      <p>${escapeHtml(upNext.title || 'Untitled game')} • ${escapeHtml(upNext.platform || 'Platform unknown')}</p>
    </div>
    <ol class="queue-list" aria-label="Play queue">
      ${items.map((item, index) => `
        <li class="queue-item" draggable="true" data-queue-game-id="${escapeHtml(item.gameId)}">
          <div class="queue-item__body">
            <div>
              <strong>${escapeHtml(item.title || 'Untitled game')}</strong>
              <p>${escapeHtml(item.platform || 'Platform unknown')}</p>
            </div>
            <span class="release-badge">${escapeHtml(item.status || 'Queued')}</span>
          </div>
          <div class="queue-item__actions">
            <button type="button" data-queue-action="up" data-queue-game-id="${escapeHtml(item.gameId)}">Move up</button>
            <button type="button" data-queue-action="down" data-queue-game-id="${escapeHtml(item.gameId)}">Move down</button>
            <button type="button" data-queue-action="start" data-queue-game-id="${escapeHtml(item.gameId)}">Start</button>
            <button type="button" data-queue-action="finish" data-queue-game-id="${escapeHtml(item.gameId)}">Finish</button>
            <button type="button" data-queue-action="skip" data-queue-game-id="${escapeHtml(item.gameId)}">Skip for Now</button>
            <button type="button" class="danger" data-queue-action="remove" data-queue-game-id="${escapeHtml(item.gameId)}">Remove</button>
          </div>
        </li>
      `).join('')}
    </ol>
  `;
}

async function syncQueueToServer(items = getQueueItems()) {
  if (!authToken || !currentUser) {
    saveQueueStateLocally(items);
    return;
  }

  try {
    const response = await apiRequest('/api/queue', {
      method: 'POST',
      body: JSON.stringify(items[0] || { gameId: '__empty__', title: '' })
    });
    if (Array.isArray(response?.items)) {
      setQueueItems(response.items);
      saveQueueStateLocally(getQueueItems());
    }
  } catch {
    saveQueueStateLocally(items);
  }
}

async function addGameToQueue(game) {
  const normalized = normalizeQueueEntry(game, game?.title || game?.name || '');
  if (!normalized.gameId) {
    return null;
  }

  const existingItems = getQueueItems();
  if (existingItems.some((item) => item.gameId === normalized.gameId)) {
    return existingItems.find((item) => item.gameId === normalized.gameId);
  }

  const nextItems = [...existingItems, normalized];
  setQueueItems(nextItems);
  saveQueueStateLocally(getQueueItems());
  renderQueueView();

  if (authToken && currentUser) {
    try {
      const response = await apiRequest('/api/queue', {
        method: 'POST',
        body: JSON.stringify(normalized)
      });
      if (Array.isArray(response?.items)) {
        setQueueItems(response.items);
        saveQueueStateLocally(getQueueItems());
      }
    } catch {
      setQueueItems(nextItems);
      saveQueueStateLocally(getQueueItems());
    }
  }

  return getQueueItems().find((item) => item.gameId === normalized.gameId) || null;
}

function getQueueEntryByGameId(gameId) {
  return getQueueItems().find((item) => item.gameId === gameId) || null;
}

async function updateQueueEntryAction(gameId, action) {
  const currentItems = getQueueItems();
  const target = currentItems.find((item) => item.gameId === gameId);
  if (!target) {
    return;
  }

  const libraryGames = getCurrentLibrary();
  const libraryGame = libraryGames.find((game) => game.id === gameId);

  if (action === 'start' && libraryGame) {
    libraryGame.status = 'Playing';
    libraryGame.completedAt = null;
    await persistLibraryState(libraryGames, { renderAfterSave: false, updateProfile: false });
  }

  if (action === 'finish' && libraryGame) {
    const shouldComplete = window.confirm(`Mark ${libraryGame.title || 'this game'} as completed?`);
    if (shouldComplete) {
      libraryGame.status = 'Completed';
      libraryGame.completedAt = libraryGame.completedAt || new Date().toISOString();
      await persistLibraryState(libraryGames, { renderAfterSave: false, updateProfile: false });
    }
  }

  if (action === 'remove') {
    const nextItems = currentItems.filter((item) => item.gameId !== gameId);
    setQueueItems(nextItems);
    saveQueueStateLocally(getQueueItems());
    renderQueueView();
  } else if (action === 'skip') {
    const nextItems = currentItems.filter((item) => item.gameId !== gameId);
    setQueueItems(nextItems);
    saveQueueStateLocally(getQueueItems());
    renderQueueView();
  } else {
    renderQueueView();
  }

  if (authToken && currentUser) {
    try {
      const response = await apiRequest('/api/queue/action', {
        method: 'POST',
        body: JSON.stringify({ gameId, action })
      });
      if (Array.isArray(response?.items)) {
        setQueueItems(response.items);
        saveQueueStateLocally(getQueueItems());
      }
    } catch {
      setQueueItems(currentItems);
      saveQueueStateLocally(getQueueItems());
    }
  }

  if (action !== 'remove' && action !== 'skip') {
    renderQueueView();
  }
}

async function reorderQueue(gameId, direction) {
  const nextItems = getQueueItems().slice();
  const index = nextItems.findIndex((item) => item.gameId === gameId);
  if (index < 0) {
    return;
  }

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= nextItems.length) {
    return;
  }

  [nextItems[index], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[index]];
  setQueueItems(nextItems);
  saveQueueStateLocally(getQueueItems());
  renderQueueView();

  if (authToken && currentUser) {
    try {
      const response = await apiRequest('/api/queue/move', {
        method: 'POST',
        body: JSON.stringify({ gameId, direction })
      });
      if (Array.isArray(response?.items)) {
        setQueueItems(response.items);
        saveQueueStateLocally(getQueueItems());
      }
    } catch {
      setQueueItems(nextItems);
      saveQueueStateLocally(getQueueItems());
    }
  }
}

async function syncLibraryToServer(games) {
  if (!authToken || !currentUser) {
    setSyncStatus('Sync status: offline locally only.', 'idle');
    return;
  }

  try {
    await apiRequest('/api/library', {
      method: 'POST',
      body: JSON.stringify({ games })
    });
  } catch (error) {
    throw error;
  }
}

async function loadLibraryFromServer() {
  if (!authToken || !currentUser) {
    setSyncStatus('Sync status: offline locally only.', 'idle');
    return;
  }

  setSyncStatus('Fetching library from the server…', 'pending');
  try {
    const data = await apiRequest('/api/library');
    setCurrentLibrary(Array.isArray(data) ? data : []);
    renderLibrary();
    setSyncStatus('Library loaded from the server.', 'success');
  } catch (error) {
    const message = error?.message || 'The server could not be reached.';
    setSyncStatus(`Using local library data. ${message}`, 'error');
  }
}

function populateStatusFilterOptions() {
  if (!statusFilter) {
    return;
  }

  statusFilter.innerHTML = [
    '<option value="All">All statuses</option>',
    ...PLAY_STATUS_OPTIONS.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
  ].join('');
}

function updateSummary() {
  const games = getDisplayedLibrary();
  const totalSpent = games.reduce((sum, game) => sum + Number(game.purchasePrice || 0), 0);
  const totalValue = games.reduce((sum, game) => sum + Number(game.currentValue || 0), 0);
  const averageValue = games.length ? totalValue / games.length : 0;

  summaryGrid.innerHTML = `
    <div class="summary-card">
      <span>Games in library</span>
      <strong>${games.length}</strong>
    </div>
    <div class="summary-card">
      <span>Current total value</span>
      <strong>$${totalValue.toFixed(2)}</strong>
    </div>
    <div class="summary-card">
      <span>Total spent</span>
      <strong>$${totalSpent.toFixed(2)}</strong>
    </div>
    <div class="summary-card">
      <span>Average item value</span>
      <strong>$${averageValue.toFixed(2)}</strong>
    </div>
  `;
}

function getProfileData() {
  const raw = localStorage.getItem(PROFILE_DATA_KEY);
  return sanitizeProfileStore(safeParseJson(raw, {}));
}

function saveProfileData(profileData) {
  localStorage.setItem(PROFILE_DATA_KEY, safeStringifyJson(sanitizeProfileStore(profileData)));
}

function getCurrentProfileData() {
  const profileData = getProfileData();
  const userKey = activeLibraryOwner || currentUser || 'guest';
  return {
    playtimeMinutes: Number(profileData[userKey]?.playtimeMinutes || 0)
  };
}

function setCurrentProfileData(nextData) {
  const profileData = getProfileData();
  const userKey = currentUser || 'guest';
  profileData[userKey] = {
    ...profileData[userKey],
    ...nextData
  };
  saveProfileData(profileData);
}

function updateProfileSearchState(visible, options = {}) {
  if (!gameSearchResults) {
    return;
  }

  const { busy = false, label = 'Search results', hidden = false } = options;
  gameSearchResults.classList.toggle('hidden', hidden);
  gameSearchResults.setAttribute('aria-busy', String(busy));
  gameSearchResults.setAttribute('aria-hidden', String(hidden));
  gameSearchResults.setAttribute('aria-label', label);
  gameSearch.setAttribute('aria-expanded', String(!hidden));
  if (hidden) {
    gameSearchResults.innerHTML = '';
  }
}

function updateProfileHub() {
  renderFriendHub();
}


function setProfileEditorStatus(message, tone = 'idle') {
  if (!profileEditorStatus) {
    return;
  }
  profileEditorStatus.textContent = message;
  profileEditorStatus.dataset.tone = tone;
}

function getCatalogGameTitle(game) {
  return String(game?.name || game?.title || 'Untitled game');
}

function renderFavoriteGamesEditor(selectedIds = []) {
  if (!favoriteGamesEditor) {
    return;
  }
  const selected = Array.isArray(selectedIds) ? selectedIds.slice(0, 5) : [];
  const options = GAME_CATALOG.slice()
    .sort((a, b) => getCatalogGameTitle(a).localeCompare(getCatalogGameTitle(b)))
    .map((game) => `<option value="${escapeHtml(String(game.id || ''))}">${escapeHtml(getCatalogGameTitle(game))} — ${escapeHtml(String(game.platform || 'Multiple platforms'))}</option>`)
    .join('');

  favoriteGamesEditor.innerHTML = Array.from({ length: 5 }, (_, index) => `
    <label class="favorite-game-select-row">
      <span>${index + 1}</span>
      <select data-favorite-game-index="${index}" aria-label="Favorite game ${index + 1}">
        <option value="">Select a game</option>
        ${options}
      </select>
    </label>
  `).join('');

  favoriteGamesEditor.querySelectorAll('[data-favorite-game-index]').forEach((select, index) => {
    select.value = selected[index] || '';
  });
}

function populateProfileEditor(profile = {}) {
  currentProfileSettings = {
    displayName: String(profile.displayName || ''),
    bio: String(profile.bio || ''),
    avatarUrl: String(profile.avatarUrl || ''),
    bannerUrl: String(profile.bannerUrl || ''),
    favoriteGameIds: Array.isArray(profile.favoriteGameIds) ? profile.favoriteGameIds.slice(0, 5) : []
  };
  if (profileDisplayNameInput) profileDisplayNameInput.value = currentProfileSettings.displayName;
  if (profileBioInput) profileBioInput.value = currentProfileSettings.bio;
  if (profileAvatarUrlInput) profileAvatarUrlInput.value = currentProfileSettings.avatarUrl;
  if (profileBannerUrlInput) profileBannerUrlInput.value = currentProfileSettings.bannerUrl;
  Object.entries(platformAccountInputs).forEach(([platform, inputs]) => { const account = currentProfileSettings.platformAccounts?.[platform] || {}; if (inputs.handle) inputs.handle.value = account.handle || ''; if (inputs.profileUrl) inputs.profileUrl.value = account.profileUrl || ''; if (inputs.visibility) inputs.visibility.value = account.visibility || 'Public'; });
  updateCompactAccountCard();
  renderFavoriteGamesEditor(currentProfileSettings.favoriteGameIds);
}

function collectProfileEditorData() {
  const favoriteGameIds = [...new Set(Array.from(favoriteGamesEditor?.querySelectorAll('[data-favorite-game-index]') || [])
    .map((select) => String(select.value || '').trim())
    .filter(Boolean))].slice(0, 5);
  return {
    displayName: String(profileDisplayNameInput?.value || '').trim(),
    bio: String(profileBioInput?.value || '').trim(),
    avatarUrl: String(profileAvatarUrlInput?.value || '').trim(),
    bannerUrl: String(profileBannerUrlInput?.value || '').trim(),
    favoriteGameIds,
    platformAccounts: Object.fromEntries(Object.entries(platformAccountInputs).map(([platform, inputs]) => [platform, { handle: String(inputs.handle?.value || '').trim(), profileUrl: String(inputs.profileUrl?.value || '').trim(), visibility: inputs.visibility?.value || 'Public' }]))
  };
}

async function loadProfileSettings() {
  if (!authToken || !currentUser) {
    populateProfileEditor({});
    return;
  }
  try {
    const response = await apiRequest('/api/profile-settings');
    populateProfileEditor(response?.profile || {});
    setProfileEditorStatus('Profile ready to edit.', 'success');
  } catch (error) {
    populateProfileEditor({});
    setProfileEditorStatus(error?.message || 'Unable to load profile details.', 'error');
  }
}

async function saveProfileSettings() {
  if (!authToken || !currentUser) {
    setProfileEditorStatus('Sign in to customize your profile.', 'error');
    return;
  }
  if (saveProfileButton) saveProfileButton.disabled = true;
  try {
    const response = await apiRequest('/api/profile-settings', {
      method: 'POST',
      body: JSON.stringify(collectProfileEditorData())
    });
    populateProfileEditor(response?.profile || {});
    setProfileEditorStatus('Profile updated.', 'success');
  } catch (error) {
    setProfileEditorStatus(error?.message || 'Unable to save profile.', 'error');
  } finally {
    if (saveProfileButton) saveProfileButton.disabled = false;
  }
}

function getProfileFallbackInitial(profile) {
  return String(profile?.displayName || profile?.handle || 'S').trim().charAt(0).toUpperCase() || 'S';
}

function renderPublicProfileSkeleton() {
  showPublicProfileView();
  if (publicProfileContent) {
    publicProfileContent.innerHTML = '<div class="skeleton-card skeleton-card--detail" role="status" aria-busy="true"><div class="skeleton-block skeleton-block--hero"></div><div class="skeleton-stack"><div class="skeleton-line skeleton-line--title"></div><div class="skeleton-line skeleton-line--meta"></div></div></div>';
  }
}

function showPublicProfileView() {
  if (mainContent) {
    mainContent.classList.remove('hidden');
    mainContent.classList.add('content-area--profile-view');
  }
  if (detailPage) detailPage.classList.add('hidden');
  if (statisticsPage) statisticsPage.classList.add('hidden');
  if (publicProfilePage) publicProfilePage.classList.remove('hidden');
}

function renderPublicProfilePage(response) {
  const profile = response?.profile || {};
  const libraryItems = Array.isArray(response?.library?.items) ? response.library.items : [];
  const favoriteGames = Array.isArray(profile.favoriteGames) ? profile.favoriteGames : [];
  const platformAccounts = profile.platformAccounts && typeof profile.platformAccounts === 'object' ? profile.platformAccounts : {};
  const platformBadgesMarkup = Object.entries(platformAccounts).map(([platform, account]) => {
    const meta = PLATFORM_ACCOUNT_META[platform];
    if (!meta || !account?.linked) return '';
    const label = `${meta.label}${account.handle ? `: ${account.handle}` : ''}`;
    const content = `<span class="platform-badge platform-badge--${platform}" title="Self-reported linked account"><span class="platform-badge__symbol">${meta.symbol}</span><span>${escapeHtml(label)}</span></span>`;
    return account.profileUrl ? `<a class="platform-badge-link" href="${escapeHtml(account.profileUrl)}" target="_blank" rel="noopener noreferrer">${content}</a>` : content;
  }).join('');
  const completedCount = libraryItems.filter((game) => game.status === 'Completed').length;
  const totalPlaytime = libraryItems.reduce((sum, game) => sum + Number(game.playtimeMinutes || 0), 0);
  const bannerStyle = profile.bannerUrl ? ` style="background-image: linear-gradient(rgba(2,6,23,.18), rgba(2,6,23,.72)), url('${escapeHtml(profile.bannerUrl)}')"` : '';
  const avatarMarkup = profile.avatarUrl
    ? `<img class="public-profile-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="${escapeHtml(profile.displayName || profile.handle || 'User')} profile picture" referrerpolicy="no-referrer" />`
    : `<div class="public-profile-avatar public-profile-avatar--fallback" aria-label="Default profile picture">${escapeHtml(getProfileFallbackInitial(profile))}</div>`;
  const favoritesMarkup = favoriteGames.length
    ? favoriteGames.map((game) => `<article class="favorite-game-card"><img src="${escapeHtml(game.image || 'https://placehold.co/300x400/1e293b/ffffff?text=Game')}" alt="${escapeHtml(game.title)} cover" loading="lazy" referrerpolicy="no-referrer" /><h4>${escapeHtml(game.title)}</h4><p>${escapeHtml(game.platform || '')}</p></article>`).join('')
    : '<p class="profile-empty-favorites">No favorite games selected yet.</p>';

  if (publicProfileHeading) publicProfileHeading.textContent = `${profile.displayName || profile.handle || 'User'}'s Profile`;
  if (publicProfileContent) {
    publicProfileContent.innerHTML = `
      <article class="public-profile-hero">
        <div class="public-profile-banner"${bannerStyle}></div>
        <div class="public-profile-identity">
          ${avatarMarkup}
          <div><h3 class="public-profile-name">${escapeHtml(profile.displayName || profile.handle || 'Project Sora User')}</h3><p class="public-profile-handle">@${escapeHtml(profile.handle || 'user')}</p></div>
        </div>
        <div class="platform-badges" aria-label="Linked gaming platforms">${platformBadgesMarkup || '<span class="platform-badges-empty">No linked gaming accounts yet.</span>'}</div><p class="public-profile-bio">${escapeHtml(profile.bio || 'This player has not added a bio yet.')}</p>
        <div class="public-profile-stats">
          <div class="public-profile-stat"><span>Games</span><strong>${response?.library?.available ? libraryItems.length : 'Private'}</strong></div>
          <div class="public-profile-stat"><span>Completed</span><strong>${response?.library?.available ? completedCount : 'Private'}</strong></div>
          <div class="public-profile-stat"><span>Playtime</span><strong>${response?.library?.available ? escapeHtml(formatPlaytime(totalPlaytime)) : 'Private'}</strong></div>
        </div>
      </article>
      <section class="favorite-games-panel"><h3>Top 5 Favorite Games</h3><div class="favorite-games-grid">${favoritesMarkup}</div></section>
    `;
  }
  showPublicProfileView();
}

function setPrivacyStatus(message, tone = 'idle') {
  if (!privacyStatus) {
    return;
  }

  privacyStatus.textContent = message;
  privacyStatus.dataset.tone = tone;
}

function getPrivacySettingsFromForm() {
  return {
    profileVisibility: profileVisibilitySelect?.value || 'Private',
    libraryVisibility: libraryVisibilitySelect?.value || 'Private',
    reviewsVisibility: reviewsVisibilitySelect?.value || 'Private',
    activityVisibility: activityVisibilitySelect?.value || 'Private'
  };
}

function populatePrivacyForm(settings = {}) {
  if (profileVisibilitySelect) {
    profileVisibilitySelect.value = settings.profileVisibility || 'Private';
  }
  if (libraryVisibilitySelect) {
    libraryVisibilitySelect.value = settings.libraryVisibility || 'Private';
  }
  if (reviewsVisibilitySelect) {
    reviewsVisibilitySelect.value = settings.reviewsVisibility || 'Private';
  }
  if (activityVisibilitySelect) {
    activityVisibilitySelect.value = settings.activityVisibility || 'Private';
  }
}

async function loadPrivacySettings() {
  if (!authToken || !currentUser) {
    populatePrivacyForm({ profileVisibility: 'Private', libraryVisibility: 'Private', reviewsVisibility: 'Private', activityVisibility: 'Private' });
    return;
  }

  try {
    const response = await apiRequest('/api/privacy');
    populatePrivacyForm(response?.privacySettings || {});
  } catch (error) {
    setPrivacyStatus(error?.message || 'Unable to load privacy settings.', 'error');
  }
}

async function savePrivacySettings() {
  if (!authToken || !currentUser) {
    setPrivacyStatus('Sign in to change your privacy settings.', 'error');
    return;
  }

  try {
    const payload = getPrivacySettingsFromForm();
    const response = await apiRequest('/api/privacy', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    populatePrivacyForm(response?.privacySettings || payload);
    setPrivacyStatus('Privacy settings updated.', 'success');
  } catch (error) {
    setPrivacyStatus(error?.message || 'Unable to save privacy settings.', 'error');
  }
}

function renderProfilePreviewCard(response) {
  if (!profilePreviewPanel) {
    return;
  }

  const profile = response?.profile || {};
  const library = response?.library || {};
  const reviews = response?.reviews || {};
  const activity = response?.activity || {};
  const sections = [
    { label: 'Profile', available: profile.available, message: profile.available ? 'Your public profile is visible.' : 'Your profile is private.' },
    { label: 'Library', available: library.available, message: library.available ? 'Your library is visible to the selected audience.' : library.message || 'Your library is hidden.' },
    { label: 'Reviews', available: reviews.available, message: reviews.available ? 'Your reviews are visible to the selected audience.' : reviews.message || 'Your reviews are hidden.' },
    { label: 'Activity', available: activity.available, message: activity.available ? 'Your recent activity is visible to the selected audience.' : activity.message || 'Your activity is hidden.' }
  ];

  profilePreviewPanel.innerHTML = `
    <strong>${escapeHtml(profile.handle || currentUser || 'Your profile')}</strong>
    ${sections.map((section) => `
      <div class="profile-preview-card__row">
        <span>${escapeHtml(section.label)}</span>
        <span>${escapeHtml(section.message)}</span>
      </div>
    `).join('')}
  `;
}

async function previewMyPublicProfile() {
  if (!authToken || !currentUser) {
    setPrivacyStatus('Sign in to preview your public profile.', 'error');
    return;
  }

  try {
    const response = await apiRequest(`/api/profile/${encodeURIComponent(currentUser)}`);
    renderProfilePreviewCard(response);
    renderPublicProfilePage(response);
    setPrivacyStatus('Public profile preview loaded.', 'success');
  } catch (error) {
    renderProfilePreviewCard({ profile: { available: false, handle: currentUser }, library: { available: false, message: error?.message || 'Unable to preview profile.' }, reviews: { available: false, message: '' }, activity: { available: false, message: '' } });
    setPrivacyStatus(error?.message || 'Unable to preview profile.', 'error');
  }
}

async function loadFriendState() {
  if (!authToken || !currentUser) {
    friendsState = { friends: [], incoming: [], outgoing: [] };
    renderFriendHub();
    return;
  }

  try {
    const [friendsResponse, incomingResponse, outgoingResponse] = await Promise.all([
      apiRequest('/api/friends'),
      apiRequest('/api/friends/requests/incoming'),
      apiRequest('/api/friends/requests/outgoing')
    ]);
    friendsState = {
      friends: Array.isArray(friendsResponse?.friends) ? friendsResponse.friends : [],
      incoming: Array.isArray(incomingResponse?.requests) ? incomingResponse.requests : [],
      outgoing: Array.isArray(outgoingResponse?.requests) ? outgoingResponse.requests : []
    };
  } catch {
    friendsState = { friends: [], incoming: [], outgoing: [] };
  }

  renderFriendHub();
}

function renderFriendHub() {
  if (!friendsList || !incomingRequestsList || !outgoingRequestsList || !profilePlaytime || !profileCompletion) {
    return;
  }

  const profileData = getCurrentProfileData();
  const games = getCurrentLibrary().map(normalizeGame);
  const totalPlaytime = games.reduce((sum, game) => sum + Number(game.playtimeMinutes || 0), 0) + Number(profileData.playtimeMinutes || 0);
  const completionAverage = games.length
    ? games.reduce((sum, game) => sum + Number(game.completionPercent || 0), 0) / games.length
    : 0;

  profilePlaytime.textContent = formatPlaytime(totalPlaytime);
  profileCompletion.textContent = `${Math.round(completionAverage)}%`;

  const buildEmptyState = (message) => `<div class="friend-pill friend-pill--empty">${escapeHtml(message)}</div>`;

  friendsList.innerHTML = friendsState.friends.length
    ? friendsState.friends.map((friend) => `
        <div class="friend-pill">
          <span>${escapeHtml(friend.handle || 'Friend')}</span>
          <div class="friend-pill__actions">
            <button type="button" data-friend-remove="${escapeHtml(friend.id)}">Remove</button>
          </div>
        </div>
      `).join('')
    : buildEmptyState('No friends yet');

  incomingRequestsList.innerHTML = friendsState.incoming.length
    ? friendsState.incoming.map((request) => {
        const actionButtons = request.status === 'pending'
          ? `
              <button type="button" data-friend-request-action="accept" data-friend-request-id="${escapeHtml(request.requester?.id || '')}">Accept</button>
              <button type="button" data-friend-request-action="decline" data-friend-request-id="${escapeHtml(request.requester?.id || '')}">Decline</button>
            `
          : '';
        const statusText = request.status === 'accepted' ? 'Accepted' : request.status === 'declined' ? 'Declined' : 'Pending';
        return `
          <div class="friend-pill">
            <span>${escapeHtml(request.requester?.handle || 'Pending request')} • ${escapeHtml(statusText)}</span>
            <div class="friend-pill__actions">${actionButtons}</div>
          </div>
        `;
      }).join('')
    : buildEmptyState('No incoming requests');

  outgoingRequestsList.innerHTML = friendsState.outgoing.length
    ? friendsState.outgoing.map((request) => {
        const actionButtons = request.status === 'pending'
          ? `<button type="button" data-friend-request-action="cancel" data-friend-request-id="${escapeHtml(request.target?.id || '')}">Cancel</button>`
          : '';
        const statusText = request.status === 'accepted' ? 'Accepted' : request.status === 'declined' ? 'Declined' : 'Pending';
        return `
          <div class="friend-pill">
            <span>${escapeHtml(request.target?.handle || 'Pending request')} • ${escapeHtml(statusText)}</span>
            <div class="friend-pill__actions">${actionButtons}</div>
          </div>
        `;
      }).join('')
    : buildEmptyState('No sent requests');
}

async function addCurrentFriend() {
  if (!friendInput) {
    return;
  }

  const query = friendInput.value.trim();
  if (!query) {
    return;
  }

  if (!authToken || !currentUser) {
    setSyncStatus('Sign in to manage your friends.', 'error');
    return;
  }

  try {
    const searchResponse = await apiRequest(`/api/friends/search?search=${encodeURIComponent(query)}`);
    const match = Array.isArray(searchResponse?.users) ? searchResponse.users.find((entry) => entry.handle.toLowerCase().includes(query.toLowerCase()) || entry.id.toLowerCase().includes(query.toLowerCase())) : null;
    if (!match) {
      setSyncStatus('No matching public profile found.', 'error');
      return;
    }

    const requestResponse = await apiRequest('/api/friends/requests', {
      method: 'POST',
      body: JSON.stringify({ userId: match.id })
    });
    friendInput.value = '';
    await loadFriendState();
    setSyncStatus(requestResponse?.ok ? 'Friend request sent.' : 'Friend action completed.', 'success');
  } catch (error) {
    friendInput.value = '';
    setSyncStatus(error?.message || 'Unable to update friend status.', 'error');
  }
}

function getFilteredGames() {
  const libraryEntries = getDisplayedLibrary().map((game, index) => ({ game: applyPlayStatusToGame(game), index }));
  return libraryEntries.filter(({ game }) => {
    const matchesSearch = !searchTerm.trim() || [game.title, game.platform, game.notes, game.condition].filter(Boolean).join(' ').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = currentStatusFilter === 'All' || game.status === currentStatusFilter;
    return matchesSearch && matchesStatus;
  });
}

function renderLibrary() {
  const filteredEntries = getFilteredGames();
  const games = filteredEntries.map(({ game }) => game);
  updateSummary();

  if (!games.length) {
    emptyState.style.display = 'block';
    gamesList.innerHTML = searchTerm.trim()
      ? '<div class="empty-state">No games match your current search.</div>'
      : '';
    return;
  }

  emptyState.style.display = 'none';
  gamesList.innerHTML = filteredEntries
    .map(({ game, index }) => {
      const profit = Number(game.currentValue || 0) - Number(game.purchasePrice || 0);
      const title = escapeHtml(game.title);
      const platform = escapeHtml(game.platform);
      const condition = escapeHtml(game.condition);
      const notes = escapeHtml(game.notes || 'No notes');
      const metacritic = escapeHtml(game.metacriticScore ?? 'N/A');
      const statusValue = escapeHtml(game.status || 'Backlog');
      const statusOptionsMarkup = PLAY_STATUS_OPTIONS.map((option) => `<option value="${escapeHtml(option)}" ${game.status === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');
      return `
        <article class="game-item">
          <div>
            <div class="game-item__header">
              <h3>${title}</h3>
              <span class="status-pill">${statusValue}</span>
            </div>
            <div class="meta">
              <span>${platform}</span>
              <span>${condition}</span>
              <span>Metacritic: ${metacritic}</span>
              <span>Purchase: $${Number(game.purchasePrice || 0).toFixed(2)}</span>
              <span>Value: $${Number(game.currentValue || 0).toFixed(2)}</span>
              <span>${notes}</span>
            </div>
            <div class="meta">
              <span>Estimated change: ${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(2)}</span>
            </div>
            <label class="status-select-wrap">
              <span class="status-select-wrap__label">Play status</span>
              <select data-play-status-select data-game-id="${escapeHtml(game.id)}">
                ${statusOptionsMarkup}
              </select>
            </label>
          </div>
          <div class="price-chip">
            <button type="button" data-view-id="${game.id}">Open page</button>
            <button type="button" class="danger" data-delete-id="${game.id}">Remove</button>
          </div>
        </article>
      `;
    })
    .join('');
}

async function renderGameSearchResults(requestId = activeSearchRequestId) {
  const query = gameSearch.value.trim().toLowerCase();
  const shouldShowSeedSuggestions = !query;
  if (!gameSearchResults) {
    return;
  }

  renderSearchSkeleton(query);
  const libraryMatches = getDisplayedLibrary()
    .map(normalizeGame)
    .filter((game) => {
      const haystack = [game.title, game.platform, game.notes, game.condition].filter(Boolean).join(' ').toLowerCase();
      return shouldShowSeedSuggestions ? true : haystack.includes(query);
    })
    .slice(0, 4);

  let catalogMatches = [];
  let profileMatches = [];

  try {
    const [catalog, profiles] = await Promise.all([
      apiRequest(shouldShowSeedSuggestions ? '/api/games?limit=12' : `/api/games?search=${encodeURIComponent(query)}&limit=30`),
      apiRequest(shouldShowSeedSuggestions ? '/api/users' : `/api/users?search=${encodeURIComponent(query)}`)
    ]);
    if (requestId !== activeSearchRequestId) {
      return;
    }

    catalogMatches = Array.isArray(catalog) ? catalog : [];
    profileMatches = Array.isArray(profiles) ? profiles : [];
  } catch {
    if (requestId !== activeSearchRequestId) {
      return;
    }
    catalogMatches = [];
    profileMatches = [];
  }

  if (shouldShowSeedSuggestions) {
    catalogMatches = catalogMatches.slice(0, 6);
    profileMatches = profileMatches.slice(0, 4);
  }

  const searchRows = [];
  const seenTitles = new Set();
  latestSearchResults = [];

  libraryMatches.forEach((game) => {
    const normalizedTitle = normalizeSearchText(game.title);
    if (!seenTitles.has(normalizedTitle)) {
      seenTitles.add(normalizedTitle);
      searchRows.push({
        kind: 'game',
        title: game.title,
        subtitle: `${game.platform} • ${game.condition}`,
        image: game.coverImage || 'https://placehold.co/72x72/0f172a/ffffff?text=Game',
        id: game.id,
        price: game.currentValue,
        metacriticScore: game.metacriticScore,
        platform: game.platform
      });
    }
  });

  catalogMatches.forEach((game) => {
    const title = game.name || game.title;
    const normalizedTitle = normalizeSearchText(title);
    if (seenTitles.has(normalizedTitle)) {
      return;
    }
    seenTitles.add(normalizedTitle);
    searchRows.push({
      kind: 'game',
      title,
      subtitle: `${Array.isArray(game.availablePlatforms) && game.availablePlatforms.length > 1 ? `${game.availablePlatforms[0]} +${game.availablePlatforms.length - 1} more` : (game.platform || 'Platform unknown')} • ${Number(game.price || 0) > 0 ? `$${Number(game.price).toFixed(2)}` : 'Price unavailable'}`,
      image: game.image || 'https://placehold.co/72x72/0f172a/ffffff?text=Game',
      id: game.id || title,
      price: game.price,
      metacriticScore: game.metacriticScore,
      platform: game.platform,
      availablePlatforms: game.availablePlatforms || [game.platform].filter(Boolean),
      editionIds: game.editionIds || [game.id].filter(Boolean)
    });
  });

  profileMatches.forEach((profileName) => {
    const publicHandle = createPublicHandle(profileName);
    if (!searchRows.some((row) => row.kind === 'profile' && row.title === publicHandle)) {
      searchRows.push({
        kind: 'profile',
        title: publicHandle,
        subtitle: 'Open profile library',
        image: '',
        id: publicHandle
      });
    }
  });

  gameSearchKeyboardState.value = -1;

  if (requestId !== activeSearchRequestId) {
    return;
  }

  if (!searchRows.length) {
    gameSearchResults.innerHTML = createEmptySearchStateMarkup('No games found');
    updateProfileSearchState(false, { busy: false, label: 'No search results', hidden: false });
    return;
  }

  latestSearchResults = searchRows.slice(0, 8);

  gameSearchResults.innerHTML = latestSearchResults
    .map((item, index) => item.kind === 'profile'
      ? createSearchResultMarkup(item, 'profile', index, query)
      : createSearchResultMarkup(item, 'game', index, query))
    .join('');

  updateProfileSearchState(false, { busy: false, label: latestSearchResults.length ? 'Search results' : 'No search results', hidden: false });
}

function resolveSearchSelection(itemElement) {
  const searchIndex = Number(itemElement?.getAttribute('data-search-index') ?? itemElement?.closest('[data-search-index]')?.getAttribute('data-search-index') ?? -1);
  if (searchIndex >= 0 && latestSearchResults[searchIndex]) {
    return latestSearchResults[searchIndex];
  }

  const fallbackId = itemElement?.getAttribute('data-game-id');
  if (!fallbackId) {
    return null;
  }

  return latestSearchResults.find((candidate) => {
    const candidateId = candidate.id || candidate.title || candidate.name || '';
    const candidateTitle = candidate.title || candidate.name || '';
    return candidateId === fallbackId || candidateTitle === fallbackId;
  }) || null;
}

function getCatalogEntryByTitle(title) {
  const normalizedTitle = String(title || '').trim().toLowerCase();
  return GAME_CATALOG.find((entry) => String(entry.name || '').trim().toLowerCase() === normalizedTitle)
    || GAME_CATALOG.find((entry) => String(entry.name || '').trim().toLowerCase().includes(normalizedTitle))
    || null;
}

function normalizeCatalogEntry(entry) {
  const baseEntry = entry || {};
  const fallbackEntry = getCatalogEntryByTitle(baseEntry.name || baseEntry.title || '');
  return normalizeCatalogDetail(baseEntry, fallbackEntry);
}

function getSimilarGames(entry) {
  const baseEntry = normalizeCatalogEntry(entry || currentCatalogDetailEntry);
  if (!baseEntry) {
    return [];
  }

  const baseTags = new Set((baseEntry.tags || []).map((tag) => String(tag || '').toLowerCase()));
  const baseDeveloper = String(baseEntry.developer || '').toLowerCase();

  return GAME_CATALOG.filter((candidate) => {
    if (candidate.name === baseEntry.name) {
      return false;
    }

    const candidateTags = new Set((candidate.tags || []).map((tag) => String(tag || '').toLowerCase()));
    const candidateDeveloper = String(candidate.developer || '').toLowerCase();
    const sharedTags = [...baseTags].filter((tag) => candidateTags.has(tag));
    const developerMatch = baseDeveloper && candidateDeveloper && baseDeveloper === candidateDeveloper;
    return sharedTags.length >= 1 || developerMatch;
  }).slice(0, 3);
}

async function renderCatalogPriceHistory(gameId) {
  const container = document.querySelector('[data-price-history-for]');
  if (!container) {
    return;
  }

  const safeGameId = String(gameId || '').trim();
  if (!safeGameId) {
    container.innerHTML = '<p class="detail-empty-state">Not enough history yet</p>';
    return;
  }

  container.innerHTML = '<p class="detail-empty-state">Loading price history…</p>';

  try {
    const summary = await apiRequest(`/api/catalog/${encodeURIComponent(safeGameId)}/price-history`);
    const summaryByCurrency = Array.isArray(summary?.summaryByCurrency) ? summary.summaryByCurrency : [];

    if (!summaryByCurrency.length) {
      container.innerHTML = '<p class="detail-empty-state">Not enough history yet</p>';
      return;
    }

    container.innerHTML = summaryByCurrency.map((item) => {
      const latestPrice = item.latestPrice ? `${item.currency} ${Number(item.latestPrice.price || 0).toFixed(2)}` : 'No snapshot yet';
      const lowestPrice = item.lowestPrice ? `${item.currency} ${Number(item.lowestPrice.price || 0).toFixed(2)}` : 'No snapshot yet';
      const highestPrice = item.highestPrice ? `${item.currency} ${Number(item.highestPrice.price || 0).toFixed(2)}` : 'No snapshot yet';
      const lastChecked = item.lastCheckedDate ? new Date(item.lastCheckedDate).toLocaleDateString() : 'Not available';
      const stateText = item.hasEnoughHistory ? '' : '<p class="detail-empty-state">Not enough history yet</p>';
      return `
        <div class="price-history-card">
          <div class="price-history-card__header">
            <strong>${escapeHtml(item.currency || 'USD')}</strong>
            <span class="release-badge">Prices observed by Project Sora</span>
          </div>
          <div class="price-history-list">
            <div><span>Latest observed price</span><strong>${escapeHtml(latestPrice)}</strong></div>
            <div><span>Lowest observed price</span><strong>${escapeHtml(lowestPrice)}</strong></div>
            <div><span>Highest observed price</span><strong>${escapeHtml(highestPrice)}</strong></div>
            <div><span>Last checked date</span><strong>${escapeHtml(lastChecked)}</strong></div>
          </div>
          ${stateText}
        </div>
      `;
    }).join('');
  } catch {
    container.innerHTML = '<p class="detail-empty-state">Not enough history yet</p>';
  }
}

function showCatalogGameDetail(entry) {
  const selectedEntry = normalizeCatalogEntry(entry || currentCatalogDetailEntry);
  if (!selectedEntry) {
    showHomeView();
    return;
  }

  const title = selectedEntry.title || selectedEntry.name || 'Game details';
  renderDetailSkeleton(title);

  window.setTimeout(() => {
    const libraryMatch = getCurrentLibrary().map(normalizeGame).find((game) => {
      const gameTitle = String(game.title || '').toLowerCase();
      const candidateTitle = String(selectedEntry.title || selectedEntry.name || '').toLowerCase();
      return gameTitle === candidateTitle || gameTitle.includes(candidateTitle) || candidateTitle.includes(gameTitle);
    });

    const platform = selectedEntry.platform || 'Platform unavailable';
    const metacritic = selectedEntry.metacriticScore ?? null;
    const userScore = selectedEntry.userScore ?? null;
    const releaseDate = formatCatalogRelease(selectedEntry.release || selectedEntry.releaseDate || selectedEntry.releaseYear);
    const publisher = selectedEntry.publisher || selectedEntry.developer || 'Publisher unavailable';
    const coverImage = selectedEntry.image || selectedEntry.coverImage || GAME_IMAGE_FALLBACK;
    const landscapeImage = selectedEntry.image || selectedEntry.heroImage || selectedEntry.headerImage || GAME_LANDSCAPE_FALLBACK;
    const description = selectedEntry.description || selectedEntry.blurb || 'A description has not been added to the Project Sora catalog yet.';
    const isInLibrary = Boolean(libraryMatch?.id);
    const similarGames = getSimilarGames(selectedEntry);
    const scoreMarkup = userScore === null
      ? '<span class="catalog-score-label">No community score yet</span>'
      : `<div class="star-rating" aria-label="User rating ${userScore}/100">${Array.from({ length: 5 }, (_, index) => `<span class="star ${index < Math.round(userScore / 20) ? 'is-active' : ''}">★</span>`).join('')}</div><span class="catalog-score-label">${userScore}/100 user score</span>`;

    currentCatalogDetailEntry = selectedEntry;
    detailTitle.textContent = title;
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeCoverImage = escapeHtml(coverImage);
    const safeLandscapeImage = escapeHtml(landscapeImage);
    const safePublisher = escapeHtml(publisher);
    const safePlatform = escapeHtml(platform);
    const safeReleaseDate = escapeHtml(releaseDate);
    const safeMetacritic = escapeHtml(metacritic ?? 'Not available');
    const metadataNotice = selectedEntry.metadataStatus === 'partial'
      ? `<div class="catalog-metadata-notice" role="status"><strong>Catalog data is incomplete.</strong> Missing: ${escapeHtml(selectedEntry.missingMetadata.join(', '))}. Information is shown only when available.</div>`
      : '';

    const isWishlisted = isGameWishlisted(selectedEntry.id || title);

    gameDetailContent.innerHTML = `
      <div class="catalog-detail-hero" style="background-image: linear-gradient(135deg, rgba(2, 6, 23, 0.72), rgba(2, 6, 23, 0.56)), url('${safeLandscapeImage}'); background-size: cover; background-position: center;">
        <div class="catalog-detail-hero__image">
          <img src="${safeImage}" alt="${safeTitle}" />
        </div>
        <div class="catalog-detail-hero__body">
          <div class="catalog-detail-hero__eyebrow">Featured title</div>
          <h3>${safeTitle}</h3>
          <p>${safeDescription}</p>
          <div class="catalog-detail-score">${scoreMarkup}</div>
          ${metadataNotice}
          <div class="release-meta">
            <span class="release-pill">Release ${safeReleaseDate}</span>
            <span class="release-pill">Publisher ${safePublisher}</span>
            <span class="release-pill">Critic ${safeMetacritic}</span>
            <span class="release-pill">Platform ${safePlatform}</span>
          </div>
          <div class="detail-actions">
            <button type="button" class="catalog-action" data-catalog-action="library">${isInLibrary ? 'In library' : 'Add to library'}</button>
            <button type="button" class="catalog-action catalog-action--secondary" data-catalog-action="wishlist">${isWishlisted ? 'Wishlisted' : 'Add to Wishlist'}</button>
          </div>
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-card__header">
          <h4>Price history</h4>
          <span class="release-badge">Prices observed by Project Sora</span>
        </div>
        <div data-price-history-for="${escapeHtml(selectedEntry.id || title)}"></div>
      </div>

      <div class="detail-card">
        <div class="detail-card__header">
          <h4>User reviews</h4>
          <span class="release-badge">Community highlights</span>
        </div>
        <div class="detail-reviews">
          <p class="detail-empty-state">No community reviews have been submitted for this game yet.</p>
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-card__header">
          <h4>Similar games</h4>
          <span class="release-badge">Based on tags & studio</span>
        </div>
        <div class="similar-games-list">
          ${similarGames.map((game) => `
            <article class="similar-game-card" data-similar-title="${escapeHtml(game.name)}">
              <img src="${escapeHtml(game.image || GAME_IMAGE_FALLBACK)}" alt="${escapeHtml(game.name)}" loading="lazy" />
              <div>
                <strong>${escapeHtml(game.name)}</strong>
                <p>${escapeHtml((game.tags || []).slice(0, 3).join(' • '))}</p>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    `;

    if (mainContent) {
      mainContent.classList.add('hidden');
    }
    detailPage.classList.remove('hidden');
    void renderCatalogPriceHistory(selectedEntry.id || title);
    const nextSlug = createCatalogSlug(title);
    if (window.location.hash !== `#catalog/${nextSlug}`) {
      window.location.hash = `catalog/${encodeURIComponent(nextSlug)}`;
    }
  }, 120);
}

function updateActiveSuggestion(container, activeIndex, selector) {
  const items = Array.from(container.querySelectorAll(selector));
  items.forEach((item, index) => {
    item.classList.toggle('is-active', index === activeIndex);
  });
}

function getVisibleSuggestionItems(container, selector) {
  return Array.from(container.querySelectorAll(selector));
}

function handleSuggestionKeyboard(event, container, activeIndexRef, selector, onEnter) {
  return handleSearchKeyboard(event, container, activeIndexRef, selector, onEnter);
}

async function getGameMetadata(title) {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) {
    return {
      title: '',
      image: '',
      description: '',
      metacriticScore: 0,
      platform: '',
      price: 0,
      msrp: 0,
      barcode: '',
      id: ''
    };
  }

  try {
    const catalog = await apiRequest(`/api/games?search=${encodeURIComponent(trimmedTitle)}`);
    const match = Array.isArray(catalog) ? catalog.find((item) => String(item.name || '').toLowerCase().includes(trimmedTitle.toLowerCase())) || catalog[0] : null;
    if (match) {
      return {
        title: match.name,
        image: match.image,
        description: match.description,
        metacriticScore: match.metacriticScore,
        platform: match.platform,
        price: match.price,
        msrp: Number(match.msrp ?? match.price ?? 0),
        barcode: Array.isArray(match.barcodes) ? (match.barcodes[0] || '') : (match.barcode || ''),
        id: match.id || match.name
      };
    }
  } catch {
    // fallback below
  }

  const fallbackMatch = GAME_CATALOG.find((game) => game.name.toLowerCase().includes(trimmedTitle.toLowerCase()));
  if (!fallbackMatch) {
    return {
      title: trimmedTitle,
      image: '',
      description: '',
      metacriticScore: 0,
      platform: '',
      price: 0,
      msrp: 0,
      barcode: '',
      id: trimmedTitle
    };
  }

  return {
    title: fallbackMatch.name,
    image: fallbackMatch.image,
    description: fallbackMatch.description,
    metacriticScore: fallbackMatch.metacriticScore,
    platform: fallbackMatch.platform,
    price: fallbackMatch.price,
    msrp: Number(fallbackMatch.msrp ?? fallbackMatch.price ?? 0),
    barcode: Array.isArray(fallbackMatch.barcodes) ? (fallbackMatch.barcodes[0] || '') : (fallbackMatch.barcode || ''),
    id: fallbackMatch.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  };
}

function setAutofillStatus(message, isError = false) {
  if (!barcodeStatus) return;
  barcodeStatus.textContent = message;
  barcodeStatus.classList.toggle('field-help--error', Boolean(isError));
}

function applyGameMetadata(metadata, options = {}) {
  if (!metadata) return;
  if (metadata.title) titleInput.value = metadata.title;
  const platformInput = document.getElementById('platformInput');
  if (platformInput && metadata.platform) platformInput.value = metadata.platform;
  const coverInput = document.querySelector('input[name="coverImage"]');
  if (coverInput && metadata.image) coverInput.value = metadata.image;
  const metacriticInput = document.querySelector('input[name="metacriticScore"]');
  if (metacriticInput && Number(metadata.metacriticScore) > 0) metacriticInput.value = metadata.metacriticScore;
  const currentValueInput = document.getElementById('currentValueInput') || document.querySelector('input[name="currentValue"]');
  if (currentValueInput && Number(metadata.price) > 0) currentValueInput.value = Number(metadata.price).toFixed(2);
  if (msrpInput && Number(metadata.msrp) > 0) msrpInput.value = Number(metadata.msrp).toFixed(2);
  if (barcodeInput && metadata.barcode) barcodeInput.value = metadata.barcode;
  if (msrpSource) {
    msrpSource.textContent = Number(metadata.msrp) > 0
      ? 'Autofilled from the Project Sora catalog; verify edition and region before saving.'
      : 'MSRP was not available for this catalog result.';
  }
  if (options.message) setAutofillStatus(options.message, false);
}

async function lookupBarcode(barcodeValue) {
  const normalized = String(barcodeValue || '').replace(/[^0-9]/g, '');
  if (normalized.length < 8 || normalized.length > 14) {
    setAutofillStatus('Enter a valid 8–14 digit UPC or EAN.', true);
    return null;
  }

  setAutofillStatus('Looking up barcode…');
  try {
    const response = await apiRequest(`/api/games/barcode?code=${encodeURIComponent(normalized)}`);
    const match = response?.game || response;
    if (!match?.name) throw new Error('No match');
    const metadata = {
      title: match.name,
      image: match.image || '',
      description: match.description || '',
      metacriticScore: Number(match.metacriticScore || 0),
      platform: match.platform || '',
      price: Number(match.price || 0),
      msrp: Number(match.msrp ?? match.price ?? 0),
      barcode: normalized,
      id: match.id || match.name
    };
    applyGameMetadata(metadata, { message: `Found ${match.name}. Review the edition and price before saving.` });
    return metadata;
  } catch {
    setAutofillStatus('No catalog match was found. Keep the barcode and search by title, or enter the game manually.', true);
    return null;
  }
}

let barcodeMediaStream = null;
let barcodeScanTimer = null;

function stopBarcodeScanner() {
  if (barcodeScanTimer) {
    window.clearTimeout(barcodeScanTimer);
    barcodeScanTimer = null;
  }
  if (barcodeMediaStream) {
    barcodeMediaStream.getTracks().forEach((track) => track.stop());
    barcodeMediaStream = null;
  }
  if (barcodeVideo) barcodeVideo.srcObject = null;
  if (barcodeScannerDialog?.open) barcodeScannerDialog.close();
}

async function scanBarcodeFrame(detector) {
  if (!barcodeVideo || !barcodeScannerDialog?.open) return;
  try {
    const barcodes = await detector.detect(barcodeVideo);
    const result = barcodes.find((entry) => entry.rawValue);
    if (result) {
      const code = String(result.rawValue).replace(/[^0-9]/g, '');
      if (barcodeInput) barcodeInput.value = code;
      if (barcodeScannerStatus) barcodeScannerStatus.textContent = `Scanned ${code}. Looking it up…`;
      stopBarcodeScanner();
      await lookupBarcode(code);
      return;
    }
  } catch {
    // Keep scanning; transient detection errors are expected while the camera focuses.
  }
  barcodeScanTimer = window.setTimeout(() => void scanBarcodeFrame(detector), 250);
}

async function startBarcodeScanner() {
  if (!barcodeScannerDialog || !barcodeVideo) return;
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    setAutofillStatus('Camera barcode scanning is not supported by this browser. Enter the barcode manually instead.', true);
    barcodeInput?.focus();
    return;
  }

  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const wanted = ['upc_a', 'upc_e', 'ean_8', 'ean_13'];
    const formats = wanted.filter((format) => supported.includes(format));
    const detector = new window.BarcodeDetector({ formats: formats.length ? formats : supported });
    barcodeScannerDialog.showModal();
    if (barcodeScannerStatus) barcodeScannerStatus.textContent = 'Starting rear camera…';
    barcodeMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    barcodeVideo.srcObject = barcodeMediaStream;
    await barcodeVideo.play();
    if (barcodeScannerStatus) barcodeScannerStatus.textContent = 'Center the barcode inside the frame.';
    void scanBarcodeFrame(detector);
  } catch (error) {
    stopBarcodeScanner();
    setAutofillStatus(error?.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow camera access or enter the barcode manually.'
      : 'The camera could not start. Enter the barcode manually instead.', true);
  }
}

function attachSuggestionEvents() {
  titleSuggestions.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-title]');
    if (!item) {
      return;
    }

    const selectedTitle = item.getAttribute('data-title');
    const metadata = await getGameMetadata(selectedTitle);
    applyGameMetadata(metadata, { message: `Autofilled ${metadata.title || selectedTitle}. Review pricing before saving.` });
    titleSuggestions.classList.add('hidden');
  });
}

function buildSearchEntryLabel(item) {
  const title = String(item.title || item.name || '').trim();
  const platform = String(item.platform || item.platforms || '').trim();
  const priceText = Number(item.price || 0).toFixed(2);
  const metaText = item.metacriticScore ? ` • Meta ${item.metacriticScore}` : '';
  return { title, platform, priceText, metaText };
}

function createSearchResultMarkup(item, kind = 'game', searchIndex = -1) {
  const searchSuggestionAccessibilityAttributes = 'role="option" tabindex="0"';
  const markup = createSearchExperienceMarkup(item, kind, searchIndex, gameSearch.value.trim().toLowerCase());
  return markup.includes(searchSuggestionAccessibilityAttributes) ? markup : markup.replace('<div class="suggestion-item"', `<div class="suggestion-item" ${searchSuggestionAccessibilityAttributes}`);
}

async function populateTitleSuggestions() {
  const value = titleInput.value.trim();
  if (value.length < 2) {
    titleSuggestions.classList.add('hidden');
    titleSuggestions.innerHTML = '';
    return;
  }

  try {
    const results = await apiRequest(`/api/games?search=${encodeURIComponent(value)}&limit=8`);
    if (!results.length) {
      throw new Error('No catalog match');
    }

    titleSuggestions.innerHTML = results
      .slice(0, 5)
      .map((game) => {
        const safeTitle = escapeHtml(game.name);
        const safePlatform = escapeHtml(game.platformSummary || (Array.isArray(game.availablePlatforms) && game.availablePlatforms.length > 1 ? `${game.availablePlatforms[0]} +${game.availablePlatforms.length - 1} more` : game.platform));
        const safeImage = escapeHtml(game.image || 'https://placehold.co/72x72/0f172a/ffffff?text=Game');
        return `
          <div class="suggestion-item" data-title="${safeTitle}">
            <img src="${safeImage}" alt="${safeTitle}" />
            <div>
              <strong>${safeTitle}</strong>
              <div>${safePlatform} • $${Number(game.price || 0).toFixed(2)}</div>
            </div>
          </div>
        `;
      })
      .join('');

    titleSuggestions.classList.remove('hidden');
  } catch {
    const fallbackResults = createSearchSuggestions(GAME_CATALOG, value, 5);
    if (!fallbackResults.length) {
      titleSuggestions.classList.add('hidden');
      titleSuggestions.innerHTML = '';
      return;
    }

    titleSuggestions.innerHTML = fallbackResults
      .map((game) => {
        const safeTitle = escapeHtml(game.name);
        const safePlatform = escapeHtml(game.platformSummary || (Array.isArray(game.availablePlatforms) && game.availablePlatforms.length > 1 ? `${game.availablePlatforms[0]} +${game.availablePlatforms.length - 1} more` : game.platform));
        const safeImage = escapeHtml(game.image || 'https://placehold.co/72x72/0f172a/ffffff?text=Game');
        return `
          <div class="suggestion-item" data-title="${safeTitle}">
            <img src="${safeImage}" alt="${safeTitle}" />
            <div>
              <strong>${safeTitle}</strong>
              <div>${safePlatform} • $${Number(game.price || 0).toFixed(2)}</div>
            </div>
          </div>
        `;
      })
      .join('');

    titleSuggestions.classList.remove('hidden');
  }
}

async function saveGame(game) {
  if (!currentUser) {
    alert('Choose a library owner before saving a game.');
    return;
  }

  const games = getCurrentLibrary();
  const nextGame = applyPlayStatusToGame({
    ...game,
    id: newGameId(),
    comments: game.comments || [],
    playtimeMinutes: Number(game.playtimeMinutes || 0),
    completionPercent: Number(game.completionPercent || 0)
  });
  games.push(nextGame);
  await persistLibraryState(games);
  if (authToken && currentUser) {
    await pushActivityEvent({
      type: 'added_game',
      gameId: nextGame.id,
      displayTitle: nextGame.title,
      eventId: `added-game-${nextGame.id}-${Date.now()}`
    });
  }
}

async function switchUser() {
  clearProfilePreview();
  renderProfileSkeleton();
  renderLibrarySkeleton();
  currentUser = normalizeEmail(usernameInput.value);
  if (!currentUser || !isValidEmail(currentUser)) {
    alert('Please enter a valid email for your library.');
    return;
  }

  if (localStorage.getItem(REMEMBER_ME_KEY) === 'true') {
    localStorage.setItem('gamevault-current-user', currentUser);
  }

  await loadLibraryFromServer();
  if (authToken && currentUser) {
    await loadFriendState();
  }
  renderLibrary();
  renderCollectionStatistics();
  updateProfileHub();
  showHomeView();
}

addFriendButton?.addEventListener('click', addCurrentFriend);

friendInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void addCurrentFriend();
  }
});

gameForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(gameForm);
  const gameTitle = formData.get('title').toString().trim();
  const metadata = await getGameMetadata(gameTitle);
  const game = {
    title: gameTitle,
    platform: formData.get('platform').toString().trim() || metadata.platform,
    condition: formData.get('condition').toString().trim(),
    purchasePrice: Number(formData.get('purchasePrice') || 0),
    currentValue: Number(formData.get('currentValue') || metadata.price || 0),
    msrp: Number(formData.get('msrp') || metadata.msrp || metadata.price || 0),
    barcode: String(formData.get('barcode') || metadata.barcode || '').replace(/[^0-9]/g, ''),
    metacriticScore: Number(formData.get('metacriticScore') || metadata.metacriticScore || 0),
    notes: formData.get('notes').toString().trim(),
    coverImage: formData.get('coverImage')?.toString().trim() || metadata.image || '',
    comments: [],
    status: formData.get('status').toString().trim() || 'Backlog',
    completionPercent: Number(formData.get('completionPercent') || 0),
    ownershipStatus: String(formData.get('ownershipStatus') || 'Owned'),
    mediaType: String(formData.get('mediaType') || 'Unknown'),
    purchaseDate: String(formData.get('purchaseDate') || ''),
    playtimeMinutes: Math.round(Number(formData.get('playtimeHours') || 0) * 60),
    personalRating: Number(formData.get('personalRating') || 0),
    estimatedHours: Number(formData.get('estimatedHours') || 0),
    franchise: String(formData.get('franchise') || '').trim(),
    genre: String(formData.get('genre') || '').trim(),
    replayStatus: String(formData.get('replayStatus') || 'No'),
    favorite: formData.get('favorite') === 'on',
    achievements: { finished: false, finalBoss: false, collectedEverything: false, wantToReplay: formData.get('replayStatus') === 'Planned' }
  };

  saveGame(game);
  gameForm.reset();
  titleSuggestions.classList.add('hidden');
});


function getGameMatchSignals() {
  const library = getCurrentLibrary().map(normalizeGame);
  const scoreBoard = library.map((game) => Number(game.metacriticScore || 0));
  const averageMeta = scoreBoard.length ? scoreBoard.reduce((sum, value) => sum + value, 0) / scoreBoard.length : 75;
  const platforms = library.map((game) => game.platform).filter(Boolean);
  const genres = library.map((game) => game.notes).filter(Boolean);
  return { library, averageMeta, platforms, genres };
}

async function buildGameMatchCandidates() {
  const library = getPlayNextLibraryGames();
  const candidates = buildPlayNextRecommendations(library, getPlayNextRecommendationOptions())
    .filter((candidate) => !playNextState.dismissed.includes(candidate.id || candidate.title || candidate.name));

  gameMatchCandidates = candidates.slice(0, 5);
  gameMatchIndex = 0;
  updatePlayNextCardState();
}

async function handleGameMatchDecision(action) {
  if (!gameMatchCandidates.length) {
    return;
  }

  const current = gameMatchCandidates[gameMatchIndex];
  const id = current.id || current.title || current.name;

  if (action === 'wishlist') {
    await addGameToWishlist({
      gameId: id,
      title: current.title || current.name,
      platform: current.platform,
      price: current.price,
      image: current.image,
      releaseDate: current.release || current.releaseDate || ''
    });
  } else if (action === 'dismiss') {
    playNextState.dismissed = [...new Set([...playNextState.dismissed, id])];
  } else if (action === 'reset') {
    playNextState.dismissed = [];
  }

  savePlayNextState();

  if (action === 'next' || action === 'dismiss' || action === 'reset') {
    playNextState.history = [...new Set([...(playNextState.history || []), id])];
  }

  if (action === 'reset') {
    await buildGameMatchCandidates();
    return;
  }

  if (action === 'wishlist') {
    playNextState.history = [...new Set([...(playNextState.history || []), id])];
  }

  gameMatchIndex = (gameMatchIndex + 1) % Math.max(gameMatchCandidates.length, 1);
  await buildGameMatchCandidates();
}

function showHomeView() {
  if (mainContent) {
    mainContent.classList.remove('hidden');
    mainContent.classList.remove('content-area--profile-view');
    mainContent.focus();
  }
  if (detailPage) {
    detailPage.classList.add('hidden');
  }
  if (statisticsPage) {
    statisticsPage.classList.add('hidden');
  }
  if (publicProfilePage) {
    publicProfilePage.classList.add('hidden');
  }
  if (releaseDetailPage) {
    releaseDetailPage.classList.add('hidden');
  }
  window.location.hash = '';
}

function showGameView(gameId) {
  const games = getDisplayedLibrary().map(normalizeGame);
  const targetGame = games.find((game) => game.id === gameId);
  if (!targetGame) {
    showHomeView();
    return;
  }

  currentDetailGameIndex = games.findIndex((game) => game.id === gameId);
  currentDetailGameId = gameId;

  renderDetailSkeleton(targetGame.title);

  window.setTimeout(() => {
    const reviews = Array.isArray(targetGame.comments) ? targetGame.comments : [];
    const averageRating = reviews.length ? (reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length).toFixed(1) : 'N/A';

    const safeTitle = escapeHtml(targetGame.title);
    const safeCoverImage = escapeHtml(targetGame.coverImage || GAME_IMAGE_FALLBACK);
    const safePlatform = escapeHtml(targetGame.platform);
    const safeCondition = escapeHtml(targetGame.condition);
    const safeNotes = escapeHtml(targetGame.notes || 'No notes');
    const safeMetacritic = escapeHtml(targetGame.metacriticScore ?? 'N/A');
    const safePlaytime = escapeHtml(formatPlaytime(targetGame.playtimeMinutes || 0));
    const safeCompletion = escapeHtml(`${Math.round(Number(targetGame.completionPercent || 0))}%`);
    const safeStatus = escapeHtml(targetGame.status || 'Backlog');
    const statusOptionsMarkup = PLAY_STATUS_OPTIONS.map((option) => `<option value="${escapeHtml(option)}" ${targetGame.status === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');

    detailTitle.textContent = targetGame.title;
    gameDetailContent.innerHTML = `
      <div class="detail-overview">
        <div class="detail-card">
          <img class="detail-cover" src="${safeCoverImage}" alt="${safeTitle}" />
        </div>
        <div class="detail-card">
          <strong>Platform</strong>
          <p>${safePlatform}</p>
          <strong>Condition</strong>
          <p>${safeCondition}</p>
          <strong>Purchase price</strong>
          <p>$${Number(targetGame.purchasePrice || 0).toFixed(2)}</p>
          <strong>Current value</strong>
          <p>$${Number(targetGame.currentValue || 0).toFixed(2)}</p>
          <strong>Metacritic score</strong>
          <p>${safeMetacritic}</p>
          <strong>Playtime</strong>
          <p>${safePlaytime}</p>
          <strong>Completion</strong>
          <p>${safeCompletion}</p>
          <strong>Status</strong>
          <p>${safeStatus}</p>
          <strong>Notes</strong>
          <p>${safeNotes}</p>
          <strong>Community average rating</strong>
          <p>${averageRating} / 5</p>
        </div>
      </div>

      <div class="detail-card">
        <h3>Profile progress</h3>
        <form id="profileProgressForm" data-game-id="${escapeHtml(targetGame.id)}">
          <label>
            Log playtime (minutes)
            <input type="number" min="0" name="playtimeMinutes" value="${Number(targetGame.playtimeMinutes || 0)}" />
          </label>
          <label>
            Completion %
            <input type="number" min="0" max="100" name="completionPercent" value="${Math.round(Number(targetGame.completionPercent || 0))}" />
          </label>
          <label>
            Play status
            <select name="status" data-play-status-select data-game-id="${escapeHtml(targetGame.id)}">
              ${statusOptionsMarkup}
            </select>
          </label>
          <button type="submit">Save progress</button>
        </form>
      </div>

      <div class="detail-card">
        <h3>In-app user ratings and comments</h3>
        <form id="commentForm" data-game-id="${escapeHtml(targetGame.id)}">
          <label>
            Your rating
            <select name="userRating">
              <option value="5">5 - Excellent</option>
              <option value="4">4 - Good</option>
              <option value="3">3 - Okay</option>
              <option value="2">2 - Weak</option>
              <option value="1">1 - Poor</option>
            </select>
          </label>
          <label>
            Add a comment
            <textarea name="comment" rows="3" placeholder="Share your thoughts on this game"></textarea>
          </label>
          <button type="submit">Post review</button>
        </form>
        <div class="comments-list">
          ${reviews.length ? reviews.map((comment) => `
            <article class="comment-item">
              <strong>${escapeHtml(comment.author || 'Anonymous')} • ${escapeHtml(comment.rating || 'N/A')} / 5</strong>
              <p>${escapeHtml(comment.text)}</p>
            </article>
          `).join('') : '<p class="empty-state">No reviews yet.</p>'}
        </div>
      </div>
    `;

    if (mainContent) {
      mainContent.classList.add('hidden');
    }
    detailPage.classList.remove('hidden');
  }, 120);
}

function navigateDetail(direction) {
  const games = getDisplayedLibrary().map(normalizeGame);
  if (!games.length) {
    return;
  }

  if (currentDetailGameIndex < 0) {
    currentDetailGameIndex = 0;
  }

  const safeIndex = (currentDetailGameIndex + direction + games.length) % games.length;
  const nextGame = games[safeIndex];
  currentDetailGameIndex = safeIndex;
  showGameView(nextGame.id);
}

gamesList?.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view-id]');
  if (viewButton) {
    const gameId = viewButton.getAttribute('data-view-id');
    const owner = resolveLibraryOwner(currentUser, activeLibraryOwner);
    const games = getLibraryForOwner(owner).map(normalizeGame);
    const targetGame = games.find((game) => game.id === gameId);
    if (targetGame && targetGame.id) {
      currentDetailGameIndex = games.findIndex((game) => game.id === targetGame.id);
      window.location.hash = `game/${targetGame.id}`;
    }
    return;
  }

  const deleteButton = event.target.closest('[data-delete-id]');
  if (!deleteButton) {
    return;
  }

  const gameId = deleteButton.getAttribute('data-delete-id');
  const owner = resolveLibraryOwner(currentUser, activeLibraryOwner);
  const games = getLibraryForOwner(owner);
  const nextGames = games.filter((game) => String(game.id || '') !== String(gameId));
  if (!canEditViewedLibrary(currentUser, activeLibraryOwner)) {
    const users = loadUsers();
    users[owner] = nextGames;
    saveUsers(users);
    renderLibrary();
    updateSummary();
    updateProfileHub();
    return;
  }

  await persistLibraryState(nextGames);
});

gameMatchCard?.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-match-action]');
  if (!actionButton) {
    return;
  }

  const action = actionButton.getAttribute('data-match-action');
  if (action === 'wishlist') {
    const current = gameMatchCandidates[gameMatchIndex];
    if (current) {
      await addGameToQueue({
        gameId: current.id || current.title || current.name,
        title: current.title || current.name,
        platform: current.platform,
        image: current.image,
        status: 'Queued'
      });
    }
  }

  await handleGameMatchDecision(action);
});

[playNextPlatformFilter, playNextGenreFilter, playNextMaxPlaytimeFilter].forEach((element) => {
  if (element) {
    element.addEventListener('change', () => {
      syncPlayNextFiltersFromInputs();
      buildGameMatchCandidates();
    });
  }
});

if (playNextResetFiltersButton) {
  playNextResetFiltersButton.addEventListener('click', () => {
    resetPlayNextFilters();
  });
}

gameDetailContent?.addEventListener('click', async (event) => {
  const similarCard = event.target.closest('[data-similar-title]');
  if (similarCard) {
    const title = similarCard.getAttribute('data-similar-title');
    const matchedEntry = getCatalogEntryByTitle(title);
    if (matchedEntry) {
      showCatalogGameDetail(matchedEntry);
    }
    return;
  }

  const actionButton = event.target.closest('[data-catalog-action]');
  if (!actionButton || !currentCatalogDetailEntry) {
    return;
  }

  const action = actionButton.getAttribute('data-catalog-action');
  const games = getCurrentLibrary();
  const title = currentCatalogDetailEntry.title || currentCatalogDetailEntry.name || 'Untitled game';
  const existingIndex = games.findIndex((game) => String(game.title || '').toLowerCase() === String(title).toLowerCase());

  if (action === 'library') {
    if (existingIndex >= 0) {
      return;
    }

    const nextGame = normalizeGame({
      id: `catalog-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title,
      platform: currentCatalogDetailEntry.platform || 'Platform unknown',
      condition: 'Good',
      purchasePrice: Number(currentCatalogDetailEntry.price || 0),
      currentValue: Number(currentCatalogDetailEntry.price || 0),
      metacriticScore: Number(currentCatalogDetailEntry.metacriticScore || 0),
      coverImage: currentCatalogDetailEntry.image || currentCatalogDetailEntry.coverImage || '',
      notes: currentCatalogDetailEntry.description || currentCatalogDetailEntry.blurb || '',
      comments: []
    });
    games.push(nextGame);
    await persistLibraryState(games);
    const wishlistMatch = getWishlistItems().find((item) => item.gameId === (currentCatalogDetailEntry.id || title));
    if (wishlistMatch) {
      await removeGameFromWishlist(wishlistMatch.gameId);
      renderWishlistView();
    }
    setSyncStatus('Added to library and removed from wishlist.', 'success');
    showCatalogGameDetail(currentCatalogDetailEntry);
    return;
  }

  if (action === 'wishlist') {
    const catalogEntry = {
      gameId: currentCatalogDetailEntry.id || currentCatalogDetailEntry.name || title,
      title,
      platform: currentCatalogDetailEntry.platform || 'Platform unknown',
      price: currentCatalogDetailEntry.price || 0,
      image: currentCatalogDetailEntry.image || currentCatalogDetailEntry.coverImage || '',
      releaseDate: currentCatalogDetailEntry.release || currentCatalogDetailEntry.releaseDate || ''
    };
    await addGameToWishlist(catalogEntry);
    actionButton.textContent = 'Wishlisted';
    actionButton.disabled = true;
    renderWishlistView();
  }
});

backToLibraryButton?.addEventListener('click', showHomeView);
prevGameButton?.addEventListener('click', () => navigateDetail(-1));
nextGameButton?.addEventListener('click', () => navigateDetail(1));

document.addEventListener('submit', async (event) => {
  const profileProgressForm = event.target.closest('#profileProgressForm');
  if (profileProgressForm) {
    event.preventDefault();
    const games = getCurrentLibrary();
    const gameId = profileProgressForm.getAttribute('data-game-id');
    const game = games.find((item) => item.id === gameId);
    if (!game) {
      return;
    }

    const playtimeMinutes = Math.max(0, Number(profileProgressForm.querySelector('input[name="playtimeMinutes"]')?.value || 0));
    const completionPercent = Math.max(0, Math.min(100, Number(profileProgressForm.querySelector('input[name="completionPercent"]')?.value || 0)));
    const selectedStatus = profileProgressForm.querySelector('select[name="status"]')?.value || 'Backlog';

    game.playtimeMinutes = playtimeMinutes;
    game.completionPercent = completionPercent;
    if (completionPercent >= 100 && game.status !== 'Completed') {
      const shouldComplete = window.confirm('Mark this game as completed?');
      game.status = shouldComplete ? 'Completed' : selectedStatus;
      if (game.status === 'Completed') {
        game.completedAt = game.completedAt || new Date().toISOString();
      } else {
        game.completedAt = null;
      }
    } else {
      game.status = selectedStatus;
      game.completedAt = game.status === 'Completed' ? (game.completedAt || new Date().toISOString()) : null;
    }
    await persistLibraryState(games);
    showGameView(gameId);
    return;
  }

  const commentForm = event.target.closest('#commentForm');
  if (!commentForm) {
    return;
  }

  event.preventDefault();
  const games = getCurrentLibrary();
  const gameId = commentForm.getAttribute('data-game-id');
  const game = games.find((item) => item.id === gameId);
  if (!game) {
    return;
  }

  const textarea = commentForm.querySelector('textarea[name="comment"]');
  const text = textarea.value.trim();
  const ratingSelect = commentForm.querySelector('select[name="userRating"]');
  const rating = Number(ratingSelect?.value || 0);

  if (!text) {
    return;
  }

  const existingComments = Array.isArray(game.comments) ? game.comments : [];
  const alreadyExists = existingComments.some((comment) => {
    const normalizedText = String(comment.text || '').trim().toLowerCase();
    const normalizedNewText = text.toLowerCase();
    return normalizedText && normalizedText === normalizedNewText && Number(comment.rating || 0) === rating;
  });

  if (alreadyExists) {
    textarea.value = '';
    return;
  }

  game.comments = existingComments;
  game.comments.push({
    author: currentUser || 'Anonymous',
    text,
    rating
  });

  await persistLibraryState(games, { renderAfterSave: false, updateProfile: false });
  if (authToken) {
    await pushActivityEvent({
      type: 'posted_review',
      gameId,
      displayTitle: game.title,
      eventId: `review-${gameId}-${Date.now()}`
    });
    try {
      await apiRequest('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ gameId, text, rating })
      });
    } catch {
      // ignore review sync error
    }
  }
  showGameView(gameId);
});

queueContainer?.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-queue-action]');
  if (!actionButton) {
    return;
  }

  const action = actionButton.getAttribute('data-queue-action');
  const gameId = actionButton.getAttribute('data-queue-game-id');
  if (action === 'up' || action === 'down') {
    await reorderQueue(gameId, action);
    return;
  }

  await updateQueueEntryAction(gameId, action);
});

queueContainer?.addEventListener('dragstart', (event) => {
  const item = event.target.closest('[data-queue-game-id]');
  if (!item) {
    return;
  }
  event.dataTransfer?.setData('text/plain', item.getAttribute('data-queue-game-id') || '');
});

queueContainer?.addEventListener('dragover', (event) => {
  if (event.target.closest('[data-queue-game-id]')) {
    event.preventDefault();
  }
});

queueContainer?.addEventListener('drop', async (event) => {
  const sourceGameId = event.dataTransfer?.getData('text/plain');
  const targetItem = event.target.closest('[data-queue-game-id]');
  if (!sourceGameId || !targetItem) {
    return;
  }
  event.preventDefault();
  const targetGameId = targetItem.getAttribute('data-queue-game-id');
  const nextItems = getQueueItems().slice();
  const sourceIndex = nextItems.findIndex((item) => item.gameId === sourceGameId);
  const targetIndex = nextItems.findIndex((item) => item.gameId === targetGameId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return;
  }
  [nextItems[sourceIndex], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[sourceIndex]];
  setQueueItems(nextItems);
  saveQueueStateLocally(getQueueItems());
  renderQueueView();
});

function handleSwipeStart(event) {
  if (!detailPage.classList.contains('hidden')) {
    window.__touchStartX = event.touches[0].clientX;
  }
}

function handleSwipeEnd(event) {
  if (detailPage.classList.contains('hidden')) {
    return;
  }

  const endX = event.changedTouches[0].clientX;
  const diff = endX - (window.__touchStartX || 0);

  if (Math.abs(diff) > 60) {
    navigateDetail(diff < 0 ? 1 : -1);
  }
}

function resolveHashRoute() {
  const hash = window.location.hash;
  if (hash.startsWith('#game/')) {
    const gameId = hash.split('/')[1];
    if (gameId) {
      showGameView(gameId);
    }
    return;
  }

  if (hash.startsWith('#catalog/')) {
    const slug = hash.split('/')[1] || '';
    const catalogMatch = findCatalogEntryBySlug(GAME_CATALOG, slug);
    if (catalogMatch) {
      showCatalogGameDetail(catalogMatch);
      return;
    }
  }

  if (hash === '#upcoming/calendar') {
    renderReleaseCalendarList();
    void refreshReleaseCalendar();
    return;
  }

  if (hash.startsWith('#upcoming/')) {
    const releaseId = hash.slice('#upcoming/'.length);
    const release = findReleaseById(releaseId);
    if (release) {
      renderReleaseDetail(release);
    } else {
      void refreshReleaseCalendar().then(() => {
        const refreshedRelease = findReleaseById(releaseId);
        if (refreshedRelease) renderReleaseDetail(refreshedRelease);
      });
    }
    return;
  }

  if (hash === '#statistics') {
    showStatisticsView();
    return;
  }

  showHomeView();
}



function formatIntegrationStatusLabel(status) {
  if (status === 'healthy') return 'Active';
  if (status === 'degraded') return 'Using fallback';
  if (status === 'not-configured') return 'Not connected';
  return 'Checking';
}

function renderIntegrationStatus(payload) {
  if (!integrationStatusList) return;
  const integrations = Array.isArray(payload?.integrations) ? payload.integrations : [];
  if (!integrations.length) {
    integrationStatusList.innerHTML = '<p class="empty-state">Integration status is unavailable right now.</p>';
    return;
  }

  integrationStatusList.innerHTML = integrations.map((integration) => {
    const status = String(integration.status || 'unknown');
    const itemCount = Number.isFinite(Number(integration.cachedItemCount))
      ? `<span>${Number(integration.cachedItemCount).toLocaleString()} cached items</span>`
      : Number.isFinite(Number(integration.recordCount))
        ? `<span>${Number(integration.recordCount).toLocaleString()} records</span>`
        : Number.isFinite(Number(integration.verifiedBarcodeCount))
          ? `<span>${Number(integration.verifiedBarcodeCount).toLocaleString()} verified barcodes</span>`
          : '';
    const sourceLabel = integration.officialApi
      ? 'Official/partner integration'
      : String(integration.sourceType || '').replaceAll('-', ' ');
    return `
      <article class="integration-status-card integration-status-card--${escapeHtml(status)}">
        <div class="integration-status-card__top">
          <strong>${escapeHtml(integration.label || integration.id || 'Integration')}</strong>
          <span class="integration-status-pill">${escapeHtml(formatIntegrationStatusLabel(status))}</span>
        </div>
        <p>${escapeHtml(integration.purpose || '')}</p>
        <div class="integration-status-meta"><span>${escapeHtml(sourceLabel)}</span>${itemCount}</div>
        <small>${escapeHtml(integration.notes || '')}</small>
      </article>`;
  }).join('');
}

async function loadIntegrationStatus() {
  if (!integrationStatusList) return;
  integrationStatusList.innerHTML = '<div class="skeleton-card" aria-label="Checking data sources"></div>';
  if (refreshIntegrationStatusButton) refreshIntegrationStatusButton.disabled = true;
  try {
    const payload = await apiRequest('/api/integrations/status');
    renderIntegrationStatus(payload);
  } catch (error) {
    integrationStatusList.innerHTML = `<p class="empty-state">${escapeHtml(getFriendlyErrorMessage(error, 'Integration status could not be loaded.'))}</p>`;
  } finally {
    if (refreshIntegrationStatusButton) refreshIntegrationStatusButton.disabled = false;
  }
}

function openSupportDialog() {
  if (!supportDialog) return;
  if (typeof supportDialog.showModal === 'function') supportDialog.showModal();
  else supportDialog.setAttribute('open', '');
  loadIntegrationStatus();
  window.setTimeout(() => closeSupportDialog?.focus(), 0);
}

function closeSupport() {
  if (!supportDialog) return;
  if (typeof supportDialog.close === 'function') supportDialog.close();
  else supportDialog.removeAttribute('open');
  supportNavButton?.focus();
}

supportNavButton?.addEventListener('click', openSupportDialog);
refreshIntegrationStatusButton?.addEventListener('click', loadIntegrationStatus);
closeSupportDialog?.addEventListener('click', closeSupport);
supportDialog?.addEventListener('click', (event) => {
  if (event.target === supportDialog) closeSupport();
});

feedbackForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (document.getElementById('feedbackWebsite')?.value) return;
  const payload = {
    category: document.getElementById('feedbackCategory')?.value || 'other',
    email: document.getElementById('feedbackEmail')?.value.trim() || '',
    summary: document.getElementById('feedbackSummary')?.value.trim() || '',
    details: document.getElementById('feedbackDetails')?.value.trim() || '',
    device: document.getElementById('feedbackDevice')?.value.trim() || navigator.userAgent,
    page: document.getElementById('feedbackPage')?.value.trim() || window.location.hash || 'home',
    appUrl: window.location.href
  };
  if (payload.summary.length < 4 || payload.details.length < 10) {
    if (feedbackStatus) {
      feedbackStatus.textContent = 'Please add a clearer summary and at least 10 characters of detail.';
      feedbackStatus.className = 'is-error';
    }
    return;
  }
  if (submitFeedbackButton) submitFeedbackButton.disabled = true;
  if (feedbackStatus) {
    feedbackStatus.textContent = 'Sending…';
    feedbackStatus.className = '';
  }
  try {
    const result = await apiRequest('/api/feedback', { method: 'POST', body: JSON.stringify(payload) });
    feedbackForm.reset();
    if (feedbackStatus) {
      feedbackStatus.textContent = `Feedback received. Reference: ${result.reference || 'submitted'}`;
      feedbackStatus.className = 'is-success';
    }
  } catch (error) {
    if (feedbackStatus) {
      feedbackStatus.textContent = getFriendlyErrorMessage(error, 'Feedback could not be sent. Please try again.');
      feedbackStatus.className = 'is-error';
    }
  } finally {
    if (submitFeedbackButton) submitFeedbackButton.disabled = false;
  }
});

releasePlatformFilter?.addEventListener('change', () => {
  releasePlatformSelection = releasePlatformFilter.value || 'All';
  releaseHeroIndex = 0;
  if (window.location.hash === '#upcoming/calendar') renderReleaseCalendarList();
  else renderReleaseCalendar();
});
releaseCalendarButton?.addEventListener('click', () => { window.location.hash = '#upcoming/calendar'; });
backFromReleaseButton?.addEventListener('click', () => showHomeView());

document.addEventListener('click', async (event) => {
  const releaseCard = event.target.closest('[data-release-id]');
  if (releaseCard && !event.target.closest('[data-release-action]')) {
    const item = findReleaseById(releaseCard.getAttribute('data-release-id'));
    if (item) openReleaseDetail(item);
    return;
  }
  const actionButton = event.target.closest('[data-release-action]');
  if (!actionButton) return;
  const item = findReleaseById(actionButton.getAttribute('data-release-id'));
  if (!item) return;
  const action = actionButton.getAttribute('data-release-action');
  if (action === 'interest') {
    const interests = getReleaseInterests();
    if (interests[item.id]) delete interests[item.id];
    else interests[item.id] = { id: item.id, title: item.title, markedAt: new Date().toISOString() };
    await persistReleaseInterests(interests);
    renderReleaseDetail(item);
  } else if (action === 'wishlist') {
    const existing = getWishlistItems().find((entry) => entry.gameId === item.id || entry.title === item.title);
    if (existing) await removeGameFromWishlist(existing.gameId);
    else await addGameToWishlist({ id: item.id, title: item.title, platform: item.platform, image: item.image, price: 0 });
    renderReleaseDetail(item);
  }
});


function reportClientDiagnostic(kind, message, details = {}) {
  const payload = {
    kind: String(kind || 'client-error').slice(0, 40),
    message: String(message || 'Unknown client error').slice(0, 500),
    route: window.location.hash || window.location.pathname,
    userAgent: navigator.userAgent,
    appVersion: document.querySelector('meta[name="app-version"]')?.content || 'beta',
    details
  };
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {});
}
window.addEventListener('error', (event) => reportClientDiagnostic('error', event.message, { filename: event.filename, line: event.lineno, column: event.colno }));
window.addEventListener('unhandledrejection', (event) => reportClientDiagnostic('unhandled-rejection', event.reason?.message || String(event.reason || 'Unhandled rejection')));

registerServiceWorker();
initInstallButton();

window.addEventListener('hashchange', resolveHashRoute);
resolveHashRoute();

window.addEventListener('touchstart', handleSwipeStart, { passive: true });
window.addEventListener('touchend', handleSwipeEnd, { passive: true });

clearLibraryButton?.addEventListener('click', async () => {
  if (!currentUser) {
    alert('Choose a library owner first.');
    return;
  }

  const confirmed = window.confirm(`Clear all games from ${currentUser}'s library?`);
  if (!confirmed) {
    return;
  }

  setCurrentLibrary([]);
  await syncLibraryToServer([]);
  renderLibrary();
  renderCollectionStatistics();
});

switchUserButton?.addEventListener('click', switchUser);
usernameInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    switchUser();
  }
});

csvUpload?.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const imported = parseCsvGames(text).map(normalizeGame);

    if (!imported.length) {
      throw new Error('No valid rows found in the CSV file.');
    }

    const games = getCurrentLibrary();
    const mergedGames = [...games, ...imported];
    await persistLibraryState(mergedGames);
    updateSummary();
    updateProfileHub();
  } catch (error) {
    const message = error?.message || 'Unable to import CSV file.';
    setSyncStatus(`Import failed: ${message}`, 'error');
    alert(message);
  } finally {
    event.target.value = '';
  }
});

exportCsvButton?.addEventListener('click', () => {
  const games = getCurrentLibrary();
  const csv = serializeLibraryCsv(games);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${currentUser || 'gamevault'}-library.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
});

if (betaDownloadStatus) {
  betaDownloadStatus.textContent = 'Beta downloads are currently unavailable.';
}

populateStatusFilterOptions();
statusFilter?.addEventListener('change', (event) => {
  currentStatusFilter = event.target.value || 'All';
  renderLibrary();
});

renderCollectionStatistics();

gameSearch?.addEventListener('focus', async () => {
  if (!gameSearch.value.trim()) {
    await renderGameSearchResults();
    return;
  }

  if (!searchDebounceController) {
    searchDebounceController = createDebouncedRequest();
  }

  searchDebounceController.runNow((requestId) => {
    activeSearchRequestId = requestId;
    void renderGameSearchResults(requestId);
  });
});

gameSearch?.addEventListener('input', (event) => {
  const nextValue = event.target.value.trim();
  searchTerm = nextValue;
  renderLibrary();

  if (!nextValue) {
    activeSearchRequestId += 1;
    if (searchDebounceController) {
      searchDebounceController.cancel();
    }
    latestSearchResults = [];
    updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
    return;
  }

  if (!searchDebounceController) {
    searchDebounceController = createDebouncedRequest();
  }

  searchDebounceController.schedule((requestId) => {
    activeSearchRequestId = requestId;
    void renderGameSearchResults(requestId);
  });
});

gameSearch?.addEventListener('keydown', (event) => {
  const handled = handleSuggestionKeyboard(event, gameSearchResults, gameSearchKeyboardState, '[data-game-id], [data-profile]', (item) => {
    const profileName = item.getAttribute('data-profile');
    if (profileName) {
      updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
      showProfilePreview(profileName);
      return;
    }

    const resolvedEntry = resolveSearchSelection(item);
    updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
    if (resolvedEntry) {
      showCatalogGameDetail(resolvedEntry);
      return;
    }

    const gameId = item.getAttribute('data-game-id');
    showGameView(gameId);
  });

  if (handled) {
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    searchTerm = gameSearch.value.trim();
    renderLibrary();
    updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
  }
});

gameSearchResults?.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) {
    return;
  }

  const focusedItem = event.target.closest('[data-game-id], [data-profile]');
  if (!focusedItem) {
    return;
  }

  event.preventDefault();
  const profileName = focusedItem.getAttribute('data-profile');
  if (profileName) {
    updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
    void showProfilePreview(profileName);
    return;
  }

  const resolvedEntry = resolveSearchSelection(focusedItem);
  updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
  if (resolvedEntry) {
    showCatalogGameDetail(resolvedEntry);
    return;
  }

  showGameView(focusedItem.getAttribute('data-game-id'));
});

scanBarcodeButton?.addEventListener('click', () => void startBarcodeScanner());
lookupBarcodeButton?.addEventListener('click', () => void lookupBarcode(barcodeInput?.value));
barcodeInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void lookupBarcode(barcodeInput.value);
  }
});
closeBarcodeScannerButton?.addEventListener('click', stopBarcodeScanner);
barcodeScannerDialog?.addEventListener('cancel', (event) => {
  event.preventDefault();
  stopBarcodeScanner();
});

titleInput?.addEventListener('focus', () => {
  populateTitleSuggestions();
});

titleInput?.addEventListener('input', () => {
  populateTitleSuggestions();
});

document.addEventListener('change', async (event) => {
  const statusSelect = event.target.closest('[data-play-status-select]');
  if (!statusSelect) {
    return;
  }

  const gameId = statusSelect.getAttribute('data-game-id');
  const games = getCurrentLibrary();
  const game = games.find((item) => item.id === gameId);
  if (!game) {
    return;
  }

  const nextGame = applyPlayStatusToGame(game, {
    status: statusSelect.value,
    completionPercent: Number(game.completionPercent || 0)
  });
  Object.assign(game, nextGame);
  await persistLibraryState(games);
});

document.addEventListener('click', async (event) => {
  const notificationAction = event.target.closest('[data-notification-action]');
  if (notificationAction) {
    const notificationId = notificationAction.getAttribute('data-notification-id');
    if (notificationId) {
      try {
        await apiRequest('/api/notifications', {
          method: 'PATCH',
          body: JSON.stringify({ id: notificationId, read: !notifications.find((entry) => entry.id === notificationId)?.read })
        });
        await loadNotifications();
      } catch {
        // ignore notification update errors
      }
    }
    return;
  }

  if (event.target.closest('#activityLoadMoreButton')) {
    await loadActivityHistory(false);
    return;
  }

  if (event.target.closest('#activityClearButton')) {
    await clearActivityHistory();
    return;
  }

  const wishlistAction = event.target.closest('[data-wishlist-action]');
  if (wishlistAction) {
    const action = wishlistAction.getAttribute('data-wishlist-action');
    const gameId = wishlistAction.getAttribute('data-wishlist-game-id');
    if (action === 'remove') {
      await removeGameFromWishlist(gameId);
      renderWishlistView();
      return;
    }

    if (action === 'alert') {
      const wishlistEntry = getWishlistItems().find((item) => item.gameId === gameId);
      if (!wishlistEntry) {
        return;
      }
      const targetPrice = Number(window.prompt('Set a target price for this wishlist item', String(wishlistEntry.price || 0)) || 0);
      if (!targetPrice || targetPrice <= 0) {
        return;
      }
      try {
        const response = await apiRequest('/api/wishlist/alerts', {
          method: 'POST',
          body: JSON.stringify({ gameId, targetPrice, currency: 'USD', enabled: true })
        });
        setSyncStatus(response?.ok ? 'Price alert saved.' : 'Price alert updated.', 'success');
      } catch (error) {
        setSyncStatus(error?.message || 'Unable to save price alert.', 'error');
      }
      return;
    }

    if (action === 'library') {
      const wishlistEntry = getWishlistItems().find((item) => item.gameId === gameId);
      if (wishlistEntry) {
        const nextGame = normalizeGame({
          id: wishlistEntry.gameId,
          title: wishlistEntry.title,
          platform: wishlistEntry.platform,
          condition: 'Good',
          purchasePrice: Number(wishlistEntry.price || 0),
          currentValue: Number(wishlistEntry.price || 0),
          metacriticScore: 0,
          coverImage: wishlistEntry.image || '',
          notes: '',
          comments: []
        });
        const games = getCurrentLibrary();
        const existing = games.some((game) => String(game.id || '').toLowerCase() === String(nextGame.id || '').toLowerCase());
        if (!existing) {
          games.push(nextGame);
          await persistLibraryState(games);
          await removeGameFromWishlist(gameId);
          renderWishlistView();
          setSyncStatus('Added to library and removed from wishlist.', 'success');
        }
      }
      return;
    }
  }

  const friendRemoveButton = event.target.closest('[data-friend-remove]');
  if (friendRemoveButton) {
    const friendId = friendRemoveButton.getAttribute('data-friend-remove');
    if (friendId) {
      try {
        await apiRequest(`/api/friends/${encodeURIComponent(friendId)}`, { method: 'DELETE' });
        await loadFriendState();
        setSyncStatus('Friend removed.', 'success');
      } catch (error) {
        setSyncStatus(error?.message || 'Unable to remove friend.', 'error');
      }
    }
    return;
  }

  const friendRequestButton = event.target.closest('[data-friend-request-action]');
  if (friendRequestButton) {
    const action = friendRequestButton.getAttribute('data-friend-request-action');
    const targetId = friendRequestButton.getAttribute('data-friend-request-id');
    if (targetId) {
      try {
        const endpoint = action === 'cancel'
          ? `/api/friends/requests/${encodeURIComponent(targetId)}/cancel`
          : `/api/friends/requests/${encodeURIComponent(targetId)}/${action}`;
        await apiRequest(endpoint, { method: 'POST' });
        await loadFriendState();
        setSyncStatus(action === 'accept' ? 'Friend request accepted.' : action === 'decline' ? 'Friend request declined.' : 'Friend request cancelled.', 'success');
      } catch (error) {
        setSyncStatus(error?.message || 'Unable to update friend request.', 'error');
      }
    }
    return;
  }

  const profileMatch = event.target.closest('[data-profile]');
  if (profileMatch) {
    const profileName = profileMatch.getAttribute('data-profile');
    updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
    await showProfilePreview(profileName);
    return;
  }

  const gameMatch = event.target.closest('[data-game-id]');
  if (gameMatch) {
    const resolvedEntry = resolveSearchSelection(gameMatch);
    updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
    if (resolvedEntry) {
      showCatalogGameDetail(resolvedEntry);
    } else {
      showGameView(gameMatch.getAttribute('data-game-id'));
    }
    return;
  }

  if (!titleSuggestions.contains(event.target) && event.target !== titleInput) {
    titleSuggestions.classList.add('hidden');
  }

  if (!gameSearchResults.contains(event.target) && event.target !== gameSearch) {
    updateProfileSearchState(false, { busy: false, label: 'Search results', hidden: true });
  }
});

statisticsNavButton?.addEventListener('click', showStatisticsView);
backToLibraryFromStatsButton?.addEventListener('click', showHomeView);

document.getElementById('wishlistNavButton')?.addEventListener('click', () => {
  const wishlistSection = document.getElementById('wishlistContainer');
  if (wishlistSection) {
    wishlistSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

menuToggle?.addEventListener('click', () => {
  const isOpen = document.body.classList.toggle('menu-open');
  if (menuToggle) {
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  }
});

document.addEventListener('click', (event) => {
  if (window.innerWidth > 850) {
    return;
  }

  const clickedInsideMenu = sideMenu?.contains(event.target);
  const clickedMenuToggle = menuToggle?.contains(event.target);
  if (!clickedInsideMenu && !clickedMenuToggle) {
    closeMobileMenu();
  }
});


let authMode = 'login';
let emailVerified = false;

function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const registering = authMode === 'register';
  authLoginMode?.classList.toggle('is-active', !registering);
  authRegisterMode?.classList.toggle('is-active', registering);
  authLoginMode?.setAttribute('aria-selected', String(!registering));
  authRegisterMode?.setAttribute('aria-selected', String(registering));
  if (authHeading) authHeading.textContent = registering ? 'Create your Project Sora account' : 'Log in to Project Sora';
  if (authSubmitButton) authSubmitButton.textContent = registering ? 'Create account' : 'Log in';
  if (authUsername) {
    authUsername.hidden = !registering;
    authUsername.required = registering;
  }
  if (authUsernameStatus) authUsernameStatus.hidden = !registering;
  if (authPasswordInput) authPasswordInput.autocomplete = registering ? 'new-password' : 'current-password';
  if (authStatus) authStatus.textContent = '';
}

function setEmailVerificationState(_verified = true, _message = '') {
  emailVerified = true;
  accountProfileCard?.classList.toggle('hidden', !currentUser);
  document.querySelectorAll('.profile-editor-panel input, .profile-editor-panel textarea, .profile-editor-panel button, .profile-editor-panel select').forEach((element) => {
    element.disabled = false;
  });
  if (compactViewProfileButton) compactViewProfileButton.disabled = false;
  if (viewOwnProfileButton) viewOwnProfileButton.disabled = false;
}

function updateCompactAccountCard() {
  if (!currentUser) return setEmailVerificationState(false);
  const profile = currentProfileSettings || {};
  const display = profile.displayName || currentUser.split('@')[0] || 'Project Sora User';
  if (accountDisplayName) accountDisplayName.textContent = display;
  if (accountHandle) accountHandle.textContent = `@${createPublicHandle(currentUser)}`;
  if (accountAvatar) accountAvatar.textContent = display.charAt(0).toUpperCase();
}

async function applyAuthenticatedSession(data, shouldRemember) {
  authToken = data.token;
  clearProfilePreview();
  currentUser = data.user;
  usernameInput.value = currentUser;
  if (shouldRemember) { setRememberPreference(true); persistSession(currentUser, authToken, true); }
  else { setRememberPreference(false); clearStoredAuth(); }
  setEmailVerificationState(true);
  updateCompactAccountCard();
  await Promise.all([loadLibraryFromServer(), loadWishlistFromServer(), loadQueueFromServer()]);
  await loadFriendState();
  await loadPrivacySettings();
  await loadProfileSettings();
  await loadNotifications();
  renderLibrary(); renderWishlistView(); renderQueueView(); updateProfileHub();
}


let usernameAvailabilityTimer = null;
authUsername?.addEventListener('input', () => {
  clearTimeout(usernameAvailabilityTimer);
  const candidate = String(authUsername.value || '').trim();
  if (authUsernameStatus) authUsernameStatus.textContent = '';
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(candidate)) {
    if (authUsernameStatus && candidate) authUsernameStatus.textContent = 'Use 3–20 letters, numbers, underscores, or periods.';
    return;
  }
  usernameAvailabilityTimer = setTimeout(async () => {
    try {
      const result = await apiRequest(`/api/usernames/availability?username=${encodeURIComponent(candidate)}`);
      if (authUsernameStatus) authUsernameStatus.textContent = result.available ? 'Username available.' : 'Username already taken.';
      authUsername?.setAttribute('aria-invalid', String(!result.available));
    } catch {
      if (authUsernameStatus) authUsernameStatus.textContent = 'Availability check is temporarily unavailable.';
    }
  }, 300);
});

authLoginMode?.addEventListener('click', () => setAuthMode('login'));
authRegisterMode?.addEventListener('click', () => setAuthMode('register'));

authSubmitButton?.addEventListener('click', async () => {
  try {
    const email = normalizeEmail(authEmailInput?.value || '');
    const password = String(authPasswordInput?.value || '').trim();
    const shouldRemember = Boolean(rememberMeCheckbox?.checked);
    if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
    if (!password) throw new Error('Please enter your password.');
    authSubmitButton.disabled = true;
    const username = String(authUsername?.value || '').trim();
    if (authMode === 'register' && !/^[A-Za-z0-9_.]{3,20}$/.test(username)) {
      throw new Error('Choose a username with 3–20 letters, numbers, underscores, or periods.');
    }
    const data = await apiRequest(authMode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify({ email, password, username }) });
    await applyAuthenticatedSession(data, shouldRemember);
    if (authStatus) authStatus.textContent = authMode === 'register' ? 'Account created and logged in.' : 'Logged in.';
  } catch (error) {
    const message = error?.message || 'Account access failed.';
    if (authStatus) authStatus.textContent = message;
    setSyncStatus(message, 'error');
  } finally { authSubmitButton.disabled = false; }
});


compactViewProfileButton?.addEventListener('click', () => viewOwnProfileButton?.click());
setAuthMode('login');

logoutButton.addEventListener('click', logout);
previewProfileButton?.addEventListener('click', previewMyPublicProfile);
savePrivacyButton?.addEventListener('click', savePrivacySettings);
saveProfileButton?.addEventListener('click', saveProfileSettings);
viewOwnProfileButton?.addEventListener('click', () => currentUser && showProfilePreview(currentUser));
backFromProfileButton?.addEventListener('click', showHomeView);
[rememberMeCheckbox, rememberMeLoginCheckbox].forEach((checkbox) => {
  checkbox?.addEventListener('change', () => {
    if (checkbox.checked) {
      setRememberPreference(true);
      if (currentUser && authToken) {
        persistSession(currentUser, authToken, true);
      }
    } else {
      setRememberPreference(false);
      clearStoredAuth();
    }
  });
});

async function initializeApp() {
  try {
    syncRememberCheckboxes();
    renderLibrarySkeleton();
    renderProfileSkeleton();
    showReleaseCalendarSkeleton();
    const rememberEnabled = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
    if (rememberMeCheckbox) {
      rememberMeCheckbox.checked = rememberEnabled;
    }
    if (rememberMeLoginCheckbox) {
      rememberMeLoginCheckbox.checked = rememberEnabled;
    }

    await restoreRememberedSession();
    await loadReleaseInterests();
    await loadReleaseReminders();

    if (currentUser) {
      usernameInput.value = currentUser;
    }

    attachSuggestionEvents();
    initializeDiscoveryControls();
    startBackgroundRotation();
    renderReleaseCalendar();
    await refreshReleaseCalendar().catch(() => {
      renderReleaseCalendar();
    });
    await refreshReleaseArticles();
    startReleaseCalendarRotation();
    initializeGlobalInteractionSafety();
    initializeReleaseCarouselControls();

    renderLibrary();
    renderWishlistView();
    renderQueueView();
    renderNotifications();
    if (currentUser && authToken) {
      await loadFriendState();
      await loadPrivacySettings();
      await loadNotifications();
      await loadActivityHistory(true);
    }
    setSyncStatus('Application ready.', 'success');
  } catch (error) {
    const message = error?.message || 'The application could not start correctly.';
    setSyncStatus(`Startup warning: ${message}`, 'error');
    console.error('Application startup failed:', error);
  }
}


window.addEventListener('hashchange', () => {
  const match = window.location.hash.match(/^#profile\/(.+)$/);
  if (match) {
    void showProfilePreview(decodeURIComponent(match[1]));
  }
});



// Game Finder: swipe-based catalog discovery
const gameFinderNavButton = document.getElementById('gameFinderNavButton');
const gameFinderPage = document.getElementById('gameFinderPage');
const closeGameFinderButton = document.getElementById('closeGameFinderButton');
const gameFinderCard = document.getElementById('gameFinderCard');
const gameFinderLoading = document.getElementById('gameFinderLoading');
const gameFinderEmpty = document.getElementById('gameFinderEmpty');
const gameFinderPassButton = document.getElementById('gameFinderPassButton');
const gameFinderLikeButton = document.getElementById('gameFinderLikeButton');
const gameFinderStrongButton = document.getElementById('gameFinderStrongButton');
const gameFinderUndoButton = document.getElementById('gameFinderUndoButton');
const gameFinderQuickActions = document.getElementById('gameFinderQuickActions');
const gameFinderHistoryList = document.getElementById('gameFinderHistoryList');
const gameFinderReviewLikesButton = document.getElementById('gameFinderReviewLikesButton');
const gameFinderReviewPassesButton = document.getElementById('gameFinderReviewPassesButton');
const gameFinderResetButton = document.getElementById('gameFinderResetButton');

let gameFinderCandidates = [];
let gameFinderCurrent = null;
let gameFinderLastLiked = null;
let gameFinderHistoryMode = 'likes';
let gameFinderPointerStart = null;
let gameFinderNextCursor = 0;
let gameFinderLoadingBatch = false;
let gameFinderRecommendationProfile = null;

function getGameFinderStorageKey() {
  return `project-sora-game-finder:${currentUser || 'guest'}`;
}

function loadGameFinderState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(getGameFinderStorageKey()) || '{}');
    return {
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.slice(-1000) : [],
      genreWeights: parsed.genreWeights && typeof parsed.genreWeights === 'object' ? parsed.genreWeights : {},
      platformWeights: parsed.platformWeights && typeof parsed.platformWeights === 'object' ? parsed.platformWeights : {},
      mutedGenres: Array.isArray(parsed.mutedGenres) ? parsed.mutedGenres : [],
      mutedPlatforms: Array.isArray(parsed.mutedPlatforms) ? parsed.mutedPlatforms : []
    };
  } catch {
    return { decisions: [], genreWeights: {}, platformWeights: {}, mutedGenres: [], mutedPlatforms: [] };
  }
}

function saveGameFinderState(state) {
  localStorage.setItem(getGameFinderStorageKey(), JSON.stringify(state));
}

function normalizeFinderText(value) {
  return String(value || '').trim().toLowerCase();
}

function getFinderGenres(game) {
  return String(game.genre || '')
    .split(/[,/|;]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function findCatalogForLibraryGame(game) {
  const title = normalizeFinderText(game.title || game.name);
  const platform = normalizeFinderText(game.platform);
  return GAME_CATALOG.find((entry) => normalizeFinderText(entry.name) === title && (!platform || normalizeFinderText(entry.platform) === platform))
    || GAME_CATALOG.find((entry) => normalizeFinderText(entry.name) === title);
}

function buildBaseFinderPreferences() {
  const genreWeights = {};
  const platformWeights = {};
  const addWeight = (target, key, amount) => {
    if (!key) return;
    target[key] = Math.max(-8, Math.min(12, Number(target[key] || 0) + amount));
  };

  getCurrentLibrary().map(normalizeGame).forEach((game) => {
    const catalogGame = findCatalogForLibraryGame(game) || game;
    const rating = Number(game.userRating || game.rating || game.metacriticScore || 0);
    const completed = game.status === 'Completed' || Number(game.completionPercent || 0) >= 100;
    const weight = rating >= 8 && rating <= 10 ? 3 : rating >= 80 ? 3 : completed ? 1.5 : 0.5;
    getFinderGenres(catalogGame).forEach((genre) => addWeight(genreWeights, normalizeFinderText(genre), weight));
    addWeight(platformWeights, normalizeFinderText(game.platform || catalogGame.platform), completed ? 1.5 : 0.75);
  });

  (currentProfileSettings.favoriteGameIds || []).forEach((id) => {
    const favorite = GAME_CATALOG.find((entry) => String(entry.id) === String(id));
    if (!favorite) return;
    getFinderGenres(favorite).forEach((genre) => addWeight(genreWeights, normalizeFinderText(genre), 4));
    addWeight(platformWeights, normalizeFinderText(favorite.platform), 2);
  });

  return { genreWeights, platformWeights };
}

function scoreGameFinderCandidate(game, preferences, state) {
  const genres = getFinderGenres(game);
  let score = 10;
  const reasons = [];
  const genreScore = genres.reduce((sum, genre) => sum + Number(preferences.genreWeights[normalizeFinderText(genre)] || 0) + Number(state.genreWeights[normalizeFinderText(genre)] || 0), 0);
  if (genreScore > 0) {
    score += genreScore * 4;
    reasons.push(`Matches your interest in ${genres.slice(0, 2).join(' and ')}`);
  }
  const platformScore = Number(preferences.platformWeights[normalizeFinderText(game.platform)] || 0) + Number(state.platformWeights[normalizeFinderText(game.platform)] || 0);
  if (platformScore > 0) {
    score += platformScore * 3;
    reasons.push(`Available on ${game.platform}, a platform you use`);
  }
  const meta = Number(game.metacriticScore || 0);
  if (meta >= 85) { score += 8; reasons.push(`Highly rated with a score of ${meta}`); }
  else if (meta >= 75) { score += 4; reasons.push(`Well reviewed with a score of ${meta}`); }
  const sales = Number(game.globalSales || 0);
  if (sales > 5) score += Math.min(5, sales / 4);
  if (!reasons.length) reasons.push('A diverse pick to help refine your recommendations');
  return { ...game, finderScore: score, finderReasons: reasons.slice(0, 3) };
}

function buildLocalGameFinderCandidates() {
  const state = loadGameFinderState();
  const decidedIds = new Set(state.decisions.map((item) => String(item.gameId)));
  const ownedTitles = new Set(getCurrentLibrary().map((game) => normalizeFinderText(game.title || game.name)));
  const preferences = buildBaseFinderPreferences();
  const uniqueTitles = new Set();
  const eligible = [];

  for (const game of GAME_CATALOG) {
    const id = String(game.id || `${game.name}-${game.platform}`);
    const titleKey = normalizeFinderText(game.name);
    if (!titleKey || decidedIds.has(id) || ownedTitles.has(titleKey) || uniqueTitles.has(titleKey)) continue;
    if (getFinderGenres(game).some((genre) => state.mutedGenres.includes(normalizeFinderText(genre)))) continue;
    if (state.mutedPlatforms.includes(normalizeFinderText(game.platform))) continue;
    if (!game.genre && !game.platform) continue;
    uniqueTitles.add(titleKey);
    eligible.push(scoreGameFinderCandidate(game, preferences, state));
  }

  eligible.sort((a, b) => b.finderScore - a.finderScore || String(a.name).localeCompare(String(b.name)));
  const top = eligible.slice(0, 180);
  // Mix strong matches with a little diversity, deterministically by current decision count.
  const offset = state.decisions.length % Math.max(top.length, 1);
  gameFinderCandidates = top.length ? [...top.slice(offset), ...top.slice(0, offset)] : [];
  gameFinderCurrent = gameFinderCandidates.shift() || null;
  renderGameFinderCard();
  if (gameFinderCandidates.length < 5 && gameFinderNextCursor !== null && gameFinderNextCursor !== undefined) {
    void loadGameFinderCandidates();
  }
}

async function syncGameFinderDecisionsFromServer() {
  if (!authToken) return;
  try {
    const response = await apiRequest('/api/game-finder');
    const remote = Array.isArray(response?.decisions) ? response.decisions : [];
    const state = loadGameFinderState();
    if (response?.preferences) {
      state.mutedGenres = Array.isArray(response.preferences.mutedGenres) ? response.preferences.mutedGenres : state.mutedGenres;
      state.mutedPlatforms = Array.isArray(response.preferences.mutedPlatforms) ? response.preferences.mutedPlatforms : state.mutedPlatforms;
    }
    if (!remote.length && !response?.preferences) return;
    const merged = new Map(state.decisions.map((entry) => [String(entry.gameId), entry]));
    remote.forEach((entry) => merged.set(String(entry.gameId), entry));
    state.decisions = [...merged.values()].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || ''))).slice(-1000);
    saveGameFinderState(state);
  } catch {
    // Local decisions remain available offline.
  }
}

async function loadGameFinderCandidates({ reset = false } = {}) {
  if (gameFinderLoadingBatch) return;
  gameFinderLoadingBatch = true;
  if (reset) {
    gameFinderNextCursor = 0;
    gameFinderCandidates = [];
    gameFinderCurrent = null;
    gameFinderLoading?.classList.remove('hidden');
    gameFinderEmpty?.classList.add('hidden');
    renderGameFinderCard();
  }
  try {
    if (!authToken) throw new Error('Authentication required');
    if (reset) await syncGameFinderDecisionsFromServer();
    const cursor = reset ? 0 : Number(gameFinderNextCursor || 0);
    const response = await apiRequest(`/api/discovery/recommendations?limit=24&cursor=${cursor}`);
    const items = Array.isArray(response?.items) ? response.items : [];
    const mapped = items.map((game) => ({
      ...game,
      finderScore: Number(game.matchPercent || game.recommendationScore || 50),
      finderMatchPercent: Number(game.matchPercent || 50),
      finderReasons: Array.isArray(game.recommendationReasons) ? game.recommendationReasons : []
    }));
    gameFinderRecommendationProfile = response?.profile || null;
    gameFinderNextCursor = response?.nextCursor;
    gameFinderCandidates.push(...mapped);
    if (!gameFinderCurrent) gameFinderCurrent = gameFinderCandidates.shift() || null;
    renderGameFinderCard();
  } catch (error) {
    if (reset) buildLocalGameFinderCandidates();
    setSyncStatus('Using on-device recommendations while the personalized discovery service is unavailable.', 'error');
  } finally {
    gameFinderLoadingBatch = false;
    gameFinderLoading?.classList.add('hidden');
  }
}

function buildGameFinderCandidates() {
  return loadGameFinderCandidates({ reset: true });
}

function renderGameFinderCard() {
  if (!gameFinderCard) return;
  gameFinderQuickActions?.classList.add('hidden');
  gameFinderEmpty?.classList.toggle('hidden', Boolean(gameFinderCurrent));
  gameFinderCard.classList.toggle('hidden', !gameFinderCurrent);
  if (!gameFinderCurrent) {
    gameFinderCard.innerHTML = '';
    return;
  }
  const game = gameFinderCurrent;
  const genres = getFinderGenres(game);
  const image = game.image || 'https://placehold.co/600x800/1e293b/ffffff?text=Project+Sora';
  gameFinderCard.className = 'game-finder-card';
  gameFinderCard.style.transform = '';
  gameFinderCard.innerHTML = `
    <span class="game-finder-stamp game-finder-stamp--pass">PASS</span>
    <span class="game-finder-stamp game-finder-stamp--like">LIKE</span>
    <span class="game-finder-stamp game-finder-stamp--strong">STRONG</span>
    <img class="game-finder-cover" src="${escapeHtml(image)}" alt="${escapeHtml(game.name)} cover" loading="eager" referrerpolicy="no-referrer" />
    <div class="game-finder-copy">
      <p class="eyebrow">${Math.round(game.finderMatchPercent || game.finderScore || 50)}% match</p>
      <h3>${escapeHtml(game.name)}</h3>
      <div class="release-meta"><span class="release-pill">${escapeHtml(game.platform || 'Platform unknown')}</span>${game.releaseYear ? `<span class="release-pill">${escapeHtml(game.releaseYear)}</span>` : ''}${genres.slice(0,2).map((genre) => `<span class="release-pill">${escapeHtml(genre)}</span>`).join('')}</div>
      <p>${escapeHtml(game.description || `${game.name} is a ${genres.join(', ') || 'game'} available for ${game.platform || 'multiple platforms'}.`)}</p>
      <ul class="game-finder-reasons">${game.finderReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
    </div>`;
}

function updateFinderPreference(state, game, action, direction = 1) {
  const amount = action === 'strong' ? 2.5 : action === 'like' ? 1.25 : -0.55;
  getFinderGenres(game).forEach((genre) => {
    const key = normalizeFinderText(genre);
    state.genreWeights[key] = Math.max(-8, Math.min(12, Number(state.genreWeights[key] || 0) + amount * direction));
  });
  const platform = normalizeFinderText(game.platform);
  if (platform) state.platformWeights[platform] = Math.max(-8, Math.min(12, Number(state.platformWeights[platform] || 0) + amount * .5 * direction));
}

function showGameFinderReaction(action) {
  const deck = gameFinderCard?.closest('.game-finder-deck');
  if (!deck) return;
  deck.querySelectorAll('.game-finder-reaction').forEach((node) => node.remove());

  const reaction = document.createElement('div');
  const isPass = action === 'pass';
  const isStrong = action === 'strong';
  reaction.className = `game-finder-reaction ${isPass ? 'game-finder-reaction--pass' : isStrong ? 'game-finder-reaction--strong' : 'game-finder-reaction--like'}`;
  reaction.setAttribute('role', 'status');
  reaction.setAttribute('aria-live', 'polite');
  reaction.setAttribute('aria-label', isPass ? 'Not interested' : isStrong ? 'Strong interest' : 'Interested');
  reaction.innerHTML = `<span class="game-finder-reaction-icon" aria-hidden="true">${isPass ? '💔' : isStrong ? '💖' : '♥'}</span><span class="game-finder-reaction-label">${isPass ? 'PASS' : isStrong ? 'STRONG MATCH' : 'LIKE'}</span>`;
  deck.append(reaction);

  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 350 : 760;
  window.setTimeout(() => reaction.remove(), duration);
}

async function decideGameFinder(action, animate = true) {
  if (!gameFinderCurrent) return;
  const game = gameFinderCurrent;
  const state = loadGameFinderState();
  const record = { gameId: String(game.id || `${game.name}-${game.platform}`), title: game.name, platform: game.platform || '', image: game.image || '', action, timestamp: new Date().toISOString(), score: game.finderScore };
  state.decisions.push(record);
  updateFinderPreference(state, game, action);
  saveGameFinderState(state);
  gameFinderLastLiked = action === 'like' || action === 'strong' ? game : null;

  if (authToken) {
    apiRequest('/api/game-finder/decision', { method: 'POST', body: JSON.stringify(record) }).catch(() => {});
  }

  if (animate) {
    showGameFinderReaction(action);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gameFinderCard.classList.add(action === 'pass' ? 'is-exit-left' : action === 'strong' ? 'is-exit-up' : 'is-exit-right');
      await new Promise((resolve) => window.setTimeout(resolve, 420));
    } else {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  }
  gameFinderCurrent = gameFinderCandidates.shift() || null;
  renderGameFinderCard();
  if (gameFinderCandidates.length < 5 && gameFinderNextCursor !== null && gameFinderNextCursor !== undefined) {
    void loadGameFinderCandidates();
  }
  if (gameFinderLastLiked) gameFinderQuickActions?.classList.remove('hidden');
}

function undoGameFinderDecision() {
  const state = loadGameFinderState();
  const previous = state.decisions.pop();
  if (!previous) return;
  const game = GAME_CATALOG.find((entry) => String(entry.id || `${entry.name}-${entry.platform}`) === String(previous.gameId));
  if (game) {
    updateFinderPreference(state, game, previous.action, -1);
    if (gameFinderCurrent) gameFinderCandidates.unshift(gameFinderCurrent);
    gameFinderCurrent = scoreGameFinderCandidate(game, buildBaseFinderPreferences(), state);
  }
  saveGameFinderState(state);
  renderGameFinderCard();
}

async function showGameFinder() {
  if (!currentUser || !authToken) {
    setSyncStatus('Log in to use Game Finder.', 'error');
    return;
  }
  mainContent?.querySelectorAll(':scope > section').forEach((section) => section.classList.add('hidden'));
  gameFinderPage?.classList.remove('hidden');
  gameFinderPage?.focus();
  window.location.hash = 'game-finder';
  renderGameFinderPreferences();
  await loadGameFinderCandidates({ reset: true });
}

function closeGameFinder() {
  gameFinderPage?.classList.add('hidden');
  mainContent?.querySelectorAll(':scope > section:not(#statisticsPage):not(#publicProfilePage):not(#gameFinderPage)').forEach((section) => section.classList.remove('hidden'));
  window.location.hash = '';
}


function renderGameFinderPreferences() {
  const state = loadGameFinderState();
  const list = document.getElementById('gameFinderMutedGenres');
  const options = document.getElementById('gameFinderGenreOptions');
  if (list) list.innerHTML = state.mutedGenres.length ? state.mutedGenres.map((genre) => `<span class="preference-chip">${escapeHtml(genre)}</span>`).join('') : '<span class="section-caption">No hidden genres.</span>';
  if (options && !options.children.length) {
    const genres = [...new Set(GAME_CATALOG.flatMap((game) => getFinderGenres(game)).filter(Boolean))].sort();
    options.innerHTML = genres.map((genre) => `<option value="${escapeHtml(genre)}"></option>`).join('');
  }
}

async function saveGameFinderPreferences() {
  const state = loadGameFinderState();
  saveGameFinderState(state);
  renderGameFinderPreferences();
  if (authToken) {
    await apiRequest('/api/game-finder/preferences', { method: 'PUT', body: JSON.stringify({ mutedGenres: state.mutedGenres, mutedPlatforms: state.mutedPlatforms }) }).catch(() => {});
  }
}

function renderGameFinderHistory(mode = gameFinderHistoryMode) {
  gameFinderHistoryMode = mode;
  if (!gameFinderHistoryList) return;
  const state = loadGameFinderState();
  const allowed = mode === 'passes' ? ['pass'] : ['like', 'strong'];
  const items = state.decisions.filter((item) => allowed.includes(item.action)).slice().reverse().slice(0, 30);
  gameFinderHistoryList.innerHTML = items.length ? items.map((item) => `<div class="game-finder-history-item"><img src="${escapeHtml(item.image || 'https://placehold.co/80x100/1e293b/ffffff?text=Game')}" alt="" /><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.platform)} · ${escapeHtml(item.action)}</p></div></div>`).join('') : '<p class="empty-state">No choices in this list yet.</p>';
}

async function handleFinderQuickAction(action) {
  const game = gameFinderLastLiked;
  if (!game) return;
  const entry = { gameId: game.id || `${game.name}-${game.platform}`, title: game.name, platform: game.platform, image: game.image, price: game.price || 0 };
  if (action === 'wishlist') await addGameToWishlist(entry);
  if (action === 'queue') await addGameToQueue({ ...entry, status: 'Queued' });
  if (action === 'library') {
    await saveGame({ title: game.name, platform: game.platform || '', condition: 'Good', purchasePrice: 0, currentValue: Number(game.price || 0), msrp: Number(game.msrp || game.price || 0), metacriticScore: Number(game.metacriticScore || 0), coverImage: game.image || '', comments: [], status: 'Backlog', completionPercent: 0, notes: 'Added from Game Finder' });
  }
  if (action === 'details') showCatalogDetail(game);
  gameFinderQuickActions?.classList.add('hidden');
}

function updateSwipeVisual(deltaX, deltaY) {
  if (!gameFinderCard || !gameFinderPointerStart) return;
  gameFinderCard.classList.add('is-swiping');
  gameFinderCard.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${deltaX / 24}deg)`;
  const pass = gameFinderCard.querySelector('.game-finder-stamp--pass');
  const like = gameFinderCard.querySelector('.game-finder-stamp--like');
  const strong = gameFinderCard.querySelector('.game-finder-stamp--strong');
  if (pass) pass.style.opacity = String(Math.min(1, Math.max(0, -deltaX / 110)));
  if (like) like.style.opacity = String(Math.min(1, Math.max(0, deltaX / 110)));
  if (strong) strong.style.opacity = String(Math.min(1, Math.max(0, -deltaY / 110)));
}

gameFinderNavButton?.addEventListener('click', () => void showGameFinder());
closeGameFinderButton?.addEventListener('click', closeGameFinder);
gameFinderPassButton?.addEventListener('click', () => void decideGameFinder('pass'));
gameFinderLikeButton?.addEventListener('click', () => void decideGameFinder('like'));
gameFinderStrongButton?.addEventListener('click', () => void decideGameFinder('strong'));
gameFinderUndoButton?.addEventListener('click', undoGameFinderDecision);
gameFinderReviewLikesButton?.addEventListener('click', () => renderGameFinderHistory('likes'));
gameFinderReviewPassesButton?.addEventListener('click', () => renderGameFinderHistory('passes'));
document.getElementById('gameFinderMuteGenreButton')?.addEventListener('click', async () => {
  const input = document.getElementById('gameFinderMuteGenreInput');
  const genre = normalizeFinderText(input?.value);
  if (!genre) return;
  const state = loadGameFinderState();
  if (!state.mutedGenres.includes(genre)) state.mutedGenres.push(genre);
  if (input) input.value = '';
  await saveGameFinderPreferences();
  await loadGameFinderCandidates({ reset: true });
});
document.getElementById('gameFinderLessLikeThisButton')?.addEventListener('click', async () => {
  if (!gameFinderCurrent) return;
  const state = loadGameFinderState();
  getFinderGenres(gameFinderCurrent).slice(0, 2).forEach((genre) => {
    const key = normalizeFinderText(genre);
    state.genreWeights[key] = Math.max(-8, Number(state.genreWeights[key] || 0) - 1.5);
  });
  await saveGameFinderPreferences();
  await decideGameFinder('pass');
});
document.getElementById('gameFinderClearMutedButton')?.addEventListener('click', async () => {
  const state = loadGameFinderState();
  state.mutedGenres = []; state.mutedPlatforms = [];
  await saveGameFinderPreferences();
  await loadGameFinderCandidates({ reset: true });
});

gameFinderResetButton?.addEventListener('click', () => {
  if (!window.confirm('Reset all Game Finder choices and learned preferences?')) return;
  localStorage.removeItem(getGameFinderStorageKey());
  if (authToken) apiRequest('/api/game-finder', { method: 'DELETE' }).catch(() => {});
  void loadGameFinderCandidates({ reset: true });
  renderGameFinderHistory();
});
gameFinderQuickActions?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-finder-quick]');
  if (button) void handleFinderQuickAction(button.dataset.finderQuick);
});
gameFinderCard?.addEventListener('click', (event) => {
  if (!gameFinderPointerStart && gameFinderCurrent && event.detail > 0) showCatalogDetail(gameFinderCurrent);
});
gameFinderCard?.addEventListener('pointerdown', (event) => {
  gameFinderPointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  gameFinderCard.setPointerCapture?.(event.pointerId);
});
gameFinderCard?.addEventListener('pointermove', (event) => {
  if (!gameFinderPointerStart || event.pointerId !== gameFinderPointerStart.id) return;
  updateSwipeVisual(event.clientX - gameFinderPointerStart.x, event.clientY - gameFinderPointerStart.y);
});
gameFinderCard?.addEventListener('pointerup', (event) => {
  if (!gameFinderPointerStart) return;
  const dx = event.clientX - gameFinderPointerStart.x;
  const dy = event.clientY - gameFinderPointerStart.y;
  gameFinderPointerStart = null;
  gameFinderCard.classList.remove('is-swiping');
  gameFinderCard.style.transform = '';
  if (dy < -90 && Math.abs(dy) > Math.abs(dx)) void decideGameFinder('strong');
  else if (dx > 100) void decideGameFinder('like');
  else if (dx < -100) void decideGameFinder('pass');
  else renderGameFinderCard();
});
window.addEventListener('keydown', (event) => {
  if (gameFinderPage?.classList.contains('hidden')) return;
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); void decideGameFinder('pass'); }
  if (event.key === 'ArrowRight') { event.preventDefault(); void decideGameFinder('like'); }
  if (event.key === 'ArrowUp') { event.preventDefault(); void decideGameFinder('strong'); }
  if (event.key === 'Backspace') { event.preventDefault(); undoGameFinderDecision(); }
  if (event.key === 'Enter' && gameFinderCurrent) { event.preventDefault(); showCatalogDetail(gameFinderCurrent); }
});
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#game-finder') void showGameFinder();
});


function betaToast(message) {
  let toast = document.getElementById('betaExperienceToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'betaExperienceToast';
    toast.className = 'toast-beta';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(betaToast.timer);
  betaToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
}


let discoveryHomeAbortController = null;
let discoveryHomeCache = null;
const DISCOVERY_PAGE_SIZE = 12;

function isLowBandwidthMode() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return Boolean(connection?.saveData || /(^|-)2g$/.test(String(connection?.effectiveType || '')));
}

function mapDiscoveryCard(item) {
  return {
    ...item,
    title: item.title || item.name || 'Untitled game',
    image: validateImageUrl(item.heroImage || item.headerImage || item.image || item.coverImage || '') || GAME_COVER_PLACEHOLDER
  };
}

async function loadPersonalizedHomeFeed({ force = false } = {}) {
  const grid = document.getElementById('forYouGrid');
  if (!grid) return;
  if (!authToken) { renderForYouExperience(); return; }
  if (discoveryHomeCache && !force) { renderPersonalizedHomeFeed(discoveryHomeCache); return; }
  discoveryHomeAbortController?.abort();
  discoveryHomeAbortController = new AbortController();
  grid.setAttribute('aria-busy','true');
  grid.innerHTML = '<div class="skeleton-card" aria-hidden="true"></div><div class="skeleton-card" aria-hidden="true"></div><div class="skeleton-card" aria-hidden="true"></div>';
  try {
    const data = await apiRequest('/api/discovery/home', { signal: discoveryHomeAbortController.signal });
    discoveryHomeCache = data;
    renderPersonalizedHomeFeed(data);
  } catch (error) {
    if (error?.name !== 'AbortError') renderForYouExperience();
  }
}

function renderPersonalizedHomeFeed(data) {
  const grid = document.getElementById('forYouGrid'); if (!grid) return;
  const picks = (Array.isArray(data?.recommendations) ? data.recommendations : []).slice(0, isLowBandwidthMode() ? 4 : 8).map(mapDiscoveryCard);
  grid.removeAttribute('aria-busy');
  if (!picks.length) { renderForYouExperience(); return; }
  grid.innerHTML = picks.map((item)=>`<button type="button" class="for-you-card" data-for-you-id="${escapeHtml(String(item.id||''))}" aria-label="Open ${escapeHtml(item.title)}"><span class="for-you-card__art" style="background-image:url('${escapeHtml(item.image)}')"></span><span class="for-you-card__content"><span class="match-pill">${Math.round(item.matchPercent||50)}% match</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml((item.recommendationReasons||[])[0]||'Recommended for your current taste profile.')}</p></span></button>`).join('');
}

async function loadDiscoveryHubs() {
  const genres=document.getElementById('genreHubList'), platforms=document.getElementById('platformHubList'); if(!genres||!platforms)return;
  try { const data=await apiRequest('/api/discovery/hubs');
    genres.innerHTML=(data.genres||[]).slice(0,12).map(x=>`<button type="button" class="hub-chip" data-hub-type="genre" data-hub-value="${escapeHtml(x.name)}">${escapeHtml(x.name)} <span>${x.count}</span></button>`).join('');
    platforms.innerHTML=(data.platforms||[]).slice(0,10).map(x=>`<button type="button" class="hub-chip" data-hub-type="platform" data-hub-value="${escapeHtml(x.name)}">${escapeHtml(x.name)} <span>${x.count}</span></button>`).join('');
  } catch { genres.innerHTML='<span class="section-caption">Hubs are temporarily unavailable.</span>'; }
}

async function openDiscoveryHub(type,value) {
  const results=document.getElementById('hubResults'); if(!results)return;
  results.setAttribute('aria-busy','true');
  results.innerHTML='<div class="skeleton-card" aria-hidden="true"></div>';
  try { const q=new URLSearchParams({limit:String(DISCOVERY_PAGE_SIZE),cursor:'0'}); q.set(type,value); const data=await apiRequest(`/api/discovery/hub?${q}`);
    const items=(data.items||[]).map(mapDiscoveryCard); results.removeAttribute('aria-busy'); results.innerHTML=items.length?`<div class="hub-result-grid">${items.map(i=>`<button type="button" class="hub-result-card" data-catalog-id="${escapeHtml(String(i.id||''))}"><img src="${escapeHtml(i.image)}" alt=""><strong>${escapeHtml(i.title)}</strong><span>${escapeHtml(i.platform||'')}</span></button>`).join('')}</div>`:'<div class="empty-state">No recommendations are available for this hub yet.</div>';
  } catch { results.removeAttribute('aria-busy'); results.innerHTML='<div class="empty-state">This hub could not load. Try again.</div>'; }
}

async function loadVisualCollections() {
  const grid=document.getElementById('visualCollectionsGrid'); if(!grid)return;
  try { const data=await apiRequest('/api/discovery/collections'); grid.innerHTML=(data.collections||[]).map(c=>{const arts=(c.items||[]).slice(0,4).map(mapDiscoveryCard);return `<article class="visual-collection-card"><div class="visual-collection-collage">${arts.map(a=>`<img src="${escapeHtml(a.image)}" alt="" loading="lazy">`).join('')}</div><div><h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.description||'')}</p><button type="button" class="ghost" data-collection-id="${escapeHtml(c.id)}">Explore ${escapeHtml(c.title)}</button></div></article>`}).join('');
  } catch { grid.innerHTML='<div class="empty-state">Collections are temporarily unavailable.</div>'; }
}

function normalizePersonalRating(game) {
  const value = Number(game?.userRating || game?.rating || game?.metacriticScore || 0);
  if (!Number.isFinite(value)) return 0;
  return value <= 10 ? value * 10 : value;
}

function deriveTasteProfile() {
  const library = getCurrentLibrary();
  const genreWeights = new Map();
  const platformWeights = new Map();
  library.forEach((game) => {
    const rating = normalizePersonalRating(game);
    const completion = Number(game.completionPercent || 0);
    const weight = 1 + (rating >= 80 ? 2 : rating >= 65 ? 1 : 0) + (completion >= 100 ? 1 : 0);
    String(game.genre || game.genres || '').split(/[,/|]/).map((part) => part.trim()).filter(Boolean).forEach((genre) => {
      genreWeights.set(genre, (genreWeights.get(genre) || 0) + weight);
    });
    const platform = String(game.platform || '').trim();
    if (platform) platformWeights.set(platform, (platformWeights.get(platform) || 0) + weight);
  });
  return {
    topGenres: [...genreWeights.entries()].sort((a,b) => b[1]-a[1]).map(([name]) => name),
    topPlatforms: [...platformWeights.entries()].sort((a,b) => b[1]-a[1]).map(([name]) => name)
  };
}

function getPersonalizedCandidates() {
  const library = getCurrentLibrary();
  const owned = new Set(library.map((game) => String(game.title || '').toLowerCase()));
  const taste = deriveTasteProfile();
  const source = [...releaseCalendarData, ...GAME_CATALOG].filter((item) => item && item.title && !owned.has(String(item.title).toLowerCase()));
  const seen = new Set();
  return source.map((item) => {
    const genre = String(item.genre || item.genres || 'Game');
    const platform = String(item.platform || item.platforms || '');
    let score = 52;
    const genreIndex = taste.topGenres.findIndex((entry) => genre.toLowerCase().includes(entry.toLowerCase()));
    const platformIndex = taste.topPlatforms.findIndex((entry) => platform.toLowerCase().includes(entry.toLowerCase()));
    if (genreIndex >= 0) score += Math.max(8, 24 - genreIndex * 4);
    if (platformIndex >= 0) score += Math.max(4, 14 - platformIndex * 3);
    score += Math.min(10, Math.round(Number(item.metacriticScore || item.score || 0) / 10));
    return { ...item, _match: Math.max(55, Math.min(98, score)) };
  }).filter((item) => {
    const key = String(item.title).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => b._match - a._match);
}


function validateImageUrl(value, fallback = '') {
  const candidate = String(value || '').trim();

  if (!candidate) {
    return fallback;
  }

  try {
    const url = new URL(candidate, window.location.origin);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return fallback;
    }

    const blockedHosts = new Set([
      'placehold.co',
      'via.placeholder.com',
      'dummyimage.com'
    ]);

    if (blockedHosts.has(url.hostname.toLowerCase())) {
      return fallback;
    }

    return url.href;
  } catch {
    return fallback;
  }
}

function renderForYouExperience(shuffle = false) {
  const grid = document.getElementById('forYouGrid');
  if (!grid) return;
  let candidates = getPersonalizedCandidates();
  if (shuffle) candidates = candidates.map((item) => ({ item, sort: Math.random() })).sort((a,b) => a.sort-b.sort).map(({item}) => item);
  const picks = candidates.slice(0, 4);
  if (!picks.length) {
    grid.innerHTML = '<div class="empty-state">Add and rate a few games to unlock personalized picks.</div>';
    return;
  }
  grid.innerHTML = picks.map((item) => {
    const image = validateImageUrl(item.heroImage || item.headerImage || item.image || item.coverImage || '') || GAME_COVER_PLACEHOLDER;
    const reason = deriveTasteProfile().topGenres[0] ? `Matches your interest in ${deriveTasteProfile().topGenres[0]}.` : 'Popular with players exploring new genres.';
    return `<button type="button" class="for-you-card" data-for-you-id="${escapeHtml(String(item.id || ''))}" aria-label="Open ${escapeHtml(item.title)}">
      <span class="for-you-card__art" style="background-image:url('${escapeHtml(image)}')"></span>
      <span class="for-you-card__content"><span class="match-pill">${item._match}% match</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(reason)}</p></span>
    </button>`;
  }).join('');
}

function renderCollectionGoalsExperience() {
  const container = document.getElementById('collectionGoals');
  if (!container) return;
  const library = getCurrentLibrary();
  const completed = library.filter((game) => Number(game.completionPercent || 0) >= 100 || game.status === 'completed').length;
  const reviewed = library.filter((game) => Array.isArray(game.reviews) && game.reviews.length).length;
  const wishlist = getWishlistItems().length;
  const goals = [
    ['Build a 25-game collection', library.length, 25],
    ['Complete 10 games', completed, 10],
    ['Review 5 games', reviewed, 5],
    ['Curate a 10-game wishlist', wishlist, 10]
  ];
  container.innerHTML = goals.map(([label,value,target]) => {
    const percent = Math.min(100, Math.round((value / target) * 100));
    return `<div class="goal-row"><div class="goal-row__label"><span>${escapeHtml(label)}</span><strong>${value}/${target}</strong></div><div class="goal-track" aria-label="${percent}% complete"><span style="width:${percent}%"></span></div></div>`;
  }).join('');
}

function renderReviewIntelligenceExperience() {
  const container = document.getElementById('reviewIntelligence');
  if (!container) return;
  const library = getCurrentLibrary();
  const rated = library.map((game) => ({ game, score: normalizePersonalRating(game) })).filter((entry) => entry.score > 0).sort((a,b) => b.score-a.score);
  if (!rated.length) {
    container.innerHTML = '<p>Rate a few games to reveal your strongest genres, hidden preferences, and review patterns.</p>';
    return;
  }
  const average = Math.round(rated.reduce((sum, entry) => sum + entry.score, 0) / rated.length);
  const taste = deriveTasteProfile();
  container.innerHTML = `<p><strong>${average}/100 average</strong> across ${rated.length} rated title${rated.length === 1 ? '' : 's'}.</p>
    <p>Your strongest signal is <strong>${escapeHtml(taste.topGenres[0] || 'variety')}</strong>${taste.topGenres[1] ? `, followed by ${escapeHtml(taste.topGenres[1])}` : ''}.</p>
    <div class="experience-result__game"><img src="${escapeHtml(validateImageUrl(rated[0].game.image || rated[0].game.coverImage || '') || GAME_COVER_PLACEHOLDER)}" alt=""><div><strong>${escapeHtml(rated[0].game.title || 'Top rated game')}</strong><br><small>Your highest-rated title at ${rated[0].score}/100.</small></div></div>`;
}

function renderGamingWrappedExperience() {
  const container = document.getElementById('gamingWrappedPreview');
  if (!container) return;
  const library = getCurrentLibrary();
  const completed = library.filter((game) => Number(game.completionPercent || 0) >= 100 || game.status === 'completed').length;
  const playtime = Math.round(library.reduce((sum, game) => sum + Number(game.playtimeHours || game.hoursPlayed || 0), 0));
  const taste = deriveTasteProfile();
  const stats = [[library.length,'games tracked'],[completed,'completed'],[playtime,'hours logged'],[taste.topGenres[0] || 'Explorer','top genre']];
  container.innerHTML = stats.map(([value,label]) => `<div class="wrapped-stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function renderCommunityPulseExperience() {
  const container = document.getElementById('communityPulse');
  if (!container) return;
  const items = activityItems.slice(0, 3);
  if (!items.length) {
    container.innerHTML = '<p>Your community pulse will appear here when you and your friends add games, finish titles, and post reviews.</p>';
    return;
  }
  container.innerHTML = items.map((entry) => `<div class="pulse-item"><span class="pulse-dot" aria-hidden="true"></span><div><strong>${escapeHtml(entry.actorDisplayName || entry.actor || entry.username || 'A player')}</strong><br><small>${escapeHtml(entry.summary || entry.message || entry.type || 'updated their collection')}</small></div></div>`).join('');
}

function pickBacklogGame(minutes) {
  const candidates = getCurrentLibrary().filter((game) => Number(game.completionPercent || 0) < 100 && game.status !== 'completed');
  if (!candidates.length) return null;
  return [...candidates].sort((a,b) => {
    const aScore = normalizePersonalRating(a) + (minutes <= 60 ? Number(a.completionPercent || 0) : 0);
    const bScore = normalizePersonalRating(b) + (minutes <= 60 ? Number(b.completionPercent || 0) : 0);
    return bScore-aScore;
  })[0];
}


let sprint4Insights = null;

function renderSprint4Insights(data = sprint4Insights) {
  sprint4Insights = data || null;
  const summary = document.getElementById('libraryInsightSummary');
  if (!summary) return;
  if (!data) {
    summary.innerHTML = '<div class="skeleton-card" aria-hidden="true"></div>';
    return;
  }
  const stats = data.stats || {};
  const cards = [
    [stats.total || 0, 'Games'],
    [stats.completed || 0, 'Completed'],
    [stats.backlog || 0, 'Backlog'],
    [stats.averageRating || 0, 'Average rating'],
    [stats.topGenre || 'Exploring', 'Top genre'],
    [stats.favoritePlatform || 'Mixed', 'Favorite platform']
  ];
  summary.innerHTML = cards.map(([value,label]) => `<div class="library-insight-stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`).join('');

  const franchises = document.getElementById('franchiseCollections');
  if (franchises) franchises.innerHTML = (data.franchises || []).slice(0,6).map((collection) => `<div class="library-mini-card"><strong>${escapeHtml(collection.name)}</strong><small>${collection.completed}/${collection.total} completed • ${collection.progress}%</small></div>`).join('') || '<p class="empty-state">Add multiple games from a franchise to build collections.</p>';

  const smart = document.getElementById('smartCollections');
  if (smart) smart.innerHTML = (data.smartCollections || []).slice(0,8).map((collection) => `<div class="library-mini-card"><strong>${escapeHtml(collection.name)}</strong><small>${collection.games?.length || 0} games</small></div>`).join('') || '<p class="empty-state">Smart collections appear as your library grows.</p>';

  renderSprint4BacklogPlan(data.backlogPlan || []);

  const milestones = document.getElementById('libraryMilestones');
  if (milestones) milestones.innerHTML = (data.milestones || []).map((item) => `<div class="goal-row"><div class="goal-row__label"><span>${escapeHtml(item.label)}</span><strong>${item.value}/${item.target}</strong></div><div class="goal-track" aria-label="${item.progress}% complete"><span style="width:${item.progress}%"></span></div></div>`).join('');

  const wrapped = document.getElementById('sprint4Wrapped');
  if (wrapped) {
    const value = data.wrapped || {};
    wrapped.innerHTML = [[value.totalHours || 0,'hours'],[value.gamesPlayed || 0,'games played'],[value.completed || 0,'completed'],[value.topGenre || 'Explorer','top genre']].map(([v,l]) => `<div class="wrapped-stat"><strong>${escapeHtml(String(v))}</strong><span>${escapeHtml(l)}</span></div>`).join('');
  }

  const adapters = document.getElementById('libraryImportAdapters');
  if (adapters) adapters.innerHTML = (data.importAdapters || []).map((adapter) => `<div class="library-mini-card ${adapter.status === 'skeleton' ? 'library-adapter--skeleton' : ''}"><strong>${escapeHtml(adapter.label)}</strong><small>${adapter.status === 'ready' ? 'Ready' : 'Integration skeleton in place'}</small></div>`).join('');
}

function renderSprint4BacklogPlan(items = []) {
  const target = document.getElementById('sprint4BacklogPlan');
  if (!target) return;
  target.innerHTML = items.length ? items.slice(0,3).map((entry) => `<div class="library-mini-card"><strong>${escapeHtml(entry.game?.title || 'Backlog pick')}</strong><small>${Math.round(entry.remainingMinutes || 0)} minutes remaining • Match ${Math.round(entry.score || 0)}</small></div>`).join('') : '<p class="empty-state">Add unfinished games and estimated playtime to build a plan.</p>';
}

async function loadSprint4Insights(minutes = 60) {
  const target = document.getElementById('libraryInsightSummary');
  if (!target) return;
  if (!authToken) {
    renderSprint4Insights({ stats: { total: getCurrentLibrary().length }, franchises: [], smartCollections: [], backlogPlan: [], milestones: [], wrapped: {}, importAdapters: [] });
    return;
  }
  renderSprint4Insights(null);
  try {
    const data = await apiRequest(`/api/library/insights?minutes=${encodeURIComponent(minutes)}`);
    renderSprint4Insights(data);
  } catch (error) {
    target.innerHTML = `<p class="empty-state">${escapeHtml(error?.message || 'Unable to load library insights.')}</p>`;
  }
}

function initializeSprint4Controls() {
  if (document.documentElement.dataset.sprint4Ready === 'true') return;
  document.documentElement.dataset.sprint4Ready = 'true';
  document.getElementById('refreshLibraryInsights')?.addEventListener('click', () => loadSprint4Insights());
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sprint4-minutes]');
    if (button) void loadSprint4Insights(Number(button.dataset.sprint4Minutes || 60));
  });
}

function renderAllBetaExperiences() {
  void loadPersonalizedHomeFeed();
  renderCollectionGoalsExperience();
  renderReviewIntelligenceExperience();
  renderGamingWrappedExperience();
  renderCommunityPulseExperience();
  void loadSprint4Insights();
}

function initializeBetaExperienceControls() {
  if (document.documentElement.dataset.betaExperienceReady === 'true') return;
  document.documentElement.dataset.betaExperienceReady = 'true';
  document.getElementById('refreshForYouButton')?.addEventListener('click', () => loadPersonalizedHomeFeed({ force: true }));
  document.addEventListener('click', (event) => {
    const recommendation = event.target.closest('[data-for-you-id]');
    if (recommendation) {
      const id = recommendation.dataset.forYouId;
      const item = [...releaseCalendarData, ...GAME_CATALOG].find((entry) => String(entry.id || '') === String(id));
      if (item) {
        const release = findReleaseById(id);
        if (release) window.location.hash = `#upcoming/${encodeURIComponent(id)}`;
        else showCatalogDetail(item);
      }
      return;
    }
    const session = event.target.closest('[data-session-minutes]');
    if (session) {
      const minutes = Number(session.dataset.sessionMinutes || 60);
      const game = pickBacklogGame(minutes);
      const result = document.getElementById('backlogPlannerResult');
      if (!result) return;
      result.innerHTML = game ? `<div class="experience-result__game"><img src="${escapeHtml(validateImageUrl(game.image || game.coverImage || '') || GAME_COVER_PLACEHOLDER)}" alt=""><div><strong>${escapeHtml(game.title || 'Backlog pick')}</strong><br><small>Recommended for your ${minutes >= 240 ? 'long' : `${minutes}-minute`} session.</small></div></div>` : '<p>Add an unfinished game to your library to create a session plan.</p>';
      return;
    }
    const quick = event.target.closest('[data-quick-list]');
    if (quick) {
      const mode = quick.dataset.quickList;
      const library = getCurrentLibrary();
      let picks = [];
      if (mode === 'favorites') picks = [...library].sort((a,b) => normalizePersonalRating(b)-normalizePersonalRating(a)).slice(0,5);
      else if (mode === 'weekend') picks = library.filter((game) => Number(game.completionPercent || 0) < 100).slice(0,5);
      else picks = [...library].filter((game) => normalizePersonalRating(game) >= 75).sort(() => Math.random()-.5).slice(0,5);
      document.getElementById('quickListResult').innerHTML = picks.length ? `<p><strong>${picks.map((game) => escapeHtml(game.title)).join(' • ')}</strong></p>` : '<p>Add and rate more games to generate this collection.</p>';
    }
  });
  document.getElementById('shareWrappedButton')?.addEventListener('click', async () => {
    const library = getCurrentLibrary();
    const completed = library.filter((game) => Number(game.completionPercent || 0) >= 100 || game.status === 'completed').length;
    const summary = `My Project Sora stats: ${library.length} games tracked, ${completed} completed, favorite genre: ${deriveTasteProfile().topGenres[0] || 'still exploring'}.`;
    try { await navigator.clipboard.writeText(summary); betaToast('Gaming Wrapped summary copied.'); }
    catch { betaToast(summary); }
  });
}

void initializeApp().then(() => {
  initializeBetaExperienceControls();
  initializeSprint4Controls();
  renderAllBetaExperiences();
  void loadPersonalizedHomeFeed();
  void loadDiscoveryHubs();
  void loadVisualCollections();
  const match = window.location.hash.match(/^#profile\/(.+)$/);
  if (match) {
    void showProfilePreview(decodeURIComponent(match[1]));
  }
});
