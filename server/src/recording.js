// Cloud recording via LiveKit Egress (task 9).
// Replaces the simulated recording service. Start/stop call the LiveKit SFU's
// room-composite egress so the meeting is transcoded and stored as a file.
// Every helper returns gracefully when LiveKit keys are absent:
//   { error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED' }
// so the app keeps working and the UI can disable the recording button.
const { EgressClient, EncodedFileOutput, EncodingOptionsPreset } = require('livekit-server-sdk');
const { getRoom } = require('./rooms');
const livekit = require('./livekit');
const defaultDb = require('./db');

let egressClient = null;

/** True when the server has LIVEKIT_URL + API key/secret configured. */
function isConfigured() {
  return livekit.isConfigured();
}

/**
 * Lazily-built EgressClient. Callers must pass through isConfigured() first;
 * this throws code LIVEKIT_NOT_CONFIGURED when the env keys are absent.
 */
function getEgressClient() {
  if (!isConfigured()) {
    const err = new Error('LiveKit is not configured');
    err.code = 'LIVEKIT_NOT_CONFIGURED';
    throw err;
  }
  if (!egressClient) {
    egressClient = new EgressClient(
      livekit.getServerUrl(),
      livekit.getApiKey(),
      livekit.getApiSecret()
    );
  }
  return egressClient;
}

/**
 * Optional S3 file-output config, read from S3_* env vars. Returns null when
 * no bucket is configured so the SDK emits a plain filepath output instead.
 */
function s3ConfigFromEnv() {
  if (!process.env.S3_BUCKET) return null;
  return {
    accessKey: process.env.S3_ACCESS_KEY || '',
    secret: process.env.S3_SECRET || '',
    endpoint: process.env.S3_ENDPOINT || '',
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
  };
}

/**
 * Get recording status for a room. Reads the in-memory room flags (kept for
 * instant UI state) plus the latest persisted recordings row (egress id, url).
 */
function getRecordingStatus(roomId, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  const row = db.prepare(
    'SELECT * FROM recordings WHERE room_name = ? ORDER BY id DESC LIMIT 1'
  ).get(roomId);

  return {
    isRecording: room.isRecording,
    startedAt: room.recordingStartTime,
    durationMs: room.isRecording ? (Date.now() - room.recordingStartTime) : 0,
    egressId: row ? row.egress_id : null,
    url: row ? row.url : null,
    status: row ? row.status : null
  };
}

/**
 * Start a room-composite egress for the room and persist a recording row.
 * Returns { isRecording, egressId, startedAt, ... } on success or
 * { error, code } on failure (never throws).
 */
async function startRecording(roomId, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  if (room.isRecording) {
    return { error: 'Already recording', isRecording: true };
  }

  if (!isConfigured()) {
    return { error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED', isRecording: false };
  }

  const filepath = `recordings/${roomId}/${Date.now()}.mp4`;
  const s3 = s3ConfigFromEnv();
  const fileOutput = s3
    ? new EncodedFileOutput({ filepath, s3 })
    : new EncodedFileOutput({ filepath });

  try {
    const info = await getEgressClient().startRoomCompositeEgress(
      roomId,
      fileOutput,
      { layout: 'grid', encodingOptions: EncodingOptionsPreset.H264_1080P_30 }
    );

    room.isRecording = true;
    room.recordingStartTime = Date.now();

    db.prepare(`
      INSERT INTO recordings (room_name, egress_id, url, status, started_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(roomId, info.egressId || null, filepath, 'active', room.recordingStartTime, Date.now());

    return {
      isRecording: true,
      egressId: info.egressId || null,
      startedAt: room.recordingStartTime,
      message: 'Recording started'
    };
  } catch (err) {
    return { error: err.message || 'Failed to start recording', isRecording: false };
  }
}

/**
 * Stop the active egress for the room and mark the recording row stopped.
 * Returns { isRecording, durationMs, recordingUrl, egressId } on success.
 */
async function stopRecording(roomId, db = defaultDb) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  if (!room.isRecording) {
    return { error: 'Not recording', isRecording: false };
  }

  if (!isConfigured()) {
    return { error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED', isRecording: false };
  }

  const row = db.prepare(
    'SELECT * FROM recordings WHERE room_name = ? AND status = ? ORDER BY id DESC LIMIT 1'
  ).get(roomId, 'active');

  const durationMs = Date.now() - (room.recordingStartTime || Date.now());

  try {
    if (row && row.egress_id) {
      await getEgressClient().stopEgress(row.egress_id);
    }

    if (row) {
      db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('stopped', row.id);
    }

    room.isRecording = false;
    room.recordingStartTime = null;

    return {
      isRecording: false,
      durationMs,
      recordingUrl: row ? row.url : null,
      egressId: row ? row.egress_id : null,
      message: 'Recording stopped'
    };
  } catch (err) {
    return { error: err.message || 'Failed to stop recording', isRecording: room.isRecording };
  }
}

module.exports = {
  getRecordingStatus,
  startRecording,
  stopRecording,
  isConfigured,
  getEgressClient
};