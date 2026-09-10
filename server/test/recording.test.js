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

function newDb() {
  return createDatabase(':memory:');
}

function makeRoom(roomId, db) {
  return rooms.createRoom(roomId, 'Host', 'sock-1', null, 'Record Room', db);
}

test('saveRecording writes the file, inserts a completed row, and returns id+path', () => {
  const db = newDb();
  const roomId = 'room-save-1';
  makeRoom(roomId, db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-test-'));
  const filename = 'test.webm';

  try {
    const result = recording.saveRecording({
      roomName: 'Record Room',
      folder: dir,
      filename,
      base64Data: Buffer.from('fake-webm').toString('base64')
    }, db);

    assert.ok(result.id > 0, 'id returned');
    assert.equal(result.path, path.join(dir, filename));
    assert.equal(fs.existsSync(result.path), true, 'file exists on disk');
    assert.deepEqual(fs.readFileSync(result.path), Buffer.from('fake-webm'), 'bytes round-trip');

    const row = db.prepare('SELECT * FROM recordings WHERE room_name = ?').get('Record Room');
    assert.ok(row, 'recording row inserted');
    assert.equal(row.status, 'completed');
    assert.equal(row.url, result.path);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    db.close();
  }
});

test('saveRecording creates nested folders recursively', () => {
  const db = newDb();
  makeRoom('room-nested-1', db);
  const dir = path.join(os.tmpdir(), `rec-nested-${Date.now()}`, 'sub', 'dir');

  try {
    const result = recording.saveRecording({
      roomName: 'Record Room',
      folder: dir,
      filename: 'clip.webm',
      base64Data: Buffer.from('blob').toString('base64')
    }, db);
    assert.equal(fs.existsSync(result.path), true, 'nested file exists');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    db.close();
  }
});

test('saveRecording rejects an invalid filename', () => {
  const db = newDb();
  makeRoom('room-badname-1', db);
  assert.throws(() => recording.saveRecording({
    roomName: 'Record Room',
    folder: os.tmpdir(),
    filename: '../../evil.webm',
    base64Data: 'x'
  }, db), /Invalid filename/);
  db.close();
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

    const statusRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/status`);
    assert.equal(statusRes.status, 200, 'status lookup succeeds');
    const status = await statusRes.json();
    assert.equal(status.recordings.length >= 1, true, 'status returns uploaded rows');
    const statusRow = status.recordings.find((r) => r.url === result.path);
    assert.ok(statusRow, 'status contains the freshly uploaded row');
    assert.equal(statusRow.status, 'completed');
  } finally {
    host.disconnect();
    guest.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});