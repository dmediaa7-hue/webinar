// LIVE smoke test against the DEPLOYED server (http://localhost:3001).
// Proves the running process: (1) multi-target start (bare-host + rtmps:// +
// classic rtmp://), (2) survives FFmpeg deaths against rejecting endpoints
// (the unhandled-EPIPE crash that previously killed the whole server),
// (3) still answers stop-rtmp and HTTP afterwards.
const { readFileSync } = require('fs');
const path = require('path');
const http = require('http');

const { io: ioClient } = require('socket.io-client');

const SERVER = process.env.SERVER || 'http://localhost:3001';
const WEBM_FILE = path.join('C:\\Users\\Admin\\AppData\\Local\\Temp\\opencode\\rtmptest', 'test_webm.webm');

let failures = 0;
const assert = (label, cond) => { if (cond) console.log('  ✓', label); else { console.error('  ✗', label); failures++; } };

function httpAlive() {
  return new Promise((resolve) => {
    const req = http.get(SERVER, { timeout: 4000 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function run() {
  console.log(`Connecting to deployed server: ${SERVER}`);
  const client = ioClient(SERVER, { transports: ['websocket'], timeout: 8000 });
  await new Promise((res, rej) => {
    client.on('connect', res);
    client.on('connect_error', rej);
    setTimeout(() => rej(new Error('connect timeout')), 10000);
  });
  console.log('  connected as', client.id);

  const startedEvents = [];
  const errorEvents = [];
  client.on('rtmp-started', (e) => startedEvents.push(e));
  client.on('rtmp-error', (e) => errorEvents.push(e));

  console.log('\n[1] create-room (host)');
  const roomCreated = await new Promise((resolve) => {
    client.on('room-created', resolve);
    client.emit('create-room', { displayName: 'SmokeHost', roomName: 'RTMP Smoketest' });
  });
  console.log('  room-created:', JSON.stringify(roomCreated));
  assert('room created', !!roomCreated && !!roomCreated.roomId);

  console.log('\n[2] start-rtmp with bare-host + rtmps:// + classic rtmp:// targets');
  const targets = [
    { targetId: 'youtube', url: 'a.rtmp.youtube.com/live2', key: 'smoke-1111' },
    { targetId: 'facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp', key: 'smoke-2222' },
    { targetId: 'twitch', url: 'rtmp://live.twitch.tv/app', key: 'smoke-3333' }
  ];
  const ack = await new Promise((resolve) => {
    client.emit('start-rtmp', { targets, format: 'webm' }, resolve);
  });
  await new Promise((r) => setTimeout(r, 500));
  console.log('  ack:', JSON.stringify(ack));
  assert('ack.success === true', ack && ack.success === true);
  assert('3 targets ok', ack && ack.results && ack.results.length === 3 && ack.results.every(r => r.ok));
  assert('bare-host normalized to rtmp://', ack.results.find(r => r.targetId === 'youtube').url === 'rtmp://a.rtmp.youtube.com/live2/smoke-1111');
  assert('rtmps:// preserved', ack.results.find(r => r.targetId === 'facebook').url === 'rtmps://live-api-s.facebook.com:443/rtmp/smoke-2222');
  assert('3 rtmp-started events', startedEvents.length === 3);

  console.log('\n[3] Fan-out chunk feed against rejecting endpoints');
  const webmB64 = readFileSync(WEBM_FILE).toString('base64');
  for (let i = 0; i < 3; i++) {
    client.emit('rtmp-chunk', { data: webmB64, targetIds: ['youtube', 'facebook', 'twitch'] });
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 6000));
  console.log('  rtmp-error events:', JSON.stringify(errorEvents));
  assert('rejections surfaced as rtmp-error (not a crash)', errorEvents.length >= 1);

  console.log('\n[4] Server survived - still answers stop-rtmp');
  const stopAck = await Promise.race([
    new Promise((resolve) => { client.emit('stop-rtmp', {}, resolve); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('stop-rtmp ack timeout - server crashed')), 8000))
  ]);
  console.log('  stop-rtmp ack:', JSON.stringify(stopAck));
  assert('stop-rtmp responds (success or No active stream)', stopAck && typeof stopAck.success === 'boolean');

  console.log('\n[5] HTTP still served after all failures');
  const alive = await httpAlive();
  assert('deployed server answers HTTP', alive);

  client.disconnect();
  console.log('\n═══════════════════════════════════════════════');
  console.log(failures === 0 ? 'LIVE SMOKE TEST PASSED ✓' : `${failures} TEST(S) FAILED ✗`);
  process.exit(failures ? 1 : 0);
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });