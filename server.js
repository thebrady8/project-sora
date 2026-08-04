const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./storage');
const { rankCatalogEntries } = require('./search-ranking.cjs');
const { buildRecommendations } = require('./discovery-engine.cjs');
const { normalizeLibraryEntry, buildLibraryStats, buildFranchiseCollections, buildSmartCollections, buildBacklogPlan, buildGamingWrapped, buildMilestones, searchLibrary, getImportAdapters } = require('./sprint4-library-engine.cjs');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY_SIZE = 1024 * 1024;
const DATA_DIR = storage.DATA_DIR;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LIBRARIES_FILE = path.join(DATA_DIR, 'libraries.json');
const WISHLISTS_FILE = path.join(DATA_DIR, 'wishlists.json');
const GAME_FINDER_FILE = path.join(DATA_DIR, 'game-finder.json');
const QUEUES_FILE = path.join(DATA_DIR, 'queues.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const RELEASE_CACHE_FILE = path.join(DATA_DIR, 'release-cache.json');
const RELEASE_INTERESTS_FILE = path.join(DATA_DIR, 'release-interests.json');
const RELEASE_REMINDERS_FILE = path.join(DATA_DIR, 'release-reminders.json');
const RELEASE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RELEASE_ARTICLE_CACHE_FILE = path.join(DATA_DIR, 'release-article-cache.json');
const RELEASE_ARTICLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RELEASE_ARTICLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RELEASE_PROVIDER_DISCLOSURE_VERSION = '2026-08-04';
const PRICE_ALERTS_FILE = path.join(DATA_DIR, 'price-alerts.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const CLIENT_ERRORS_FILE = path.join(DATA_DIR, 'client-errors.json');
const EXTERNAL_REQUEST_TIMEOUT_MS = Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS || 8000);
const EXTERNAL_REQUEST_RETRIES = Math.max(0, Math.min(3, Number(process.env.EXTERNAL_REQUEST_RETRIES || 1)));
const ALLOWED_CORS_ORIGINS = String(process.env.ALLOWED_CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);


function sanitizeReleaseReminderPreferences(value = {}) {
  const allowedOffsets = new Set([0, 1, 3, 7, 14, 30]);
  const offsets = Array.isArray(value.offsets) ? value.offsets.map(Number).filter((entry) => allowedOffsets.has(entry)) : [7, 1, 0];
  return {
    enabled: value.enabled !== false,
    offsets: [...new Set(offsets)].sort((a, b) => b - a),
    wishlistReleaseDay: value.wishlistReleaseDay !== false,
    browserNotifications: Boolean(value.browserNotifications)
  };
}

function sanitizeReleaseReminderStore(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([username, record]) => {
    const reminders = {};
    for (const [id, entry] of Object.entries(record?.reminders || {}).slice(0, 1000)) {
      const safeId = String(id || '').trim().slice(0, 160);
      if (!safeId) continue;
      reminders[safeId] = {
        id: safeId,
        title: String(entry?.title || '').trim().slice(0, 240),
        releaseDate: String(entry?.releaseDate || '').slice(0, 40),
        offsetDays: [0,1,3,7,14,30].includes(Number(entry?.offsetDays)) ? Number(entry.offsetDays) : 1,
        enabled: entry?.enabled !== false,
        createdAt: String(entry?.createdAt || new Date().toISOString()).slice(0, 40)
      };
    }
    return [String(username), { preferences: sanitizeReleaseReminderPreferences(record?.preferences), reminders }];
  }));
}

const integrationHealth = new Map();
const INTEGRATION_CATALOG = Object.freeze({
  steamStore: {
    id: 'steam-store',
    label: 'Steam Store',
    sourceType: 'public-structured-endpoint',
    officialApi: false,
    enabled: true,
    purpose: 'Upcoming PC releases with hard launch dates',
    freshnessMs: RELEASE_CACHE_TTL_MS,
    notes: "Uses public Steam Store JSON endpoints. It is not part of Valve's guaranteed Steam Web API contract."
  },
  releaseArticles: {
    id: 'release-articles',
    label: 'Gaming press coverage',
    sourceType: 'public-rss-aggregation',
    officialApi: false,
    enabled: true,
    purpose: 'Recent attributed article links',
    freshnessMs: RELEASE_ARTICLE_CACHE_TTL_MS,
    notes: 'Uses Google News RSS and links to the original publisher. Article text is not copied.'
  },
  localCatalog: {
    id: 'local-catalog',
    label: 'Project Sora local catalog',
    sourceType: 'local-imported-dataset',
    officialApi: false,
    enabled: true,
    purpose: 'Search, library autocomplete, and local game metadata',
    freshnessMs: null,
    notes: 'Static imported data; values are not automatically current.'
  },
  openBarcodes: {
    id: 'open-barcodes',
    label: 'Open barcode records',
    sourceType: 'open-structured-data',
    officialApi: false,
    enabled: true,
    purpose: 'Verified UPC/EAN lookup when provenance exists',
    freshnessMs: null,
    notes: 'Coverage is partial. Unmatched games remain blank.'
  },
  xbox: {
    id: 'xbox',
    label: 'Xbox',
    sourceType: 'partner-api-placeholder',
    officialApi: true,
    enabled: false,
    purpose: 'Future official catalog and account integration',
    freshnessMs: null,
    notes: 'Skeleton only; requires approved Microsoft/Xbox access.'
  },
  playstation: {
    id: 'playstation',
    label: 'PlayStation',
    sourceType: 'partner-api-placeholder',
    officialApi: true,
    enabled: false,
    purpose: 'Future official catalog and account integration',
    freshnessMs: null,
    notes: 'Skeleton only; requires approved PlayStation partner access.'
  },
  nintendo: {
    id: 'nintendo',
    label: 'Nintendo',
    sourceType: 'partner-api-placeholder',
    officialApi: true,
    enabled: false,
    purpose: 'Future official catalog and account integration',
    freshnessMs: null,
    notes: 'HTML scraping is disabled. Skeleton only until approved structured access is available.'
  }
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_BYPASS = process.env.GAMEVAULT_DISABLE_RATE_LIMIT === '1';
const authRateLimits = new Map();
const REQUEST_ID_HEADER = 'x-request-id';
const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_FIELDS = new Set(['password', 'token', 'auth', 'authorization', 'privateNote', 'notes', 'email', 'secret']);

function redactSensitiveString(value) {
  let output = String(value || '');
  output = output.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]');
  output = output.replace(/(password|token|secret|authorization)/gi, '[REDACTED]');
  return output;
}

function redactForLogging(value, seen = new WeakMap()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactSensitiveString(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const result = value.map((item) => redactForLogging(item, seen));
    seen.set(value, result);
    return result;
  }

  const result = {};
  seen.set(value, result);
  Object.entries(value).forEach(([key, entryValue]) => {
    if (SENSITIVE_FIELDS.has(key) || /password|token|secret|authorization|email|note/i.test(key)) {
      result[key] = REDACTED_VALUE;
      return;
    }

    result[key] = redactForLogging(entryValue, seen);
  });
  return result;
}

function getRequestId(req) {
  const existing = req.headers[REQUEST_ID_HEADER] || req.headers['x-request-id'];
  if (existing && typeof existing === 'string' && existing.trim()) {
    return existing.trim();
  }

  return crypto.randomBytes(8).toString('hex');
}

function logRequest(req, res, statusCode, durationMs, requestId) {
  const method = String(req.method || 'GET').toUpperCase();
  const route = String(req.url || '/').split('?')[0] || '/';
  const payload = {
    requestId,
    method,
    route,
    statusCode,
    durationMs,
    remoteAddress: String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
  };

  console.info('[server] ', JSON.stringify(redactForLogging(payload)));
}

function handleServerError(req, res, error, requestId) {
  const publicMessage = 'Internal Server Error';
  const details = error && error.message ? error.message : String(error || 'Unknown error');
  const sanitizedDetails = redactForLogging(details);
  console.error('[server-error]', JSON.stringify({ requestId, error: sanitizedDetails }));
  if (!res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER, requestId);
    sendJson(res, 500, { error: publicMessage });
  }
}

function createShutdownController(server, options = {}) {
  const logger = options.logger || console;
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`[server] received ${signal}; shutting down gracefully`);

    const closeServer = () => {
      server.close((error) => {
        if (error) {
          logger.error('[server] shutdown error', error);
          if (options.exit) {
            options.exit(1);
          }
          return;
        }
        logger.info('[server] shutdown complete');
        if (options.exit) {
          options.exit(0);
        }
      });
    };

    if (typeof server.listening === 'boolean' && server.listening) {
      closeServer();
      return;
    }

    if (options.exit) {
      options.exit(0);
    }
  };

  return shutdown;
}

const PLAY_STATUS_OPTIONS = ['Backlog', 'Playing', 'Paused', 'Completed', 'Dropped'];
const PRIVACY_VISIBILITY_OPTIONS = ['Public', 'Friends Only', 'Private'];
const PRIVACY_SETTING_KEYS = ['profileVisibility', 'libraryVisibility', 'reviewsVisibility', 'activityVisibility'];

function normalizePlayStatus(value, completionPercent = 0) {
  const candidate = String(value || '').trim();
  if (PLAY_STATUS_OPTIONS.includes(candidate)) {
    return candidate;
  }

  return Number(completionPercent || 0) >= 100 ? 'Completed' : 'Backlog';
}

