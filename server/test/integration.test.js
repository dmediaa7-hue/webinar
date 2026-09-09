// Integration test: verifies the signaling server works end-to-end
// Simulates 2 clients joining a room and exchanging WebRTC signaling.
// Self-harnessed: spawns the server as a child process, then shuts it down,
// so `npm test` is deterministic (no pre-running server required).
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3001';
const serverDir = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function waitForServer(proc, timeoutMs = 15000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) return true;
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 300));
    if (proc.exitCode !== null) break;
  }
  throw lastErr || new Error('Server did not become ready');
}

async function runTest() {
  console.log('=== Webinar Server Integration Test ===\n');

  const proc = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    stdio: 'ignore'
  });

  try {
    await waitForServer(proc);

    // Connect client A (host)
    console.log('Testing client connections...');
    const clientA = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise(resolve => clientA.on('connect', resolve));
    assert(clientA.connected, 'Client A connected');

    const clientB = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise(resolve => clientB.on('connect', resolve));
    assert(clientB.connected, 'Client B connected');

    // Test room creation
    console.log('\nTesting room creation...');
    const roomCreated = await new Promise((resolve) => {
      clientA.emit('create-room', { displayName: 'Host A', roomName: 'Team Standup' }, (response) => {
        resolve(response);
      });
    });
    assert(roomCreated?.success, 'Room created successfully');
    assert(roomCreated?.roomId, 'Room ID generated');
    assert(roomCreated?.roomName === 'Team Standup', 'Room name persisted');

    // Test participant join
    console.log('\nTesting participant join...');

    // Register listener BEFORE join to avoid race condition
    const joinPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      clientA.on('participant-joined', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });

    const joinResult = await new Promise((resolve) => {
      clientB.emit('join-room', { roomId: roomCreated.roomId, displayName: 'Guest B' }, (response) => {
        resolve(response);
      });
    });
    assert(joinResult?.success, 'Client B joined room');

    // Wait for A to be notified
    const participantJoined = await joinPromise;
    assert(participantJoined?.participant?.displayName === 'Guest B', 'Client A notified of B joining');

    // Test WebRTC offer relay
    console.log('\nTesting WebRTC signaling relay...');
    const offerReceived = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      clientB.on('offer', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      // Send a fake SDP offer from A to B
      clientA.emit('offer', {
        targetId: clientB.id,
        sdp: { type: 'offer', sdp: 'fake-sdp' },
        type: 'video'
      });
    });
    assert(offerReceived?.from === clientA.id, 'Offer relayed correctly');
    assert(offerReceived?.sdp?.type === 'offer', 'SDP offer in payload');

    // Test answer relay
    const answerReceived = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      clientA.on('answer', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      clientB.emit('answer', { targetId: clientA.id, sdp: { type: 'answer', sdp: 'fake-answer' } });
    });
    assert(answerReceived?.from === clientB.id, 'Answer relayed correctly');

    // Test ICE candidate relay
    console.log('\nTesting ICE candidate relay...');
    const iceReceived = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      clientA.on('ice-candidate', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      clientB.emit('ice-candidate', { targetId: clientA.id, candidate: 'candidate:123' });
    });
    assert(iceReceived?.candidate === 'candidate:123', 'ICE candidate relayed correctly');

    // Test chat
    console.log('\nTesting chat system...');
    const chatReceived = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      clientA.on('chat-message', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      clientB.emit('chat-message', { message: 'Hello from B!' });
    });
    assert(chatReceived?.message === 'Hello from B!', 'Chat message relayed to room');

    // Test audio toggle
    console.log('\nTesting media state sync...');
    const audioToggled = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      clientA.on('participant-audio-toggled', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      clientB.emit('toggle-audio', { isMuted: true });
    });
    assert(audioToggled?.isMuted === true, 'Audio toggle broadcast to room');
    assert(audioToggled?.socketId === clientB.id, 'Audio toggle sender identified');

    // Test participant leave
    console.log('\nTesting participant leave...');
    const leftNotification = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      clientA.on('participant-left', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      clientB.emit('leave-room');
    });
    assert(leftNotification?.socketId === clientB.id, 'Participant left broadcast to room');

    // --- Password protection tests ---
    console.log('\nTesting password-protected room...');

    // Create a room with a password via REST API
    const res = await fetch(`${SERVER_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName: 'Pwd Host', password: '123456' })
    });
    const { roomId: pwdRoomId, hasPassword } = await res.json();
    assert(hasPassword === true, 'Room created with password flag');
    assert(pwdRoomId?.length > 0, 'Password-protected room ID generated');

    // Verify GET /api/rooms/:roomId returns hasPassword
    const roomInfo = await fetch(`${SERVER_URL}/api/rooms/${pwdRoomId}`);
    const roomInfoData = await roomInfo.json();
    assert(roomInfoData.hasPassword === true, 'GET room info reports hasPassword=true');

    // Connect a client and try to join WITHOUT password → should fail
    const clientNoPwd = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise(resolve => clientNoPwd.on('connect', resolve));

    const joinNoPwd = await new Promise((resolve) => {
      clientNoPwd.emit('join-room', { roomId: pwdRoomId, displayName: 'No Pwd User' }, (resp) => resolve(resp));
    });
    assert(joinNoPwd?.success === false, 'Join WITHOUT password rejected');
    assert(joinNoPwd?.code === 'WRONG_PASSWORD', 'Rejection code is WRONG_PASSWORD');

    // Try joining with WRONG password
    const clientWrongPwd = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise(resolve => clientWrongPwd.on('connect', resolve));

    const joinWrongPwd = await new Promise((resolve) => {
      clientWrongPwd.emit('join-room', { roomId: pwdRoomId, displayName: 'Wrong Pwd User', password: '999999' }, (resp) => resolve(resp));
    });
    assert(joinWrongPwd?.success === false, 'Join with WRONG password rejected');

    // Join with CORRECT password → should succeed
    const clientCorrectPwd = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise(resolve => clientCorrectPwd.on('connect', resolve));

    const joinCorrectPwd = await new Promise((resolve) => {
      clientCorrectPwd.emit('join-room', { roomId: pwdRoomId, displayName: 'Correct Pwd User', password: '123456' }, (resp) => resolve(resp));
    });
    assert(joinCorrectPwd?.success === true, 'Join with CORRECT password succeeds');
    assert(joinCorrectPwd?.isHost === true, 'First joiner to password room becomes host');

    clientNoPwd.disconnect();
    clientWrongPwd.disconnect();
    clientCorrectPwd.disconnect();

    // Cleanup
    console.log('\n=== Test Complete ===');
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);

    clientA.disconnect();
    clientB.disconnect();

    // Let the disconnect handshakes drain before exiting - calling process.exit()
    // while libuv handles are still closing triggers a UV_HANDLE_CLOSING assertion
    // on Windows and pollutes otherwise-green test output.
    await new Promise(r => setTimeout(r, 500));
  } finally {
    proc.kill();
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

runTest().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});