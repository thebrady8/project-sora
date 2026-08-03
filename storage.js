const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ROOT = __dirname;
const DATA_DIR = process.env.GAMEVAULT_DATA_DIR ? path.resolve(process.env.GAMEVAULT_DATA_DIR) : path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'project-sora.sqlite');
const PERSISTENCE_MODE = String(process.env.GAMEVAULT_PERSISTENCE || 'SQLITE').toUpperCase();
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

let database = null;
let initialized = false;
let persistenceMode = PERSISTENCE_MODE;

function ensureDataDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function closeDatabase() {
  if (database) {
    database.close();
  }
  database = null;
  initialized = false;
}

function getPersistenceMode() {
  return persistenceMode;
}

function listBackupDirectories() {
  ensureDataDirectory();
  return fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^(backup|json-backup)-/.test(entry.name))
    .map((entry) => path.join(DATA_DIR, entry.name))
    .sort((left, right) => fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs);
}

function pruneBackupDirectories(keepCount) {
  const directories = listBackupDirectories();
  while (directories.length > keepCount) {
    const oldest = directories.shift();
    if (oldest && fs.existsSync(oldest)) {
      fs.rmSync(oldest, { recursive: true, force: true });
    }
  }
}

function createDataBackup(options = {}) {
  ensureDataDirectory();
  const keepCount = Number(options.keepCount ?? process.env.PROJECT_SORA_MAX_BACKUPS ?? 5) || 5;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(DATA_DIR, `backup-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const filesToCopy = ['users.json', 'libraries.json', 'wishlists.json', 'queues.json', 'activities.json', 'friends.json', 'catalog.json', 'price-history.json', 'price-alerts.json', 'notifications.json'];
  const copiedFiles = [];
  filesToCopy.forEach((fileName) => {
    const sourcePath = path.join(DATA_DIR, fileName);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(backupDir, fileName));
      copiedFiles.push(fileName);
    }
  });

  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, path.join(backupDir, 'project-sora.sqlite'));
    copiedFiles.push('project-sora.sqlite');
  }

  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
    createdAt: new Date().toISOString(),
    persistenceMode,
    files: copiedFiles
  }, null, 2));

  pruneBackupDirectories(keepCount);
  return backupDir;
}

function validateBackup(backupPath) {
  const resolvedPath = backupPath ? path.resolve(backupPath) : null;
  const targetPath = resolvedPath || listBackupDirectories().slice(-1)[0] || null;
  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error('No valid backup directory found');
  }

  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const manifestPath = path.join(targetPath, 'manifest.json');
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      manifest = {};
    }
  }

  const hasDatabase = files.includes('project-sora.sqlite');
  const hasDataFiles = files.some((fileName) => fileName.endsWith('.json'));
  const valid = Boolean(hasDatabase || hasDataFiles || manifest.files?.length);

  return {
    valid,
    backupPath: targetPath,
    hasDatabase,
    hasDataFiles,
    files,
    directories,
    manifest
  };
}

function resetForTests() {
  if (database) {
    database.close();
    database = null;
  }
  initialized = false;
  const filePath = DB_PATH;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function openDatabase() {
  if (database) {
    return database;
  }

  ensureDataDirectory();
  database = new Database(DB_PATH, { fileMustExist: false });
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  return database;
}

function initializeStorage() {
  if (initialized) {
    return database;
  }

  if (persistenceMode === 'JSON') {
    initialized = true;
    return null;
  }

  const db = openDatabase();
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      public_id TEXT NOT NULL UNIQUE,
      public_handle TEXT NOT NULL UNIQUE,
      privacy_settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      title TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      condition TEXT NOT NULL DEFAULT 'Good',
      purchase_price REAL NOT NULL DEFAULT 0,
      current_value REAL NOT NULL DEFAULT 0,
      metacritic_score REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      comments_json TEXT NOT NULL DEFAULT '[]',
      playtime_minutes INTEGER NOT NULL DEFAULT 0,
      completion_percent REAL NOT NULL DEFAULT 0,
      cover_image TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Backlog',
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_email, game_id)
    )`,
    `CREATE TABLE IF NOT EXISTS wishlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      image TEXT NOT NULL DEFAULT '',
      release_date TEXT NOT NULL DEFAULT '',
      added_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_email, game_id)
    )`,
    `CREATE TABLE IF NOT EXISTS queues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Queued',
      added_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_email, game_id)
    )`,
    `CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      type TEXT NOT NULL,
      game_id TEXT NOT NULL DEFAULT '',
      display_title TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_email, event_id)
    )`,
    `CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(requester_id, target_id)
    )`,
    `CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id_a TEXT NOT NULL,
      user_id_b TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id_a, user_id_b)
    )`,
    `CREATE TABLE IF NOT EXISTS privacy_settings (
      user_email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
      profile_visibility TEXT NOT NULL DEFAULT 'Private',
      library_visibility TEXT NOT NULL DEFAULT 'Private',
      reviews_visibility TEXT NOT NULL DEFAULT 'Private',
      activity_visibility TEXT NOT NULL DEFAULT 'Private',
      feed_sharing_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      storefront TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(game_id, storefront, currency, captured_at)
    )`,
    `CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      target_price REAL NOT NULL,
      currency TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_email, game_id)
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'price_alert',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      target_price REAL,
      currency TEXT,
      observed_price REAL,
      UNIQUE(user_email, game_id, target_price, currency)
    )`
  ];

  const transaction = db.transaction(() => {
    schemaStatements.forEach((statement) => db.exec(statement));
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_email ON sessions(user_email)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_libraries_user_email ON libraries(user_email)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wishlists_user_email ON wishlists(user_email)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_queues_user_email ON queues(user_email)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_user_email_timestamp ON activities(user_email, timestamp)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_target ON friend_requests(requester_id, target_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(user_id_a, user_id_b)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_game_id ON price_history(game_id, captured_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_price_alerts_user_game ON price_alerts(user_email, game_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_email, created_at)`);
  });

  transaction();
  initialized = true;
  return db;
}

function parseJsonField(value, fallback = {}) {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
}

function serializeJson(value) {
  return JSON.stringify(value || {});
}

function getNowIso() {
  return new Date().toISOString();
}

function createUserRecord({ email, passwordHash, salt, publicId, publicHandle, privacySettings }) {
  const db = initializeStorage();
  if (!db) {
    return null;
  }

  const now = getNowIso();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPasswordHash = String(passwordHash || '').trim();
  const normalizedSalt = String(salt || '').trim();
  const normalizedPublicId = String(publicId || '').trim() || `user-${crypto.randomBytes(6).toString('hex')}`;
  const normalizedPublicHandle = String(publicHandle || '').trim() || `user-${crypto.randomBytes(6).toString('hex')}`;
  const privacyPayload = privacySettings && typeof privacySettings === 'object' ? privacySettings : {};
  const privacyJson = serializeJson(privacyPayload);

  const insertStatement = db.prepare(`
    INSERT INTO users(email, password_hash, salt, public_id, public_handle, privacy_settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      password_hash = excluded.password_hash,
      salt = excluded.salt,
      public_id = excluded.public_id,
      public_handle = excluded.public_handle,
      privacy_settings_json = excluded.privacy_settings_json,
      updated_at = excluded.updated_at
  `);

  insertStatement.run(normalizedEmail, normalizedPasswordHash, normalizedSalt, normalizedPublicId, normalizedPublicHandle, privacyJson, now, now);
  const privacyStatement = db.prepare(`
    INSERT INTO privacy_settings(user_email, profile_visibility, library_visibility, reviews_visibility, activity_visibility, feed_sharing_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_email) DO UPDATE SET
      profile_visibility = excluded.profile_visibility,
      library_visibility = excluded.library_visibility,
      reviews_visibility = excluded.reviews_visibility,
      activity_visibility = excluded.activity_visibility,
      feed_sharing_enabled = excluded.feed_sharing_enabled,
      updated_at = excluded.updated_at
  `);
  privacyStatement.run(normalizedEmail, privacyPayload.profileVisibility || 'Private', privacyPayload.libraryVisibility || 'Private', privacyPayload.reviewsVisibility || 'Private', privacyPayload.activityVisibility || 'Private', privacyPayload.feedSharingEnabled ? 1 : 0, now, now);

  return { email: normalizedEmail, passwordHash: normalizedPasswordHash, salt: normalizedSalt, publicId: normalizedPublicId, publicHandle: normalizedPublicHandle, privacySettings: privacyPayload };
}

function getUserRecord(email) {
  const db = initializeStorage();
  if (!db) {
    return null;
  }

  const row = db.prepare('SELECT u.*, p.profile_visibility, p.library_visibility, p.reviews_visibility, p.activity_visibility, p.feed_sharing_enabled FROM users u LEFT JOIN privacy_settings p ON p.user_email = u.email WHERE u.email = ?').get(String(email || '').trim().toLowerCase());
  if (!row) {
    return null;
  }

  return {
    email: row.email,
    passwordHash: row.password_hash,
    salt: row.salt,
    publicId: row.public_id,
    publicHandle: row.public_handle,
    privacySettings: {
      profileVisibility: row.profile_visibility || 'Private',
      libraryVisibility: row.library_visibility || 'Private',
      reviewsVisibility: row.reviews_visibility || 'Private',
      activityVisibility: row.activity_visibility || 'Private',
      feedSharingEnabled: Boolean(row.feed_sharing_enabled)
    }
  };
}

function readUsersStore() {
  const db = initializeStorage();
  if (!db) {
    return {};
  }

  const rows = db.prepare('SELECT u.*, p.profile_visibility, p.library_visibility, p.reviews_visibility, p.activity_visibility, p.feed_sharing_enabled FROM users u LEFT JOIN privacy_settings p ON p.user_email = u.email ORDER BY u.email').all();
  return Object.fromEntries(rows.map((row) => [row.email, {
    salt: row.salt,
    passwordHash: row.password_hash,
    publicId: row.public_id,
    publicHandle: row.public_handle,
    privacySettings: {
      profileVisibility: row.profile_visibility || 'Private',
      libraryVisibility: row.library_visibility || 'Private',
      reviewsVisibility: row.reviews_visibility || 'Private',
      activityVisibility: row.activity_visibility || 'Private',
      feedSharingEnabled: Boolean(row.feed_sharing_enabled)
    }
  }]));
}

function writeUsersStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    Object.entries(store || {}).forEach(([email, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      const sanitizedValue = value;
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return;
      }
      createUserRecord({
        email: normalizedEmail,
        passwordHash: sanitizedValue.passwordHash || sanitizedValue.password_hash || '',
        salt: sanitizedValue.salt || '',
        publicId: sanitizedValue.publicId || sanitizedValue.public_id || `user-${crypto.randomBytes(6).toString('hex')}`,
        publicHandle: sanitizedValue.publicHandle || sanitizedValue.public_handle || `user-${crypto.randomBytes(6).toString('hex')}`,
        privacySettings: sanitizedValue.privacySettings || {}
      });
    });
  });
  transaction();
}

function createSession(userEmail, token, expiresAt = Date.now() + SESSION_TTL_MS) {
  const db = initializeStorage();
  if (!db) {
    return null;
  }

  const normalizedToken = String(token || '').trim();
  const normalizedEmail = String(userEmail || '').trim().toLowerCase();
  if (!normalizedToken || !normalizedEmail) {
    return null;
  }

  const now = getNowIso();
  const statement = db.prepare(`
    INSERT INTO sessions(token, user_email, expires_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      user_email = excluded.user_email,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `);
  statement.run(normalizedToken, normalizedEmail, Number(expiresAt || 0), now);
  return normalizedToken;
}

function getSessionData(token) {
  const db = initializeStorage();
  if (!db) {
    return null;
  }

  const normalizedToken = String(token || '').trim();
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(normalizedToken);
  if (!row) {
    return null;
  }

  if (!row.expires_at || Number(row.expires_at) <= Date.now()) {
    deleteSession(normalizedToken);
    return null;
  }

  return {
    user: row.user_email,
    createdAt: row.created_at,
    expiresAt: Number(row.expires_at)
  };
}

function getSessionUser(token) {
  const session = getSessionData(token);
  return session ? session.user : null;
}

function deleteSession(token) {
  const db = initializeStorage();
  if (!db) {
    return;
  }
  db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token || '').trim());
}

function pruneExpiredSessions() {
  const db = initializeStorage();
  if (!db) {
    return;
  }
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

function readLibrariesStore() {
  const db = initializeStorage();
  if (!db) {
    return {};
  }

  const rows = db.prepare('SELECT * FROM libraries ORDER BY user_email, created_at').all();
  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.user_email]) {
      grouped[row.user_email] = [];
    }
    grouped[row.user_email].push({
      id: row.game_id,
      title: row.title,
      platform: row.platform,
      condition: row.condition,
      purchasePrice: Number(row.purchase_price || 0),
      currentValue: Number(row.current_value || 0),
      metacriticScore: Number(row.metacritic_score || 0),
      notes: row.notes,
      comments: parseJsonField(row.comments_json, []),
      playtimeMinutes: Number(row.playtime_minutes || 0),
      completionPercent: Number(row.completion_percent || 0),
      coverImage: row.cover_image,
      status: row.status,
      completedAt: row.completed_at
    });
  });
  return grouped;
}

function writeLibrariesStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM libraries').run();
    Object.entries(store || {}).forEach(([email, entries]) => {
      const userEmail = String(email || '').trim().toLowerCase();
      if (!Array.isArray(entries) || !userEmail) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        const gameId = String(entry.id || entry.gameId || '').trim() || `game-${crypto.randomBytes(4).toString('hex')}`;
        const now = getNowIso();
        const statement = db.prepare(`
          INSERT INTO libraries(user_email, game_id, title, platform, condition, purchase_price, current_value, metacritic_score, notes, comments_json, playtime_minutes, completion_percent, cover_image, status, completed_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        statement.run(userEmail, gameId, String(entry.title || ''), String(entry.platform || ''), String(entry.condition || 'Good'), Number(entry.purchasePrice || 0), Number(entry.currentValue || 0), Number(entry.metacriticScore || 0), String(entry.notes || ''), serializeJson(Array.isArray(entry.comments) ? entry.comments : []), Number(entry.playtimeMinutes || 0), Number(entry.completionPercent || 0), String(entry.coverImage || ''), String(entry.status || 'Backlog'), entry.completedAt || null, now, now);
      });
    });
  });
  transaction();
}

function readWishlistsStore() {
  const db = initializeStorage();
  if (!db) {
    return {};
  }

  const rows = db.prepare('SELECT * FROM wishlists ORDER BY user_email, added_at').all();
  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.user_email]) {
      grouped[row.user_email] = [];
    }
    grouped[row.user_email].push({
      gameId: row.game_id,
      title: row.title,
      platform: row.platform,
      price: Number(row.price || 0),
      image: row.image,
      releaseDate: row.release_date,
      addedAt: row.added_at
    });
  });
  return grouped;
}

function writeWishlistsStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM wishlists').run();
    Object.entries(store || {}).forEach(([email, entries]) => {
      const userEmail = String(email || '').trim().toLowerCase();
      if (!Array.isArray(entries) || !userEmail) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        const gameId = String(entry.gameId || entry.id || '').trim() || `catalog-${crypto.randomBytes(4).toString('hex')}`;
        const now = getNowIso();
        db.prepare(`
          INSERT INTO wishlists(user_email, game_id, title, platform, price, image, release_date, added_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userEmail, gameId, String(entry.title || ''), String(entry.platform || ''), Number(entry.price || 0), String(entry.image || ''), String(entry.releaseDate || entry.release || ''), String(entry.addedAt || now), now, now);
      });
    });
  });
  transaction();
}

function readQueuesStore() {
  const db = initializeStorage();
  if (!db) {
    return {};
  }

  const rows = db.prepare('SELECT * FROM queues ORDER BY user_email, sort_order, added_at').all();
  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.user_email]) {
      grouped[row.user_email] = [];
    }
    grouped[row.user_email].push({
      gameId: row.game_id,
      title: row.title,
      platform: row.platform,
      image: row.image,
      status: row.status,
      addedAt: row.added_at
    });
  });
  return grouped;
}

function writeQueuesStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM queues').run();
    Object.entries(store || {}).forEach(([email, entries]) => {
      const userEmail = String(email || '').trim().toLowerCase();
      if (!Array.isArray(entries) || !userEmail) {
        return;
      }
      entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        const gameId = String(entry.gameId || entry.id || '').trim() || `queue-${crypto.randomBytes(4).toString('hex')}`;
        const now = getNowIso();
        db.prepare(`
          INSERT INTO queues(user_email, game_id, title, platform, image, status, added_at, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userEmail, gameId, String(entry.title || ''), String(entry.platform || ''), String(entry.image || ''), String(entry.status || 'Queued'), String(entry.addedAt || now), index, now, now);
      });
    });
  });
  transaction();
}

