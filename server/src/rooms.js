// Room management - in-memory room storage, metadata persisted to SQLite (task 3)
const crypto = require('crypto');
const defaultDb = require('./db');

const rooms = new Map();

/** Upsert a room's metadata row into SQLite. */
function persistRoomMetadata(room, db = defaultDb) {
  db.prepare(`
    INSERT INTO rooms (id, name, host_id, host_name, passcode_hash, waiting_room_enabled, is_locked, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      host_id = excluded.host_id,
      host_name = excluded.host_name,
      passcode_hash = excluded.passcode_hash,
      waiting_room_enabled = excluded.waiting_room_enabled,
      is_locked = excluded.is_locked
  `).run(
    room.id,
    room.name,
    room.hostId || null,
    room.hostName || '',
    room.passwordHash || null,
    room.settings.waitingRoomEnabled ? 1 : 0,
    room.settings.isLocked ? 1 : 0,
    room.createdAt
  );
}

/** Delete a room's persisted metadata row on cleanup. */
function removePersistedRoom(roomId, db = defaultDb) {
  db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
}

/** Read persisted room metadata (id, name, hostName, hasPassword, settings). */
function getPersistedRoom(roomId, db = defaultDb) {
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    hostName: row.host_name,
    hasPassword: Boolean(row.passcode_hash),
    settings: {
      waitingRoomEnabled: Boolean(row.waiting_room_enabled),
      isLocked: Boolean(row.is_locked)
    },
    createdAt: row.created_at
  };
}

/**
 * Create a new room
 * @param {string} roomId - Room identifier
 * @param {string} hostName - Display name of the host
 * @param {string} hostSocketId - Socket ID of the host
 * @param {string|null} password - Optional meeting password
 * @param {string} roomName - Optional meeting name
 * @param {object} [db] - optional better-sqlite3 handle (defaults to shared one)
 * @returns {object} Room object
 */
function createRoom(roomId, hostName = 'Host', hostSocketId = null, password = null, roomName = null, db = defaultDb) {
  const room = {
    id: roomId,
    name: roomName || hostName + "'s Meeting",
    hostId: hostSocketId,
    hostName: hostName,
    createdAt: Date.now(),
    participants: new Map(), // socketId -> participant
    waitingList: new Map(), // socketId -> { socketId, userId, displayName, joinedAt }
    attendance: [], // { socketId, userId, displayName, isHost, joinedAt, leftAt }
    settings: {
      isLocked: false,
      waitingRoomEnabled: false,
      maxParticipants: Infinity // unlimited
    },
    passwordHash: password ? hashPassword(password) : null,
    isRecording: false,
    recordingStartTime: null,
    chatHistory: [] // last 100 messages
  };

  // Add host as first participant
  if (hostSocketId) {
    room.participants.set(hostSocketId, {
      socketId: hostSocketId,
      userId: roomId + '-host',
      displayName: hostName,
      isHost: true,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false,
      joinedAt: Date.now()
    });
    room.attendance.push({
      socketId: hostSocketId,
      userId: roomId + '-host',
      displayName: hostName,
      isHost: true,
      joinedAt: Date.now()
    });
  }

  rooms.set(roomId, room);
  persistRoomMetadata(room, db);
  return room;
}

/**
 * Create a room from a scheduled meeting (task 18): the passcode is already
 * hashed (scheduled_meetings.passcode_hash) so it is applied directly without
 * re-hashing, and the waiting-room toggle carries over. No host socket yet -
 * the first arrival becomes host through the normal join-room path.
 */
function createRoomWithHash(roomId, { hostName = 'Host', hostSocketId = null, passwordHash = null, roomName = null, waitingRoomEnabled = false, isLocked = false, db = defaultDb } = {}) {
  const room = {
    id: roomId,
    name: roomName || hostName + "'s Meeting",
    hostId: hostSocketId,
    hostName: hostName,
    createdAt: Date.now(),
    participants: new Map(),
    waitingList: new Map(),
    attendance: [],
    settings: {
      isLocked: Boolean(isLocked),
      waitingRoomEnabled: Boolean(waitingRoomEnabled),
      maxParticipants: Infinity
    },
    passwordHash,
    isRecording: false,
    recordingStartTime: null,
    chatHistory: []
  };

  if (hostSocketId) {
    room.participants.set(hostSocketId, {
      socketId: hostSocketId,
      userId: roomId + '-host',
      displayName: hostName,
      isHost: true,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false,
      joinedAt: Date.now()
    });
    room.attendance.push({
      socketId: hostSocketId,
      userId: roomId + '-host',
      displayName: hostName,
      isHost: true,
      joinedAt: Date.now()
    });
  }

  rooms.set(roomId, room);
  persistRoomMetadata(room, db);
  return room;
}