const defaultCatalog = [
  {
    id: 'game-zelda-breath',
    name: 'The Legend of Zelda: Breath of the Wild',
    platform: 'Nintendo Switch',
    price: 49.99,
    metacriticScore: 97,
    image: 'https://upload.wikimedia.org/wikipedia/en/c/c6/The_Legend_of_Zelda_Breath_of_the_Wild.jpg',
    description: 'A beloved open-world adventure with strong collector demand.'
  },
  {
    id: 'game-cyberpunk-2077',
    name: 'Cyberpunk 2077',
    platform: 'PC / PlayStation / Xbox',
    price: 39.99,
    metacriticScore: 86,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1091500/header.jpg',
    description: 'A futuristic RPG with broad platform support and shifting value.'
  },
  {
    id: 'game-spiderman-2',
    name: 'Spider-Man 2',
    platform: 'PlayStation 5',
    price: 69.99,
    metacriticScore: 90,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1544020/header.jpg',
    description: 'High-demand PS5 action title with strong resale interest.'
  },
  {
    id: 'game-ff7-rebirth',
    name: 'Final Fantasy VII Rebirth',
    platform: 'PlayStation 5',
    price: 59.99,
    metacriticScore: 93,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/2507950/header.jpg',
    description: 'A premium RPG title that remains popular with collectors.'
  },
  {
    id: 'game-mario-kart-8',
    name: 'Mario Kart 8 Deluxe',
    platform: 'Nintendo Switch',
    price: 44.99,
    metacriticScore: 92,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1363080/header.jpg',
    description: 'A long-running Switch favorite with steady value.'
  },
  {
    id: 'game-elden-ring',
    name: 'Elden Ring',
    platform: 'PC / PlayStation / Xbox',
    price: 54.99,
    metacriticScore: 95,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1245620/header.jpg',
    description: 'A major fantasy release with strong critical and collector appeal.'
  },
  {
    id: 'game-hogwarts-legacy',
    name: 'Hogwarts Legacy',
    platform: 'PC / PlayStation / Xbox',
    price: 59.99,
    metacriticScore: 84,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/990080/header.jpg',
    description: 'A richly detailed action RPG in the Wizarding World.'
  },
  {
    id: 'game-stardew-valley',
    name: 'Stardew Valley',
    platform: 'PC / PlayStation / Xbox / Switch',
    price: 14.99,
    metacriticScore: 89,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/413150/header.jpg',
    description: 'A cherished farming sim with long-term player retention and collector value.'
  },
  {
    id: 'game-red-dead-redemption-2',
    name: 'Red Dead Redemption 2',
    platform: 'PC / PlayStation / Xbox',
    price: 29.99,
    metacriticScore: 97,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1174180/header.jpg',
    description: 'A cinematic western with enduring demand and strong premium status.'
  },
  {
    id: 'game-baldurs-gate-3',
    name: 'Baldur\'s Gate 3',
    platform: 'PC / PlayStation / Xbox',
    price: 59.99,
    metacriticScore: 96,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1086940/header.jpg',
    description: 'A modern CRPG landmark with strong reception across platforms.'
  },
  {
    id: 'game-silent-hill-2',
    name: 'Silent Hill 2',
    platform: 'PC / PlayStation / Xbox',
    price: 49.99,
    metacriticScore: 87,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/2124490/header.jpg',
    description: 'A psychological horror classic returning with renewed interest.'
  },
  {
    id: 'game-starfield',
    name: 'Starfield',
    platform: 'PC / Xbox',
    price: 69.99,
    metacriticScore: 83,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1716740/header.jpg',
    description: 'A bold sci-fi RPG with broad fan appeal and collector demand.'
  },
  {
    id: 'game-tekken-8',
    name: 'Tekken 8',
    platform: 'PC / PlayStation / Xbox',
    price: 69.99,
    metacriticScore: 91,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/1778820/header.jpg',
    description: 'A high-energy fighting game with a highly visible competitive audience.'
  },
  {
    id: 'game-helldivers-2',
    name: 'Helldivers 2',
    platform: 'PC / PlayStation',
    price: 39.99,
    metacriticScore: 83,
    image: 'https://steamcdn-a.akamaihd.net/steam/apps/553850/header.jpg',
    description: 'A co-op shooter with strong replayability and player communities.'
  },
  {
    id: 'game-zelda-tears',
    name: 'The Legend of Zelda: Tears of the Kingdom',
    platform: 'Nintendo Switch',
    price: 69.99,
    metacriticScore: 96,
    image: 'https://upload.wikimedia.org/wikipedia/en/8/8f/The_Legend_of_Zelda_Tears_of_the_Kingdom.jpg',
    description: 'A premium Switch adventure title with huge collector and fan interest.'
  }
];

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CATALOG_FILE)) {
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(defaultCatalog, null, 2));
  }
  if (!fs.existsSync(USERS_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(LIBRARIES_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(LIBRARIES_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(RELEASE_INTERESTS_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(RELEASE_INTERESTS_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(WISHLISTS_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(WISHLISTS_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(QUEUES_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(QUEUES_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(ACTIVITIES_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(FRIENDS_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(FRIENDS_FILE, JSON.stringify({ requests: [], friendships: [] }, null, 2));
  }
  if (!fs.existsSync(PRICE_HISTORY_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(PRICE_HISTORY_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(PRICE_ALERTS_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(PRICE_ALERTS_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(NOTIFICATIONS_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify({}, null, 2));
  }
  if (!fs.existsSync(PROFILES_FILE) && storage.getPersistenceMode() === 'JSON') {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify({}, null, 2));
  }
}

function readJson(filePath, fallback) {
  return storage.readJson(filePath, fallback);
}

function writeJson(filePath, value) {
  return storage.writeJson(filePath, value);
}


function isEmailVerified() {
  // Email verification is temporarily disabled. All authenticated accounts are unlocked.
  return true;
}

function ensureEmailVerified() {
  return true;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function createToken(username) {
  return crypto.randomBytes(24).toString('hex');
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (!session || !session.expiresAt || session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function createSession(email) {
  pruneExpiredSessions();
  const token = createToken(email);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const createdAt = Date.now();
  sessions.set(token, {
    user: email,
    createdAt,
    expiresAt
  });
  storage.createSession(email, token, expiresAt);
  return token;
}

function getSessionData(token) {
  pruneExpiredSessions();
  const mappedSession = sessions.get(token);
  if (mappedSession) {
    if (!mappedSession.expiresAt || mappedSession.expiresAt <= Date.now()) {
      sessions.delete(token);
      storage.deleteSession(token);
      return null;
    }
    return mappedSession;
  }

  const persistedSession = storage.getSessionData(token);
  if (!persistedSession) {
    sessions.delete(token);
    return null;
  }

  if (!persistedSession.expiresAt || persistedSession.expiresAt <= Date.now()) {
    sessions.delete(token);
    storage.deleteSession(token);
    return null;
  }

  sessions.set(token, persistedSession);
  return persistedSession;
}

function applySecurityHeaders(res, contentType) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https: data:; connect-src 'self' https:;");
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
}

function normalizeOrigin(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
}

function getAllowedCorsOrigin(req) {
  const origin = normalizeOrigin(req?.headers?.origin);
  if (!origin) return '';

  const host = String(req?.headers?.host || '').trim();
  const sameOriginCandidates = host
    ? [`https://${host}`, `http://${host}`].map(normalizeOrigin)
    : [];

  if (sameOriginCandidates.includes(origin)) return origin;
  if (ALLOWED_CORS_ORIGINS.map(normalizeOrigin).includes(origin)) return origin;
  return '';
}

function applyCorsHeaders(req, headers = {}) {
  const origin = getAllowedCorsOrigin(req);
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = headers.Vary ? `${headers.Vary}, Origin` : 'Origin';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  return headers;
}

function sendJson(res, statusCode, payload, requestId) {
  applySecurityHeaders(res, 'application/json; charset=utf-8');
  const headers = applyCorsHeaders(res.__req, {});
  const resolvedRequestId = requestId || res.__requestId || res.getHeader?.(REQUEST_ID_HEADER);
  if (resolvedRequestId) {
    headers[REQUEST_ID_HEADER] = resolvedRequestId;
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));

  if (res.__req && resolvedRequestId && res.__startedAt !== undefined) {
    logRequest(res.__req, res, statusCode, Date.now() - res.__startedAt, resolvedRequestId);
  }
}

function updateIntegrationHealth(key, update = {}) {
  integrationHealth.set(key, {
    ...(integrationHealth.get(key) || {}),
    ...update,
    checkedAt: new Date().toISOString()
  });
}

function serializeIntegrationStatus(key, definition) {
  const health = integrationHealth.get(key) || {};
  return {
    ...definition,
    status: definition.enabled ? (health.status || 'unknown') : 'not-configured',
    lastSuccessAt: health.lastSuccessAt || null,
    lastFailureAt: health.lastFailureAt || null,
    lastError: health.lastError || null,
    checkedAt: health.checkedAt || null
  };
}

function requestExternal(url, { expectJson = false, timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS, retries = EXTERNAL_REQUEST_RETRIES } = {}) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const run = () => {
      attempt += 1;
      const req = https.get(url, {
        headers: {
          'User-Agent': 'ProjectSora/0.1 (+https://project-sora-mnoo.onrender.com/)'
        }
      }, (res) => {
        const statusCode = res.statusCode || 500;
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          requestExternal(new URL(res.headers.location, url).toString(), { expectJson, timeoutMs, retries: Math.max(0, retries - attempt + 1) })
            .then(resolve, reject);
          return;
        }
        if (statusCode >= 400) {
          res.resume();
          const error = new Error(`External request failed with status ${statusCode}`);
          if (attempt <= retries) return setTimeout(run, 150 * attempt);
          reject(error);
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 5 * 1024 * 1024) {
            req.destroy(new Error('External response exceeded 5 MB'));
          }
        });
        res.on('end', () => {
          if (!expectJson) return resolve(data);
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            if (attempt <= retries) return setTimeout(run, 150 * attempt);
            reject(error);
          }
        });
      });

      req.setTimeout(timeoutMs, () => req.destroy(new Error(`External request timed out after ${timeoutMs}ms`)));
      req.on('error', (error) => {
        if (attempt <= retries) return setTimeout(run, 150 * attempt);
        reject(error);
      });
    };

    run();
  });
}

function fetchSteamJson(url) {
  return requestExternal(url, { expectJson: true });
}

function fetchText(url) {
  return requestExternal(url, { expectJson: false });
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXmlText(value) {
  return stripHtml(String(value || '')
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, ''));
}

function getXmlTagValue(block, tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = block.match(pattern);
  return match ? decodeXmlText(match[1]) : '';
}

function parseRssItems(xml, platform) {
  const itemBlocks = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
  return itemBlocks.map((matches) => {
    const block = matches[1] || '';
    const title = getXmlTagValue(block, 'title');
    const link = getXmlTagValue(block, 'link');
    const release = getXmlTagValue(block, 'pubDate') || getXmlTagValue(block, 'dc:date') || 'Upcoming';
    const description = getXmlTagValue(block, 'description') || getXmlTagValue(block, 'content:encoded') || title;
    const image = (block.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || [])[1]
      || (block.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1]
      || '';

    return {
      id: `${platform.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      title,
      link,
      source: platform,
      release,
      genre: 'Game',
      platform,
      image,
      blurb: stripHtml(description)
    };
  }).filter((item) => item.title);
}

async function fetchNintendoReleaseFeed() {
  updateIntegrationHealth('nintendo', {
    status: 'not-configured',
    lastError: 'HTML scraping is disabled; waiting for approved structured provider access.'
  });
  return [];
}

async function fetchRssReleaseFeed(rssUrl, platform) {
  try {
    const xml = await fetchText(rssUrl);
    return parseRssItems(xml, platform).slice(0, 3);
  } catch {
    return [];
  }
}

function parseSteamReleaseTimestamp(releaseDate) {
  const text = String(releaseDate?.date || '').trim();
  if (!text || /coming soon|tba|to be announced|q[1-4]|spring|summer|fall|autumn|winter/i.test(text)) {
    return null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.getTime();
}

function isHardLaunchDate(timestamp) {
  const time = Number(timestamp);
  const now = Date.now();
  const twelveMonths = now + (365 * 24 * 60 * 60 * 1000);
  return Number.isFinite(time) && time >= now - (24 * 60 * 60 * 1000) && time <= twelveMonths;
}

function fetchSteamAppDetails(appId) {
  return fetchSteamJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic,release_date,genres,platforms,short_description`)
    .then((payload) => {
      const details = payload?.[String(appId)]?.data;
      if (!details) {
        return null;
      }

      return {
        id: `steam-${appId}`,
        appId,
        source: 'Steam',
        link: `https://store.steampowered.com/app/${appId}/`,
        title: details.name || 'Unknown title',
        image: details.header_image || '',
        release: details.release_date?.date || 'Coming soon',
        releaseTimestamp: parseSteamReleaseTimestamp(details.release_date),
        genre: details.genres?.[0]?.description || 'Game',
        platform: details.platforms ? Object.entries(details.platforms)
          .filter(([, supported]) => supported)
          .map(([name]) => name)
          .join(' / ') : 'PC / Console',
        blurb: details.short_description || details.name || ''
      };
    });
}

async function fetchSteamUpcomingAppIds() {
  try {
    const url = 'https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=_ASC&filter=comingsoon&category1=998&infinite=1&cc=US&l=english';
    const payload = await fetchSteamJson(url);
    const html = String(payload?.results_html || '');
    const ids = [];
    for (const match of html.matchAll(/data-ds-appid=\"(\d+)\"/g)) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    }
    for (const match of html.matchAll(/\/app\/(\d+)\//g)) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    }
    return ids.slice(0, 36);
  } catch {
    return [];
  }
}

async function fetchSteamReleaseFeed() {
  try {
    const searchIds = await fetchSteamUpcomingAppIds();
    const featuredCategories = await fetchSteamJson('https://store.steampowered.com/api/featuredcategories/?l=en&cc=US').catch(() => ({}));
    const comingSoon = Array.isArray(featuredCategories?.coming_soon?.items) ? featuredCategories.coming_soon.items : [];
    const featuredIds = comingSoon.map((item) => String(item.id || '')).filter(Boolean);
    const appIds = [...new Set([...searchIds, ...featuredIds])].slice(0, 36);

    const details = await Promise.all(appIds.map((appId) => fetchSteamAppDetails(appId).catch(() => null)));
    const normalized = details
      .filter((item) => item && isHardLaunchDate(item.releaseTimestamp))
      .sort((a, b) => a.releaseTimestamp - b.releaseTimestamp)
      .map((item) => ({
        ...item,
        hardDate: true,
        release: new Date(item.releaseTimestamp).toISOString().slice(0, 10),
        genre: item.genre || 'Game',
        platform: item.platform || 'PC'
      }))
      .slice(0, 30);
    updateIntegrationHealth('steamStore', {
      status: 'healthy',
      lastSuccessAt: new Date().toISOString(),
      lastError: null
    });
    return normalized;
  } catch (error) {
    updateIntegrationHealth('steamStore', {
      status: 'degraded',
      lastFailureAt: new Date().toISOString(),
      lastError: String(error?.message || error || 'Steam Store request failed')
    });
    return [];
  }
}

async function fetchLiveReleaseFeed() {
  const steamData = await fetchSteamReleaseFeed();
  return steamData
    .filter((item) => item && item.hardDate && isHardLaunchDate(item.releaseTimestamp))
    .sort((a, b) => a.releaseTimestamp - b.releaseTimestamp)
    .slice(0, 30);
}

function parseGoogleNewsItems(xml) {
  const blocks = [...String(xml || '').matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
  return blocks.map((matches) => {
    const block = matches[1] || '';
    const rawTitle = getXmlTagValue(block, 'title');
    const link = getXmlTagValue(block, 'link');
    const pubDate = getXmlTagValue(block, 'pubDate');
    const source = getXmlTagValue(block, 'source') || (rawTitle.includes(' - ') ? rawTitle.split(' - ').pop() : 'Gaming press');
    const title = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
    const publishedAt = new Date(pubDate).getTime();
    return {
      id: `article-${crypto.createHash('sha1').update(link || rawTitle).digest('hex').slice(0, 12)}`,
      title,
      link,
      source,
      publishedAt: Number.isFinite(publishedAt) ? new Date(publishedAt).toISOString() : '',
      summary: getXmlTagValue(block, 'description') || title
    };
  }).filter((item) => item.title && item.link && item.publishedAt);
}

function significantTitleTokens(title) {
  return String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !['game','games','edition','official','release'].includes(token));
}

async function fetchWeeklyReleaseArticles(releases) {
  const query = encodeURIComponent('(site:ign.com OR site:gamespot.com OR site:eurogamer.net OR site:polygon.com OR site:pcgamer.com) video game release review when:7d');
  try {
    const xml = await fetchText(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`);
    const cutoff = Date.now() - RELEASE_ARTICLE_WINDOW_MS;
    const releaseTokens = releases.flatMap((release) => significantTitleTokens(release.title));
    const seen = new Set();
    const items = parseGoogleNewsItems(xml)
      .filter((article) => Date.parse(article.publishedAt) >= cutoff)
      .filter((article) => {
        const lower = article.title.toLowerCase();
        return releaseTokens.length === 0 || releaseTokens.some((token) => lower.includes(token));
      })
      .filter((article) => {
        const key = article.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, 18);
    updateIntegrationHealth('releaseArticles', { status: 'healthy', lastSuccessAt: new Date().toISOString(), lastError: null });
    return items;
  } catch (error) {
    updateIntegrationHealth('releaseArticles', { status: 'degraded', lastFailureAt: new Date().toISOString(), lastError: String(error?.message || error || 'Article feed request failed') });
    return [];
  }
}

async function getWeeklyReleaseArticles(forceRefresh = false) {
  const cached = readJson(RELEASE_ARTICLE_CACHE_FILE, {});
  const cachedAt = Date.parse(cached.updatedAt || '');
  if (!forceRefresh && Array.isArray(cached.items) && Number.isFinite(cachedAt) && Date.now() - cachedAt < RELEASE_ARTICLE_CACHE_TTL_MS) {
    return cached;
  }
  const releaseFeed = await getDailyReleaseFeed(false);
  const items = await fetchWeeklyReleaseArticles(Array.isArray(releaseFeed.items) ? releaseFeed.items : []);
  const payload = {
    updatedAt: new Date().toISOString(),
    ttlMs: RELEASE_ARTICLE_CACHE_TTL_MS,
    windowDays: 7,
    sourceType: 'public-rss-aggregation',
    verifiedProviderApi: false,
    disclosure: 'Links are discovered through Google News RSS and attributed to the original publisher. Project Sora does not copy article text.',
    sources: ['IGN', 'GameSpot', 'Eurogamer', 'Polygon', 'PC Gamer'],
    items
  };
  writeJson(RELEASE_ARTICLE_CACHE_FILE, payload);
  return payload;
}

async function getDailyReleaseFeed(forceRefresh = false) {
  const cached = readJson(RELEASE_CACHE_FILE, {});
  const cachedAt = Date.parse(cached.updatedAt || '');
  if (!forceRefresh && Array.isArray(cached.items) && cached.items.length && Number.isFinite(cachedAt) && Date.now() - cachedAt < RELEASE_CACHE_TTL_MS) {
    return cached;
  }
  const items = await fetchLiveReleaseFeed();
  const payload = {
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + RELEASE_CACHE_TTL_MS).toISOString(),
    ttlMs: RELEASE_CACHE_TTL_MS,
    hardDatesOnly: true,
    sort: 'soonest-first',
    sourceLabel: 'Public Steam Store data',
    sourceType: 'public-structured-endpoint',
    verifiedProviderApi: false,
    disclosureVersion: RELEASE_PROVIDER_DISCLOSURE_VERSION,
    disclosure: "Dates are independently validated from public Steam Store data. This is not Valve's guaranteed Steam Web API.",
    sources: ['Steam Store'],
    items: items.map((item) => ({ ...item, sourceType: 'public-structured-endpoint', verifiedProviderApi: false, dateConfidence: 'hard-date' }))
  };
  if (items.length) writeJson(RELEASE_CACHE_FILE, payload);
  return items.length ? payload : (Array.isArray(cached.items) ? cached : payload);
}

function sanitizeLibraryPayload(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(Boolean).map((entry) => ({
    ...normalizeLibraryEntry(entry),
    condition: String(entry?.condition || 'Good'),
    purchasePrice: Number(entry?.purchasePrice || 0),
    currentValue: Number(entry?.currentValue || 0),
    metacriticScore: Number(entry?.metacriticScore || 0),
    notes: String(entry?.notes || ''),
    comments: Array.isArray(entry?.comments) ? entry.comments : [],
    coverImage: String(entry?.coverImage || '')
  }));
}

function sanitizePrivacyVisibility(value, fallback = 'Private') {
  const candidate = String(value || '').trim();
  return PRIVACY_VISIBILITY_OPTIONS.includes(candidate) ? candidate : fallback;
}

function sanitizeBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function sanitizePrivacySettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      profileVisibility: 'Private',
      libraryVisibility: 'Private',
      reviewsVisibility: 'Private',
      activityVisibility: 'Private',
      feedSharingEnabled: false
    };
  }

  return {
    profileVisibility: sanitizePrivacyVisibility(value.profileVisibility, 'Private'),
    libraryVisibility: sanitizePrivacyVisibility(value.libraryVisibility, 'Private'),
    reviewsVisibility: sanitizePrivacyVisibility(value.reviewsVisibility, 'Private'),
    activityVisibility: sanitizePrivacyVisibility(value.activityVisibility, 'Private'),
    feedSharingEnabled: sanitizeBooleanFlag(value.feedSharingEnabled, false)
  };
}

function sanitizeLibraryEntryForProfile(entry) {
  const normalized = sanitizeLibraryPayload([entry])[0] || null;
  if (!normalized) {
    return null;
  }

  const { purchasePrice, currentValue, notes, comments, ...safeEntry } = normalized;
  return {
    ...safeEntry,
    id: String(normalized.id || ''),
    title: String(normalized.title || ''),
    platform: String(normalized.platform || ''),
    condition: String(normalized.condition || 'Good'),
    metacriticScore: Number(normalized.metacriticScore || 0),
    playtimeMinutes: Number(normalized.playtimeMinutes || 0),
    completionPercent: Number(normalized.completionPercent || 0),
    coverImage: String(normalized.coverImage || ''),
    status: normalizePlayStatus(normalized.status, Number(normalized.completionPercent || 0)),
    completedAt: normalized.status === 'Completed' ? (normalized.completedAt || null) : null
  };
}

function sanitizeLibraryPayloadForProfile(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(Boolean).map((entry) => sanitizeLibraryEntryForProfile(entry)).filter(Boolean);
}

function sanitizeReviewEntryForProfile(entry, authorEmail) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const author = String(authorEmail || '').trim();
  return {
    authorHandle: author ? createPublicHandle(author) : 'user',
    text: String(entry.text || '').trim(),
    rating: Number(entry.rating || 0)
  };
}

function sanitizeReviewsPayloadForProfile(value, authorEmail) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(Boolean).map((entry) => sanitizeReviewEntryForProfile(entry, authorEmail)).filter(Boolean);
}

function isUsersFriends(friendStore, userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) {
    return false;
  }

  return friendStore.friendships.some((entry) => (entry.userIdA === userIdA && entry.userIdB === userIdB) || (entry.userIdA === userIdB && entry.userIdB === userIdA));
}

function evaluateProfileAccess(ownerEmail, viewerEmail, usersStore, friendStore) {
  const normalizedOwnerEmail = String(ownerEmail || '').trim().toLowerCase();
  const normalizedViewerEmail = String(viewerEmail || '').trim().toLowerCase();
  const ownerRecord = ensureUserPublicIdentity(usersStore, normalizedOwnerEmail);
  const viewerRecord = normalizedViewerEmail ? ensureUserPublicIdentity(usersStore, normalizedViewerEmail) : null;
  const privacy = sanitizePrivacySettings(ownerRecord?.privacySettings);

  if (!normalizedOwnerEmail || !ownerRecord) {
    return { allowed: false, reason: 'This profile is private.' };
  }

  if (normalizedOwnerEmail === normalizedViewerEmail) {
    return { allowed: true, reason: null };
  }

  if (!normalizedViewerEmail) {
    return { allowed: privacy.profileVisibility === 'Public', reason: 'This profile is private.' };
  }

  const isFriend = isUsersFriends(friendStore, ownerRecord.publicId, viewerRecord?.publicId);
  if (privacy.profileVisibility === 'Public') {
    return { allowed: true, reason: null };
  }
  if (privacy.profileVisibility === 'Friends Only') {
    return { allowed: isFriend, reason: 'This profile is private.' };
  }
  return { allowed: false, reason: 'This profile is private.' };
}

function evaluateSectionAccess(sectionKey, ownerEmail, viewerEmail, usersStore, friendStore) {
  const profileAccess = evaluateProfileAccess(ownerEmail, viewerEmail, usersStore, friendStore);
  if (!profileAccess.allowed) {
    return { available: false, message: profileAccess.reason || 'This profile is private.' };
  }

  const normalizedOwnerEmail = String(ownerEmail || '').trim().toLowerCase();
  const normalizedViewerEmail = String(viewerEmail || '').trim().toLowerCase();
  const ownerRecord = ensureUserPublicIdentity(usersStore, normalizedOwnerEmail);
  const viewerRecord = normalizedViewerEmail ? ensureUserPublicIdentity(usersStore, normalizedViewerEmail) : null;
  const privacy = sanitizePrivacySettings(ownerRecord?.privacySettings);
  const isOwner = normalizedOwnerEmail === normalizedViewerEmail;
  const isFriend = isUsersFriends(friendStore, ownerRecord.publicId, viewerRecord?.publicId);

  const setting = privacy[sectionKey] || 'Private';
  if (isOwner) {
    return { available: true, message: null };
  }

  if (setting === 'Public') {
    return { available: true, message: null };
  }

  if (setting === 'Friends Only') {
    return { available: isFriend, message: isFriend ? null : (sectionKey === 'libraryVisibility' ? 'Library access is restricted by privacy settings.' : sectionKey === 'reviewsVisibility' ? 'Reviews are restricted by privacy settings.' : 'Activity is restricted by privacy settings.') };
  }

  return { available: false, message: sectionKey === 'libraryVisibility' ? 'Library access is restricted by privacy settings.' : sectionKey === 'reviewsVisibility' ? 'Reviews are restricted by privacy settings.' : 'Activity is restricted by privacy settings.' };
}


function sanitizeProfileImageUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return '';
  }
  if (candidate.startsWith('/')) {
    return candidate.slice(0, 500);
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? candidate.slice(0, 500) : '';
  } catch {
    return '';
  }
}


const PLATFORM_ACCOUNT_KEYS = ['steam', 'xbox', 'playstation', 'nintendo'];
const PLATFORM_VISIBILITIES = new Set(['Public', 'Friends Only', 'Private']);

function sanitizePlatformAccount(platform, value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const handle = String(source.handle || '').trim().slice(0, 64);
  let profileUrl = '';
  const candidate = String(source.profileUrl || '').trim();
  if (candidate) {
    try {
      const parsed = new URL(candidate);
      const allowedHosts = {
        steam: ['steamcommunity.com', 'store.steampowered.com'],
        xbox: ['xbox.com', 'www.xbox.com'],
        playstation: ['playstation.com', 'www.playstation.com'],
        nintendo: ['nintendo.com', 'www.nintendo.com']
      };
      const hosts = allowedHosts[platform] || [];
      if (parsed.protocol === 'https:' && hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) profileUrl = candidate.slice(0, 500);
    } catch {}
  }
  const visibility = PLATFORM_VISIBILITIES.has(source.visibility) ? source.visibility : 'Public';
  return {
    platform,
    handle,
    profileUrl,
    visibility,
    linked: Boolean(handle || profileUrl),
    verificationStatus: 'self-reported',
    updatedAt: String(source.updatedAt || new Date().toISOString())
  };
}

function sanitizePlatformAccounts(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(PLATFORM_ACCOUNT_KEYS.map((platform) => [platform, sanitizePlatformAccount(platform, source[platform])]));
}

function filterVisiblePlatformAccounts(accounts, isOwner, isFriend) {
  const sanitized = sanitizePlatformAccounts(accounts);
  return Object.fromEntries(Object.entries(sanitized).filter(([, account]) => {
    if (!account.linked) return false;
    if (isOwner) return true;
    if (account.visibility === 'Public') return true;
    return account.visibility === 'Friends Only' && isFriend;
  }));
}

function sanitizeProfileDetails(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const favoriteGameIds = [...new Set((Array.isArray(source.favoriteGameIds) ? source.favoriteGameIds : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))].slice(0, 5);
  return {
    displayName: String(source.displayName || '').trim().slice(0, 40),
    bio: String(source.bio || '').trim().slice(0, 280),
    avatarUrl: sanitizeProfileImageUrl(source.avatarUrl),
    bannerUrl: sanitizeProfileImageUrl(source.bannerUrl),
    favoriteGameIds,
    platformAccounts: sanitizePlatformAccounts(source.platformAccounts),
    updatedAt: String(source.updatedAt || new Date().toISOString())
  };
}

function resolveProfileOwner(usersStore, identifier) {
  const candidate = decodeURIComponent(String(identifier || '')).trim().toLowerCase();
  if (!candidate) {
    return null;
  }
  if (usersStore[candidate]) {
    return candidate;
  }
  return Object.keys(usersStore).find((email) => {
    const record = ensureUserPublicIdentity(usersStore, email);
    return String(record?.publicHandle || '').toLowerCase() === candidate || String(record?.publicId || '').toLowerCase() === candidate;
  }) || null;
}

function serializeFavoriteGames(gameIds) {
  const catalogValue = readJson(CATALOG_FILE, defaultCatalog);
  const catalog = Array.isArray(catalogValue) ? catalogValue : defaultCatalog;
  return (Array.isArray(gameIds) ? gameIds : []).map((gameId) => {
    const target = catalog.find((game) => String(game.id || '') === String(gameId || ''));
    if (!target) {
      return null;
    }
    return {
      id: String(target.id || ''),
      title: String(target.name || target.title || ''),
      platform: String(target.platform || ''),
      image: String(target.image || target.coverImage || '')
    };
  }).filter(Boolean).slice(0, 5);
}

function normalizeWishlistGameId(value, fallbackTitle = '') {
  const candidate = String(value || '').trim();
  if (candidate) {
    return candidate;
  }

  const title = String(fallbackTitle || '').trim().toLowerCase();
  return title ? `catalog-${title.replace(/[^a-z0-9]+/g, '-')}` : 'catalog-game';
}

function sanitizeWishlistEntry(entry, fallbackTitle = '') {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const gameId = normalizeWishlistGameId(entry.gameId || entry.id, entry.title || fallbackTitle);
  return {
    gameId,
    title: String(entry.title || fallbackTitle || ''),
    platform: String(entry.platform || ''),
    price: Number(entry.price || 0),
    image: String(entry.image || ''),
    releaseDate: String(entry.releaseDate || entry.release || ''),
    addedAt: String(entry.addedAt || new Date().toISOString())
  };
}

function sanitizeWishlistPayload(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => sanitizeWishlistEntry(entry, entry?.title || ''))
    .filter(Boolean);
}

function sanitizeWishlistStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, storedValue]) => [String(key), sanitizeWishlistPayload(Array.isArray(storedValue) ? storedValue : [])])
  );
}

function normalizeQueueGameId(value, fallbackTitle = '') {
  const candidate = String(value || '').trim();
  if (candidate) {
    return candidate;
  }

  const title = String(fallbackTitle || '').trim().toLowerCase();
  return title ? `queue-${title.replace(/[^a-z0-9]+/g, '-')}` : 'queue-game';
}

function sanitizeQueueEntry(entry, fallbackTitle = '') {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const gameId = normalizeQueueGameId(entry.gameId || entry.id, entry.title || fallbackTitle);
  return {
    gameId,
    title: String(entry.title || fallbackTitle || ''),
    platform: String(entry.platform || ''),
    image: String(entry.image || ''),
    status: String(entry.status || 'Queued'),
    addedAt: String(entry.addedAt || new Date().toISOString())
  };
}

function sanitizeQueuePayload(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => sanitizeQueueEntry(entry, entry?.title || ''))
    .filter(Boolean);
}

function sanitizeQueueStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, storedValue]) => [String(key), sanitizeQueuePayload(Array.isArray(storedValue) ? storedValue : [])])
  );
}

function sanitizeDisplayTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function sanitizePriceHistorySnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const gameId = String(value.gameId || value.catalogGameId || '').trim();
  const storefront = String(value.storefront || '').trim();
  const currency = String(value.currency || '').trim().toUpperCase();
  const source = String(value.source || value.sourceIdentifier || '').trim();
  const capturedAtRaw = String(value.capturedAt || '').trim();
  const priceValue = Number(value.price ?? 0);
  const capturedAt = new Date(capturedAtRaw);

  if (!gameId || !storefront || !currency || !source || !capturedAtRaw || Number.isNaN(capturedAt.getTime()) || !Number.isFinite(priceValue) || priceValue <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    return null;
  }

  return {
    gameId,
    storefront,
    price: Number(priceValue.toFixed(2)),
    currency,
    capturedAt: capturedAt.toISOString(),
    source
  };
}

function sanitizePriceHistoryStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, storedValue]) => {
        const entries = Array.isArray(storedValue) ? storedValue : (storedValue && typeof storedValue === 'object' && !Array.isArray(storedValue) && Array.isArray(storedValue.entries) ? storedValue.entries : []);
        const sanitizedEntries = entries
          .map((entry) => sanitizePriceHistorySnapshot(entry))
          .filter(Boolean)
          .sort((left, right) => (left.capturedAt || '').localeCompare(right.capturedAt || ''));

        return [String(key), sanitizedEntries];
      })
  );
}

function sanitizePriceAlert(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const gameId = String(value.gameId || '').trim();
  const currency = String(value.currency || '').trim().toUpperCase();
  const targetPrice = Number(value.targetPrice || 0);
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : String(value.enabled || 'true').trim().toLowerCase() !== 'false';
  if (!gameId || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(targetPrice) || targetPrice <= 0) {
    return null;
  }

  return {
    gameId,
    targetPrice: Number(targetPrice.toFixed(2)),
    currency,
    enabled,
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || new Date().toISOString())
  };
}

function sanitizePriceAlertStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, storedValue]) => {
      const alerts = Array.isArray(storedValue) ? storedValue : [];
      return [String(key), alerts.map((entry) => sanitizePriceAlert(entry)).filter(Boolean)];
    })
  );
}

function sanitizeNotification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const id = String(value.id || '').trim();
  const gameId = String(value.gameId || '').trim();
  const type = String(value.type || 'price_alert').trim();
  if (!id || !gameId || type !== 'price_alert') {
    return null;
  }

  return {
    id,
    type,
    gameId,
    title: String(value.title || 'Price alert').trim(),
    message: String(value.message || '').trim(),
    read: typeof value.read === 'boolean' ? value.read : false,
    createdAt: String(value.createdAt || new Date().toISOString()),
    targetPrice: Number(value.targetPrice || 0),
    currency: String(value.currency || '').trim().toUpperCase(),
    observedPrice: Number(value.observedPrice || 0)
  };
}

function sanitizeNotificationStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, storedValue]) => {
      const notifications = Array.isArray(storedValue) ? storedValue : [];
      return [String(key), notifications.map((entry) => sanitizeNotification(entry)).filter(Boolean)];
    })
  );
}

function getPriceHistoryDayKey(value) {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toISOString().slice(0, 10);
}

function buildPriceHistorySummary(gameId, historyEntries) {
  const sortedEntries = [...historyEntries].sort((left, right) => (left.capturedAt || '').localeCompare(right.capturedAt || ''));
  const groupedByCurrency = new Map();

  sortedEntries.forEach((entry) => {
    const currency = entry.currency || 'USD';
    if (!groupedByCurrency.has(currency)) {
      groupedByCurrency.set(currency, []);
    }
    groupedByCurrency.get(currency).push(entry);
  });

  const summaryByCurrency = Array.from(groupedByCurrency.entries())
    .map(([currency, entries]) => {
      const latestEntry = [...entries].sort((left, right) => (left.capturedAt || '').localeCompare(right.capturedAt || ''))[entries.length - 1] || null;
      const lowestEntry = [...entries].sort((left, right) => Number(left.price || 0) - Number(right.price || 0))[0] || null;
      const highestEntry = [...entries].sort((left, right) => Number(right.price || 0) - Number(left.price || 0))[0] || null;
      return {
        currency,
        label: 'Prices observed by Project Sora',
        latestPrice: latestEntry ? { price: Number(latestEntry.price || 0), currency: latestEntry.currency, storefront: latestEntry.storefront, capturedAt: latestEntry.capturedAt, source: latestEntry.source } : null,
        lowestPrice: lowestEntry ? { price: Number(lowestEntry.price || 0), currency: lowestEntry.currency, storefront: lowestEntry.storefront, capturedAt: lowestEntry.capturedAt, source: lowestEntry.source } : null,
        highestPrice: highestEntry ? { price: Number(highestEntry.price || 0), currency: highestEntry.currency, storefront: highestEntry.storefront, capturedAt: highestEntry.capturedAt, source: highestEntry.source } : null,
        lastCheckedDate: latestEntry ? latestEntry.capturedAt : null,
        hasEnoughHistory: entries.length >= 2
      };
    })
    .sort((left, right) => left.currency.localeCompare(right.currency));

  return {
    gameId,
    history: sortedEntries.map((entry) => ({ ...entry, price: Number(entry.price || 0) })),
    summaryByCurrency,
    emptyState: sortedEntries.length >= 2 ? null : 'Not enough history yet'
  };
}

const ACTIVITY_EVENT_TYPES = new Set(['added_game', 'removed_game', 'changed_play_status', 'completed_game', 'posted_review', 'changed_rating', 'added_wishlist_item', 'removed_wishlist_item']);

function sanitizeActivityEvent(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const eventType = String(entry.type || '').trim();
  if (!ACTIVITY_EVENT_TYPES.has(eventType)) {
    return null;
  }

  const eventId = String(entry.eventId || entry.id || '').trim();
  return {
    eventId: eventId || `activity-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    type: eventType,
    gameId: String(entry.gameId || '').trim(),
    displayTitle: sanitizeDisplayTitle(entry.displayTitle || entry.title || entry.name || ''),
    timestamp: String(entry.timestamp || new Date().toISOString()),
    hidden: sanitizeBooleanFlag(entry.hidden, false)
  };
}

function sanitizeActivityPayload(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => sanitizeActivityEvent(entry))
    .filter(Boolean);
}

function sanitizeActivityStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, storedValue]) => [String(key), sanitizeActivityPayload(Array.isArray(storedValue) ? storedValue : [])])
  );
}

function normalizeActivityEventPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const source = body.activityEvent && typeof body.activityEvent === 'object' && !Array.isArray(body.activityEvent)
    ? body.activityEvent
    : body;

  const explicitType = String(source.type || '').trim();
  const inferredType = explicitType || (body.eventId && body.games !== undefined ? 'added_game' : '') || (body.eventId && body.gameId && body.title && body.type === undefined && body.action === 'remove' ? 'removed_game' : '');
  if (!inferredType) {
    return null;
  }

  const candidateGames = Array.isArray(source.games) ? source.games : Array.isArray(body.games) ? body.games : [];
  const firstGame = candidateGames.find((entry) => entry && typeof entry === 'object') || null;
  const inferredGameId = String(source.gameId || body.gameId || firstGame?.id || firstGame?.gameId || '').trim();
  const inferredDisplayTitle = sanitizeDisplayTitle(source.displayTitle || source.title || body.displayTitle || body.title || body.name || firstGame?.title || firstGame?.name || '');

  return sanitizeActivityEvent({
    eventId: source.eventId || body.eventId || '',
    type: inferredType,
    gameId: inferredGameId,
    displayTitle: inferredDisplayTitle,
    timestamp: source.timestamp || body.timestamp || new Date().toISOString()
  });
}

function appendActivityEvent(activityStore, username, event) {
  const normalized = sanitizeActivityEvent(event);
  if (!normalized) {
    return sanitizeActivityPayload(activityStore[username] || []);
  }

  const existing = sanitizeActivityPayload(activityStore[username] || []);
  if (existing.some((item) => item.eventId === normalized.eventId)) {
    return existing;
  }

  const nextItems = [normalized, ...existing]
    .sort((left, right) => (right.timestamp || '').localeCompare(left.timestamp || ''))
    .slice(0, 250);
  activityStore[username] = nextItems;
  return nextItems;
}

function mergeWishlistEntries(localItems = [], remoteItems = []) {
  const combined = [...sanitizeWishlistPayload(localItems), ...sanitizeWishlistPayload(remoteItems)];
  const byGameId = new Map();

  combined.forEach((entry) => {
    const existing = byGameId.get(entry.gameId);
    if (!existing) {
      byGameId.set(entry.gameId, entry);
      return;
    }

    const existingTimestamp = existing.addedAt || '';
    const incomingTimestamp = entry.addedAt || '';
    if (!existingTimestamp || (incomingTimestamp && incomingTimestamp > existingTimestamp)) {
      byGameId.set(entry.gameId, entry);
    }
  });

  return Array.from(byGameId.values()).sort((left, right) => (left.addedAt || '').localeCompare(right.addedAt || ''));
}


const RESERVED_USERNAMES = new Set(['admin','administrator','api','app','developer','help','moderator','official','owner','project-sora','projectsora','root','staff','support','system']);
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}
function isValidUsername(value) {
  const normalized = normalizeUsername(value);
  return /^[a-z0-9_.]{3,20}$/.test(normalized) && !RESERVED_USERNAMES.has(normalized);
}
function isUsernameAvailable(usersStore, value, currentEmail = '') {
  const normalized = normalizeUsername(value);
  if (!normalized) return false;
  return !Object.entries(usersStore || {}).some(([email, record]) => String(email).toLowerCase() !== String(currentEmail).toLowerCase() && normalizeUsername(record?.publicHandle) === normalized);
}

function createPublicHandle(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'user';
  }

  const localPart = normalized.split('@')[0] || 'user';
  const safePart = localPart.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const seed = Math.abs(normalized.split('').reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)).toString(36);
  return safePart ? `user-${safePart}-${seed}` : `user-${seed}`;
}

function createPublicUserId() {
  return `user-${crypto.randomBytes(8).toString('hex')}`;
}

function sanitizeUserStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, storedValue]) => {
      if (storedValue && typeof storedValue === 'object' && !Array.isArray(storedValue)) {
        const candidate = storedValue;
        const hasCredentialFields = typeof candidate.salt === 'string' && typeof candidate.passwordHash === 'string';
        if (hasCredentialFields) {
          const sanitizedUser = {
            salt: String(candidate.salt || ''),
            passwordHash: String(candidate.passwordHash || '')
          };
          if (candidate.publicId) {
            sanitizedUser.publicId = String(candidate.publicId || '').trim();
          }
          if (candidate.publicHandle) {
            sanitizedUser.publicHandle = String(candidate.publicHandle || '').trim();
          }
          sanitizedUser.privacySettings = sanitizePrivacySettings(candidate.privacySettings);
          sanitizedUser.emailVerifiedAt = String(candidate.emailVerifiedAt || '').trim();
          sanitizedUser.verificationCodeHash = String(candidate.verificationCodeHash || '').trim();
          sanitizedUser.verificationExpiresAt = Number(candidate.verificationExpiresAt || 0);
          sanitizedUser.verificationLastSentAt = Number(candidate.verificationLastSentAt || 0);
          return [String(key), sanitizedUser];
        }
      }

      return [String(key), sanitizeLibraryPayload(storedValue)];
    })
  );
}

function sanitizeFriendRequestEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const requesterId = String(value.requesterId || '').trim();
  const targetId = String(value.targetId || '').trim();
  const status = String(value.status || 'pending').trim().toLowerCase();
  if (!requesterId || !targetId || !['pending', 'accepted', 'declined'].includes(status)) {
    return null;
  }

  return {
    id: String(value.id || `request-${crypto.randomBytes(6).toString('hex')}`),
    requesterId,
    targetId,
    status,
    createdAt: String(value.createdAt || new Date().toISOString())
  };
}

function sanitizeFriendshipEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const userIdA = String(value.userIdA || '').trim();
  const userIdB = String(value.userIdB || '').trim();
  if (!userIdA || !userIdB || userIdA === userIdB) {
    return null;
  }

  return {
    userIdA,
    userIdB,
    createdAt: String(value.createdAt || new Date().toISOString())
  };
}

function sanitizeFriendStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { requests: [], friendships: [] };
  }

  return {
    requests: Array.isArray(value.requests)
      ? value.requests.map((entry) => sanitizeFriendRequestEntry(entry)).filter(Boolean)
      : [],
    friendships: Array.isArray(value.friendships)
      ? value.friendships.map((entry) => sanitizeFriendshipEntry(entry)).filter(Boolean)
      : []
  };
}

