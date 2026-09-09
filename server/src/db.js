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

const DEFAULT_DB_PATH = path.join(DATA_DIR, 'webinar.db');

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
      egress_id TEXT,
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

    CREATE TABLE IF NOT EXISTS whiteboards (
      id TEXT PRIMARY KEY,
      room_name TEXT NOT NULL,
      scene_json TEXT,
      updated_at INTEGER NOT NULL
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