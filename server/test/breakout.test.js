// Unit tests for the breakout GROUPS module. In pure P2P there are no separate
// media rooms, so breakouts are host-managed labeled groups on the main room:
// createBreakout/assign/return/teardown persist SQLite rows only. The final
// test self-harnesses src/index.js (like host-controls.test.js) to verify the
// host-only REST gate returns 403 for a non-host caller and that host actions
// succeed with non-503 responses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const { createDatabase } = require('../src/db');
const rooms = require('../src/rooms');
const breakout = require('../src/breakout');

async function newDb() {
  return createDatabase(':memory:');
}

/** Create a room with a host + optional guest participant in the registry. */
async function makeRoom(roomId, db, withGuest = false) {
  const room = await rooms.createRoom(roomId, 'Host', 'sock-host', null, null, db);
  if (withGuest) {
    rooms.joinRoom(roomId, { socketId: 'sock-guest', displayName: 'Guest', isHost: false });
  }
  return room;
}

// --- Pure helpers ---

test('cleanBreakoutName trims, caps length, and rejects invalid characters', () => {
  assert.equal(breakout.cleanBreakoutName('  1  '), '1');
  assert.equal(breakout.cleanBreakoutName('design-a'), 'design-a');
  assert.equal(breakout.cleanBreakoutName('bad name!'), null);
  assert.equal(breakout.cleanBreakoutName(''), null);
  assert.equal(breakout.cleanBreakoutName('x'.repeat(25)), null);
  assert.equal(breakout.cleanBreakoutName(null), null);
});

test('nextBreakoutName auto-numbers past existing breakouts', async () => {
  const db = await newDb();
  const roomId = 'room-next-1';
  await makeRoom(roomId, db);

  assert.equal(await breakout.nextBreakoutName(roomId, [], db), '1');
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  assert.equal(await breakout.nextBreakoutName(roomId, [], db), '2');
  await breakout.createBreakout(roomId, '2', 'sock-host', db);
  assert.equal(await breakout.nextBreakoutName(roomId, [], db), '3');
  await db.close();
});

// --- Creation ---

test('createBreakout persists a group row and returns the breakout', async () => {
  const db = await newDb();
  const roomId = 'room-prov-1';
  await makeRoom(roomId, db);

  const result = await breakout.createBreakout(roomId, '1', 'sock-host', db);

  assert.equal(result.roomId, roomId);
  assert.equal(result.breakout.name, '1');
  assert.equal(result.breakout.createdBy, 'sock-host');
  assert.ok(result.breakout.createdAt > 0, 'createdAt persisted');

  const row = await db.get('SELECT * FROM breakout_rooms WHERE main_room = ? AND breakout_name = ?', roomId, '1');
  assert.ok(row, 'breakout row inserted');
  assert.equal(row.created_by, 'sock-host');
  await db.close();
});

test('duplicate breakout name is rejected with DUPLICATE_BREAKOUT', async () => {
  const db = await newDb();
  const roomId = 'room-dup-1';
  await makeRoom(roomId, db);

  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  const second = await breakout.createBreakout(roomId, '1', 'sock-host', db);

  assert.equal(second.error, `Breakout '1' already exists`);
  assert.equal(second.code, 'DUPLICATE_BREAKOUT');
  await db.close();
});

test('unnamed createBreakout auto-numbers to the next free label', async () => {
  const db = await newDb();
  const roomId = 'room-auto-1';
  await makeRoom(roomId, db);

  const first = await breakout.createBreakout(roomId, null, 'sock-host', db);
  assert.equal(first.breakout.name, '1');

  const second = await breakout.createBreakout(roomId, null, 'sock-host', db);
  assert.equal(second.breakout.name, '2');
  await db.close();
});

// --- Assignment (no media-room move) ---

test('assignParticipant upserts an assignment row', async () => {
  const db = await newDb();
  const roomId = 'room-assign-1';
  await makeRoom(roomId, db, true);

  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  const result = await breakout.assignParticipant(roomId, 'sock-guest', '1', db);

  assert.equal(result.ok, true);
  assert.equal(result.identity, 'sock-guest');
  assert.equal(result.roomId, roomId);

  const assignment = await db.get(
    'SELECT * FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?',
    roomId, 'sock-guest'
  );
  assert.ok(assignment, 'assignment row persisted');
  assert.equal(assignment.breakout_name, '1');
  await db.close();
});

test('re-assigning a participant moves their row to the new group', async () => {
  const db = await newDb();
  const roomId = 'room-reassign-1';
  await makeRoom(roomId, db, true);
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  await breakout.createBreakout(roomId, '2', 'sock-host', db);
  await breakout.assignParticipant(roomId, 'sock-guest', '1', db);

  const result = await breakout.assignParticipant(roomId, 'sock-guest', '2', db);
  assert.equal(result.ok, true);

  const assignment = await db.get(
    'SELECT * FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?',
    roomId, 'sock-guest'
  );
  assert.equal(assignment.breakout_name, '2', 'assignment moved to group 2');
  await db.close();
});

