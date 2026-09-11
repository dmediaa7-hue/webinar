// Scheduled meetings persistence layer (task 3: DB + rooms persistence)
// CRUD over the `scheduled_meetings` table with server-side validation.
// Functions accept an optional `db` handle so unit tests can use ':memory:'.
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const defaultDb = require('./db');

function hashPasscode(passcode) {
  return crypto.createHash('sha256').update(String(passcode)).digest('hex');
}

/**
 * Validate candidate meeting fields. Throws a descriptive Error on failure.
 * Returns a sanitized payload ready for insert.
 */
function validateMeetingInput(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  if (!title) throw new Error('title is required');
  if (title.length > 200) throw new Error('title must be 200 characters or fewer');

  const hostUserId = Number(input?.hostUserId);
  if (!Number.isInteger(hostUserId) || hostUserId <= 0) {
    throw new Error('hostUserId is required and must be a positive integer');
  }

  const startTime = Number(input?.startTime);
  const endTime = Number(input?.endTime);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    throw new Error('Invalid date: startTime and endTime must be valid timestamps');
  }
  if (endTime <= startTime) {
    throw new Error('Invalid date: endTime must be after startTime');
  }

  const roomName = typeof input?.roomName === 'string' ? input.roomName.trim().slice(0, 100) : null;
  const passcode = typeof input?.passcode === 'string' && input.passcode.trim() ? input.passcode.trim().slice(0, 50) : null;

  return {
    title,
    hostUserId,
    startTime: Math.floor(startTime),
    endTime: Math.floor(endTime),
    roomName,
    passcodeHash: passcode ? hashPasscode(passcode) : null,
    waitingRoomEnabled: Boolean(input?.waitingRoomEnabled),
    createdAt: Date.now()
  };
}

function rowToMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    roomName: row.room_name,
    hasPasscode: Boolean(row.passcode_hash),
    waitingRoomEnabled: Boolean(row.waiting_room_enabled),
    createdAt: row.created_at
  };
}

/**
 * Create a scheduled meeting.
 * @param {object} input { hostUserId, title, startTime, endTime, roomName?, passcode?, waitingRoomEnabled? }
 * @param {object} [db] optional better-sqlite3 handle (defaults to the shared one)
 * @returns {object} the persisted meeting row
 */
async function createMeeting(input, db = defaultDb) {
  const data = validateMeetingInput(input);
  const id = uuidv4();
  await db.run(`
    INSERT INTO scheduled_meetings
      (id, host_user_id, title, start_time, end_time, room_name, passcode_hash, waiting_room_enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, data.hostUserId, data.title, data.startTime, data.endTime, data.roomName, data.passcodeHash, data.waitingRoomEnabled ? 1 : 0, data.createdAt);
  return await getMeeting(id, db);
}

/**
 * Fetch a single scheduled meeting by id.
 */
async function getMeeting(id, db = defaultDb) {
  const row = await db.get('SELECT * FROM scheduled_meetings WHERE id = ?', id);
  return rowToMeeting(row);
}

/**
 * Internal: raw row including passcode_hash. Used only by the server-side
 * "start meeting" flow to replicate the passcode onto the live room; never
 * serialized to API responses (getMeeting stays hash-free).
 */
async function getMeetingRow(id, db = defaultDb) {
  return await db.get('SELECT * FROM scheduled_meetings WHERE id = ?', id);
}

/**
 * List scheduled meetings, optionally filtered by host and/or a "from" time.
 * @param {object} [filters] { hostUserId?, fromTime? }
 */
async function listMeetings(filters = {}, db = defaultDb) {
  const clauses = [];
  const params = [];
  if (filters.hostUserId) {
    clauses.push('host_user_id = ?');
    params.push(filters.hostUserId);
  }
  if (filters.fromTime) {
    clauses.push('end_time >= ?');
    params.push(Math.floor(Number(filters.fromTime) || 0));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db.all(`SELECT * FROM scheduled_meetings ${where} ORDER BY start_time ASC`, ...params);
  return rows.map(rowToMeeting);
}

/**
 * Delete a scheduled meeting by id. Returns true if a row was removed.
 */
async function deleteMeeting(id, db = defaultDb) {
  const result = await db.run('DELETE FROM scheduled_meetings WHERE id = ?', id);
  return result.changes > 0;
}

module.exports = {
  createMeeting,
  getMeeting,
  getMeetingRow,
  listMeetings,
  deleteMeeting,
  hashPasscode,
  validateMeetingInput
};