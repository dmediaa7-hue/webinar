// Waiting-room gate test. Self-harnessed (spawns src/index.js with fake
// LiveKit keys like host-controls.test.js) so the token endpoint is live.
// Asserts:
//   1. Pure room helpers hold/release waiting joiners.
//   2. A waiting joiner gets { success: true, waiting: true }, is NOT given
//      room-joined, and receives NO media token (403 WAITING_ROOM).
//   3. After the host admits them: room-joined fires and the token is issued.
//   4. Deny returns the joiner to the lobby (waiting-denied) with no token.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const roomsApi = require('../src/rooms');
const { createDatabase } = require('../src/db');

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

// Resolves true if the event fires within the window, false otherwise.
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

  // Persisted room metadata does not include the waiting list (ephemeral).
  const persisted = roomsApi.getPersistedRoom('wr-unit', db);
  assert.equal(persisted.settings.waitingRoomEnabled, false);
});

test('waiting users receive no token until admitted; token issued after admit', async (t) => {
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
  const walkIn = await connectClient();

  try {
    const created = await emitAck(host, 'create-room', {
      displayName: 'Host A',
      roomName: 'Waiting Room Test'
    });
    assert.equal(created.success, true, 'room created');
    const roomId = created.roomId;

    // Host enables the waiting room.
    host.emit('toggle-waiting-room');
    await new Promise((r) => setTimeout(r, 200));

    // Guest join is gated. Event listeners are attached BEFORE the triggering
    // emit so none of the assertions can race the server's broadcast.
    const hostSawWaiting = expectEventWithin(host, 'waiting-list-updated');
    const guestGated = expectEventWithin(guest, 'room-joined');
    const joined = await emitAck(guest, 'join-room', { roomId, displayName: 'Guest B' });
    assert.equal(joined.success, true, 'join ack succeeds');
    assert.equal(joined.waiting, true, 'joiner is marked waiting');
    assert.equal(await guestGated, false, 'no room-joined while waiting');
    assert.equal(await hostSawWaiting, true, 'host received the waiting list');

    // Token gate: waiting identity is refused; host token still issued.
    const guestTokenRes = await fetch(
      `${SERVER_URL}/api/livekit/token?room=${roomId}&identity=${guest.id}&name=Guest%20B`
    );
    assert.equal(guestTokenRes.status, 403, 'waiting guest token refused');
    const guestTokenBody = await guestTokenRes.json();
    assert.equal(guestTokenBody.code, 'WAITING_ROOM', 'refusal carries WAITING_ROOM code');

    const hostTokenRes = await fetch(
      `${SERVER_URL}/api/livekit/token?room=${roomId}&identity=${host.id}&name=Host%20A`
    );
    assert.equal(hostTokenRes.status, 200, 'host token always issued');

    // Admit: guest gets the standard room-joined payload, then a token.
    const guestJoined = expectEventWithin(guest, 'room-joined');
    const admitted = await emitAck(host, 'admit-waiting', { targetId: guest.id });
    assert.equal(admitted.success, true, 'admit ack succeeds');
    assert.equal(await guestJoined, true, 'guest is room-joined after admit');

    const admittedTokenRes = await fetch(
      `${SERVER_URL}/api/livekit/token?room=${roomId}&identity=${guest.id}&name=Guest%20B`
    );
    assert.equal(admittedTokenRes.status, 200, 'admitted guest token issued');

    // Deny: second joiner is sent back to the lobby with a message.
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