/** Merge settings changes into a room and persist the metadata. */
function updateRoomSettings(roomId, patch, db = defaultDb) {
  const room = rooms.get(roomId);
  if (!room) return null;
  Object.assign(room.settings, patch);
  persistRoomMetadata(room, db);
  return room.settings;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

function roomHasPassword(room) {
  return Boolean(room && room.passwordHash);
}

function verifyPassword(room, password) {
  if (!roomHasPassword(room)) return true;
  if (!password) return false;
  return room.passwordHash === hashPassword(password);
}

/**
 * Join a participant to a room
 * @param {string} roomId
 * @param {object} participant - { socketId, userId, displayName, isHost, isMuted, isVideoOff, isScreenSharing }
 * @returns {object} participant
 */
function joinRoom(roomId, participant) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Room not found');

  // Check max participants
  if (room.participants.size >= room.settings.maxParticipants) {
    throw new Error('Room is at maximum capacity');
  }

  const p = {
    socketId: participant.socketId,
    userId: participant.userId,
    displayName: participant.displayName || 'Guest',
    isHost: participant.isHost || false,
    isMuted: participant.isMuted || false,
    isVideoOff: participant.isVideoOff || false,
    isScreenSharing: participant.isScreenSharing || false,
    joinedAt: Date.now()
  };

  // First participant is always host if no host exists
  if (room.participants.size === 0 && !p.isHost) {
    p.isHost = true;
    room.hostId = p.socketId;
  }

  room.participants.set(p.socketId, p);

  const existing = room.attendance.find(a => a.socketId === p.socketId && !a.leftAt);
  if (existing) {
    existing.displayName = p.displayName;
    existing.isHost = p.isHost;
  } else {
    room.attendance.push({
      socketId: p.socketId,
      userId: p.userId,
      displayName: p.displayName,
      isHost: p.isHost,
      joinedAt: p.joinedAt
    });
    if (room.attendance.length > 200) room.attendance.splice(0, room.attendance.length - 200);
  }

  return p;
}

/**
 * Remove a participant from a room
 * @param {string} roomId
 * @param {string} socketId
 */
function leaveRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(socketId);
  const activeEntry = room.attendance.find(a => a.socketId === socketId && !a.leftAt);
  if (activeEntry) {
    activeEntry.leftAt = Date.now();
  } else if (participant) {
    room.attendance.push({
      socketId,
      userId: participant.userId,
      displayName: participant.displayName,
      isHost: participant.isHost,
      joinedAt: participant.joinedAt || Date.now(),
      leftAt: Date.now()
    });
  }

  room.participants.delete(socketId);

  // If this was the host, assign new host
  if (room.hostId === socketId) {
    const firstParticipant = room.participants.values().next().value;
    if (firstParticipant) {
      firstParticipant.isHost = true;
      room.hostId = firstParticipant.socketId;
    } else {
      room.hostId = null;
    }
  }

  // Clean up empty rooms after 5 minutes
  if (room.participants.size === 0) {
    setTimeout(() => {
      const r = rooms.get(roomId);
      if (r && r.participants.size === 0) {
        rooms.delete(roomId);
        removePersistedRoom(roomId);
        console.log(`[🗑] Room ${roomId} cleaned up (empty)`);
      }
    }, 300000);
  }

  return room;
}

/**
 * Get a room by ID
 */
function getRoom(roomId) {
  return rooms.get(roomId);
}

/**
 * Get all rooms
 */
function getRooms() {
  return rooms;
}

/**
 * Update a participant's properties
 */
function updateParticipant(roomId, socketId, updates) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const participant = room.participants.get(socketId);
  if (!participant) return null;
  Object.assign(participant, updates);
  return participant;
}

/**
 * Hold a joiner in the waiting room (denied publish access until admitted).
 * @returns {{ok:true}|{ok:false,error:string}}
 */
function addWaiting(roomId, participant) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
  room.waitingList.set(participant.socketId, {
    socketId: participant.socketId,
    userId: participant.userId,
    displayName: participant.displayName || 'Guest',
    joinedAt: Date.now()
  });
  return { ok: true };
}

/** @returns {Array} waiting entries, oldest first */
function getWaitingList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.waitingList.values());
}

function isWaiting(roomId, socketId) {
  const room = rooms.get(roomId);
  return Boolean(room && room.waitingList.has(socketId));
}

/** @returns {boolean} true if an entry was removed */
function removeWaiting(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  return room.waitingList.delete(socketId);
}

/**
 * Get participant info
 */
function getParticipant(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.participants.get(socketId) || null;
}

/**
 * Get the attendance log for a room
 */
function getAttendance(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return room.attendance;
}

module.exports = {
  createRoom,
  createRoomWithHash,
  joinRoom,
  leaveRoom,
  getRoom,
  getRooms,
  updateParticipant,
  getParticipant,
  getAttendance,
  roomHasPassword,
  verifyPassword,
  updateRoomSettings,
  persistRoomMetadata,
  removePersistedRoom,
  getPersistedRoom,
  addWaiting,
  getWaitingList,
  isWaiting,
  removeWaiting
};
