// Unit tests for the LiveKit Egress recording module (task 9).
// Mocks EgressClient so no SFU/network is required; asserts the SDK call
// shape (room name + encoded file output + H.264 1080p preset) and the
// LIVEKIT_NOT_CONFIGURED graceful-degrade path when env keys are absent.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const { EgressClient, EncodedFileOutput, EncodingOptionsPreset } = require('livekit-server-sdk');
const rooms = require('../src/rooms');
const recording = require('../src/recording');

function newDb() {
  return createDatabase(':memory:');
}

/** Set fake LiveKit env keys for the duration of a test. */
function withLiveKitEnv(t) {
  process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880';
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret';
  t.after(() => {
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
  });
}

/** Create a room in the shared in-memory registry + test db. */
function makeRoom(roomId, db) {
  return rooms.createRoom(roomId, 'Host', 'sock-1', null, null, db);
}

test('start recording without LiveKit keys returns LIVEKIT_NOT_CONFIGURED', async () => {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;

  const db = newDb();
  const roomId = 'room-unconfig-1';
  makeRoom(roomId, db);

  const result = await recording.startRecording(roomId, db);

  assert.equal(result.error, 'LiveKit is not configured');
  assert.equal(result.code, 'LIVEKIT_NOT_CONFIGURED');
  assert.equal(result.isRecording, false);
  assert.equal(rooms.getRoom(roomId).isRecording, false);
  db.close();
});

test('startRecording creates room-composite egress with encoded output and 1080p preset', async (t) => {
  const db = newDb();
  const roomId = 'room-egress-1';
  makeRoom(roomId, db);
  withLiveKitEnv(t);

  const startMock = t.mock.method(EgressClient.prototype, 'startRoomCompositeEgress', async () => ({ egressId: 'EG_AB12' }));

  const result = await recording.startRecording(roomId, db);

  assert.equal(startMock.mock.callCount(), 1);
  const [calledRoom, output, options] = startMock.mock.calls[0].arguments;
  assert.equal(calledRoom, roomId);
  assert.ok(output instanceof EncodedFileOutput, 'output is EncodedFileOutput');
  assert.ok(output.filepath.startsWith(`recordings/${roomId}/`), 'filepath under recordings/<roomId>/');
  assert.ok(output.filepath.endsWith('.mp4'), 'filepath ends with .mp4');
  assert.equal(options.layout, 'grid');
  assert.equal(options.encodingOptions, EncodingOptionsPreset.H264_1080P_30);

  assert.equal(result.isRecording, true);
  assert.equal(result.egressId, 'EG_AB12');

  const row = db.prepare('SELECT * FROM recordings WHERE room_name = ?').get(roomId);
  assert.ok(row, 'recording row inserted');
  assert.equal(row.status, 'active');
  assert.equal(row.egress_id, 'EG_AB12');
  db.close();
});

test('getRecordingStatus surfaces persisted egress id and url', async (t) => {
  const db = newDb();
  const roomId = 'room-status-1';
  makeRoom(roomId, db);
  withLiveKitEnv(t);

  t.mock.method(EgressClient.prototype, 'startRoomCompositeEgress', async () => ({ egressId: 'EG_ST01' }));
  await recording.startRecording(roomId, db);

  const status = recording.getRecordingStatus(roomId, db);

  assert.equal(status.isRecording, true);
  assert.equal(status.egressId, 'EG_ST01');
  assert.ok(status.url.startsWith(`recordings/${roomId}/`), 'url path persisted');
  assert.equal(status.status, 'active');
  db.close();
});

test('stopRecording calls stopEgress with stored id and marks row stopped', async (t) => {
  const db = newDb();
  const roomId = 'room-stop-1';
  makeRoom(roomId, db);
  withLiveKitEnv(t);

  t.mock.method(EgressClient.prototype, 'startRoomCompositeEgress', async () => ({ egressId: 'EG_STOP1' }));
  await recording.startRecording(roomId, db);

  const stopMock = t.mock.method(EgressClient.prototype, 'stopEgress', async () => ({}));

  const result = await recording.stopRecording(roomId, db);

  assert.equal(stopMock.mock.callCount(), 1);
  assert.equal(stopMock.mock.calls[0].arguments[0], 'EG_STOP1');
  assert.equal(result.isRecording, false);
  assert.ok(result.durationMs >= 0, 'duration computed');

  const row = db.prepare('SELECT * FROM recordings WHERE room_name = ?').get(roomId);
  assert.equal(row.status, 'stopped');
  db.close();
});

test('starting twice is rejected as Already recording', async (t) => {
  const db = newDb();
  const roomId = 'room-double-1';
  makeRoom(roomId, db);
  withLiveKitEnv(t);

  t.mock.method(EgressClient.prototype, 'startRoomCompositeEgress', async () => ({ egressId: 'EG_DBL1' }));
  await recording.startRecording(roomId, db);

  const second = await recording.startRecording(roomId, db);
  assert.equal(second.error, 'Already recording');
  assert.equal(second.isRecording, true);
  db.close();
});

test('stop on a non-recording room returns error', async () => {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;

  const db = newDb();
  const roomId = 'room-norec-1';
  makeRoom(roomId, db);

  const result = await recording.stopRecording(roomId, db);
  assert.equal(result.error, 'Not recording');
  db.close();
});