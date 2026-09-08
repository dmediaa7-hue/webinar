// Room management - in-memory room storage
const crypto = require('crypto');

const rooms = new Map();

/**
 * Create a new room
 * @param {string} roomId - Room identifier
 * @param {string} hostName - Display name of the host
 * @param {string} hostSocketId - Socket ID of the host
 * @param {string|null} password - Optional meeting password
 * @param {string} roomName - Optional meeting name
 * @returns {object} Room object
 */
function createRoom(roomId, hostName = 'Host', hostSocketId = null, password = null, roomName = null) {
  const room = {
    id: roomId,
    name: roomName || hostName + "'s Meeting",
    hostId: hostSocketId,
    createdAt: Date.now(),
    participants: new Map(), // socketId -> participant
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
  }

  rooms.set(roomId, room);
  return room;
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
 * Get participant info
 */
function getParticipant(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.participants.get(socketId) || null;
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  getRooms,
  updateParticipant,
  getParticipant,
  roomHasPassword,
  verifyPassword
};
