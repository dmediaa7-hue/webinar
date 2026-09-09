// Unit tests for the breakout rooms module (task 12).
// Mocks RoomServiceClient so no SFU/network is required; asserts the SDK call
// shapes: createRoom provisions '{main}:N', moveParticipant relocates to the
// correct destination room, deleteRoom tears down on end, and the
// LIVEKIT_NOT_CONFIGURED graceful-degrade path when env keys are absent.
// The final test self-harnesses src/index.js (like host-controls.test.js) to
// verify the host-only REST gate returns 403 for a non-host caller.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const { createDatabase } = require('../src/db');
const { RoomServiceClient } = require('livekit-server-sdk');
const rooms = require('../src/rooms');
const breakout = require('../src/breakout');

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

/** Create a room with a host + optional guest participant in the registry. */
function makeRoom(roomId, db, withGuest = false) {
  const room = rooms.createRoom(roomId, 'Host', 'sock-host', null, null, db);
  if (withGuest) {
    rooms.joinRoom(roomId, { socketId: 'sock-guest', displayName: 'Guest', isHost: false });
  }
  return room;
}

// --- Pure helpers ---

test('breakoutRoomName joins main room and label with a colon', () => {
  assert.equal(breakout.breakoutRoomName('abc123', '1'), 'abc123:1');
  assert.equal(breakout.breakoutRoomName('abc123', 'design'), 'abc123:design');
});

test('cleanBreakoutName trims, caps length, and rejects invalid characters', () => {
  assert.equal(breakout.cleanBreakoutName('  1  '), '1');
  assert.equal(breakout.cleanBreakoutName('design-a'), 'design-a');
  assert.equal(breakout.cleanBreakoutName('bad name!'), null);
  assert.equal(breakout.cleanBreakoutName(''), null);
  assert.equal(breakout.cleanBreakoutName('x'.repeat(25)), null);
  assert.equal(breakout.cleanBreakoutName(null), null);
});

test('nextBreakoutName auto-numbers past existing breakouts', async (t) => {
  const db = newDb();
  const roomId = 'room-next-1';
  makeRoom(roomId, db);
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));
  t.mock.method(RoomServiceClient.prototype, 'moveParticipant', async () => ({}));

  assert.equal(breakout.nextBreakoutName(roomId, [], db), '1');
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  assert.equal(breakout.nextBreakoutName(roomId, [], db), '2');
  await breakout.createBreakout(roomId, '2', 'sock-host', db);
  assert.equal(breakout.nextBreakoutName(roomId, [], db), '3');
  db.close();
});

// --- Graceful degrade without LiveKit keys ---

test('createBreakout without LiveKit keys returns LIVEKIT_NOT_CONFIGURED', async () => {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;

  const db = newDb();
  const roomId = 'room-unconf-1';
  makeRoom(roomId, db);

  const result = await breakout.createBreakout(roomId, '1', 'sock-host', db);
  assert.equal(result.error, 'LiveKit is not configured');
  assert.equal(result.code, 'LIVEKIT_NOT_CONFIGURED');
  db.close();
});

