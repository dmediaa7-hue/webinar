// Host-control test: verifies server-side enforcement of host rights over the
// socket layer. Self-harnessed (spawns src/index.js like integration.test.js)
// so `npm test` is deterministic. Asserts:
//   1. Non-host mute/kick socket events are no-ops; host mute/kick succeed.
//   2. Locking the room broadcasts room-locked; host unlock works.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const TEST_PORT = 3010;
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

test('host controls are enforced server-side', async (t) => {
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
    const created = await emitAck(host, 'create-room', {
      displayName: 'Host A',
      roomName: 'Host Controls'
    });
    assert.equal(created.success, true, 'room created');
    const roomId = created.roomId;

    const joined = await emitAck(guest, 'join-room', {
      roomId,
      displayName: 'Guest B'
    });
    assert.equal(joined.success, true, 'guest joined');

    // 1a. Non-host mute is a no-op: target never receives force-mute.
    const guestGotForceMute = await new Promise((resolve) => {
      let fired = false;
      const onForceMute = () => {
        fired = true;
        resolve(true);
      };
      guest.on('force-mute', onForceMute);
      guest.emit('mute-participant', { targetId: host.id });
      setTimeout(() => {
        guest.off('force-mute', onForceMute);
        resolve(fired);
      }, 800);
    });
    assert.equal(guestGotForceMute, false, 'guest mute attempt did not mute anyone');

    // 1b. Host mute succeeds: guest receives force-mute.
    const hostMutedGuest = await new Promise((resolve) => {
      const onForceMute = () => resolve(true);
      guest.once('force-mute', onForceMute);
      host.emit('mute-participant', { targetId: guest.id });
      setTimeout(() => resolve(false), 800);
    });
    assert.equal(hostMutedGuest, true, 'host mute reaches the guest');

    // 1c. Non-host kick is a no-op: guest stays connected.
    guest.emit('kick-participant', { targetId: host.id });
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(guest.connected, true, 'guest kick attempt did not disconnect anyone');
    assert.equal(host.connected, true, 'host still connected after guest kick attempt');

    // 2. Lock the room: non-host can no longer join; host unlock reopens it.
    const roomLockedEvent = new Promise((resolve) => {
      guest.once('room-locked', (data) => resolve(data));
    });
    const lockedAck = await emitAck(host, 'lock-room', { isLocked: true });
    assert.equal(lockedAck.success, true, 'host lock ack succeeds');
    assert.equal(lockedAck.isLocked, true, 'lock ack reports locked');
    assert.equal((await roomLockedEvent).isLocked, true, 'room-locked broadcast to room');

    const lockedGuest = await connectClient();
    const lockedJoin = await emitAck(lockedGuest, 'join-room', { roomId, displayName: 'Locked Out' });
    assert.equal(lockedJoin.success, false, 'join refused while locked');
    assert.equal(lockedJoin.error, 'Room is locked', 'refusal message');
    lockedGuest.disconnect();

    const unlockedAck = await emitAck(host, 'lock-room', { isLocked: false });
    assert.equal(unlockedAck.isLocked, false, 'host unlock ack reports unlocked');

    const reopenedGuest = await connectClient();
    const reopenedJoin = await emitAck(reopenedGuest, 'join-room', { roomId, displayName: 'Reopened' });
    assert.equal(reopenedJoin.success, true, 'join allowed again after unlock');
    reopenedGuest.disconnect();
  } finally {
    host.disconnect();
    guest.disconnect();
  }
});