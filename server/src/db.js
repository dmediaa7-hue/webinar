// Persistence layer — Turso (libSQL) with embedded replicas.
//
// In production (TURSO_DATABASE_URL set) the client uses an embedded replica:
//   • local file cache for fast reads (survives normal restarts)
//   • TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for durable remote storage
//   • syncInterval keeps remote fresh; on fresh boot it re-syncs automatically
//
// In local development (no Turso env vars) it falls back to a plain local
// SQLite file at server/data/webinar.db, identical to the old better-sqlite3
// behaviour.
//
// Tests pass ':memory:' or a temp file — no Turso connection needed.

'use strict';

const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

// ── Schema (idempotent, one big exec) ────────────────────────────────────────
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS scheduled_meetings (
    id TEXT PRIMARY KEY,
    host_user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    room_name TEXT,
    passcode_hash TEXT,
    waiting_room_enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (host_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host_id TEXT,
    host_name TEXT NOT NULL,
    passcode_hash TEXT,
    waiting_room_enabled INTEGER NOT NULL DEFAULT 0,
    is_locked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_name TEXT NOT NULL,
    url TEXT,
    status TEXT NOT NULL,
    started_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    host_identity TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS poll_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id TEXT NOT NULL,
    voter_identity TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(poll_id, voter_identity)
  );

  CREATE TABLE IF NOT EXISTS qa_questions (
    id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    author_identity TEXT NOT NULL,
    author_name TEXT,
    body TEXT NOT NULL,
    upvotes INTEGER NOT NULL DEFAULT 0,
    is_answered INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qa_upvotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT NOT NULL,
    voter_identity TEXT NOT NULL,
    delta INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(question_id, voter_identity)
  );

  CREATE TABLE IF NOT EXISTS whiteboards (
    id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    scene_json TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS breakout_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    main_room TEXT NOT NULL,
    breakout_name TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(main_room, breakout_name)
  );

  CREATE TABLE IF NOT EXISTS breakout_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    main_room TEXT NOT NULL,
    breakout_name TEXT NOT NULL,
    participant_identity TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    UNIQUE(main_room, participant_identity)
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`;

// ── Client factory ───────────────────────────────────────────────────────────

/**
 * Create a libSQL client.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.url]          Override the database URL.
 * @param {boolean} [opts.remoteOnly]   Force remote-only mode (no local file).
 * @returns {import('@libsql/client').Client}
 */
function createDbClient(opts = {}) {
  const tursoUrl   = opts.url || process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  // If a Turso URL is provided (production), use embedded-replica mode.
  if (tursoUrl && !opts.remoteOnly) {
    const localPath = process.env.DB_PATH
      || path.join(__dirname, '..', 'data', 'webinar.db');

    // Ensure parent directory exists.
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    return createClient({
      url: `file:${localPath}`,
      syncUrl: tursoUrl,
      authToken: tursoToken || undefined,
      syncInterval: 60,   // seconds — sync every minute
    });
  }

  // Local-only fallback (development or tests).
  const localPath = opts.url
    || process.env.DB_PATH
    || path.join(__dirname, '..', 'data', 'webinar.db');

  if (localPath !== ':memory:' && !localPath.startsWith('file:')) {
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  return createClient({
    url: localPath.startsWith('file:') ? localPath : `file:${localPath}`,
  });
}

// ── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Wrap a libSQL client with convenience methods that match the ergonomic
 * surface the rest of the server expects.
 *
 *   await db.get(sql, ...args)       → row object | undefined
 *   await db.all(sql, ...args)       → Array<row>
 *   await db.run(sql, ...args)       → { changes, lastInsertRowid }
 *   await db.exec(sql)               → void  (multi-statement DDL)
 *   await db.close()                 → void
 */
function wrapClient(client) {
  async function execute(sql, args) {
    try {
      return await client.execute({ sql, args });
    } catch (err) {
      // libSQL reports generic constraint codes on `err.code` and the precise
      // better-sqlite3-style code on `err.cause.code`. The app's error handlers
      // (e.g. auth.js duplicate-email → 409) match the precise codes, so lift
      // them up before rethrowing.
      if (err && err.code === 'SQLITE_CONSTRAINT' && err.cause && typeof err.cause.code === 'string') {
        err.code = err.cause.code;
      }
      throw err;
    }
  }

  return {
    /** Execute and return the first row, or undefined. */
    async get(sql, ...args) {
      const rs = await execute(sql, args.length ? args : undefined);
      return rs.rows[0] || undefined;
    },

    /** Execute and return all rows. */
    async all(sql, ...args) {
      const rs = await execute(sql, args.length ? args : undefined);
      return rs.rows;
    },

    /** Execute a write statement; return { changes, lastInsertRowid }. */
    async run(sql, ...args) {
      const rs = await execute(sql, args.length ? args : undefined);
      return {
        changes: rs.rowsAffected,
        // libSQL returns BigInt for lastInsertRowid; the app expects a Number.
        lastInsertRowid: Number(rs.lastInsertRowid),
      };
    },

    /** Execute multiple semicolon-separated statements (DDL). */
    async exec(sql) {
      await client.executeMultiple(sql);
    },

    /** Close the underlying client. */
    async close() {
      await client.close();
    },

    /** Expose the raw libSQL client for advanced use (sync, batch, etc.). */
    raw: client,
  };
}

// ── Schema initialisation ────────────────────────────────────────────────────

async function initSchema(handle) {
  const target = handle || defaultDb;
  await target.exec(SCHEMA_SQL);
}

// ── Default (singleton) client ───────────────────────────────────────────────
const defaultClient = createDbClient();
const defaultDb = wrapClient(defaultClient);

// Run schema on module load (async IIFE — awaited by callers that need the
// schema to exist before querying).
(async () => {
  await initSchema(defaultDb);
})().catch((err) => {
  console.error('[db] Schema initialisation failed:', err);
  process.exit(1);
});

// ── Test helper: create a fresh isolated database ────────────────────────────

/**
 * Create a standalone database (for unit tests).
 *
 *   const testDb = await createDatabase();         // temp file, auto-cleaned
 *   const memDb  = await createDatabase(':memory:'); // in-memory
 */
async function createDatabase(dbPath) {
  const resolvedPath = dbPath || ':memory:';
  const client = createDbClient({ url: resolvedPath, remoteOnly: true });
  const wrapped = wrapClient(client);
  await initSchema(wrapped);
  return wrapped;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = defaultDb;
module.exports.createDatabase = createDatabase;
module.exports.initSchema = initSchema;
module.exports.createDbClient = createDbClient;
module.exports.wrapClient = wrapClient;
module.exports.SCHEMA_SQL = SCHEMA_SQL;
