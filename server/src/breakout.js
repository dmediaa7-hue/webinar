// Breakout rooms (task 12) - multi-room simulation + moveParticipant.
// LiveKit has no native breakout concept (issue #482), so breakouts are
// simulated as separate rooms named '{mainRoom}:1', '{mainRoom}:2', ... and
// the host moves participants between them with RoomServiceClient
// .moveParticipant(room, identity, destinationRoom). Breakout config +
// assignments are persisted to SQLite so the layout survives restarts.
// Every helper returns gracefully when LiveKit keys are absent:
//   { error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED' }
const { getRoom } = require('./rooms');
const livekit = require('./livekit');
const defaultDb = require('./db');

/** True when the server has LIVEKIT_URL + API key/secret configured. */
function isConfigured() {
  return livekit.isConfigured();
}

/** LiveKit room name for a breakout: '{mainRoom}:{name}'. */
function breakoutRoomName(mainRoom, name) {
  return `${mainRoom}:${name}`;
}

/** Sanitize a breakout label; null when invalid (empty or >24 chars or bad chars). */
function cleanBreakoutName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 24) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

/** Next auto-numbered breakout label for a room (1, 2, 3, ...). */
function nextBreakoutName(mainRoom, excludeNames = [], db = defaultDb) {
  const rows = db.prepare(
    'SELECT breakout_name FROM breakout_rooms WHERE main_room = ?'
  ).all(mainRoom);
  const used = new Set(excludeNames.concat(rows.map((r) => r.breakout_name)));
  let n = 1;
  while (used.has(String(n))) n += 1;
  return String(n);
}

/** List breakouts for a room with their assigned identities. */
function listBreakouts(roomId, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const rooms = db.prepare(
    'SELECT * FROM breakout_rooms WHERE main_room = ? ORDER BY id ASC'
  ).all(roomId);
  const assignments = db.prepare(
    'SELECT * FROM breakout_assignments WHERE main_room = ?'
  ).all(roomId);

  const breakout = rooms.map((r) => ({
    name: r.breakout_name,
    livekitRoom: r.livekit_room,
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
      breakoutName: a.breakout_name,
      livekitRoom: breakoutRoomName(roomId, a.breakout_name)
    }))
  };
}

/**
 * Provision a breakout room on the SFU + persist it. Name is optional; a
 * missing/invalid name auto-numbers from the existing breakouts.
 * @returns {Promise<{breakout, roomId}|{error, code}>}
 */
