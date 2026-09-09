// LiveKit admin operations: host controls (mute / kick / lock) enforced
// server-side. The RoomServiceClient speaks to the LiveKit SFU control plane
// and requires LIVEKIT_URL + API key/secret; every helper returns a
// { ok:false, error:'LIVEKIT_NOT_CONFIGURED' } result when keys are absent so
// the rest of the app degrades gracefully and tests can run without an SFU.
const livekit = require('./livekit');
const { updateRoomSettings, getRoom } = require('./rooms');

// TrackSource enum from @livekit/protocol (transitive dep, so use the constant).
// MICROPHONE = 2. Used to pick the participant's audio track sid for mute.
const TRACK_SOURCE_MICROPHONE = 2;

/**
 * Mute a participant's audio tracks on the SFU.
 * The SDK requires a concrete track sid (mutePublishedTrack(room, identity,
 * trackSid, muted)); we resolve it from listParticipants and mute every
 * live microphone track, so a participant with re-published audio after an
 * unmute round-trip stays muted.
 * @returns {Promise<{ok:true, mutedTracks:number}|{ok:false,error:string}>}
 */
async function muteParticipant(roomName, identity) {
  let svc;
  try {
    svc = livekit.getRoomService();
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }

  try {
    const participants = await svc.listParticipants(roomName);
    const target = participants.find((p) => p.identity === identity);
    if (!target) return { ok: false, error: 'PARTICIPANT_NOT_FOUND' };

    const micTracks = (target.tracks || []).filter((t) => t.source === TRACK_SOURCE_MICROPHONE);
    let mutedTracks = 0;
    for (const track of micTracks) {
      // Muting an already-muted track is a safe no-op on the SFU.
      await svc.mutePublishedTrack(roomName, identity, track.sid, true);
      mutedTracks += 1;
    }
    return { ok: true, mutedTracks };
  } catch (err) {
    return { ok: false, error: err.message || 'LiveKit admin mute failed' };
  }
}

/**
 * Remove (kick) a participant from the LiveKit room. The client's socket is
 * disconnected separately by the socket layer; this severs the SFU session.
 * @returns {Promise<{ok:true}|{ok:false,error:string}>}
 */
async function removeParticipant(roomName, identity) {
  let svc;
  try {
    svc = livekit.getRoomService();
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }

  try {
    await svc.removeParticipant(roomName, identity);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'LiveKit admin remove failed' };
  }
}

/**
 * Server-side room lock: persist isLocked in SQLite (survives restarts) and
 * gate future joins. LiveKit itself has no "locked" flag, so refusal is
 * enforced at token issuance (see index.js /api/livekit/token): non-host
 * identities get a 403 ROOM_LOCKED while the room is locked.
 * @returns {{ok:true, settings}|{ok:false,error:string}}
 */
function setRoomLocked(roomId, isLocked) {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
  const settings = updateRoomSettings(roomId, { isLocked: Boolean(isLocked) });
  return { ok: true, settings };
}

/**
 * True when the room exists and its persisted lock setting is on.
 */
function isRoomLocked(roomId) {
  const room = getRoom(roomId);
  return Boolean(room && room.settings && room.settings.isLocked);
}

module.exports = {
  muteParticipant,
  removeParticipant,
  setRoomLocked,
  isRoomLocked,
  TRACK_SOURCE_MICROPHONE
};