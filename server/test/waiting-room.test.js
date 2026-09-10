// Waiting-room gate test. Self-harnessed (spawns src/index.js) so the socket
// flow is live. Asserts:
//   1. Pure room helpers hold/release waiting joiners.
//   2. A waiting joiner gets { success: true, waiting: true } and is NOT given
//      room-joined until the host admits them.
//   3. After the host admits them: room-joined fires.
//   4. Deny returns the joiner to the lobby (waiting-denied).
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const roomsApi = require('../src/rooms');
const { createDatabase } = require('../src/db');

const TEST_PORT = 3040;
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

function expectEventWithin(client, event, windowMs = 800) {
  return new Promise((resolve) => {
    const onEvent = () => {
      client.off(event, onEvent);
      resolve(true);
    };
    client.on(event, onEvent);
    setTimeout(() => {
      client.off(event, onEvent);
      resolve(false);
    }, windowMs);
  });
}

test('waiting room helpers hold and release joiners', () => {
  const db = createDatabase(':memory:');
  roomsApi.createRoom('wr-unit', 'Host A', 'host-sock', null, null, db);

  assert.deepEqual(roomsApi.addWaiting('wr-unit', { socketId: 'g1', userId: 'u1', displayName: 'Guest 1' }), { ok: true });
  assert.equal(roomsApi.isWaiting('wr-unit', 'g1'), true);
  assert.equal(roomsApi.addWaiting('missing-room', { socketId: 'nope', userId: 'u', displayName: 'X' }).error, 'ROOM_NOT_FOUND');

  const list = roomsApi.getWaitingList('wr-unit');
  assert.equal(list.length, 1);
  assert.equal(list[0].displayName, 'Guest 1');
  assert.equal(typeof list[0].joinedAt, 'number');

  assert.equal(roomsApi.removeWaiting('wr-unit', 'g1'), true);
  assert.equal(roomsApi.isWaiting('wr-unit', 'g1'), false);
  assert.equal(roomsApi.getWaitingList('wr-unit').length, 0);
  assert.equal(roomsApi.removeWaiting('wr-unit', 'g1'), false);
});

test('waiting users are gated on join; room-joined only after admit', async (t) => {
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
  const walkIn = await connectClient();

  try {
    const created = await emitAck(host, 'create-room', {
      displayName: 'Host A',
      roomName: 'Waiting Room Test'
    });
    assert.equal(created.success, true, 'room created');
    const roomId = created.roomId;

    host.emit('toggle-waiting-room');
    await new Promise((r) => setTimeout(r, 200));

    const hostSawWaiting = expectEventWithin(host, 'waiting-list-updated');
    const guestGated = expectEventWithin(guest, 'room-joined');
    const joined = await emitAck(guest, 'join-room', { roomId, displayName: 'Guest B' });
    assert.equal(joined.success, true, 'join ack succeeds');
    assert.equal(joined.waiting, true, 'joiner is marked waiting');
    assert.equal(await guestGated, false, 'no room-joined while waiting');
    assert.equal(await hostSawWaiting, true, 'host received the waiting list');

    const guestJoined = expectEventWithin(guest, 'room-joined');
    const admitted = await emitAck(host, 'admit-waiting', { targetId: guest.id });
    assert.equal(admitted.success, true, 'admit ack succeeds');
    assert.equal(await guestJoined, true, 'guest is room-joined after admit');

    const walkInResult = await emitAck(walkIn, 'join-room', { roomId, displayName: 'Walk In' });
    assert.equal(walkInResult.waiting, true, 'second joiner waits too');
    const walkInDenied = expectEventWithin(walkIn, 'waiting-denied');
    const walkInStayedGated = expectEventWithin(walkIn, 'room-joined');
    host.emit('deny-waiting', { targetId: walkIn.id });
    assert.equal(await walkInDenied, true, 'denied joiner is notified');
    assert.equal(await walkInStayedGated, false, 'denied joiner never receives room-joined');
  } finally {
    host.disconnect();
    guest.disconnect();
    walkIn.disconnect();
  }
});