function readActivitiesStore() {
  const db = initializeStorage();
  if (!db) {
    return {};
  }

  const rows = db.prepare('SELECT * FROM activities ORDER BY user_email, timestamp DESC').all();
  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.user_email]) {
      grouped[row.user_email] = [];
    }
    grouped[row.user_email].push({
      eventId: row.event_id,
      type: row.type,
      gameId: row.game_id,
      displayTitle: row.display_title,
      timestamp: row.timestamp,
      hidden: Boolean(row.hidden)
    });
  });
  return grouped;
}

function writeActivitiesStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM activities').run();
    Object.entries(store || {}).forEach(([email, entries]) => {
      const userEmail = String(email || '').trim().toLowerCase();
      if (!Array.isArray(entries) || !userEmail) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        const now = getNowIso();
        db.prepare(`
          INSERT INTO activities(user_email, event_id, type, game_id, display_title, timestamp, hidden, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userEmail, String(entry.eventId || entry.id || ''), String(entry.type || ''), String(entry.gameId || ''), String(entry.displayTitle || entry.title || ''), String(entry.timestamp || now), entry.hidden ? 1 : 0, now, now);
      });
    });
  });
  transaction();
}

function readFriendStore() {
  const db = initializeStorage();
  if (!db) {
    return { requests: [], friendships: [] };
  }

  return {
    requests: db.prepare('SELECT * FROM friend_requests ORDER BY created_at').all().map((row) => ({ id: String(row.id), requesterId: row.requester_id, targetId: row.target_id, status: row.status, createdAt: row.created_at })),
    friendships: db.prepare('SELECT * FROM friendships ORDER BY created_at').all().map((row) => ({ userIdA: row.user_id_a, userIdB: row.user_id_b, createdAt: row.created_at }))
  };
}

function writeFriendStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM friend_requests').run();
    db.prepare('DELETE FROM friendships').run();
    const requests = Array.isArray(store?.requests) ? store.requests : [];
    const friendships = Array.isArray(store?.friendships) ? store.friendships : [];
    requests.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      db.prepare(`
        INSERT INTO friend_requests(requester_id, target_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(String(entry.requesterId || ''), String(entry.targetId || ''), String(entry.status || 'pending'), String(entry.createdAt || getNowIso()), String(entry.createdAt || getNowIso()));
    });
    friendships.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      db.prepare(`
        INSERT INTO friendships(user_id_a, user_id_b, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(String(entry.userIdA || ''), String(entry.userIdB || ''), String(entry.createdAt || getNowIso()), String(entry.createdAt || getNowIso()));
    });
  });
  transaction();
}

function readPriceHistoryStore() {
  const db = initializeStorage();
  if (!db) {
    return {};
  }

  const rows = db.prepare('SELECT * FROM price_history ORDER BY game_id, captured_at').all();
  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.game_id]) {
      grouped[row.game_id] = [];
    }
    grouped[row.game_id].push({
      gameId: row.game_id,
      storefront: row.storefront,
      price: Number(row.price || 0),
      currency: row.currency,
      capturedAt: row.captured_at,
      source: row.source
    });
  });
  return grouped;
}

function writePriceHistoryStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM price_history').run();
    Object.entries(store || {}).forEach(([gameId, entries]) => {
      const normalizedGameId = String(gameId || '').trim();
      if (!Array.isArray(entries) || !normalizedGameId) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        const now = getNowIso();
        db.prepare(`
          INSERT INTO price_history(game_id, storefront, price, currency, captured_at, source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(normalizedGameId, String(entry.storefront || ''), Number(entry.price || 0), String(entry.currency || '').toUpperCase(), String(entry.capturedAt || now), String(entry.source || ''), now, now);
      });
    });
  });
  transaction();
}

