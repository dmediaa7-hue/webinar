// Host-control test: verifies server-side enforcement of LiveKit host rights.
// Self-harnessed (spawns src/index.js like integration.test.js) so `npm test`
// is deterministic. Asserts:
//   1. The token endpoint derives roomAdmin from the participant roster, so a
//      guest asking for roomAdmin=1 gets a non-admin token (JWT payload).
//   2. A locked room refuses non-host token issuance (403 ROOM_LOCKED) while
//      the host still receives a token.
//   3. Non-host mute/kick socket events are no-ops; host mute/kick succeed.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');

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

test('host controls are enforced server-side', async (t) => {
  // Stub LiveKit credentials so the token endpoint passes its isConfigured
  // gate. Token minting is a local JWT sign (no network); the SFU admin calls
  // made by mute/kick land on 127.0.0.1:9 (connection refused -> {ok:false}).
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
    // Host creates the room over the socket path.
    const created = await emitAck(host, 'create-room', {
      displayName: 'Host A',
      roomName: 'Host Controls'
    });
    assert.equal(created.success, true, 'room created');
    const roomId = created.roomId;

    // Guest joins with a passwordless room.
    const joined = await emitAck(guest, 'join-room', {
      roomId,
      displayName: 'Guest B'
    });
    assert.equal(joined.success, true, 'guest joined');

    // 1. Token grants: roomAdmin must come from the roster, not the query param.
    const hostTokenRes = await fetch(
      `${SERVER_URL}/api/livekit/token?room=${roomId}&identity=${host.id}&name=Host%20A`
    );
    assert.equal(hostTokenRes.status, 200, 'host token issued');
    const hostTokenBody = await hostTokenRes.json();
    const hostGrants = jwt.decode(hostTokenBody.token);
    assert.equal(hostGrants.video.roomAdmin, true, 'host token carries roomAdmin');

    const guestTokenRes = await fetch(
      `${SERVER_URL}/api/livekit/token?room=${roomId}&identity=${guest.id}&name=Guest%20B&roomAdmin=1`
    );
    assert.equal(guestTokenRes.status, 200, 'guest token issued');
    const guestTokenBody = await guestTokenRes.json();
    assert.equal(guestTokenBody.roomAdmin, false, 'server reports roomAdmin=false for guest');
    const guestGrants = jwt.decode(guestTokenBody.token);
    assert.equal(guestGrants.video.roomAdmin, false, 'guest token lacks roomAdmin despite roomAdmin=1');
    assert.equal(guestGrants.video.canPublish, true, 'guest can still publish');
    assert.equal(guestGrants.video.canSubscribe, true, 'guest can still subscribe');

    // 3a. Non-host mute is a no-op: target never receives force-mute.
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

    // 3b. Host mute succeeds: guest receives force-mute.
    const hostMutedGuest = await new Promise((resolve) => {
      const onForceMute = () => resolve(true);
      guest.once('force-mute', onForceMute);
      host.emit('mute-participant', { targetId: guest.id });
      setTimeout(() => resolve(false), 800);
    });
    assert.equal(hostMutedGuest, true, 'host mute reaches the guest');

    // 3c. Non-host kick is a no-op: guest stays connected.
    guest.emit('kick-participant', { targetId: host.id });
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(guest.connected, true, 'guest kick attempt did not disconnect anyone');
    assert.equal(host.connected, true, 'host still connected after guest kick attempt');

    // 2. Lock the room: guest token refused, host token still issued.
    await emitAck(host, 'lock-room', { isLocked: true });
    const lockedGuestRes = await fetch(
      `${SERVER_URL}/api/livekit/token?room=${roomId}&identity=${guest.id}&name=Guest%20B`
    );
    assert.equal(lockedGuestRes.status, 403, 'guest token refused while locked');
    const lockedGuestBody = await lockedGuestRes.json();
    assert.equal(lockedGuestBody.code, 'ROOM_LOCKED', 'refusal carries ROOM_LOCKED code');

    const lockedHostRes = await fetch(
      `${SERVER_URL}/api/livekit/token?room=${roomId}&identity=${host.id}&name=Host%20A`
    );
    assert.equal(lockedHostRes.status, 200, 'host token still issued while locked');

    // Host can unlock again.
    await emitAck(host, 'lock-room', { isLocked: false });
    const unlockedGuestRes = await fetch(
      `${SERVER_URL}/api/livekit/token?room=${roomId}&identity=${guest.id}&name=Guest%20B`
    );
    assert.equal(unlockedGuestRes.status, 200, 'guest token issued again after unlock');
  } finally {
    host.disconnect();
    guest.disconnect();
  }
});