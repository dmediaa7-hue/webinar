// LiveKit integration: access-token generation + admin ops.
// Uses livekit-server-sdk. Requires LIVEKIT_URL, LIVEKIT_API_KEY,
// LIVEKIT_API_SECRET in server/.env. All helpers return gracefully when
// LiveKit is not configured so the rest of the app can degrade cleanly.
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

function isConfigured() {
  return Boolean(
    process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET
  );
}

function getServerUrl() {
  return process.env.LIVEKIT_URL || '';
}

function getApiKey() {
  return process.env.LIVEKIT_API_KEY || '';
}

function getApiSecret() {
  return process.env.LIVEKIT_API_SECRET || '';
}

/**
 * Generate a short-lived join token for a room.
 * @param {object} opts { room, identity, name, canPublish, canSubscribe, roomAdmin }
 * @returns {Promise<{token:string, serverUrl:string}>}
 */
async function createJoinToken({ room, identity, name, canPublish = true, canSubscribe = true, roomAdmin = false }) {
  if (!isConfigured()) {
    const err = new Error('LiveKit is not configured');
    err.code = 'LIVEKIT_NOT_CONFIGURED';
    throw err;
  }
  const at = new AccessToken(getApiKey(), getApiSecret(), { ttl: '1h' });
  at.identity = String(identity || '');
  at.name = String(name || identity || '');
  at.addGrant({ room, roomJoin: true, canPublish, canSubscribe, roomAdmin });
  return { token: await at.toJwt(), serverUrl: getServerUrl() };
}

let roomService = null;
function getRoomService() {
  if (!isConfigured()) {
    const err = new Error('LiveKit is not configured');
    err.code = 'LIVEKIT_NOT_CONFIGURED';
    throw err;
  }
  if (!roomService) {
    roomService = new RoomServiceClient(getServerUrl(), getApiKey(), getApiSecret());
  }
  return roomService;
}

/**
 * Mute a participant's audio track (host action).
 */
async function muteParticipant(room, identity) {
  const svc = getRoomService();
  return svc.mutePublishedTrack(room, identity, 'audio', true);
}

/**
 * Remove (kick) a participant from a room.
 */
async function removeParticipant(room, identity) {
  const svc = getRoomService();
  return svc.removeParticipant(room, identity);
}

/**
 * Move a participant to another room (used for breakout rooms).
 */
async function moveParticipant(room, identity, destinationRoom) {
  const svc = getRoomService();
  return svc.moveParticipant(room, identity, destinationRoom);
}

/**
 * Send a data message to all participants in a room (admin/broadcast).
 */
async function sendData(room, data, topic) {
  const svc = getRoomService();
  const encoder = new TextEncoder();
  return svc.sendData(room, encoder.encode(typeof data === 'string' ? data : JSON.stringify(data)), 'RELIABLE', { topic });
}

module.exports = {
  isConfigured,
  getServerUrl,
  getApiKey,
  getApiSecret,
  createJoinToken,
  muteParticipant,
  removeParticipant,
  moveParticipant,
  sendData
};