async function createBreakout(roomId, srcName = null, hostIdentity = null, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const name = cleanBreakoutName(srcName) || nextBreakoutName(roomId, [srcName], db);
  const livekitRoom = breakoutRoomName(roomId, name);

  const exists = db.prepare(
    'SELECT id FROM breakout_rooms WHERE main_room = ? AND breakout_name = ?'
  ).get(roomId, name);
  if (exists) return { error: `Breakout '${name}' already exists`, code: 'DUPLICATE_BREAKOUT' };

  if (!isConfigured()) {
    return { error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED' };
  }

  try {
    await livekit.createRoom(livekitRoom);
  } catch (err) {
    return { error: err.message || 'Failed to provision breakout room' };
  }

  const breakout = {
    name,
    livekitRoom,
    createdBy: hostIdentity,
    createdAt: Date.now()
  };
  db.prepare(`
    INSERT INTO breakout_rooms (main_room, breakout_name, livekit_room, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(roomId, name, livekitRoom, hostIdentity, breakout.createdAt);

  return { roomId, breakout };
}

/**
 * Move a participant into a breakout room. The participant's current room is
 * read from the persisted assignment (or the main room when unassigned), then
 * moveParticipant relocates their existing connection to '{main}:{name}'.
 * @returns {Promise<{ok:true, livekitRoom, identity}|{error, code}>}
 */
async function assignParticipant(roomId, identity, breakoutName, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const label = cleanBreakoutName(breakoutName);
  if (!label) return { error: 'Invalid breakout name' };

  const breakout = db.prepare(
    'SELECT * FROM breakout_rooms WHERE main_room = ? AND breakout_name = ?'
  ).get(roomId, label);
  if (!breakout) return { error: `Breakout '${label}' does not exist`, code: 'BREAKOUT_NOT_FOUND' };

  const isParticipant = room.participants.has(identity);
  if (!isParticipant) return { error: 'Participant not in room', code: 'PARTICIPANT_NOT_FOUND' };

  if (!isConfigured()) {
    return { error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED' };
  }

  const current = db.prepare(
    'SELECT breakout_name FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?'
  ).get(roomId, identity);
  const fromRoom = current ? breakoutRoomName(roomId, current.breakout_name) : roomId;
  const toRoom = breakoutRoomName(roomId, label);

  try {
    await livekit.moveParticipant(fromRoom, identity, toRoom);
  } catch (err) {
    return { error: err.message || 'Failed to move participant' };
  }

  db.prepare(`
    INSERT INTO breakout_assignments (main_room, breakout_name, participant_identity, assigned_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(main_room, participant_identity) DO UPDATE SET breakout_name = excluded.breakout_name
  `).run(roomId, label, identity, Date.now());

  return { ok: true, identity, livekitRoom: toRoom, roomId };
}

/**
 * Move a participant back to the main room from their assigned breakout.
 * @returns {Promise<{ok:true, livekitRoom, identity}|{error, code}>}
 */
async function returnParticipant(roomId, identity, db = defaultDb) {
  const assignment = db.prepare(
    'SELECT breakout_name FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?'
  ).get(roomId, identity);
  if (!assignment) {
    return { ok: true, identity, livekitRoom: roomId, alreadyInMain: true };
  }

  const fromRoom = breakoutRoomName(roomId, assignment.breakout_name);

  if (!isConfigured()) {
    return { error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED' };
  }

  try {
    await livekit.moveParticipant(fromRoom, identity, roomId);
  } catch (err) {
    return { error: err.message || 'Failed to return participant' };
  }

  db.prepare(
    'DELETE FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?'
  ).run(roomId, identity);

  return { ok: true, identity, livekitRoom: roomId, roomId };
}

/**
 * End breakouts: move every assigned participant back to the main room, tear
 * down the '{main}:N' rooms on the SFU, and clear the persisted layout.
 */
async function teardownBreakouts(roomId, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const assignments = db.prepare(
    'SELECT * FROM breakout_assignments WHERE main_room = ?'
  ).all(roomId);
  const breakoutRows = db.prepare(
    'SELECT livekit_room FROM breakout_rooms WHERE main_room = ?'
  ).all(roomId);

  if (!isConfigured()) {
    return { error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED' };
  }

  const moveErrors = [];
  for (const a of assignments) {
    const fromRoom = breakoutRoomName(roomId, a.breakout_name);
    try {
      await livekit.moveParticipant(fromRoom, a.participant_identity, roomId);
    } catch (err) {
      moveErrors.push(err.message || 'move failed');
    }
  }

  const deleteErrors = [];
  for (const r of breakoutRows) {
    try {
      await livekit.deleteRoom(r.livekit_room);
    } catch (err) {
      deleteErrors.push(err.message || 'delete failed');
    }
  }

  db.prepare('DELETE FROM breakout_assignments WHERE main_room = ?').run(roomId);
  db.prepare('DELETE FROM breakout_rooms WHERE main_room = ?').run(roomId);

  const remainingErrors = moveErrors.concat(deleteErrors);
  return remainingErrors.length
    ? { ok: true, roomId, removed: breakoutRows.length, errors: remainingErrors }
    : { ok: true, roomId, removed: breakoutRows.length };
}

module.exports = {
  isConfigured,
  breakoutRoomName,
  cleanBreakoutName,
  nextBreakoutName,
  listBreakouts,
  createBreakout,
  assignParticipant,
  returnParticipant,
  teardownBreakouts
};