function serializePublicUser(userRecord) {
  if (!userRecord || typeof userRecord !== 'object' || Array.isArray(userRecord)) {
    return null;
  }

  const publicId = String(userRecord.publicId || '').trim();
  const publicHandle = String(userRecord.publicHandle || '').trim();
  if (!publicId && !publicHandle) {
    return null;
  }

  return {
    id: publicId || publicHandle,
    handle: publicHandle || createPublicHandle(publicId || 'user')
  };
}

function getUserRecordByEmail(usersStore, email) {
  return usersStore[String(email || '').trim().toLowerCase()] || null;
}

function ensureUserPublicIdentity(usersStore, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const userRecord = usersStore[normalizedEmail];
  if (!userRecord || typeof userRecord !== 'object' || Array.isArray(userRecord)) {
    return userRecord;
  }

  if (!userRecord.publicId) {
    userRecord.publicId = createPublicUserId();
  }
  if (!userRecord.publicHandle) {
    userRecord.publicHandle = createPublicHandle(normalizedEmail);
  }
  return userRecord;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(body);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('Invalid JSON payload'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function getTokenFromRequest(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.replace('Bearer ', '') : '';
}

function getUserByToken(token) {
  const session = getSessionData(token);
  return session ? session.user : null;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function ensureAuthenticated(req, res) {
  const token = getTokenFromRequest(req);
  if (!token || typeof token !== 'string' || token.length < 8) {
    sendJson(res, 401, { error: 'Unauthorized' }, res.__requestId || getRequestId(req));
    return null;
  }

  const username = getUserByToken(token);
  if (!username) {
    sendJson(res, 401, { error: 'Unauthorized' }, res.__requestId || getRequestId(req));
    return null;
  }
  return username;
}

function sanitizePath(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/').trim();
}

function isRateLimited(key) {
  const now = Date.now();
  const window = authRateLimits.get(key);
  if (!window) {
    authRateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (window.resetAt <= now) {
    authRateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  window.count += 1;
  return window.count > RATE_LIMIT_MAX_REQUESTS;
}

function isSafeStaticPath(urlPath) {
  if (!urlPath || urlPath === '/') {
    return true;
  }

  if (urlPath.includes('..') || urlPath.includes('//')) {
    return false;
  }

  const normalized = path.posix.normalize(urlPath);
  if (normalized.startsWith('../') || normalized === '..') {
    return false;
  }

  const relativePath = normalized.replace(/^\/+/, '');
  if (!relativePath) {
    return true;
  }

  if (relativePath.startsWith('.')) {
    return false;
  }

  const hasExtension = path.posix.extname(relativePath) !== '';
  const allowedExtensions = new Set(Object.keys(MIME_TYPES));
  const extension = path.posix.extname(relativePath).toLowerCase();
  const allowedPublicFiles = new Set([
    'index.html', 'offline.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'helpers.js',
    'catalog-data.js', 'csv-utils.mjs', 'search-utils.mjs', 'catalog-routing.mjs', 'profile-privacy.mjs',
    'profile-privacy.js', 'library-view-utils.mjs', 'play-next-utils.mjs', 'play-next-utils.cjs',
    'queue-utils.js', 'search-experience.mjs', 'statistics-utils.mjs',
    'catalog-detail-utils.mjs', 'catalog-search.mjs',
    'release-experience.mjs', 'release-trust.mjs', 'release-pipeline.mjs',
    'sw.js', 'favicon.ico'
  ]);
  const isAllowedAsset =
    allowedPublicFiles.has(relativePath) ||
    relativePath.startsWith('icons/') ||
    relativePath.startsWith('assets/');
  if (hasExtension) {
    return isAllowedAsset && allowedExtensions.has(extension);
  }

  return true;
}

function serveStaticFile(req, res) {
  const rawPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const urlPath = sanitizePath(rawPath);
  if (!isSafeStaticPath(urlPath)) {
    sendJson(res, 403, { error: 'Forbidden' }, res.__requestId || getRequestId(req));
    return;
  }

  const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const isClientRoute = !path.posix.extname(relativePath) && relativePath !== 'index.html';
  const safePath = isClientRoute ? 'index.html' : relativePath || 'index.html';
  const filePath = path.resolve(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' }, res.__requestId || getRequestId(req));
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: 'Not found' }, res.__requestId || getRequestId(req));
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    applySecurityHeaders(res, MIME_TYPES[ext] || 'application/octet-stream');

    if (safePath === 'sw.js') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    } else if (['.html', '.js', '.mjs', '.json', '.webmanifest'].includes(ext)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    }

    res.writeHead(200);
    res.end(content);
    logRequest(req, res, 200, Date.now() - (res.__startedAt || Date.now()), res.__requestId || getRequestId(req));
  });
}

ensureDataFiles();

function createServer() {
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestId = getRequestId(req);
    const url = new URL(req.url, `http://${req.headers.host}`);

    res.__req = req;
    res.__requestId = requestId;
    res.__startedAt = startedAt;

    const respond = (statusCode, payload) => {
      sendJson(res, statusCode, payload, requestId);
    };

    try {
  if (req.method === 'OPTIONS') {
    applySecurityHeaders(res);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.writeHead(204, applyCorsHeaders(req, {}));
    logRequest(req, res, 204, Date.now() - startedAt, requestId);
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    const uptimeMs = Math.round(process.uptime() * 1000);
    return respond(200, { status: 'ok', service: 'project-sora', uptimeMs, ready: true, persistenceMode: storage.getPersistenceMode(), databasePathConfigured: Boolean(storage.DB_PATH), timestamp: new Date().toISOString() });
  }

  if (req.method === 'GET' && url.pathname === '/ready') {
    return respond(200, { status: 'ready', ready: true });
  }

  if (req.method === 'GET' && url.pathname === '/deployment-health') {
    const uptimeMs = Math.round(process.uptime() * 1000);
    return respond(200, { status: 'ok', service: 'project-sora', uptimeMs, ready: true, deployment: 'production' });
  }

  if (req.method === 'GET' && url.pathname === '/api/integrations/status') {
    const releaseCache = readJson(RELEASE_CACHE_FILE, {});
    const articleCache = readJson(RELEASE_ARTICLE_CACHE_FILE, {});
    const catalog = readJson(CATALOG_FILE, defaultCatalog);
    const barcodeCount = catalog.reduce((count, entry) => {
      const barcodes = Array.isArray(entry?.barcodes) ? entry.barcodes : [entry?.barcode];
      return count + barcodes.filter(Boolean).length;
    }, 0);

    return respond(200, {
      generatedAt: new Date().toISOString(),
      policy: {
        htmlScrapingEnabled: false,
        privateApiCors: 'same-origin',
        cameraPermission: 'self',
        dataLabelsRequired: true
      },
      integrations: Object.entries(INTEGRATION_CATALOG).map(([key, definition]) => {
        const status = serializeIntegrationStatus(key, definition);
        if (key === 'steamStore') {
          status.cacheUpdatedAt = releaseCache.updatedAt || null;
          status.cachedItemCount = Array.isArray(releaseCache.items) ? releaseCache.items.length : 0;
        }
        if (key === 'releaseArticles') {
          status.cacheUpdatedAt = articleCache.updatedAt || null;
          status.cachedItemCount = Array.isArray(articleCache.items) ? articleCache.items.length : 0;
        }
        if (key === 'localCatalog') status.recordCount = catalog.length;
        if (key === 'openBarcodes') status.verifiedBarcodeCount = barcodeCount;
        return status;
      })
    });
  }


  if (req.method === 'GET' && url.pathname === '/api/system/status') {
    return respond(200, {
      generatedAt: new Date().toISOString(),
      service: 'project-sora',
      persistence: storage.getMigrationStatus ? storage.getMigrationStatus() : { mode: storage.getPersistenceMode() },
      backups: storage.listBackupDirectories ? storage.listBackupDirectories().slice(-5).map((entry) => path.basename(entry)) : [],
      integrations: Object.entries(INTEGRATION_CATALOG).map(([key, definition]) => serializeIntegrationStatus(key, definition))
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/client-errors') {
    try {
      const body = await parseBody(req);
      const record = {
        id: `client-error-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        createdAt: new Date().toISOString(),
        kind: String(body.kind || 'client-error').slice(0, 40),
        message: redactSensitiveString(String(body.message || 'Unknown client error')).slice(0, 500),
        route: String(body.route || '').slice(0, 200),
        userAgent: String(body.userAgent || '').slice(0, 300),
        appVersion: String(body.appVersion || 'beta').slice(0, 80),
        requestId,
        details: redactForLogging(body.details || {})
      };
      const records = readJson(CLIENT_ERRORS_FILE, []);
      const next = Array.isArray(records) ? records.slice(-499) : [];
      next.push(record);
      writeJson(CLIENT_ERRORS_FILE, next);
      return respond(202, { ok: true, reference: record.id });
    } catch (error) {
      return respond(400, { error: 'Client diagnostic could not be recorded', requestId });
    }
  }


  if (req.method === 'GET' && url.pathname === '/api/games/barcode') {
    const code = String(url.searchParams.get('code') || '').replace(/[^0-9]/g, '');
    if (code.length < 8 || code.length > 14) {
      return respond(400, { error: 'A valid 8–14 digit UPC or EAN is required' });
    }

    const catalog = readJson(CATALOG_FILE, defaultCatalog);
    const game = catalog.find((entry) => {
      const values = Array.isArray(entry.barcodes) ? entry.barcodes : [entry.barcode];
      return values.filter(Boolean).some((value) => String(value).replace(/[^0-9]/g, '') === code);
    });

    if (!game) {
      return respond(404, { error: 'No game in the Project Sora catalog matches this barcode' });
    }

    return respond(200, { game: { ...game, msrp: Number(game.msrp ?? game.price ?? 0) } });
  }

  if (req.method === 'GET' && url.pathname === '/api/games') {
    const searchTerm = String(url.searchParams.get('search') || '').trim();
    const requestedLimit = Number(url.searchParams.get('limit') || (searchTerm ? 30 : 12));
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 20));
    const catalog = readJson(CATALOG_FILE, defaultCatalog);
    const ranked = rankCatalogEntries(catalog, searchTerm, { limit });
    return respond(200, ranked.map((game) => ({
      ...game,
      msrp: Number(game.msrp ?? game.price ?? 0),
      availablePlatforms: Array.isArray(game.availablePlatforms) ? game.availablePlatforms : [game.platform].filter(Boolean),
      editionIds: Array.isArray(game.editionIds) ? game.editionIds : [game.id].filter(Boolean)
    })));
  }

  if (req.method === 'POST' && url.pathname === '/api/catalog/price-history') {
    const trustedToken = String(process.env.PROJECT_SORA_TRUSTED_INTEGRATION_TOKEN || '').trim();
    const providedToken = String(req.headers['x-project-sora-integration'] || '').trim();
    if (!trustedToken || providedToken !== trustedToken) {
      return respond(403, { error: 'Forbidden' });
    }

    try {
      const body = await parseBody(req);
      const snapshot = sanitizePriceHistorySnapshot(body);
      if (!snapshot) {
        return respond(400, { error: 'Price snapshot is invalid' });
      }

      const priceHistoryStore = sanitizePriceHistoryStore(readJson(PRICE_HISTORY_FILE, {}));
      const existingEntries = Array.isArray(priceHistoryStore[snapshot.gameId]) ? priceHistoryStore[snapshot.gameId] : [];
      const dayKey = getPriceHistoryDayKey(snapshot.capturedAt);
      const duplicate = existingEntries.find((entry) => entry.gameId === snapshot.gameId && entry.storefront === snapshot.storefront && entry.currency === snapshot.currency && entry.price === snapshot.price && getPriceHistoryDayKey(entry.capturedAt) === dayKey);
      if (duplicate) {
        return respond(200, { ok: true, created: false, snapshot: duplicate });
      }

      const nextEntries = [...existingEntries, snapshot].sort((left, right) => (left.capturedAt || '').localeCompare(right.capturedAt || ''));
      priceHistoryStore[snapshot.gameId] = nextEntries;
      writeJson(PRICE_HISTORY_FILE, priceHistoryStore);

      const alertStore = sanitizePriceAlertStore(readJson(PRICE_ALERTS_FILE, {}));
      const notificationStore = sanitizeNotificationStore(readJson(NOTIFICATIONS_FILE, {}));
      const usernameList = Object.keys(alertStore);
      for (const username of usernameList) {
        const alerts = Array.isArray(alertStore[username]) ? alertStore[username] : [];
        const matchingAlerts = alerts.filter((alert) => alert && alert.enabled && alert.gameId === snapshot.gameId && alert.currency === snapshot.currency);
        for (const alert of matchingAlerts) {
          if (snapshot.price < alert.targetPrice) {
            const existingNotifications = Array.isArray(notificationStore[username]) ? notificationStore[username] : [];
            const hasNotification = existingNotifications.some((entry) => entry && entry.gameId === snapshot.gameId && entry.targetPrice === alert.targetPrice && entry.currency === alert.currency);
            if (!hasNotification) {
              const notification = {
                id: `notification-${crypto.randomBytes(6).toString('hex')}`,
                type: 'price_alert',
                gameId: snapshot.gameId,
                title: 'Price alert triggered',
                message: `Price fell to ${snapshot.currency} ${Number(snapshot.price || 0).toFixed(2)} for ${snapshot.gameId}.`,
                read: false,
                createdAt: new Date().toISOString(),
                targetPrice: alert.targetPrice,
                currency: alert.currency,
                observedPrice: snapshot.price
              };
              existingNotifications.unshift(notification);
              notificationStore[username] = existingNotifications.slice(0, 50);
            }
          }
        }
      }
      writeJson(NOTIFICATIONS_FILE, notificationStore);
      return respond(201, { ok: true, created: true, snapshot });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/catalog\/[^/]+\/price-history$/)) {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const match = url.pathname.match(/^\/api\/catalog\/([^/]+)\/price-history$/);
    if (!match) {
      return respond(404, { error: 'Not found' });
    }

    const gameId = decodeURIComponent(match[1]);
    const store = sanitizePriceHistoryStore(readJson(PRICE_HISTORY_FILE, {}));
    const historyEntries = Array.isArray(store[gameId]) ? store[gameId] : [];
    return respond(200, buildPriceHistorySummary(gameId, historyEntries));
  }

  if (req.method === 'POST' && url.pathname === '/api/feedback') {
    try {
      const body = await parseBody(req);
      const category = String(body.category || 'other').trim().slice(0, 40);
      const email = String(body.email || '').trim().slice(0, 160);
      const summary = String(body.summary || '').trim().slice(0, 140);
      const details = String(body.details || '').trim().slice(0, 4000);
      const device = String(body.device || '').trim().slice(0, 180);
      const page = String(body.page || '').trim().slice(0, 180);
      const appUrl = String(body.appUrl || '').trim().slice(0, 500);
      const allowedCategories = new Set(['bug', 'installation', 'feature', 'design', 'other']);
      if (!allowedCategories.has(category) || summary.length < 4 || details.length < 10) {
        return respond(400, { error: 'Please provide a valid category, summary, and description.' });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return respond(400, { error: 'Please enter a valid follow-up email or leave it blank.' });
      }
      const feedback = readJson(FEEDBACK_FILE, []);
      const record = {
        id: `feedback-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        createdAt: new Date().toISOString(),
        status: 'new',
        category,
        email,
        summary,
        details,
        device,
        page,
        appUrl,
        requestId
      };
      const next = Array.isArray(feedback) ? feedback.slice(-999) : [];
      next.push(record);
      writeJson(FEEDBACK_FILE, next);
      return respond(201, { ok: true, reference: record.id });
    } catch (error) {
      if (error && error.code === 'BODY_TOO_LARGE') return respond(413, { error: 'Feedback is too large.' });
      throw error;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/releases/status') {
    const releases = await getDailyReleaseFeed(false);
    const articles = readJson(RELEASE_ARTICLE_CACHE_FILE, {});
    const releaseUpdatedAt = Date.parse(releases.updatedAt || '');
    const articleUpdatedAt = Date.parse(articles.updatedAt || '');
    return respond(200, {
      generatedAt: new Date().toISOString(),
      releases: {
        sourceLabel: releases.sourceLabel || 'Public Steam Store data',
        sourceType: releases.sourceType || 'public-structured-endpoint',
        verifiedProviderApi: releases.verifiedProviderApi === true,
        updatedAt: releases.updatedAt || null,
        stale: !Number.isFinite(releaseUpdatedAt) || Date.now() - releaseUpdatedAt > RELEASE_CACHE_TTL_MS,
        itemCount: Array.isArray(releases.items) ? releases.items.length : 0,
        hardDateCount: Array.isArray(releases.items) ? releases.items.filter((item) => item?.hardDate && Number.isFinite(Number(item.releaseTimestamp))).length : 0,
        disclosure: releases.disclosure || null
      },
      coverage: {
        sourceType: articles.sourceType || 'public-rss-aggregation',
        verifiedProviderApi: articles.verifiedProviderApi === true,
        updatedAt: articles.updatedAt || null,
        stale: !Number.isFinite(articleUpdatedAt) || Date.now() - articleUpdatedAt > RELEASE_ARTICLE_CACHE_TTL_MS,
        itemCount: Array.isArray(articles.items) ? articles.items.length : 0,
        windowDays: Number(articles.windowDays || 7),
        disclosure: articles.disclosure || 'Coverage links are attributed to their publishers.'
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/releases') {
    try {
      const releases = await getDailyReleaseFeed(url.searchParams.get('refresh') === '1');
      return respond(200, releases);
    } catch (error) {
      return respond(200, {
        updatedAt: new Date().toISOString(),
        hardDatesOnly: true,
        sort: 'soonest-first',
        sourceLabel: 'Public Steam Store data',
        degraded: true,
        error: 'Release data is temporarily unavailable.',
        items: []
      });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/release-articles') {
    try {
      const articles = await getWeeklyReleaseArticles(url.searchParams.get('refresh') === '1');
      return respond(200, articles);
    } catch {
      return respond(200, { updatedAt: new Date().toISOString(), windowDays: 7, items: [] });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    const searchTerm = (url.searchParams.get('search') || '').toLowerCase();
    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const usernames = Object.keys(users);
    const filtered = !searchTerm
      ? usernames
      : usernames.filter((username) => username.toLowerCase().includes(searchTerm));
    const publicHandles = filtered.map((username) => {
      const userRecord = ensureUserPublicIdentity(users, username);
      const publicUser = serializePublicUser(userRecord);
      return publicUser ? publicUser.handle : createPublicHandle(username);
    });
    return respond(200, publicHandles);
  }

  if (req.method === 'GET' && url.pathname === '/api/profile-settings') {
    const username = ensureAuthenticated(req, res);
    if (!username) { return; }
    if (!ensureEmailVerified(username, res)) { return; }
    const profiles = readJson(PROFILES_FILE, {});
    return respond(200, { profile: sanitizeProfileDetails(profiles[username] || {}) });
  }

  if (req.method === 'POST' && url.pathname === '/api/profile-settings') {
    const username = ensureAuthenticated(req, res);
    if (!username) { return; }
    if (!ensureEmailVerified(username, res)) { return; }
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      return respond(400, { error: error.message || 'Invalid profile data.' });
    }
    const profiles = readJson(PROFILES_FILE, {});
    const profile = sanitizeProfileDetails(body);
    profiles[username] = profile;
    writeJson(PROFILES_FILE, profiles);
    return respond(200, { profile });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/profile/')) {
    const sessionToken = getTokenFromRequest(req);
    const username = sessionToken ? getUserByToken(sessionToken) : null;
    const identifier = url.pathname.replace('/api/profile/', '');
    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const ownerEmail = resolveProfileOwner(users, identifier);
    if (!ownerEmail) {
      return respond(404, { error: 'Profile not found.' });
    }
    const ownerRecord = ensureUserPublicIdentity(users, ownerEmail);
    const friendStore = sanitizeFriendStore(readJson(FRIENDS_FILE, { requests: [], friendships: [] }));
    const profileAccess = evaluateProfileAccess(ownerEmail, username, users, friendStore);
    if (!profileAccess.allowed) {
      return respond(403, { error: profileAccess.reason || 'This profile is private.' });
    }

    const libraryAccess = evaluateSectionAccess('libraryVisibility', ownerEmail, username, users, friendStore);
    const reviewsAccess = evaluateSectionAccess('reviewsVisibility', ownerEmail, username, users, friendStore);
    const activityAccess = evaluateSectionAccess('activityVisibility', ownerEmail, username, users, friendStore);

    const profiles = readJson(PROFILES_FILE, {});
    const profileDetails = sanitizeProfileDetails(profiles[ownerEmail] || {});
    const isOwner = String(username || '').trim().toLowerCase() === String(ownerEmail || '').trim().toLowerCase();
    const isFriend = username ? isUsersFriends(friendStore, ownerEmail, username) : false;
    const visiblePlatformAccounts = filterVisiblePlatformAccounts(profileDetails.platformAccounts, isOwner, isFriend);
    const libraries = sanitizeUserStore(readJson(LIBRARIES_FILE, {}));
    const libraryItems = sanitizeLibraryPayloadForProfile(libraries[ownerEmail] || []);
    const reviewItems = sanitizeReviewsPayloadForProfile(
      sanitizeLibraryPayload(libraries[ownerEmail] || []).flatMap((game) => Array.isArray(game.comments) ? game.comments : []),
      ownerEmail
    );
    const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
    const activityItems = sanitizeActivityPayload(activities[ownerEmail] || []).filter((entry) => !entry.hidden);

    return respond(200, {
      profile: {
        available: true,
        handle: ownerRecord?.publicHandle || createPublicHandle(ownerEmail),
        id: ownerRecord?.publicId || '',
        isOwner,
        displayName: profileDetails.displayName || ownerRecord?.publicHandle || createPublicHandle(ownerEmail),
        bio: profileDetails.bio,
        avatarUrl: profileDetails.avatarUrl,
        bannerUrl: profileDetails.bannerUrl,
        favoriteGames: serializeFavoriteGames(profileDetails.favoriteGameIds),
        platformAccounts: visiblePlatformAccounts
      },
      library: {
        available: libraryAccess.available,
        items: libraryAccess.available ? libraryItems : [],
        message: libraryAccess.message || null
      },
      reviews: {
        available: reviewsAccess.available,
        items: reviewsAccess.available ? reviewItems : [],
        message: reviewsAccess.message || null
      },
      activity: {
        available: activityAccess.available,
        items: activityAccess.available ? activityItems : [],
        message: activityAccess.message || null
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/friends/activity') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 10)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const currentUserRecord = ensureUserPublicIdentity(users, username);
    const friendStore = sanitizeFriendStore(readJson(FRIENDS_FILE, { requests: [], friendships: [] }));
    const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));

    const friendIds = friendStore.friendships
      .filter((entry) => [entry.userIdA, entry.userIdB].includes(currentUserRecord.publicId))
      .flatMap((entry) => [entry.userIdA, entry.userIdB])
      .filter((value) => value && value !== currentUserRecord.publicId);

    const feedItems = [];
    friendIds.forEach((friendId) => {
      const matchingUser = Object.entries(users).find(([, candidate]) => candidate && typeof candidate === 'object' && String(candidate.publicId || '').trim() === friendId);
      if (!matchingUser) {
        return;
      }

      const [ownerEmail, ownerRecord] = matchingUser;
      const ownerPrivacy = sanitizePrivacySettings(ownerRecord?.privacySettings);
      const activityAccess = evaluateSectionAccess('activityVisibility', ownerEmail, username, users, friendStore);
      if (!activityAccess.available || !ownerPrivacy.feedSharingEnabled) {
        return;
      }

      const ownerEvents = sanitizeActivityPayload(activities[ownerEmail] || []).filter((entry) => !entry.hidden);
      ownerEvents.forEach((entry) => {
        feedItems.push({
          ...entry,
          ownerEmail,
          ownerHandle: ownerRecord?.publicHandle || createPublicHandle(ownerEmail),
          ownerId: ownerRecord?.publicId || ''
        });
      });
    });

    feedItems.sort((left, right) => (right.timestamp || '').localeCompare(left.timestamp || ''));
    const page = feedItems.slice(offset, offset + limit);
    return respond(200, { items: page, hasMore: offset + page.length < feedItems.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/activity/hide') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const eventId = String(body.eventId || '').trim();
      if (!eventId) {
        return respond(400, { error: 'An event id is required' });
      }

      const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
      const currentItems = sanitizeActivityPayload(activities[username] || []);
      const updatedItems = currentItems.map((entry) => (entry.eventId === eventId ? { ...entry, hidden: true } : entry));
      if (updatedItems.length === currentItems.length && !currentItems.some((entry) => entry.eventId === eventId)) {
        return respond(404, { error: 'Event not found' });
      }

      activities[username] = updatedItems;
      writeJson(ACTIVITIES_FILE, activities);
      return respond(200, { ok: true, items: updatedItems });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/privacy') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const userRecord = ensureUserPublicIdentity(users, username);
    return respond(200, { privacySettings: sanitizePrivacySettings(userRecord?.privacySettings) });
  }

  if (req.method === 'POST' && url.pathname === '/api/privacy') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const users = sanitizeUserStore(readJson(USERS_FILE, {}));
      const userRecord = ensureUserPublicIdentity(users, username);
      userRecord.privacySettings = sanitizePrivacySettings({
        profileVisibility: body.profileVisibility,
        libraryVisibility: body.libraryVisibility,
        reviewsVisibility: body.reviewsVisibility,
        activityVisibility: body.activityVisibility,
        feedSharingEnabled: body.feedSharingEnabled
      });
      writeJson(USERS_FILE, users);
      return respond(200, { ok: true, privacySettings: sanitizePrivacySettings(userRecord.privacySettings) });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/friends/search') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const searchTerm = String(url.searchParams.get('search') || '').trim().toLowerCase();
    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const publicUsers = Object.entries(users)
      .map(([email, userRecord]) => {
        const publicUser = serializePublicUser(ensureUserPublicIdentity(users, email));
        return publicUser ? publicUser : null;
      })
      .filter(Boolean)
      .filter((entry) => entry.handle !== createPublicHandle(username))
      .filter((entry) => !searchTerm || String(entry.handle || '').toLowerCase().includes(searchTerm));

    return respond(200, { users: publicUsers });
  }

  if (req.method === 'GET' && url.pathname === '/api/friends') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const currentUserRecord = ensureUserPublicIdentity(users, username);
    const friendStore = sanitizeFriendStore(readJson(FRIENDS_FILE, { requests: [], friendships: [] }));
    const friendships = friendStore.friendships.filter((entry) => [entry.userIdA, entry.userIdB].includes(currentUserRecord.publicId));
    const friendIds = friendships.flatMap((entry) => [entry.userIdA, entry.userIdB]).filter((value) => value !== currentUserRecord.publicId);
    const friends = friendIds.map((publicId) => {
      const matchingUser = Object.values(users).find((candidate) => candidate && typeof candidate === 'object' && candidate.publicId === publicId);
      return matchingUser ? serializePublicUser(matchingUser) : null;
    }).filter(Boolean);

    return respond(200, { friends });
  }

  if (req.method === 'GET' && url.pathname === '/api/friends/requests/incoming') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const currentUserRecord = ensureUserPublicIdentity(users, username);
    const friendStore = sanitizeFriendStore(readJson(FRIENDS_FILE, { requests: [], friendships: [] }));
    const requests = friendStore.requests
      .filter((entry) => entry.targetId === currentUserRecord.publicId)
      .map((entry) => ({
        ...entry,
        requester: serializePublicUser(Object.values(users).find((candidate) => candidate && typeof candidate === 'object' && candidate.publicId === entry.requesterId)) || null
      }));

    return respond(200, { requests });
  }

  if (req.method === 'GET' && url.pathname === '/api/friends/requests/outgoing') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const currentUserRecord = ensureUserPublicIdentity(users, username);
    const friendStore = sanitizeFriendStore(readJson(FRIENDS_FILE, { requests: [], friendships: [] }));
    const requests = friendStore.requests
      .filter((entry) => entry.requesterId === currentUserRecord.publicId)
      .map((entry) => ({
        ...entry,
        target: serializePublicUser(Object.values(users).find((candidate) => candidate && typeof candidate === 'object' && candidate.publicId === entry.targetId)) || null
      }));

    return respond(200, { requests });
  }

  if (req.method === 'POST' && url.pathname === '/api/friends/requests') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const targetUserId = String(body.userId || '').trim();
      if (!targetUserId) {
        return respond(400, { error: 'A target user is required' });
      }

      const users = sanitizeUserStore(readJson(USERS_FILE, {}));
      const currentUserRecord = ensureUserPublicIdentity(users, username);
      const targetRecord = Object.values(users).find((candidate) => candidate && typeof candidate === 'object' && String(candidate.publicId || '').trim() === targetUserId);
      if (!targetRecord) {
        return respond(404, { error: 'User not found' });
      }
      if (currentUserRecord.publicId === targetRecord.publicId) {
        return respond(400, { error: 'You cannot send a friend request to yourself' });
      }

      const friendStore = sanitizeFriendStore(readJson(FRIENDS_FILE, { requests: [], friendships: [] }));
      const existingRequest = friendStore.requests.find((entry) => (entry.requesterId === currentUserRecord.publicId && entry.targetId === targetRecord.publicId) || (entry.requesterId === targetRecord.publicId && entry.targetId === currentUserRecord.publicId));
      if (existingRequest) {
        return respond(409, { error: 'Friend request already exists' });
      }

      const existingFriendship = friendStore.friendships.find((entry) => (entry.userIdA === currentUserRecord.publicId && entry.userIdB === targetRecord.publicId) || (entry.userIdA === targetRecord.publicId && entry.userIdB === currentUserRecord.publicId));
      if (existingFriendship) {
        return respond(409, { error: 'Users are already friends' });
      }

      friendStore.requests.push({
        id: `request-${crypto.randomBytes(6).toString('hex')}`,
        requesterId: currentUserRecord.publicId,
        targetId: targetRecord.publicId,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      writeJson(FRIENDS_FILE, friendStore);
      return respond(201, { ok: true, request: friendStore.requests[friendStore.requests.length - 1] });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/friends/requests/')) {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const actionMatch = url.pathname.match(/^\/api\/friends\/requests\/([^/]+)\/(accept|decline|cancel)$/);
    if (!actionMatch) {
      return respond(404, { error: 'Friend request route not found' });
    }

    const [, targetUserId, action] = actionMatch;
    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const currentUserRecord = ensureUserPublicIdentity(users, username);
    const friendStore = sanitizeFriendStore(readJson(FRIENDS_FILE, { requests: [], friendships: [] }));
    const targetUserIdValue = decodeURIComponent(targetUserId);
    const requestIndex = friendStore.requests.findIndex((entry) => {
      const involvesCurrentUser = entry.requesterId === currentUserRecord.publicId || entry.targetId === currentUserRecord.publicId;
      const involvesTargetUser = entry.requesterId === targetUserIdValue || entry.targetId === targetUserIdValue || targetUserIdValue === currentUserRecord.publicId;
      return involvesCurrentUser && involvesTargetUser;
    });

    if (requestIndex < 0) {
      return respond(404, { error: 'Friend request not found' });
    }

    const request = friendStore.requests[requestIndex];
    if (request.status !== 'pending') {
      return respond(404, { error: 'Friend request not found' });
    }

    if (action === 'cancel') {
      if (request.requesterId !== currentUserRecord.publicId) {
        return respond(403, { error: 'Forbidden' });
      }
      friendStore.requests.splice(requestIndex, 1);
      writeJson(FRIENDS_FILE, friendStore);
      return respond(200, { ok: true });
    }

    if (request.targetId !== currentUserRecord.publicId) {
      return respond(403, { error: 'Forbidden' });
    }

    if (action === 'accept') {
      const alreadyFriends = friendStore.friendships.find((entry) => (entry.userIdA === request.requesterId && entry.userIdB === request.targetId) || (entry.userIdA === request.targetId && entry.userIdB === request.requesterId));
      if (alreadyFriends) {
        friendStore.requests[requestIndex].status = 'accepted';
        writeJson(FRIENDS_FILE, friendStore);
        return respond(200, { ok: true, status: 'accepted' });
      }
      friendStore.requests[requestIndex].status = 'accepted';
      friendStore.friendships.push({
        userIdA: request.requesterId,
        userIdB: request.targetId,
        createdAt: new Date().toISOString()
      });
      writeJson(FRIENDS_FILE, friendStore);
      return respond(200, { ok: true, status: 'accepted' });
    }

    if (action === 'decline') {
      friendStore.requests[requestIndex].status = 'declined';
      writeJson(FRIENDS_FILE, friendStore);
      return respond(200, { ok: true, status: 'declined' });
    }

    return respond(400, { error: 'Unsupported action' });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/friends/')) {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const friendUserId = decodeURIComponent(url.pathname.replace('/api/friends/', ''));
    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    const currentUserRecord = ensureUserPublicIdentity(users, username);
    const friendStore = sanitizeFriendStore(readJson(FRIENDS_FILE, { requests: [], friendships: [] }));
    const nextFriendships = friendStore.friendships.filter((entry) => !((entry.userIdA === currentUserRecord.publicId && entry.userIdB === friendUserId) || (entry.userIdA === friendUserId && entry.userIdB === currentUserRecord.publicId)));
    if (nextFriendships.length === friendStore.friendships.length) {
      return respond(404, { error: 'Friendship not found' });
    }

    friendStore.friendships = nextFriendships;
    writeJson(FRIENDS_FILE, friendStore);
    return respond(200, { ok: true });
  }


  if (req.method === 'GET' && url.pathname === '/api/usernames/availability') {
    const username = normalizeUsername(url.searchParams.get('username'));
    const users = sanitizeUserStore(readJson(USERS_FILE, {}));
    return respond(200, { username, valid: isValidUsername(username), available: isUsernameAvailable(users, username) });
  }

  if (req.method === 'POST' && (url.pathname === '/api/register' || url.pathname === '/api/login')) {
    const clientKey = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!RATE_LIMIT_BYPASS && isRateLimited(clientKey)) {
      return respond(429, { error: 'Too many requests' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/register') {
    try {
      const body = await parseBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '').trim();
      const suppliedUsername = String(body.username || '').trim();
      let requestedUsername = normalizeUsername(suppliedUsername);

      if (!isValidEmail(email) || !password) {
        return respond(400, { error: 'A valid email address and password are required' });
      }

      const users = sanitizeUserStore(readJson(USERS_FILE, {}));
      if (!requestedUsername) {
        const legacyBase = String(email.split('@')[0] || 'player').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'player';
        requestedUsername = legacyBase;
        let suffix = 1;
        const original = requestedUsername;
        while (!isUsernameAvailable(users, requestedUsername)) {
          requestedUsername = `${original.slice(0, Math.max(3, 20 - String(suffix).length))}${suffix}`;
          suffix += 1;
        }
      }
      if (suppliedUsername && !isValidUsername(requestedUsername)) {
        return respond(400, { error: 'Choose a username with 3–20 letters, numbers, underscores, or periods' });
      }
      if (!isUsernameAvailable(users, requestedUsername)) {
        return respond(409, { error: 'Username is already taken' });
      }
      if (users[email]) {
        return respond(409, { error: 'Account already exists' });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      users[email] = {
        salt,
        passwordHash,
        publicId: createPublicUserId(),
        publicHandle: requestedUsername,
        privacySettings: sanitizePrivacySettings(),
        emailVerifiedAt: new Date().toISOString(),
        verificationCodeHash: '',
        verificationExpiresAt: 0,
        verificationLastSentAt: 0
      };
      writeJson(USERS_FILE, users);

      const libraries = sanitizeUserStore(readJson(LIBRARIES_FILE, {}));
      if (!libraries[email]) {
        libraries[email] = [];
        writeJson(LIBRARIES_FILE, libraries);
      }

      const token = createSession(email);
      return respond(201, { token, user: email, emailVerified: true, verificationRequired: false });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const body = await parseBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '').trim();

      if (!isValidEmail(email) || !password) {
        return respond(400, { error: 'A valid email address and password are required' });
      }

      const users = sanitizeUserStore(readJson(USERS_FILE, {}));
      const userRecord = users[email];
      if (!userRecord) {
        return respond(401, { error: 'Invalid credentials' });
      }

      ensureUserPublicIdentity(users, email);
      writeJson(USERS_FILE, users);

      const passwordHash = hashPassword(password, userRecord.salt);
      if (passwordHash !== userRecord.passwordHash) {
        return respond(401, { error: 'Invalid credentials' });
      }

      if (!isEmailVerified(userRecord)) {
        userRecord.emailVerifiedAt = new Date().toISOString();
        userRecord.verificationCodeHash = '';
        userRecord.verificationExpiresAt = 0;
        users[email] = userRecord;
        writeJson(USERS_FILE, users);
      }
      const token = createSession(email);
      return respond(200, { token, user: email, emailVerified: true, verificationRequired: false });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }


  if (req.method === 'POST' && (url.pathname === '/api/auth/resend-verification' || url.pathname === '/api/auth/verify-email')) {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    return respond(200, { ok: true, emailVerified: true, verificationRequired: false });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    return respond(200, { user: username, emailVerified: true, verificationRequired: false });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = getTokenFromRequest(req);
    if (token) {
      sessions.delete(token);
    }
    return respond(200, { ok: true });
  }


  if (req.method === 'GET' && url.pathname === '/api/account/export') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    const stores = {
      profile: sanitizeProfileDetails(readJson(PROFILES_FILE, {})[username] || {}),
      library: sanitizeLibraryPayload(readJson(LIBRARIES_FILE, {})[username] || []),
      wishlist: sanitizeWishlistPayload(readJson(WISHLISTS_FILE, {})[username] || []),
      queue: sanitizeQueuePayload(readJson(QUEUES_FILE, {})[username] || []),
      activities: sanitizeActivityPayload(readJson(ACTIVITIES_FILE, {})[username] || []),
      releaseInterests: readJson(RELEASE_INTERESTS_FILE, {})[username] || [],
      releaseReminders: sanitizeReleaseReminderStore(readJson(RELEASE_REMINDERS_FILE, {}))[username] || { preferences: sanitizeReleaseReminderPreferences({}), reminders: {} }
    };
    return respond(200, { exportedAt: new Date().toISOString(), account: { email: username }, data: stores });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/account') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    try {
      const body = await parseBody(req);
      if (String(body.confirmation || '') !== 'DELETE') return respond(400, { error: 'Type DELETE to confirm account removal' });
      const users = sanitizeUserStore(readJson(USERS_FILE, {}));
      delete users[username];
      writeJson(USERS_FILE, users);
      for (const file of [LIBRARIES_FILE, WISHLISTS_FILE, QUEUES_FILE, ACTIVITIES_FILE, PROFILES_FILE, RELEASE_INTERESTS_FILE, RELEASE_REMINDERS_FILE, GAME_FINDER_FILE]) {
        const store = readJson(file, {});
        if (store && typeof store === 'object' && !Array.isArray(store)) { delete store[username]; writeJson(file, store); }
      }
      const token = getTokenFromRequest(req);
      if (token) { sessions.delete(token); storage.deleteSession(token); }
      return respond(200, { ok: true, deleted: true });
    } catch (error) { return handleServerError(req, res, error, requestId); }
  }

  if (req.method === 'GET' && url.pathname === '/api/library') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const libraries = sanitizeUserStore(readJson(LIBRARIES_FILE, {}));
    return respond(200, sanitizeLibraryPayload(libraries[username] || []));
  }


  if (req.method === 'GET' && url.pathname === '/api/library/insights') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    const libraries = sanitizeUserStore(readJson(LIBRARIES_FILE, {}));
    const games = sanitizeLibraryPayload(libraries[username] || []);
    const reviewCount = games.reduce((sum, game) => sum + (Array.isArray(game.comments) ? game.comments.length : 0), 0);
    const availableMinutes = Math.min(1440, Math.max(15, Number(url.searchParams.get('minutes') || 60)));
    return respond(200, {
      stats: buildLibraryStats(games),
      franchises: buildFranchiseCollections(games),
      smartCollections: buildSmartCollections(games).map((collection) => ({ ...collection, games: collection.games.slice(0, 50) })),
      backlogPlan: buildBacklogPlan(games, availableMinutes),
      wrapped: buildGamingWrapped(games),
      milestones: buildMilestones(games, reviewCount),
      importAdapters: getImportAdapters()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/library/search') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    const libraries = sanitizeUserStore(readJson(LIBRARIES_FILE, {}));
    const games = sanitizeLibraryPayload(libraries[username] || []);
    const items = searchLibrary(games, {
      query: url.searchParams.get('q') || '',
      status: url.searchParams.get('status') || 'All',
      platform: url.searchParams.get('platform') || 'All',
      mediaType: url.searchParams.get('mediaType') || 'All',
      ownershipStatus: url.searchParams.get('ownershipStatus') || 'All',
      favorite: url.searchParams.get('favorite') === 'true'
    });
    return respond(200, { items: items.slice(0, 500), total: items.length });
  }

  if (req.method === 'GET' && url.pathname === '/api/library/import-adapters') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    return respond(200, { adapters: getImportAdapters() });
  }

  if (req.method === 'GET' && url.pathname === '/api/activity') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 10)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
    const items = sanitizeActivityPayload(activities[username] || [])
      .sort((left, right) => (right.timestamp || '').localeCompare(left.timestamp || ''));
    const page = items.slice(offset, offset + limit);
    return respond(200, { items: page, hasMore: offset + page.length < items.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/activity') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const activityEvent = normalizeActivityEventPayload(body);
      if (!activityEvent) {
        return respond(400, { error: 'Activity event is invalid' });
      }

      const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
      const nextItems = appendActivityEvent(activities, username, activityEvent);
      writeJson(ACTIVITIES_FILE, activities);
      return respond(200, { ok: true, item: nextItems[0] || activityEvent, items: nextItems });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'DELETE' && url.pathname === '/api/activity') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
    activities[username] = [];
    writeJson(ACTIVITIES_FILE, activities);
    return respond(200, { ok: true, items: [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/library') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const libraries = sanitizeUserStore(readJson(LIBRARIES_FILE, {}));
      const nextLibraryGames = sanitizeLibraryPayload(Array.isArray(body.games) ? body.games : []);
      libraries[username] = nextLibraryGames;
      writeJson(LIBRARIES_FILE, libraries);

      const activityEvent = normalizeActivityEventPayload({ ...body, type: body.type || 'added_game' });
      if (activityEvent) {
        const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
        appendActivityEvent(activities, username, activityEvent);
        writeJson(ACTIVITIES_FILE, activities);
      }

      const queues = sanitizeQueueStore(readJson(QUEUES_FILE, {}));
      const libraryIds = new Set(nextLibraryGames.map((game) => game.id).filter(Boolean));
      const existingEntries = sanitizeQueuePayload(queues[username] || []);
      const nextQueueEntries = existingEntries.filter((entry) => libraryIds.has(entry.gameId));
      if (nextQueueEntries.length !== existingEntries.length) {
        queues[username] = nextQueueEntries;
        writeJson(QUEUES_FILE, queues);
      }

      return respond(200, { ok: true, games: libraries[username] });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/reviews') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const libraries = sanitizeUserStore(readJson(LIBRARIES_FILE, {}));
      const targetGames = sanitizeLibraryPayload(libraries[username] || []);
      const targetGame = targetGames.find((game) => game.id === body.gameId);
      if (!targetGame) {
        return respond(404, { error: 'Game not found in library' });
      }

      targetGame.comments = Array.isArray(targetGame.comments) ? targetGame.comments : [];
      targetGame.comments.push({
        author: username,
        text: String(body.text || '').trim(),
        rating: Number(body.rating || 0)
      });

      libraries[username] = targetGames;
      writeJson(LIBRARIES_FILE, libraries);

      const activityEvent = normalizeActivityEventPayload({ ...body, type: body.type || 'posted_review' });
      if (activityEvent) {
        const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
        appendActivityEvent(activities, username, activityEvent);
        writeJson(ACTIVITIES_FILE, activities);
      }
      return respond(200, { ok: true, game: targetGame });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }


  if (req.method === 'GET' && url.pathname === '/api/discovery/home') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    try {
      const catalogValue = readJson(CATALOG_FILE, defaultCatalog);
      const catalog = Array.isArray(catalogValue) ? catalogValue : defaultCatalog;
      const profiles = readJson(PROFILES_FILE, {});
      const finderStore = readJson(GAME_FINDER_FILE, {});
      const userData = {
        library: sanitizeLibraryPayload(readJson(LIBRARIES_FILE, {})[username] || []),
        wishlist: sanitizeWishlistPayload(readJson(WISHLISTS_FILE, {})[username] || []),
        favoriteGameIds: Array.isArray(profiles[username]?.favoriteGameIds) ? profiles[username].favoriteGameIds : [],
        decisions: Array.isArray(finderStore[username]?.decisions) ? finderStore[username].decisions : [],
        preferences: finderStore[username]?.preferences || {}
      };
      const recommendations = buildRecommendations(catalog, userData, { limit: 12, cursor: 0 });
      const releases = (await getReleaseFeed()).items.slice(0, 8);
      return respond(200, { recommendations: recommendations.items, profile: recommendations.profile, releases, generatedAt: new Date().toISOString() });
    } catch (error) { return handleServerError(req, res, error, requestId); }
  }

  if (req.method === 'GET' && url.pathname === '/api/discovery/hubs') {
    const catalogValue = readJson(CATALOG_FILE, defaultCatalog);
    const catalog = Array.isArray(catalogValue) ? catalogValue : defaultCatalog;
    const summarize = (field, splitter) => {
      const counts = new Map();
      for (const game of catalog) for (const raw of splitter(game[field])) { const key=String(raw||'').trim(); if(key) counts.set(key,(counts.get(key)||0)+1); }
      return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,24).map(([name,count])=>({name,count}));
    };
    return respond(200,{genres:summarize('genre',(v)=>String(v||'').split(/[,/|;]/)),platforms:summarize('platform',(v)=>[v]),generatedAt:new Date().toISOString()});
  }

  if (req.method === 'GET' && url.pathname === '/api/discovery/collections') {
    const catalogValue = readJson(CATALOG_FILE, defaultCatalog);
    const catalog = Array.isArray(catalogValue) ? catalogValue : defaultCatalog;
    const unique=(items)=>{const seen=new Set();return items.filter(g=>{const k=String(g.name||g.title||'').toLowerCase();if(!k||seen.has(k))return false;seen.add(k);return true;}).slice(0,12)};
    const collections=[
      {id:'top-rated',title:'Top Rated',description:'Critically acclaimed titles',items:unique([...catalog].sort((a,b)=>Number(b.metacriticScore||0)-Number(a.metacriticScore||0)))},
      {id:'hidden-gems',title:'Hidden Gems',description:'Strong ratings with lower sales visibility',items:unique(catalog.filter(g=>Number(g.metacriticScore||0)>=75&&Number(g.globalSales||0)<2).sort((a,b)=>Number(b.metacriticScore||0)-Number(a.metacriticScore||0)))},
      {id:'rpg-essentials',title:'RPG Essentials',description:'Role-playing favorites across platforms',items:unique(catalog.filter(g=>/rpg|role-playing/i.test(String(g.genre||''))).sort((a,b)=>Number(b.metacriticScore||0)-Number(a.metacriticScore||0)))},
      {id:'local-multiplayer',title:'Play Together',description:'Multiplayer and party picks',items:unique(catalog.filter(g=>/party|multiplayer|sports|racing/i.test(String(g.genre||''))).sort((a,b)=>Number(b.globalSales||0)-Number(a.globalSales||0)))}
    ];
    return respond(200,{collections,generatedAt:new Date().toISOString()});
  }

  if (req.method === 'GET' && url.pathname === '/api/discovery/recommendations') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    try {
      const catalogValue = readJson(CATALOG_FILE, defaultCatalog);
      const catalog = Array.isArray(catalogValue) ? catalogValue : defaultCatalog;
      const profiles = readJson(PROFILES_FILE, {});
      const finderStore = readJson(GAME_FINDER_FILE, {});
      const result = buildRecommendations(catalog, {
        library: sanitizeLibraryPayload(readJson(LIBRARIES_FILE, {})[username] || []),
        wishlist: sanitizeWishlistPayload(readJson(WISHLISTS_FILE, {})[username] || []),
        favoriteGameIds: Array.isArray(profiles[username]?.favoriteGameIds) ? profiles[username].favoriteGameIds : [],
        decisions: Array.isArray(finderStore[username]?.decisions) ? finderStore[username].decisions : [],
        preferences: finderStore[username]?.preferences && typeof finderStore[username].preferences === 'object' ? finderStore[username].preferences : {}
      }, {
        limit: Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20))),
        cursor: Math.max(0, Number(url.searchParams.get('cursor') || 0)),
        platform: url.searchParams.get('platform') || '',
        genre: url.searchParams.get('genre') || '',
        excludeWishlist: url.searchParams.get('includeWishlist') !== '1'
      });
      return respond(200, {
        ...result,
        generatedAt: new Date().toISOString(),
        algorithm: 'project-sora-explainable-v1'
      });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/game-finder') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    const store = readJson(GAME_FINDER_FILE, {});
    const state = store[username] && typeof store[username] === 'object' ? store[username] : { decisions: [] };
    return respond(200, { decisions: Array.isArray(state.decisions) ? state.decisions.slice(-1000) : [], preferences: state.preferences && typeof state.preferences === 'object' ? state.preferences : {} });
  }


  if (req.method === 'PUT' && url.pathname === '/api/game-finder/preferences') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    try {
      const body = await parseBody(req);
      const cleanList = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))].slice(0, 40);
      const preferences = {
        mutedGenres: cleanList(body.mutedGenres),
        mutedPlatforms: cleanList(body.mutedPlatforms),
        diversityLevel: Math.max(0, Math.min(100, Number(body.diversityLevel ?? 20)))
      };
      const store = readJson(GAME_FINDER_FILE, {});
      const current = store[username] && typeof store[username] === 'object' ? store[username] : { decisions: [] };
      store[username] = { ...current, preferences, updatedAt: new Date().toISOString() };
      writeJson(GAME_FINDER_FILE, store);
      return respond(200, { ok: true, preferences });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/game-finder/decision') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    try {
      const body = await parseBody(req);
      const action = ['pass', 'like', 'strong'].includes(body.action) ? body.action : null;
      const gameId = String(body.gameId || '').trim().slice(0, 160);
      const title = String(body.title || '').trim().slice(0, 180);
      if (!action || !gameId || !title) return respond(400, { error: 'A valid game and decision are required' });
      const record = {
        gameId,
        title,
        platform: String(body.platform || '').trim().slice(0, 80),
        image: sanitizeProfileImageUrl(body.image),
        action,
        timestamp: new Date().toISOString(),
        score: Math.max(0, Math.min(1000, Number(body.score || 0)))
      };
      const store = readJson(GAME_FINDER_FILE, {});
      const current = store[username] && typeof store[username] === 'object' ? store[username] : { decisions: [] };
      const decisions = Array.isArray(current.decisions) ? current.decisions : [];
      const withoutExisting = decisions.filter((entry) => String(entry.gameId) !== gameId);
      store[username] = { decisions: [...withoutExisting, record].slice(-1000), updatedAt: new Date().toISOString() };
      writeJson(GAME_FINDER_FILE, store);
      return respond(200, { ok: true, decision: record });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'DELETE' && url.pathname === '/api/game-finder') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    const store = readJson(GAME_FINDER_FILE, {});
    delete store[username];
    writeJson(GAME_FINDER_FILE, store);
    return respond(200, { ok: true });
  }


  if (req.method === 'GET' && url.pathname === '/api/release-reminders') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    const store = sanitizeReleaseReminderStore(readJson(RELEASE_REMINDERS_FILE, {}));
    return respond(200, store[username] || { preferences: sanitizeReleaseReminderPreferences({}), reminders: {} });
  }

  if (req.method === 'PUT' && url.pathname === '/api/release-reminders') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    try {
      const body = await parseBody(req);
      const store = sanitizeReleaseReminderStore(readJson(RELEASE_REMINDERS_FILE, {}));
      const current = store[username] || { preferences: sanitizeReleaseReminderPreferences({}), reminders: {} };
      const next = {
        preferences: sanitizeReleaseReminderPreferences(body?.preferences || current.preferences),
        reminders: current.reminders || {}
      };
      if (body?.reminder && typeof body.reminder === 'object') {
        const id = String(body.reminder.id || '').trim().slice(0, 160);
        if (!id) return respond(400, { error: 'A release ID is required' });
        next.reminders[id] = {
          id,
          title: String(body.reminder.title || '').trim().slice(0, 240),
          releaseDate: String(body.reminder.releaseDate || '').slice(0, 40),
          offsetDays: [0,1,3,7,14,30].includes(Number(body.reminder.offsetDays)) ? Number(body.reminder.offsetDays) : 1,
          enabled: body.reminder.enabled !== false,
          createdAt: String(body.reminder.createdAt || new Date().toISOString()).slice(0, 40)
        };
      }
      if (body?.removeId) delete next.reminders[String(body.removeId)];
      store[username] = next;
      writeJson(RELEASE_REMINDERS_FILE, store);
      return respond(200, { ok: true, ...next });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/release-interests') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    const store = readJson(RELEASE_INTERESTS_FILE, {});
    const items = store[username] && typeof store[username] === 'object' ? store[username] : {};
    return respond(200, { items });
  }

  if (req.method === 'PUT' && url.pathname === '/api/release-interests') {
    const username = ensureAuthenticated(req, res);
    if (!username) return;
    try {
      const body = await parseBody(req);
      const raw = body?.items && typeof body.items === 'object' ? body.items : {};
      const items = {};
      for (const [id, entry] of Object.entries(raw).slice(0, 1000)) {
        const safeId = String(id || '').trim().slice(0, 160);
        if (!safeId) continue;
        items[safeId] = {
          id: safeId,
          title: String(entry?.title || '').trim().slice(0, 240),
          markedAt: String(entry?.markedAt || new Date().toISOString()).slice(0, 40)
        };
      }
      const store = readJson(RELEASE_INTERESTS_FILE, {});
      store[username] = items;
      writeJson(RELEASE_INTERESTS_FILE, store);
      return respond(200, { ok: true, items });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/wishlist') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const wishlists = sanitizeWishlistStore(readJson(WISHLISTS_FILE, {}));
    return respond(200, { items: sanitizeWishlistPayload(wishlists[username] || []) });
  }

  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const notificationStore = sanitizeNotificationStore(readJson(NOTIFICATIONS_FILE, {}));
    return respond(200, { items: Array.isArray(notificationStore[username]) ? notificationStore[username] : [] });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/notifications') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const notificationStore = sanitizeNotificationStore(readJson(NOTIFICATIONS_FILE, {}));
      const notifications = Array.isArray(notificationStore[username]) ? notificationStore[username] : [];
      const targetNotification = notifications.find((entry) => entry.id === String(body.id || ''));
      if (!targetNotification) {
        return respond(404, { error: 'Notification not found' });
      }
      targetNotification.read = Boolean(body.read ?? targetNotification.read);
      notificationStore[username] = notifications;
      writeJson(NOTIFICATIONS_FILE, notificationStore);
      return respond(200, { ok: true, notification: targetNotification });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/wishlist/alerts') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const alertStore = sanitizePriceAlertStore(readJson(PRICE_ALERTS_FILE, {}));
    return respond(200, { alerts: Array.isArray(alertStore[username]) ? alertStore[username] : [] });
  }

  if (req.method === 'POST' && url.pathname === '/api/wishlist/alerts') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const alert = sanitizePriceAlert({ ...body, enabled: body.enabled !== undefined ? body.enabled : true });
      if (!alert) {
        return respond(400, { error: 'Price alert is invalid' });
      }

      const alertStore = sanitizePriceAlertStore(readJson(PRICE_ALERTS_FILE, {}));
      const existingAlerts = Array.isArray(alertStore[username]) ? alertStore[username] : [];
      const existingIndex = existingAlerts.findIndex((entry) => entry.gameId === alert.gameId);
      if (existingIndex >= 0) {
        const nextAlert = { ...existingAlerts[existingIndex], ...alert, createdAt: existingAlerts[existingIndex].createdAt };
        existingAlerts[existingIndex] = nextAlert;
        alertStore[username] = existingAlerts;
        writeJson(PRICE_ALERTS_FILE, alertStore);
        return respond(200, { ok: true, alert: nextAlert });
      }

      const nextAlert = { ...alert, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      existingAlerts.push(nextAlert);
      alertStore[username] = existingAlerts;
      writeJson(PRICE_ALERTS_FILE, alertStore);
      return respond(201, { ok: true, alert: nextAlert });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'PATCH' && url.pathname === '/api/wishlist/alerts') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const alert = sanitizePriceAlert({ ...body, enabled: body.enabled !== undefined ? body.enabled : true });
      if (!alert) {
        return respond(400, { error: 'Price alert is invalid' });
      }

      const alertStore = sanitizePriceAlertStore(readJson(PRICE_ALERTS_FILE, {}));
      const existingAlerts = Array.isArray(alertStore[username]) ? alertStore[username] : [];
      const existingIndex = existingAlerts.findIndex((entry) => entry.gameId === alert.gameId);
      if (existingIndex < 0) {
        return respond(404, { error: 'Alert not found' });
      }

      const nextAlert = { ...existingAlerts[existingIndex], ...alert, createdAt: existingAlerts[existingIndex].createdAt, updatedAt: new Date().toISOString() };
      existingAlerts[existingIndex] = nextAlert;
      alertStore[username] = existingAlerts;
      writeJson(PRICE_ALERTS_FILE, alertStore);
      return respond(200, { ok: true, alert: nextAlert });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'DELETE' && url.pathname === '/api/wishlist/alerts') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const alertStore = sanitizePriceAlertStore(readJson(PRICE_ALERTS_FILE, {}));
      const existingAlerts = Array.isArray(alertStore[username]) ? alertStore[username] : [];
      const nextAlerts = existingAlerts.filter((entry) => entry.gameId !== String(body.gameId || '').trim());
      if (nextAlerts.length === existingAlerts.length) {
        return respond(404, { error: 'Alert not found' });
      }
      alertStore[username] = nextAlerts;
      writeJson(PRICE_ALERTS_FILE, alertStore);
      return respond(200, { ok: true, deleted: true });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/wishlist') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const wishlists = sanitizeWishlistStore(readJson(WISHLISTS_FILE, {}));
      const nextEntry = sanitizeWishlistEntry(body, body.title || body.name || '');
      if (!nextEntry) {
        return respond(400, { error: 'Wishlist entry is invalid' });
      }

      const existingEntries = sanitizeWishlistPayload(wishlists[username] || []);
      const existingIndex = existingEntries.findIndex((entry) => entry.gameId === nextEntry.gameId);
      if (existingIndex >= 0) {
        const mergedEntries = existingEntries.slice();
        mergedEntries[existingIndex] = {
          ...mergedEntries[existingIndex],
          ...nextEntry,
          addedAt: mergedEntries[existingIndex].addedAt || nextEntry.addedAt
        };
        wishlists[username] = mergedEntries;
        writeJson(WISHLISTS_FILE, wishlists);
        return respond(200, { ok: true, items: mergedEntries });
      }

      const updatedEntries = [...existingEntries, nextEntry];
      wishlists[username] = updatedEntries;
      writeJson(WISHLISTS_FILE, wishlists);

      const activityEvent = normalizeActivityEventPayload({ ...body, type: body.type || 'added_wishlist_item' });
      if (activityEvent) {
        const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
        appendActivityEvent(activities, username, activityEvent);
        writeJson(ACTIVITIES_FILE, activities);
      }
      return respond(200, { ok: true, items: updatedEntries });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/wishlist/')) {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const gameId = decodeURIComponent(url.pathname.replace('/api/wishlist/', ''));
    const wishlists = sanitizeWishlistStore(readJson(WISHLISTS_FILE, {}));
    const existingEntries = sanitizeWishlistPayload(wishlists[username] || []);
    const nextEntries = existingEntries.filter((entry) => entry.gameId !== gameId);
    wishlists[username] = nextEntries;
    writeJson(WISHLISTS_FILE, wishlists);

    let activityEvent = null;
    try {
      const body = await parseBody(req);
      activityEvent = normalizeActivityEventPayload({ ...body, type: body.type || 'removed_wishlist_item' });
    } catch {
      activityEvent = null;
    }

    if (activityEvent) {
      const activities = sanitizeActivityStore(readJson(ACTIVITIES_FILE, {}));
      appendActivityEvent(activities, username, activityEvent);
      writeJson(ACTIVITIES_FILE, activities);
    }
    return respond(200, { ok: true, items: nextEntries });
  }

  if (req.method === 'GET' && url.pathname === '/api/queue') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    const queues = sanitizeQueueStore(readJson(QUEUES_FILE, {}));
    return respond(200, { items: sanitizeQueuePayload(queues[username] || []) });
  }

  if (req.method === 'POST' && url.pathname === '/api/queue') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const queues = sanitizeQueueStore(readJson(QUEUES_FILE, {}));
      const nextEntry = sanitizeQueueEntry(body, body.title || body.name || '');
      if (!nextEntry) {
        return respond(400, { error: 'Queue entry is invalid' });
      }

      const existingEntries = sanitizeQueuePayload(queues[username] || []);
      const existingIndex = existingEntries.findIndex((entry) => entry.gameId === nextEntry.gameId);
      if (existingIndex >= 0) {
        const mergedEntries = existingEntries.slice();
        mergedEntries[existingIndex] = {
          ...mergedEntries[existingIndex],
          ...nextEntry,
          addedAt: mergedEntries[existingIndex].addedAt || nextEntry.addedAt
        };
        queues[username] = mergedEntries;
        writeJson(QUEUES_FILE, queues);
        return respond(200, { ok: true, items: mergedEntries });
      }

      const updatedEntries = [...existingEntries, nextEntry];
      queues[username] = updatedEntries;
      writeJson(QUEUES_FILE, queues);
      return respond(200, { ok: true, items: updatedEntries });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/queue/move') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const queues = sanitizeQueueStore(readJson(QUEUES_FILE, {}));
      const entries = sanitizeQueuePayload(queues[username] || []);
      const index = entries.findIndex((entry) => entry.gameId === body.gameId);
      if (index < 0) {
        return respond(404, { error: 'Queue entry not found' });
      }

      const targetIndex = body.direction === 'up' ? index + 1 : index - 1;
      if (targetIndex < 0 || targetIndex >= entries.length) {
        return respond(200, { ok: true, items: entries });
      }

      const nextEntries = entries.slice();
      [nextEntries[index], nextEntries[targetIndex]] = [nextEntries[targetIndex], nextEntries[index]];
      queues[username] = nextEntries;
      writeJson(QUEUES_FILE, queues);
      return respond(200, { ok: true, items: nextEntries });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/queue/action') {
    const username = ensureAuthenticated(req, res);
    if (!username) {
      return;
    }

    try {
      const body = await parseBody(req);
      const queues = sanitizeQueueStore(readJson(QUEUES_FILE, {}));
      const entries = sanitizeQueuePayload(queues[username] || []);
      const index = entries.findIndex((entry) => entry.gameId === body.gameId);
      if (index < 0) {
        return respond(404, { error: 'Queue entry not found' });
      }

      const libraries = sanitizeUserStore(readJson(LIBRARIES_FILE, {}));
      const libraryGames = sanitizeLibraryPayload(libraries[username] || []);
      const targetGame = libraryGames.find((game) => game.id === body.gameId);
      if (targetGame) {
        if (body.action === 'start') {
          targetGame.status = 'Playing';
          targetGame.completedAt = null;
        }
        if (body.action === 'finish') {
          targetGame.status = 'Completed';
          targetGame.completedAt = targetGame.completedAt || new Date().toISOString();
        }
        libraries[username] = libraryGames;
        writeJson(LIBRARIES_FILE, libraries);
      }

      if (body.action === 'remove' || body.action === 'skip') {
        const nextEntries = entries.filter((entry) => entry.gameId !== body.gameId);
        queues[username] = nextEntries;
        writeJson(QUEUES_FILE, queues);
        return respond(200, { ok: true, items: nextEntries });
      }

      return respond(200, { ok: true, items: entries });
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  }

  return serveStaticFile(req, res);
    } catch (error) {
      return handleServerError(req, res, error, requestId);
    }
  });
}

