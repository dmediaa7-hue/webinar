// Boot the server as a child process, run auth API assertions, then shut down.
// Self-contained so shell/process timing issues can't interfere.
const { spawn } = require('child_process');
const path = require('path');

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

function makeClient() {
  let cookie = '';
  return {
    async request(pathname, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers['Cookie'] = cookie;
      const res = await fetch(`${SERVER_URL}${pathname}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...headers }
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return res;
    }
  };
}

async function waitForServer(proc, timeoutMs = 10000) {
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

async function run() {
  console.log('=== Auth API Test (self-harnessed) ===\n');

  const proc = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    stdio: 'ignore'
  });

  try {
    await waitForServer(proc);

    const client = makeClient();
    const tag = Date.now();
    const email = `user${tag}@example.com`;

    let res = await client.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name: 'Test User', password: 'password123' })
    });
    assert(res.status === 201, 'Register returns 201');
    const regPayload = await res.json();
    assert(regPayload.user && regPayload.user.email === email, 'Register returns created user');

    // Two sessions for the same user created within the same second must stay
    // distinct. JWT iat has 1s granularity, so without a random jti the two
    // tokens are byte-identical and the second INSERT collides on token_hash.
    const auth = require('../src/auth');
    let sameSecondSessions = null;
    try {
      const first = await auth.createSession(regPayload.user.id);
      const second = await auth.createSession(regPayload.user.id);
      if (first.cookieValue === second.cookieValue) {
        sameSecondSessions = 'duplicate token produced';
      }
    } catch (e) {
      sameSecondSessions = e.message;
    }
    assert(sameSecondSessions === null, `same-second sessions stay distinct (${sameSecondSessions || 'ok'})`);

    res = await client.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name: 'Dup', password: 'password123' })
    });
    assert(res.status === 409, 'Duplicate email returns 409');

    res = await client.request('/api/auth/me');
    assert(res.status === 200, '/me with session returns 200');
    const me = await res.json();
    assert(me.user && me.user.email === email, '/me returns the logged-in user');

    res = await client.request('/api/auth/logout', { method: 'POST', body: '{}' });
    assert(res.status === 200, 'Logout returns 200');

    res = await client.request('/api/auth/me');
    assert(res.status === 200, '/me after logout returns 200');
    const meAfterLogout = await res.json();
    assert(meAfterLogout.user === null, '/me after logout returns user: null');

    res = await client.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'wrong-password' })
    });
    assert(res.status === 401, 'Wrong password returns 401');

    res = await client.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'password123' })
    });
    assert(res.status === 200, 'Correct login returns 200');
    const login = await res.json();
    assert(login.user && login.user.email === email, 'Login returns user');

    const statusPath = '/api/livekit/status';
    res = await client.request(statusPath);
    assert(res.status === 404, 'media status route removed -> 404');

    // --- Meeting scheduling API (task 17) ---
    // Unauthenticated create must be rejected before touching any DB logic.
    res = await fetch(`${SERVER_URL}/api/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'No-session meeting',
        startTime: Date.now() + 3600 * 1000,
        endTime: Date.now() + 7200 * 1000
      })
    });
    assert(res.status === 401, 'POST /api/meetings without session returns 401');

    // Authenticated create (session cookie from the login above).
    const startTime = Date.now() + 60 * 60 * 1000;
    res = await client.request('/api/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Scheduled Sync',
        startTime,
        endTime: startTime + 60 * 60 * 1000,
        roomName: 'scheduled-sync',
        waitingRoomEnabled: false
      })
    });
    assert(res.status === 201, 'POST /api/meetings with session returns 201');
    const created = await res.json();
    const invitePayload = created.meeting && created.meeting.invite;
    assert(invitePayload && invitePayload.joinUrl.includes('/meeting/'), 'created meeting exposes a join URL');
    assert(invitePayload.googleCalendarUrl.startsWith('https://calendar.google.com/calendar/render?'), 'google calendar URL present');
    assert(invitePayload.icsPath === `/api/meetings/${created.meeting.id}/invite.ics`, 'ics download path present');
    assert(created.meeting.hostUserId === me.user.id, 'hostUserId is the authenticated user, never a client-supplied id');

    res = await client.request('/api/meetings');
    assert(res.status === 200, 'GET /api/meetings returns 200');
    const listing = await res.json();
    assert(listing.meetings.some(m => m.id === created.meeting.id), 'listed meetings include the created one');

    res = await client.request(`/api/meetings/${created.meeting.id}/invite.ics`);
    assert(res.status === 200, 'ICS invite is downloadable');
    const ics = await res.text();
    assert(ics.includes('BEGIN:VCALENDAR') && ics.includes('BEGIN:VEVENT') && ics.includes(`UID:${created.meeting.id}@webinar`), 'ICS body parses with UID');

    res = await client.request(`/api/meetings/${created.meeting.id}`, { method: 'DELETE', body: '{}' });
    assert(res.status === 200, 'DELETE /api/meetings/:id returns 200');
    res = await client.request(`/api/meetings/${created.meeting.id}`);
    assert(res.status === 404, 'deleted meeting returns 404');

    // --- Start a scheduled meeting (task 18) ---
    // Ended meeting refuses to start.
    const endedMeeting = await client.request('/api/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Ended Meeting',
        startTime: Date.now() - 2 * 3600 * 1000,
        endTime: Date.now() - 3600 * 1000
      })
    });
    const ended = await endedMeeting.json();
    res = await client.request(`/api/meetings/${ended.meeting.id}/start`, { method: 'POST', body: '{}' });
    assert(res.status === 410, 'starting an ended meeting returns 410');

    // Not-started meeting: /api/rooms/:id surfaces MEETING_NOT_STARTED.
    const futureMeeting = await client.request('/api/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Future Sync',
        startTime: Date.now() + 3600 * 1000,
        endTime: Date.now() + 7200 * 1000,
        roomName: 'future-sync',
        passcode: '4242',
        waitingRoomEnabled: true
      })
    });
    const future = await futureMeeting.json();
    res = await client.request(`/api/rooms/${future.meeting.id}`);
    assert(res.status === 404, 'unstarted scheduled room returns 404');
    const notStarted = await res.json();
    assert(notStarted.code === 'MEETING_NOT_STARTED', 'unstarted room carries MEETING_NOT_STARTED code');

    // Start materializes the room with the scheduled passcode + waiting room.
    res = await client.request(`/api/meetings/${future.meeting.id}/start`, { method: 'POST', body: '{}' });
    assert(res.status === 200, 'start returns 200 for a future meeting');
    const started = await res.json();
    assert(started.roomId === future.meeting.id && started.hasPassword === true, 'start surfaces roomId + hasPassword');

    res = await client.request(`/api/rooms/${future.meeting.id}`);
    assert(res.status === 200, 'room exists after start');
    const roomInfo = await res.json();
    assert(roomInfo.hasPassword === true, 'room inherits the scheduled passcode');
    assert(roomInfo.settings.waitingRoomEnabled === true, 'room inherits the waiting-room toggle');

    res = await client.request(`/api/meetings/${future.meeting.id}`, { method: 'DELETE', body: '{}' });
    assert(res.status === 200, 'cleanup deletes the future meeting');

    console.log('\n=== Test Complete ===');
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
  } finally {
    proc.kill();
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

run().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
