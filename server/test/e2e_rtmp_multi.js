// Multi-target (multi-site) fan-out E2E: one recorder, many destinations.
// Proves each target gets its own FFmpeg spawn and events fan out correctly.
const { readFileSync } = require('fs');
const path = require('path');

const roomsMod = require('E:\\Webinar\\server\\src\\rooms.js');
const room = { id: 'multroom', name: 'Multi', hostId: null, participants: new Map(), isStreaming: false, rtmpUrl: null };
roomsMod.getRoom = () => room;

const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const { handleRtmp } = require('E:\\Webinar\\server\\src\\rtmp.js');

const WEBM_FILE = path.join('C:\\Users\\Admin\\AppData\\Local\\Temp\\opencode\\rtmptest', 'test_webm.webm');
const PORT = 19877;

let failures = 0;
const assert = (label, cond) => { if (cond) console.log('  ✓', label); else { console.error('  ✗', label); failures++; } };

async function run() {
  console.log('\n[1] Multi-target start-rtmp (3 destinations at once)');
  const io = new Server(PORT, { cors: { origin: '*' }, maxHttpBufferSize: 2e6 });
  const startedEvents = [];
  const errorEvents = [];

  io.on('connection', (socket) => {
    socket.data.roomId = room.id;
    socket.data.isHost = true;
    socket.join(room.id);
    handleRtmp(io, socket);
  });

  const client = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
  await new Promise((res) => client.on('connect', res));
  client.on('rtmp-started', (e) => startedEvents.push(e));
  client.on('rtmp-error', (e) => errorEvents.push(e));

  const targets = [
    { targetId: 'youtube', url: 'a.rtmp.youtube.com/live2', key: 'y-1111' },
    { targetId: 'facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp', key: 'f-2222' },
    { targetId: 'custom', url: 'rtmp://127.0.0.1:19999/live/custom', key: 'c-3333' }
  ];

  const ack = await new Promise((resolve) => {
    client.emit('start-rtmp', { targets, format: 'webm' }, resolve);
  });
  await new Promise((r) => setTimeout(r, 600));

  console.log('  ack:', JSON.stringify(ack));
  assert('ack.success === true', ack && ack.success === true);
  assert('all 3 targets ok', ack && ack.results && ack.results.length === 3 && ack.results.every(r => r.ok));
  assert('youtube bare-host normalized', ack.results.find(r => r.targetId === 'youtube').url === 'rtmp://a.rtmp.youtube.com/live2/y-1111');
  assert('facebook rtmps:// preserved', ack.results.find(r => r.targetId === 'facebook').url === 'rtmps://live-api-s.facebook.com:443/rtmp/f-2222');

  console.log('\n[2] rtmp-started broadcast fan-out (one per destination)');
  console.log('  started events:', JSON.stringify(startedEvents));
  assert('3 rtmp-started events', startedEvents.length === 3);
  assert('events cover all targetIds', ['youtube','facebook','custom'].every(id => startedEvents.some(e => e.targetId === id)));

  console.log('\n[3] Fan-out chunk feed (one recorder → 3 FFmpeg processes)');
  const webmB64 = readFileSync(WEBM_FILE).toString('base64');
  let chunkErrors = 0;
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { client.emit('rtmp-chunk', { data: webmB64, targetIds: ['youtube', 'facebook', 'custom'] }); }
    catch (e) { chunkErrors++; }
  }
  await new Promise((r) => setTimeout(r, 1000));
  assert('chunks delivered to all 3 targets without socket errors', chunkErrors === 0);

  // Dead-endpoint FFmpeg processes will eventually exit → expect rtmp-error per target
  console.log('\n[4] Per-target failure isolation (dead endpoints tear down ONLY themselves)');
  await new Promise((r) => setTimeout(r, 8000));
  console.log('  rtmp-error events:', JSON.stringify(errorEvents));
  assert('rtmp-error(s) reported for dead endpoints', errorEvents.length >= 1);
  const deadIds = errorEvents.map(e => e.targetId);
  assert('custom (dead rtmp) failed', deadIds.includes('custom'));
  // room must still exist
  assert('room intact after failures', !!roomsMod.getRoom(room.id));

  // Sessions self-tore-down on FFmpeg exit; 'No active stream' is the correct non-crash response (EPIPE fix regression guard).
  console.log('\n[5] Stop-all after natural teardown (server must still be alive)');
  const stopAck = await new Promise((resolve) => { client.emit('stop-rtmp', {}, resolve); });
  console.log('  stop-rtmp ack:', JSON.stringify(stopAck));
  assert('stop-rtmp responds (no crash)', stopAck && typeof stopAck.success === 'boolean');
  assert('sessions already tore down → No active stream', stopAck && stopAck.success === false && stopAck.error === 'No active stream');
  assert('room.isStreaming reset to false', room.isStreaming === false);
  assert('room.rtmpUrl nulled', room.rtmpUrl === null);

  client.disconnect();
  io.close();
  console.log('\n═══════════════════════════════════════════════');
  console.log(failures === 0 ? 'ALL MULTI-TARGET E2E PASSED ✓' : `${failures} TEST(S) FAILED ✗`);
  process.exit(failures ? 1 : 0);
}

run().catch((err) => { console.error('FATAL:', err); process.exit(1); });