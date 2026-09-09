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

const db = new Database(path.join(DATA_DIR, 'webinar.db'));
db.pragma('journal_mode = WAL');

// --- Idempotent schema (CREATE TABLE IF NOT EXISTS) ---
function initSchema() {
  db.exec(`
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

initSchema();

module.exports = db;
