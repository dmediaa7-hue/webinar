// Authentication: bcrypt password hashing + JWT httpOnly-cookie sessions.
// Passwords are bcrypt-hashed; the session token is a JWT whose hash is stored
// in the DB so a leaked cookie DB row never contains a usable token.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const COOKIE_NAME = 'webinar_session';
// JWT secret should come from env in production; fall back to a local dev secret.
const JWT_SECRET = process.env.JWT_SECRET || 'webinar-dev-secret-change-me';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Register a new user.
 * @returns {{ok:true,user}|{ok:false,status,error}}
 */
function registerUser({ email, name, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim().slice(0, 100);
  if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return { ok: false, status: 400, error: 'A valid email is required' };
  }
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(cleanEmail, cleanName, passwordHash, Date.now());
    return {
      ok: true,
      user: { id: info.lastInsertRowid, email: cleanEmail, name: cleanName }
    };
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, status: 409, error: 'An account with this email already exists' };
    }
    throw err;
  }
}

/**
 * Verify credentials and create a session; returns user.
 */
function verifyCredentials(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!row) return null;
  if (!bcrypt.compareSync(String(password || ''), row.password_hash)) return null;
  return { id: row.id, email: row.email, name: row.name };
}

/**
 * Create a signed httpOnly cookie value for a user, persist token hash.
 * @returns {{cookieValue:string, cookieOptions:object}}
 */
function createSession(userId) {
  const token = jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: '7d' });
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(userId, hashToken(token), Date.now(), expiresAt);
  return {
    cookieValue: token,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS,
      path: '/'
    }
  };
}

/**
 * Middleware: resolve the current user from the session cookie (if any) and
 * attach `req.user`. Does not reject — callers decide.
 */
function loadUser(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    req.user = null;
    return next();
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
    return next();
  }
  const session = db
    .prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(hashToken(token), Date.now());
  if (!session) {
    req.user = null;
    return next();
  }
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(payload.sub);
  req.user = user || null;
  return next();
}

/**
 * Middleware: require an authenticated user (401 otherwise).
 */
function requireAuth(req, res, next) {
  loadUser(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  });
}

/**
 * Destroy a session (logout).
 */
function destroySession(cookieValue) {
  if (cookieValue) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(cookieValue));
  }
}

module.exports = {
  COOKIE_NAME,
  registerUser,
  verifyCredentials,
  createSession,
  destroySession,
  loadUser,
  requireAuth
};