test('assignParticipant rejects a breakout that does not exist', async () => {
  const db = await newDb();
  const roomId = 'room-missing-1';
  await makeRoom(roomId, db, true);

  const result = await breakout.assignParticipant(roomId, 'sock-guest', '9', db);
  assert.equal(result.code, 'BREAKOUT_NOT_FOUND');
  await db.close();
});

test('assignParticipant rejects a participant not in the room roster', async () => {
  const db = await newDb();
  const roomId = 'room-noone-1';
  await makeRoom(roomId, db, false);
  await breakout.createBreakout(roomId, '1', 'sock-host', db);

  const result = await breakout.assignParticipant(roomId, 'stranger', '1', db);
  assert.equal(result.code, 'PARTICIPANT_NOT_FOUND');
  await db.close();
});

// --- Return to main ---

test('returnParticipant deletes the assignment row', async () => {
  const db = await newDb();
  const roomId = 'room-return-1';
  await makeRoom(roomId, db, true);
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  await breakout.assignParticipant(roomId, 'sock-guest', '1', db);

  const result = await breakout.returnParticipant(roomId, 'sock-guest', db);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyInMain, undefined);

  const assignment = await db.get(
    'SELECT * FROM breakout_assignments WHERE main_room = ? AND participant_identity = ?',
    roomId, 'sock-guest'
  );
  assert.equal(assignment, undefined, 'assignment row removed');
  await db.close();
});

test('returnParticipant for an unassigned participant is a no-op', async () => {
  const db = await newDb();
  const roomId = 'room-noret-1';
  await makeRoom(roomId, db, true);

  const result = await breakout.returnParticipant(roomId, 'sock-guest', db);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyInMain, true);
  await db.close();
});

// --- Teardown ---

test('teardownBreakouts clears assignments and breakout rows', async () => {
  const db = await newDb();
  const roomId = 'room-teardown-1';
  await makeRoom(roomId, db, true);
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  await breakout.createBreakout(roomId, '2', 'sock-host', db);
  await breakout.assignParticipant(roomId, 'sock-guest', '2', db);

  const result = await breakout.teardownBreakouts(roomId, db);

  assert.equal(result.ok, true);
  assert.equal(result.removed, 2);

  const rows = await db.all('SELECT * FROM breakout_rooms WHERE main_room = ?', roomId);
  assert.equal(rows.length, 0, 'breakout rows cleared');
  const assignments = await db.all('SELECT * FROM breakout_assignments WHERE main_room = ?', roomId);
  assert.equal(assignments.length, 0, 'assignments cleared');
  await db.close();
});

test('listBreakouts returns breakout state with identities', async () => {
  const db = await newDb();
  const roomId = 'room-list-1';
  await makeRoom(roomId, db, true);
  await breakout.createBreakout(roomId, '1', 'sock-host', db);
  await breakout.assignParticipant(roomId, 'sock-guest', '1', db);

  const state = await breakout.listBreakouts(roomId, db);
  assert.equal(state.mainRoom, roomId);
  assert.equal(state.breakouts.length, 1);
  assert.equal(state.breakouts[0].name, '1');
  assert.deepEqual(state.breakouts[0].identities, ['sock-guest']);
  assert.equal(state.assignments[0].breakoutName, '1');
  await db.close();
});

// --- Host-only REST gate (self-harnessed, like host-controls.test.js) ---

const TEST_PORT = 3030;
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

test('breakout endpoints reject non-host callers with 403; host actions succeed', async (t) => {
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

  try {
    const created = await emitAck(host, 'create-room', { displayName: 'Host A', roomName: 'Breakout Gate' });
    assert.equal(created.success, true, 'room created');
    const roomId = created.roomId;

    const joined = await emitAck(guest, 'join-room', { roomId, displayName: 'Guest B' });
    assert.equal(joined.success, true, 'guest joined');

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

    const hostCreate = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: JSON.stringify({ name: '1' })
    });
    assert.equal(hostCreate.status, 201, 'host create breakout -> 201');
    const createdBody = await hostCreate.json();
    assert.equal(createdBody.breakout.name, '1', 'host create persists the group');

    const hostAssign = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: JSON.stringify({ identity: guest.id, name: '1' })
    });
    assert.equal(hostAssign.status, 200, 'host assign -> 200');

    const listRes = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts`, {
      headers: { 'x-host-id': host.id }
    });
    const listBody = await listRes.json();
    assert.equal(listBody.assignments.length, 1, 'assignment persisted and listed');

    const hostReturn = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id },
      body: JSON.stringify({ identity: guest.id })
    });
    assert.equal(hostReturn.status, 200, 'host return -> 200');

    const hostTeardown = await fetch(`${SERVER_URL}/api/rooms/${roomId}/breakouts/teardown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': host.id }
    });
    assert.equal(hostTeardown.status, 200, 'host teardown -> 200');
  } finally {
    host.disconnect();
    guest.disconnect();
  }
});