function getServerPort() {
  return Number(process.env.PORT || DEFAULT_PORT);
}

function getServerHost() {
  return process.env.HOST || process.env.BIND_HOST || DEFAULT_HOST;
}

function startServer(port) {
  const server = createServer();
  const shutdown = createShutdownController(server, {
    exit: (code) => {
      process.exitCode = code;
    }
  });

  server.removeAllListeners('error');
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Trying ${nextPort} instead.`);
      startServer(nextPort);
      return;
    }

    console.error('Server startup error:', error);
    process.exitCode = 1;
  });

  const host = getServerHost();
  const resolvedPort = Number(port || getServerPort());
  server.listen(resolvedPort, host, () => {
    console.log(`Project Sora backend listening at http://${host}:${resolvedPort}`);
  });

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

function runOperationalCommand(argv = process.argv.slice(2)) {
  const [command, backupPath] = argv;
  if (command === '--backup') {
    const backupDir = storage.createDataBackup({ keepCount: Number(process.env.PROJECT_SORA_MAX_BACKUPS || 5) });
    console.log(JSON.stringify({ ok: true, backupDir }));
    return;
  }

  if (command === '--validate-backup') {
    const validation = storage.validateBackup(backupPath);
    console.log(JSON.stringify(validation));
    return;
  }

  if (command === '--help') {
    console.log('Usage: node server.js [--backup|--validate-backup <path>]');
    return;
  }

  startServer(getServerPort());
}

if (require.main === module) {
  runOperationalCommand();
}

module.exports = {
  createServer,
  getServerPort,
  getServerHost,
  mergeWishlistEntries,
  sanitizeQueueEntry,
  sanitizeQueuePayload,
  sanitizeQueueStore,
  sanitizeWishlistEntry,
  sanitizeWishlistPayload,
  sanitizeWishlistStore,
  redactForLogging,
  handleServerError,
  createShutdownController,
  startServer,
  getRequestId
};
