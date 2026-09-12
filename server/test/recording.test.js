// Unit + integration tests for the local-disk recording upload endpoint.
// saveRecording writes a base64 webm blob to a host folder and persists a
// recordings row; the self-harnessed REST test asserts host-gating, the file
// landing on disk, and the status lookup.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');

const { createDatabase } = require('../src/db');
const rooms = require('../src/rooms');
const recording = require('../src/recording');

async function newDb() {
  return createDatabase(':memory:');
}

async function makeRoom(roomId, db) {
  return rooms.createRoom(roomId, 'Host', 'sock-1', null, 'Record Room', db);
}

test('saveRecording writes the file, inserts a completed row, and returns id+path', async () => {
  const db = await newDb();
  const roomId = 'room-save-1';
  await makeRoom(roomId, db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-test-'));
  const filename = 'test.webm';

  try {
    const result = await recording.saveRecording({
      roomName: 'Record Room',
      folder: dir,
      filename,
      base64Data: Buffer.from('fake-webm').toString('base64')
    }, db);

    assert.ok(result.id > 0, 'id returned');
    assert.equal(result.path, path.join(dir, filename));
    assert.equal(fs.existsSync(result.path), true, 'file exists on disk');
    assert.deepEqual(fs.readFileSync(result.path), Buffer.from('fake-webm'), 'bytes round-trip');

    const row = await db.get('SELECT * FROM recordings WHERE room_name = ?', 'Record Room');
    assert.ok(row, 'recording row inserted');
    assert.equal(row.status, 'completed');
    assert.equal(row.url, result.path);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await db.close();
  }
});

test('saveRecording creates nested folders recursively', async () => {
  const db = await newDb();
  await makeRoom('room-nested-1', db);
  const dir = path.join(os.tmpdir(), `rec-nested-${Date.now()}`, 'sub', 'dir');

  try {
    const result = await recording.saveRecording({
      roomName: 'Record Room',
      folder: dir,
      filename: 'clip.webm',
      base64Data: Buffer.from('blob').toString('base64')
    }, db);
    assert.equal(fs.existsSync(result.path), true, 'nested file exists');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await db.close();
  }
});

test('saveRecording rejects an invalid filename', async () => {
  const db = await newDb();
  await makeRoom('room-badname-1', db);
  await assert.rejects(
    recording.saveRecording({
      roomName: 'Record Room',
      folder: os.tmpdir(),
      filename: '../../evil.webm',
      base64Data: 'x'
    }, db),
    /Invalid filename/
  );
  await db.close();
});

// --- Self-harnessed REST upload flow ---

const TEST_PORT = 3020;
const SERVER_URL = `http://localhost:${TEST_PORT}`;
const serverDir = path.join(__dirname, '..');

async function waitForServer(proc, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (proc.exitCode !== null) throw new Error('Server exited before becoming ready');
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready in time');
}

function connectClient() {
  const client = io(SERVER_URL, { transports: ['websocket'] });
  return new Promise((resolve, reject) => {
    client.on('connect', () => resolve(client));
    client.on('connect_error', reject);
  });
}

function emitAck(client, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    client.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

test('upload endpoint stores the file and status returns the row; non-host is 403', async (t) => {
  const proc = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(TEST_PORT) }
  });

  t.after(() => {
    proc.kill();
  });

  await waitForServer(proc);

  const host = await connectClient();
  const guest = await connectClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-upload-'));
  const filename = 'test.webm';

  try {
    const created = await emitAck(host, 'create-room', { displayName: 'Host A', roomName: 'Rec Upload' });
    assert.equal(created.success, true, 'room created');
    const roomId = created.roomId;

    await emitAck(guest, 'join-room', { roomId, displayName: 'Guest B' });

    const body = {
      folder: dir,
      filename,
      data: Buffer.from('fake-webm').toString('base64'),
      hostId: host.id
    };

    const guestRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': guest.id },
      body: JSON.stringify(body)
    });
    assert.equal(guestRes.status, 403, 'non-host upload is forbidden');

    const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: JSON.stringify(body)
    });
    assert.equal(res.status, 200, 'host upload succeeds');
    const result = await res.json();
    assert.ok(result.id > 0, 'response carries an id');
    assert.equal(result.path, path.join(dir, filename), 'response carries the absolute path');
    assert.equal(fs.existsSync(result.path), true, 'file exists on disk after upload');

    // Regression: real .webm recordings are base64 blobs far above the 100kb
    // express.json() default - the global parser used to 413 the request before
    // the route ran (remapped to 500), so a ~1.37MB base64 payload must now
    // succeed and land on disk.
    const bigFilename = 'large.webm';
    const bigRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: JSON.stringify({
        folder: dir,
        filename: bigFilename,
        data: Buffer.alloc(1024 * 1024, 7).toString('base64'),
        hostId: host.id
      })
    });
    assert.equal(bigRes.status, 200, 'large host upload succeeds (limit raised)');
    assert.equal(fs.existsSync(path.join(dir, bigFilename)), true, 'large file exists on disk');

    const statusRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/status`, {
      headers: { 'x-host-id': host.id }
    });
    assert.equal(statusRes.status, 200, 'status lookup succeeds');
    const status = await statusRes.json();
    assert.equal(status.recordings.length >= 1, true, 'status returns uploaded rows');
    const statusRow = status.recordings.find((r) => r.filename === filename);
    assert.ok(statusRow, 'status contains the freshly uploaded row');
    assert.equal(statusRow.status, 'completed');
  } finally {
    host.disconnect();
    guest.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Recording lifecycle: direct-db tests ---

test('startRecording creates a recording row with started_at and started_by', async () => {
  const db = await newDb();
  try {
    const { id } = await recording.startRecording({ roomName: 'Lifecycle Room', startedBy: 'sock-h' }, db);
    assert.ok(id > 0, 'id returned');
    const row = await db.get('SELECT * FROM recordings WHERE id = ?', id);
    assert.equal(row.status, 'recording');
    assert.ok(row.started_at > 0, 'started_at set');
    assert.equal(row.started_by, 'sock-h');
    assert.equal(row.ended_at, null);
    assert.equal(row.duration_ms, null);
  } finally {
    await db.close();
  }
});

test('start -> stop transitions to processing and sets ended_at', async () => {
  const db = await newDb();
  try {
    const { id } = await recording.startRecording({ roomName: 'Lifecycle Room', startedBy: 'sock-h' }, db);
    await recording.stopRecording({ id }, db);
    const row = await db.get('SELECT * FROM recordings WHERE id = ?', id);
    assert.equal(row.status, 'processing');
    assert.ok(row.ended_at >= row.started_at, 'ended_at set on stop');
  } finally {
    await db.close();
  }
});

test('start -> stop -> saveRecording(recordingId) completes the row and computes duration_ms', async () => {
  const db = await newDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-life-'));
  try {
    const { id } = await recording.startRecording({ roomName: 'Lifecycle Room', startedBy: 'sock-h' }, db);
    await recording.stopRecording({ id }, db);

    const result = await recording.saveRecording({
      roomName: 'Lifecycle Room',
      folder: dir,
      filename: 'life.webm',
      base64Data: Buffer.from('blob').toString('base64'),
      recordingId: id
    }, db);

    assert.equal(result.id, id, 'returns the same recordingId');
    assert.equal(result.path, path.join(dir, 'life.webm'));

    const row = await db.get('SELECT * FROM recordings WHERE id = ?', id);
    assert.equal(row.status, 'completed');
    assert.equal(row.folder, dir);
    assert.equal(row.url, result.path);
    assert.ok(row.ended_at > 0, 'ended_at preserved');
    assert.equal(row.duration_ms, row.ended_at - row.started_at, 'duration_ms computed from ended_at - started_at');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await db.close();
  }
});

test('cancelRecording and failRecording transition processing rows; later calls no-op', async () => {
  const db = await newDb();
  try {
    const s1 = await recording.startRecording({ roomName: 'LC', startedBy: 's' }, db);
    await recording.stopRecording({ id: s1.id }, db);
    await recording.cancelRecording({ id: s1.id }, db);
    let row = await db.get('SELECT * FROM recordings WHERE id = ?', s1.id);
    assert.equal(row.status, 'cancelled');
    assert.ok(row.ended_at > 0, 'cancelled row has ended_at');
    await recording.cancelRecording({ id: s1.id }, db);
    row = await db.get('SELECT * FROM recordings WHERE id = ?', s1.id);
    assert.equal(row.status, 'cancelled', 'second cancel is a safe no-op');

    const s2 = await recording.startRecording({ roomName: 'LC', startedBy: 's' }, db);
    await recording.stopRecording({ id: s2.id }, db);
    await recording.failRecording({ id: s2.id }, db);
    row = await db.get('SELECT * FROM recordings WHERE id = ?', s2.id);
    assert.equal(row.status, 'failed');
    await recording.failRecording({ id: s2.id }, db);
    row = await db.get('SELECT * FROM recordings WHERE id = ?', s2.id);
    assert.equal(row.status, 'failed', 'second fail is a safe no-op');
  } finally {
    await db.close();
  }
});

test('stop/cancel/fail on a completed row keep it completed', async () => {
  const db = await newDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-completed-'));
  try {
    const { id } = await recording.startRecording({ roomName: 'LC', startedBy: 's' }, db);
    await recording.stopRecording({ id }, db);
    await recording.saveRecording({
      roomName: 'LC',
      folder: dir,
      filename: 'done.webm',
      base64Data: Buffer.from('x').toString('base64'),
      recordingId: id
    }, db);
    const before = await db.get('SELECT * FROM recordings WHERE id = ?', id);
    assert.equal(before.status, 'completed');

    await recording.stopRecording({ id }, db);
    await recording.cancelRecording({ id }, db);
    await recording.failRecording({ id }, db);

    const row = await db.get('SELECT * FROM recordings WHERE id = ?', id);
    assert.equal(row.status, 'completed', 'status preserved after no-op lifecycle calls');
    assert.equal(row.ended_at, before.ended_at, 'ended_at untouched');
    assert.equal(row.duration_ms, before.duration_ms, 'duration_ms untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await db.close();
  }
});

// --- Recording lifecycle: REST tests ---

test('host recording lifecycle over REST: start -> status -> stop -> upload completes the same row', async (t) => {
  const proc = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(TEST_PORT) }
  });

  t.after(() => {
    proc.kill();
  });

  await waitForServer(proc);

  const host = await connectClient();
  const guest = await connectClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-rest-life-'));

  try {
    const created = await emitAck(host, 'create-room', { displayName: 'Host A', roomName: 'Rec Lifecycle' });
    assert.equal(created.success, true, 'room created');
    const roomId = created.roomId;
    await emitAck(guest, 'join-room', { roomId, displayName: 'Guest B' });

    const base = `${SERVER_URL}/api/rooms/${roomId}/recording`;

    const nonHostStart = await fetch(`${base}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': guest.id },
      body: '{}'
    });
    assert.equal(nonHostStart.status, 403, 'non-host start is forbidden');

    const startRes = await fetch(`${base}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: '{}'
    });
    assert.equal(startRes.status, 200, 'host start succeeds');
    const started = await startRes.json();
    assert.ok(started.recordingId > 0, 'recordingId returned');
    assert.equal(started.ok, true);

    let statusRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/status`, {
      headers: { 'x-host-id': host.id }
    });
    assert.equal(statusRes.status, 200, 'status lookup succeeds');
    let status = await statusRes.json();
    let row = status.recordings.find((r) => r.id === started.recordingId);
    assert.ok(row, 'status lists the new recording');
    assert.equal(row.status, 'recording', 'row is in recording state');
    assert.ok(typeof row.startedAt === 'number' && row.startedAt > 0, 'startedAt present');

    const stopRes = await fetch(`${base}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: JSON.stringify({ recordingId: started.recordingId })
    });
    assert.equal(stopRes.status, 200, 'host stop succeeds');
    const stopped = await stopRes.json();
    assert.equal(stopped.ok, true);

    statusRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/status`, {
      headers: { 'x-host-id': host.id }
    });
    status = await statusRes.json();
    row = status.recordings.find((r) => r.id === started.recordingId);
    assert.equal(row.status, 'processing', 'row transitioned to processing');
    assert.ok(typeof row.endedAt === 'number', 'endedAt set on stop');

    const uploadRes = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: JSON.stringify({
        folder: dir,
        filename: 'rest-life.webm',
        data: Buffer.from('fake-webm').toString('base64'),
        hostId: host.id,
        recordingId: started.recordingId
      })
    });
    assert.equal(uploadRes.status, 200, 'upload with recordingId succeeds');
    const uploaded = await uploadRes.json();
    assert.equal(uploaded.id, started.recordingId, 'upload completes the SAME row');

    statusRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/status`, {
      headers: { 'x-host-id': host.id }
    });
    status = await statusRes.json();
    row = status.recordings.find((r) => r.id === started.recordingId);
    assert.equal(row.status, 'completed', 'row completed after upload');
    assert.ok(typeof row.durationMs === 'number' && row.durationMs >= 0, 'durationMs computed');
    assert.equal(row.filename, 'rest-life.webm', 'filename present');

    const fileRes = await fetch(`${SERVER_URL}/api/recordings/${started.recordingId}/file`);
    assert.equal(fileRes.status, 200, 'stored file is downloadable');
    assert.equal(fileRes.headers.get('content-type'), 'video/webm');
    assert.deepEqual(Buffer.from(await fileRes.arrayBuffer()), Buffer.from('fake-webm'), 'file bytes match');

    const missingRes = await fetch(`${SERVER_URL}/api/recordings/999999/file`);
    assert.equal(missingRes.status, 404, 'missing recording file is 404');
  } finally {
    host.disconnect();
    guest.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/recordings requires a session and lists recordings for a logged-in user', async (t) => {
  const proc = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(TEST_PORT) }
  });

  t.after(() => {
    proc.kill();
  });

  await waitForServer(proc);

  const anon = await fetch(`${SERVER_URL}/api/recordings`);
  assert.equal(anon.status, 401, 'unauthenticated list is rejected');

  const tag = Date.now();
  const register = await fetch(`${SERVER_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `rec-list-${tag}@example.com`, name: 'Rec User', password: 'password123' })
  });
  assert.equal(register.status, 201, 'test user registered');
  const setCookie = register.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : '';

  const res = await fetch(`${SERVER_URL}/api/recordings`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200, 'authenticated list is allowed');
  const body = await res.json();
  assert.ok(Array.isArray(body.recordings), 'recordings array returned');
});
