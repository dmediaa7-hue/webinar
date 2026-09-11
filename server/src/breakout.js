// Breakout rooms are host-managed labeled GROUPS on the main room. In pure P2P
// there are no separate media rooms, so config + assignments persist to SQLite
// only - participants keep their single WebRTC connection to the main room.
const { getRoom } = require('./rooms');
const defaultDb = require('./db');

/** Sanitize a breakout label; null when invalid (empty or >24 chars or bad chars). */
function cleanBreakoutName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 24) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

/** Next auto-numbered breakout label for a room (1, 2, 3, ...). */
async function nextBreakoutName(mainRoom, excludeNames = [], db = defaultDb) {
  const rows = await db.all('SELECT breakout_name FROM breakout_rooms WHERE main_room = ?', mainRoom);
  const used = new Set(excludeNames.concat(rows.map((r) => r.breakout_name)));
  let n = 1;
  while (used.has(String(n))) n += 1;
  return String(n);
}

/** List breakouts for a room with their assigned identities. */
async function listBreakouts(roomId, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const rooms = await db.all('SELECT * FROM breakout_rooms WHERE main_room = ? ORDER BY id ASC', roomId);
  const assignments = await db.all('SELECT * FROM breakout_assignments WHERE main_room = ?', roomId);

  const breakout = rooms.map((r) => ({
    name: r.breakout_name,
    createdBy: r.created_by,
    createdAt: r.created_at,
    identities: assignments
      .filter((a) => a.breakout_name === r.breakout_name)
      .map((a) => a.participant_identity)
  }));

  return {
    roomId,
    mainRoom: roomId,
    breakouts: breakout,
    assignments: assignments.map((a) => ({
      identity: a.participant_identity,
      breakoutName: a.breakout_name
    }))
  };
}

/**
 * Register a breakout group. Name is optional; a missing/invalid name
 * auto-numbers from the existing breakouts.
 * @returns {Promise<{breakout, roomId}|{error, code}>}
 */
async function createBreakout(roomId, srcName = null, hostIdentity = null, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const name = cleanBreakoutName(srcName) || (await nextBreakoutName(roomId, [srcName], db));

  const exists = await db.get(
    'SELECT id FROM breakout_rooms WHERE main_room = ? AND breakout_name = ?',
    roomId,
    name
  );
  if (exists) return { error: `Breakout '${name}' already exists`, code: 'DUPLICATE_BREAKOUT' };

  const breakout = {
    name,
    createdBy: hostIdentity,
    createdAt: Date.now()
  };
  await db.run(
    `
    INSERT INTO breakout_rooms (main_room, breakout_name, created_by, created_at)
    VALUES (?, ?, ?, ?)
  `,
    roomId,
    name,
    hostIdentity,
    breakout.createdAt
  );

  return { roomId, breakout };
}

/**
 * Assign a participant to a breakout group (upsert; no media-room move needed).
 * @returns {Promise<{ok:true, identity, roomId}|{error, code}>}
 */
async function assignParticipant(roomId, identity, breakoutName, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const label = cleanBreakoutName(breakoutName);
  if (!label) return { error: 'Invalid breakout name' };

  const breakout = await db.get(
    'SELECT * FROM breakout_rooms WHERE main_room = ? AND breakout_name = ?',
    roomId,
    label
  );
  if (!breakout) return { error: `Breakout '${label}' does not exist`, code: 'BREAKOUT_NOT_FOUND' };

  const isParticipant = room.participants.has(identity);
  if (!isParticipant) return { error: 'Participant not in room', code: 'PARTICIPANT_NOT_FOUND' };

  await db.run(
    `
    INSERT INTO breakout_assignments (main_room, breakout_name, participant_identity, assigned_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(main_room, participant_identity) DO UPDATE SET breakout_name = excluded.breakout_name
  `,
    roomId,
    label,
    identity,
    Date.now()
  );

  return { ok: true, identity, roomId };
}

/**
 * Return a participant to the main group (removes their assignment).
 * @returns {Promise<{ok:true, identity, alreadyInMain?: boolean, roomId}|{error, code}>}
 */
async function returnParticipant(roomId, identity, db = defaultDb) {
  const assignment = await db.get(
    'SELECT breakout_name FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?',
    roomId,
    identity
  );
  if (!assignment) {
    return { ok: true, identity, alreadyInMain: true, roomId };
  }

  await db.run(
    'DELETE FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?',
    roomId,
    identity
  );

  return { ok: true, identity, roomId };
}

/**
 * End breakouts: clear every assignment and breakout row for the room.
 */
async function teardownBreakouts(roomId, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const rows = await db.get(
    'SELECT COUNT(*) AS count FROM breakout_rooms WHERE main_room = ?',
    roomId
  );

  await db.run('DELETE FROM breakout_assignments WHERE main_room = ?', roomId);
  await db.run('DELETE FROM breakout_rooms WHERE main_room = ?', roomId);

  return { ok: true, roomId, removed: Number(rows.count) };
}

module.exports = {
  cleanBreakoutName,
  nextBreakoutName,
  listBreakouts,
  createBreakout,
  assignParticipant,
  returnParticipant,
  teardownBreakouts
};