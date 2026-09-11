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

if (JWT_SECRET === 'webinar-dev-secret-change-me') {
  console.warn(
    '[AUTH] Using the default JWT_SECRET - session cookies can be forged by anyone ' +
    'who knows it. Set server/.env JWT_SECRET to a random value before deploying.'
  );
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Register a new user.
 * @returns {{ok:true,user}|{ok:false,status,error}}
 */
async function registerUser({ email, name, password }) {
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
    const info = await db.run(
      'INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)',
      cleanEmail, cleanName, passwordHash, Date.now()
    );
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
async function verifyCredentials(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const row = await db.get('SELECT * FROM users WHERE email = ?', cleanEmail);
  if (!row) return null;
  if (!bcrypt.compareSync(String(password || ''), row.password_hash)) return null;
  return { id: row.id, email: row.email, name: row.name };
}

/**
 * Create a signed httpOnly cookie value for a user, persist token hash.
 * @returns {{cookieValue:string, cookieOptions:object}}
 */
async function createSession(userId) {
  // jti (random per session) keeps tokens unique: without it, two sessions for
  // the same user created within the same second share iat and produce byte-
  // identical JWTs, colliding on sessions.token_hash (SQLITE_CONSTRAINT_UNIQUE).
  const token = jwt.sign(
    { sub: String(userId), jti: crypto.randomBytes(16).toString('hex') },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db.run(
    'INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
    userId, hashToken(token), Date.now(), expiresAt
  );
  return {
    cookieValue: token,
    cookieOptions: {
      httpOnly: true,
      // The deployed SPA (dmatest.rf.gd) and API (onrender.com) are different
      // registrable domains - a cross-site context. Browsers refuse to attach a
      // 'lax' cookie to cross-site fetch(credentials:'include'), so production
      // needs 'none' (requires Secure, which is set below on HTTPS). Same-origin
      // deployments can force 'lax' via COOKIE_SAMESITE.
      sameSite: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
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
async function loadUser(req, res, next) {
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
  const session = await db.get(
    'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
    hashToken(token), Date.now()
  );
  if (!session) {
    req.user = null;
    return next();
  }
  const user = await db.get('SELECT id, email, name FROM users WHERE id = ?', payload.sub);
  req.user = user || null;
  return next();
}

/**
 * Middleware: require an authenticated user (401 otherwise).
 */
async function requireAuth(req, res, next) {
  try {
    await loadUser(req, res, () => {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      return next();
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Destroy a session (logout).
 */
async function destroySession(cookieValue) {
  if (cookieValue) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(cookieValue));
  }
}

/**
 * Request a password reset (self-hosted pattern: no mail infra, so the raw link
 * token is returned to the caller instead of emailed).
 * @returns {{ok:true,resetToken:string}|{ok:false,status,error}}
 */
async function requestPasswordReset(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = await db.get('SELECT id FROM users WHERE email = ?', cleanEmail);
  if (!user) return { ok: false, status: 404, error: 'No account found with that email' };

  // Housekeeping: drop this user's already-expired tokens before issuing a
  // fresh one, so the table never accumulates dead rows.
  await db.run('DELETE FROM password_resets WHERE user_id = ? AND expires_at < ?', user.id, Date.now());

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minute TTL
  await db.run(
    'INSERT INTO password_resets (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
    user.id, hashToken(rawToken), Date.now(), expiresAt
  );
  return { ok: true, resetToken: rawToken };
}

/**
 * Apply a password reset token: set a new password, consume the token
 * (single-use) and revoke every existing session for the user.
 * @returns {{ok:true}|{ok:false,status,error}}
 */
async function applyPasswordReset(token, password) {
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  }
  const row = await db.get(
    'SELECT * FROM password_resets WHERE token_hash = ?',
    hashToken(String(token || ''))
  );
  if (!row || row.expires_at < Date.now()) {
    return { ok: false, status: 400, error: 'This reset link is invalid or has expired' };
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, row.user_id);
  // Single-use: consume the token so the same link cannot be applied twice.
  await db.run('DELETE FROM password_resets WHERE id = ?', row.id);
  // Revoke all sessions so the new password is enforced everywhere at once.
  await db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
  return { ok: true };
}

module.exports = {
  COOKIE_NAME,
  registerUser,
  verifyCredentials,
  createSession,
  destroySession,
  loadUser,
  requireAuth,
  requestPasswordReset,
  applyPasswordReset
};
