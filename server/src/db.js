// SQLite persistence layer (better-sqlite3)
// Central, idempotent schema definition. All persistent stores read/write here.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// DB file lives in server/data/webinar.db
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// DB_PATH env var lets deployments point the database at durable storage
// (e.g. a Render persistent disk mount at /var/data/webinar.db). Falls back to
// the repo-relative server/data/webinar.db for local development.
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'webinar.db');

const db = new Database(DEFAULT_DB_PATH);
db.pragma('journal_mode = WAL');

// --- Idempotent schema (CREATE TABLE IF NOT EXISTS) ---
function initSchema(database) {
  const target = database || db;
  target.exec(`
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

    -- Persistent room metadata (in-memory socket/participant state stays in rooms.js)
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

    -- Per-voter Q&A vote record (delta +1/-1, UNIQUE per voter) so the
    -- upvotes counter stays accurate across refreshes and re-votes.
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

    -- Breakout room config: each breakout is a labeled group on the main room.
    CREATE TABLE IF NOT EXISTS breakout_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      main_room TEXT NOT NULL,
      breakout_name TEXT NOT NULL,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(main_room, breakout_name)
    );

    -- Who is currently assigned to which breakout (one assignment per identity).
    CREATE TABLE IF NOT EXISTS breakout_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      main_room TEXT NOT NULL,
      breakout_name TEXT NOT NULL,
      participant_identity TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      UNIQUE(main_room, participant_identity)
    );

    -- Password reset tokens (self-hosted admin pattern: no mail infra, so the
    -- raw token is returned in the API response). Hashed like session tokens so
    -- a leaked DB row never contains a usable link. Single-use, 30-min TTL.
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

/**
 * Open a database (used by unit tests with ':memory:').
 * Returns a prepared better-sqlite3 instance with the schema applied.
 */
function createDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const database = new Database(dbPath);
  if (dbPath !== ':memory:') database.pragma('journal_mode = WAL');
  initSchema(database);
  return database;
}

initSchema();

module.exports = db;
module.exports.createDatabase = createDatabase;
module.exports.initSchema = initSchema;