test('assignParticipant without LiveKit keys returns LIVEKIT_NOT_CONFIGURED', async (t) => {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;

  const db = newDb();
  const roomId = 'room-unconf-2';
  makeRoom(roomId, db, true);

  // Need a breakout row without provisioning - insert directly like the module would.
  db.prepare(`
    INSERT INTO breakout_rooms (main_room, breakout_name, livekit_room, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(roomId, '1', `${roomId}:1`, 'sock-host', Date.now());

  const result = await breakout.assignParticipant(roomId, 'sock-guest', '1', db);
  assert.equal(result.error, 'LiveKit is not configured');
  assert.equal(result.code, 'LIVEKIT_NOT_CONFIGURED');
  db.close();
});

// --- Provisioning via createRoom ---

test('createBreakout provisions a {main}:N LiveKit room and persists it', async (t) => {
  const db = newDb();
  const roomId = 'room-provision-1';
  makeRoom(roomId, db);
  withLiveKitEnv(t);

  const createRoomMock = t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));

  const result = await breakout.createBreakout(roomId, '1', 'sock-host', db);

  assert.equal(createRoomMock.mock.callCount(), 1);
  const [callOpts] = createRoomMock.mock.calls[0].arguments;
  assert.deepEqual(callOpts, { name: `${roomId}:1` }, 'provisions exactly {main}:N');

  assert.equal(result.roomId, roomId);
  assert.equal(result.breakout.name, '1');
  assert.equal(result.breakout.livekitRoom, `${roomId}:1`);

  const row = db.prepare('SELECT * FROM breakout_rooms WHERE main_room = ? AND breakout_name = ?').get(roomId, '1');
  assert.ok(row, 'breakout row inserted');
  assert.equal(row.livekit_room, `${roomId}:1`);
  assert.equal(row.created_by, 'sock-host');
  db.close();
});

test('duplicate breakout name is rejected with DUPLICATE_BREAKOUT', async (t) => {
  const db = newDb();
  const roomId = 'room-dup-1';
  makeRoom(roomId, db);
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));

  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  const second = await breakout.createBreakout(roomId, '1', 'sock-host', db);

  assert.equal(second.error, `Breakout '1' already exists`);
  assert.equal(second.code, 'DUPLICATE_BREAKOUT');
  db.close();
});

test('unnamed createBreakout auto-numbers to the next free label', async (t) => {
  const db = newDb();
  const roomId = 'room-auto-1';
  makeRoom(roomId, db);
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));

  const first = await breakout.createBreakout(roomId, null, 'sock-host', db);
  assert.equal(first.breakout.name, '1');

  const second = await breakout.createBreakout(roomId, null, 'sock-host', db);
  assert.equal(second.breakout.name, '2');
  db.close();
});

// --- Assignment via moveParticipant (acceptance: correct destination) ---

test('assignParticipant calls moveParticipant with {main}:N as destination', async (t) => {
  const db = newDb();
  const roomId = 'room-assign-1';
  makeRoom(roomId, db, true); // host + 'sock-guest'
  withLiveKitEnv(t);

  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));
  await breakout.createBreakout(roomId, '1', 'sock-host', db);

  const moveMock = t.mock.method(RoomServiceClient.prototype, 'moveParticipant', async () => ({}));

  const result = await breakout.assignParticipant(roomId, 'sock-guest', '1', db);

  assert.equal(moveMock.mock.callCount(), 1);
  const [fromRoom, identity, destinationRoom] = moveMock.mock.calls[0].arguments;
  assert.equal(fromRoom, roomId, 'moves from the main room');
  assert.equal(identity, 'sock-guest');
  assert.equal(destinationRoom, `${roomId}:1`, 'destination is {main}:N');

  assert.equal(result.ok, true);
  assert.equal(result.livekitRoom, `${roomId}:1`);

  const assignment = db.prepare(
    'SELECT * FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?'
  ).get(roomId, 'sock-guest');
  assert.ok(assignment, 'assignment row persisted');
  assert.equal(assignment.breakout_name, '1');
  db.close();
});

test('re-assigning a participant moves them from their current breakout', async (t) => {
  const db = newDb();
  const roomId = 'room-reassign-1';
  makeRoom(roomId, db, true);
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));
  const moveMock = t.mock.method(RoomServiceClient.prototype, 'moveParticipant', async () => ({}));
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  await breakout.createBreakout(roomId, '2', 'sock-host', db);
  await breakout.assignParticipant(roomId, 'sock-guest', '1', db);

  const moveCallsBeforeReassign = moveMock.mock.callCount();
  const result = await breakout.assignParticipant(roomId, 'sock-guest', '2', db);

  const [fromRoom, identity, destinationRoom] = moveMock.mock.calls[moveCallsBeforeReassign].arguments;
  assert.equal(fromRoom, `${roomId}:1`, 'moves from the old breakout');
  assert.equal(identity, 'sock-guest');
  assert.equal(destinationRoom, `${roomId}:2`);
  assert.equal(result.ok, true);
  db.close();
});

test('assignParticipant rejects a breakout that does not exist', async (t) => {
  const db = newDb();
  const roomId = 'room-missing-1';
  makeRoom(roomId, db, true);
  withLiveKitEnv(t);

  const moveMock = t.mock.method(RoomServiceClient.prototype, 'moveParticipant', async () => ({}));

  const result = await breakout.assignParticipant(roomId, 'sock-guest', '9', db);
  assert.equal(result.code, 'BREAKOUT_NOT_FOUND');
  assert.equal(moveMock.mock.callCount(), 0, 'moveParticipant never called');
  db.close();
});

test('assignParticipant rejects a participant not in the room roster', async (t) => {
  const db = newDb();
  const roomId = 'room-noone-1';
  makeRoom(roomId, db, false); // no guest
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));
  await breakout.createBreakout(roomId, '1', 'sock-host', db);

  const result = await breakout.assignParticipant(roomId, 'stranger', '1', db);
  assert.equal(result.code, 'PARTICIPANT_NOT_FOUND');
  db.close();
});

// --- Return to main ---

test('returnParticipant calls moveParticipant back to the main room', async (t) => {
  const db = newDb();
  const roomId = 'room-return-1';
  makeRoom(roomId, db, true);
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));
  const moveMock = t.mock.method(RoomServiceClient.prototype, 'moveParticipant', async () => ({}));
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  await breakout.assignParticipant(roomId, 'sock-guest', '1', db);

  const result = await breakout.returnParticipant(roomId, 'sock-guest', db);

  const [fromRoom, identity, destinationRoom] = moveMock.mock.calls[moveMock.mock.callCount() - 1].arguments;
  assert.equal(fromRoom, `${roomId}:1`, 'moves from the breakout');
  assert.equal(identity, 'sock-guest');
  assert.equal(destinationRoom, roomId, 'destination is the main room');

  assert.equal(result.ok, true);
  assert.equal(result.alreadyInMain, undefined);

  const assignment = db.prepare(
    'SELECT * FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?'
  ).get(roomId, 'sock-guest');
  assert.equal(assignment, undefined, 'assignment row removed');
  db.close();
});

test('returnParticipant for an unassigned participant is a no-op', async (t) => {
  const db = newDb();
  const roomId = 'room-noret-1';
  makeRoom(roomId, db, true);
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'moveParticipant', async () => ({}));

  const result = await breakout.returnParticipant(roomId, 'sock-guest', db);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyInMain, true);
  db.close();
});

// --- Teardown ---

test('teardownBreakouts moves everyone back and deletes every {main}:N room', async (t) => {
  const db = newDb();
  const roomId = 'room-teardown-1';
  makeRoom(roomId, db, true);
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));
  const moveMock = t.mock.method(RoomServiceClient.prototype, 'moveParticipant', async () => ({}));
  const deleteMock = t.mock.method(RoomServiceClient.prototype, 'deleteRoom', async () => ({}));
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  await breakout.createBreakout(roomId, '2', 'sock-host', db);
  await breakout.assignParticipant(roomId, 'sock-guest', '2', db);

  const moveCallsBeforeTeardown = moveMock.mock.callCount();
  const result = await breakout.teardownBreakouts(roomId, db);

  const moveCallsDuringTeardown = moveMock.mock.callCount() - moveCallsBeforeTeardown;
  assert.equal(moveCallsDuringTeardown, 1, 'assigned participant returned to main');
  const [fromRoom, , destinationRoom] = moveMock.mock.calls[moveMock.mock.callCount() - 1].arguments;
  assert.equal(fromRoom, `${roomId}:2`);
  assert.equal(destinationRoom, roomId);

  assert.equal(deleteMock.mock.callCount(), 2, 'both {main}:N rooms deleted');
  const deleted = deleteMock.mock.calls.map((c) => c.arguments[0]);
  assert.deepEqual(new Set(deleted), new Set([`${roomId}:1`, `${roomId}:2`]));

  assert.equal(result.ok, true);
  assert.equal(result.removed, 2);

  const rows = db.prepare('SELECT * FROM breakout_rooms WHERE main_room = ?').all(roomId);
  assert.equal(rows.length, 0, 'breakout rows cleared');
  const assignments = db.prepare('SELECT * FROM breakout_assignments WHERE main_room = ?').all(roomId);
  assert.equal(assignments.length, 0, 'assignments cleared');
  db.close();
});

test('listBreakouts returns breakout state with identities', async (t) => {
  const db = newDb();
  const roomId = 'room-list-1';
  makeRoom(roomId, db, true);
  withLiveKitEnv(t);
  t.mock.method(RoomServiceClient.prototype, 'createRoom', async (options) => ({ name: options.name }));
  t.mock.method(RoomServiceClient.prototype, 'moveParticipant', async () => ({}));
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  await breakout.assignParticipant(roomId, 'sock-guest', '1', db);

  const state = breakout.listBreakouts(roomId, db);
  assert.equal(state.mainRoom, roomId);
  assert.equal(state.breakouts.length, 1);
  assert.equal(state.breakouts[0].name, '1');
  assert.deepEqual(state.breakouts[0].identities, ['sock-guest']);
  assert.equal(state.assignments[0].livekitRoom, `${roomId}:1`);
  db.close();
});

// --- Host-only REST gate (self-harnessed, like host-controls.test.js) ---

const SERVER_URL = 'http://localhost:3001';
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

test('breakout endpoints reject non-host callers with 403', async (t) => {
  // Fake LiveKit credentials so the server boots with media "configured"; the
  // SFU calls land on 127.0.0.1:9 (connection refused -> error result). The
  // host gate is what this test asserts - it fires before any SDK call.
  const proc = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    stdio: 'ignore',
    env: {
      ...process.env,
      LIVEKIT_URL: 'https://127.0.0.1:9',
      LIVEKIT_API_KEY: 'test-key',
      LIVEKIT_API_SECRET: 'test-secret'
    }
  });

  t.after(() => {
    proc.kill();
  });

  await waitForServer(proc);

  const host = await connectClient();
  const guest = await connectClient();

  try {
    const created = await emitAck(host, 'create-room', { displayName: 'Host A', roomName: 'Breakout Gate' });
    assert.equal(created.success, true, 'room created');
    const roomId = created.roomId;

    const joined = await emitAck(guest, 'join-room', { roomId, displayName: 'Guest B' });
    assert.equal(joined.success, true, 'guest joined');

    // Guest (wrong/no x-host-id) is refused on every breakout endpoint.
    const guestCreate = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '1' })
    });
    assert.equal(guestCreate.status, 403, 'guest create breakout -> 403');

    const guestAssign = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: guest.id, name: '1' })
    });
    assert.equal(guestAssign.status, 403, 'guest assign -> 403');

    const guestReturn = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: guest.id })
    });
    assert.equal(guestReturn.status, 403, 'guest return -> 403');

    const guestTeardown = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts/teardown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.equal(guestTeardown.status, 403, 'guest teardown -> 403');

    // The hosting identity passes the gate (SFU is down here -> 400, not 401/403).
    const hostCreate = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: JSON.stringify({ name: '1' })
    });
    assert.notEqual(hostCreate.status, 403, 'host create is not forbidden');
  } finally {
    host.disconnect();
    guest.disconnect();
  }
});