function readPriceAlertsStore() {
  const db = initializeStorage();
  if (!db) {
    return {};
  }

  const rows = db.prepare('SELECT * FROM price_alerts ORDER BY user_email, created_at').all();
  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.user_email]) {
      grouped[row.user_email] = [];
    }
    grouped[row.user_email].push({
      gameId: row.game_id,
      targetPrice: Number(row.target_price || 0),
      currency: row.currency,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  });
  return grouped;
}

function writePriceAlertsStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM price_alerts').run();
    Object.entries(store || {}).forEach(([email, entries]) => {
      const userEmail = String(email || '').trim().toLowerCase();
      if (!Array.isArray(entries) || !userEmail) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        const now = getNowIso();
        db.prepare(`
          INSERT INTO price_alerts(user_email, game_id, target_price, currency, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(userEmail, String(entry.gameId || ''), Number(entry.targetPrice || 0), String(entry.currency || '').toUpperCase(), entry.enabled ? 1 : 0, String(entry.createdAt || now), String(entry.updatedAt || now));
      });
    });
  });
  transaction();
}

function readNotificationsStore() {
  const db = initializeStorage();
  if (!db) {
    return {};
  }

  const rows = db.prepare('SELECT * FROM notifications ORDER BY user_email, created_at DESC').all();
  const grouped = {};
  rows.forEach((row) => {
    if (!grouped[row.user_email]) {
      grouped[row.user_email] = [];
    }
    grouped[row.user_email].push({
      id: row.id,
      type: row.type,
      gameId: row.game_id,
      title: row.title,
      message: row.message,
      read: Boolean(row.read),
      createdAt: row.created_at,
      targetPrice: Number(row.target_price || 0),
      currency: row.currency,
      observedPrice: Number(row.observed_price || 0)
    });
  });
  return grouped;
}

function writeNotificationsStore(store) {
  const db = initializeStorage();
  if (!db) {
    return;
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM notifications').run();
    Object.entries(store || {}).forEach(([email, entries]) => {
      const userEmail = String(email || '').trim().toLowerCase();
      if (!Array.isArray(entries) || !userEmail) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        const now = getNowIso();
        db.prepare(`
          INSERT INTO notifications(id, user_email, game_id, type, title, message, read, created_at, target_price, currency, observed_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(String(entry.id || `notification-${crypto.randomBytes(6).toString('hex')}`), userEmail, String(entry.gameId || ''), String(entry.type || 'price_alert'), String(entry.title || ''), String(entry.message || ''), entry.read ? 1 : 0, String(entry.createdAt || now), Number(entry.targetPrice || 0), String(entry.currency || '').toUpperCase(), Number(entry.observedPrice || 0));
      });
    });
  });
  transaction();
}

function withTransaction(callback) {
  const db = initializeStorage();
  if (!db) {
    return callback();
  }
  const transaction = db.transaction(callback);
  return transaction();
}

function createFriendship(userIdA, userIdB) {
  const db = initializeStorage();
  if (!db) {
    return null;
  }
  const now = getNowIso();
  db.prepare(`
    INSERT INTO friendships(user_id_a, user_id_b, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(String(userIdA || ''), String(userIdB || ''), now, now);
  return { userIdA: String(userIdA || ''), userIdB: String(userIdB || ''), createdAt: now };
}

function createWishlistEntry(userEmail, entry) {
  const db = initializeStorage();
  if (!db) {
    return null;
  }
  const now = getNowIso();
  const gameId = String(entry?.gameId || entry?.id || '').trim() || `catalog-${crypto.randomBytes(4).toString('hex')}`;
  db.prepare(`
    INSERT INTO wishlists(user_email, game_id, title, platform, price, image, release_date, added_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(userEmail || '').trim().toLowerCase(), gameId, String(entry?.title || ''), String(entry?.platform || ''), Number(entry?.price || 0), String(entry?.image || ''), String(entry?.releaseDate || entry?.release || ''), String(entry?.addedAt || now), now, now);
  return { gameId, title: String(entry?.title || ''), platform: String(entry?.platform || ''), price: Number(entry?.price || 0), image: String(entry?.image || ''), releaseDate: String(entry?.releaseDate || entry?.release || ''), addedAt: String(entry?.addedAt || now) };
}

function createQueueEntry(userEmail, entry) {
  const db = initializeStorage();
  if (!db) {
    return null;
  }
  const now = getNowIso();
  const gameId = String(entry?.gameId || entry?.id || '').trim() || `queue-${crypto.randomBytes(4).toString('hex')}`;
  db.prepare(`
    INSERT INTO queues(user_email, game_id, title, platform, image, status, added_at, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(userEmail || '').trim().toLowerCase(), gameId, String(entry?.title || ''), String(entry?.platform || ''), String(entry?.image || ''), String(entry?.status || 'Queued'), String(entry?.addedAt || now), 0, now, now);
  return { gameId, title: String(entry?.title || ''), platform: String(entry?.platform || ''), image: String(entry?.image || ''), status: String(entry?.status || 'Queued'), addedAt: String(entry?.addedAt || now) };
}

function createNotification(userEmail, entry) {
  const db = initializeStorage();
  if (!db) {
    return null;
  }
  const now = getNowIso();
  const notificationId = String(entry?.id || `notification-${crypto.randomBytes(6).toString('hex')}`);
  db.prepare(`
    INSERT INTO notifications(id, user_email, game_id, type, title, message, read, created_at, target_price, currency, observed_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(notificationId, String(userEmail || '').trim().toLowerCase(), String(entry?.gameId || ''), String(entry?.type || 'price_alert'), String(entry?.title || ''), String(entry?.message || ''), entry?.read ? 1 : 0, String(entry?.createdAt || now), Number(entry?.targetPrice || 0), String(entry?.currency || '').toUpperCase(), Number(entry?.observedPrice || 0));
  return { id: notificationId, ...entry };
}

function hasExistingData() {
  const db = initializeStorage();
  if (!db) {
    return false;
  }
  const rows = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  return Number(rows.count || 0) > 0;
}

function backupJsonFiles() {
  ensureDataDirectory();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(DATA_DIR, `json-backup-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const files = ['users.json', 'libraries.json', 'wishlists.json', 'queues.json', 'activities.json', 'friends.json', 'price-history.json', 'price-alerts.json', 'notifications.json', 'catalog.json'];
  files.forEach((fileName) => {
    const source = path.join(DATA_DIR, fileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(backupDir, fileName));
    }
  });
  return backupDir;
}

function migrateFromJsonFiles() {
  if (persistenceMode === 'JSON') {
    return { migrated: false, reason: 'JSON persistence selected' };
  }

  const db = initializeStorage();
  if (!db) {
    return { migrated: false, reason: 'Database unavailable' };
  }

  if (hasExistingData()) {
    return { migrated: false, reason: 'Database already contains data' };
  }

  const backupDir = backupJsonFiles();
  const migrations = [
    { fileName: 'users.json', reader: (value) => value, writer: writeUsersStore },
    { fileName: 'libraries.json', reader: (value) => value, writer: writeLibrariesStore },
    { fileName: 'wishlists.json', reader: (value) => value, writer: writeWishlistsStore },
    { fileName: 'queues.json', reader: (value) => value, writer: writeQueuesStore },
    { fileName: 'activities.json', reader: (value) => value, writer: writeActivitiesStore },
    { fileName: 'friends.json', reader: (value) => value, writer: writeFriendStore },
    { fileName: 'price-history.json', reader: (value) => value, writer: writePriceHistoryStore },
    { fileName: 'price-alerts.json', reader: (value) => value, writer: writePriceAlertsStore },
    { fileName: 'notifications.json', reader: (value) => value, writer: writeNotificationsStore }
  ];

  const transaction = db.transaction(() => {
    migrations.forEach(({ fileName, writer }) => {
      const filePath = path.join(DATA_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        parsed = {};
      }
      writer(parsed);
    });
  });
  transaction();
  return { migrated: true, backupDir };
}

function readJson(filePath, fallback) {
  if (persistenceMode === 'JSON') {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw || !raw.trim()) {
        return fallback;
      }
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  const filename = path.basename(filePath);
  switch (filename) {
    case 'users.json':
      return readUsersStore();
    case 'libraries.json':
      return readLibrariesStore();
    case 'wishlists.json':
      return readWishlistsStore();
    case 'queues.json':
      return readQueuesStore();
    case 'activities.json':
      return readActivitiesStore();
    case 'friends.json':
      return readFriendStore();
    case 'price-history.json':
      return readPriceHistoryStore();
    case 'price-alerts.json':
      return readPriceAlertsStore();
    case 'notifications.json':
      return readNotificationsStore();
    default:
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) {
          return fallback;
        }
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
  }
}

function writeJson(filePath, value) {
  if (persistenceMode === 'JSON') {
    try {
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
    } catch {
      // ignore write failures in beta environments
    }
    return;
  }

  const filename = path.basename(filePath);
  switch (filename) {
    case 'users.json':
      return writeUsersStore(value);
    case 'libraries.json':
      return writeLibrariesStore(value);
    case 'wishlists.json':
      return writeWishlistsStore(value);
    case 'queues.json':
      return writeQueuesStore(value);
    case 'activities.json':
      return writeActivitiesStore(value);
    case 'friends.json':
      return writeFriendStore(value);
    case 'price-history.json':
      return writePriceHistoryStore(value);
    case 'price-alerts.json':
      return writePriceAlertsStore(value);
    case 'notifications.json':
      return writeNotificationsStore(value);
    default:
      try {
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
      } catch {
        // ignore write failures in beta environments
      }
      return;
  }
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  initializeStorage,
  closeDatabase,
  resetForTests,
  getPersistenceMode,
  createUserRecord,
  getUserRecord,
  readUsersStore,
  writeUsersStore,
  createSession,
  getSessionData,
  getSessionUser,
  deleteSession,
  pruneExpiredSessions,
  readLibrariesStore,
  writeLibrariesStore,
  readWishlistsStore,
  writeWishlistsStore,
  readQueuesStore,
  writeQueuesStore,
  readActivitiesStore,
  writeActivitiesStore,
  readFriendStore,
  writeFriendStore,
  readPriceHistoryStore,
  writePriceHistoryStore,
  readPriceAlertsStore,
  writePriceAlertsStore,
  readNotificationsStore,
  writeNotificationsStore,
  createFriendship,
  createWishlistEntry,
  createQueueEntry,
  createNotification,
  withTransaction,
  backupJsonFiles,
  createDataBackup,
  validateBackup,
  migrateFromJsonFiles,
  readJson,
  writeJson,
  ensureDataDirectory
};
