const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Committed production defaults (server/.env.production), applied only when the
// process environment has not already set the key (override: false). This lets
// the deployed server on Render know its public client origin without requiring
// dashboard-managed env vars. Local server/.env always wins during development.
require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env.production'),
  override: false
});

const { createRoom, createRoomWithHash, joinRoom, leaveRoom, getRoom, getRooms, updateParticipant, updateRoomSettings, roomHasPassword, verifyPassword, getAttendance, addWaiting, getWaitingList, removeWaiting } = require('./rooms');
const { handleSignaling } = require('./signaling');
const { handleChat, getChatHistory } = require('./chat');
const recording = require('./recording');
const breakout = require('./breakout');
const engagement = require('./engagement');
const whiteboard = require('./whiteboard');
const meetings = require('./meetings');
const invite = require('./invite');
const auth = require('./auth');
const turn = require('./turn');
const db = require('./db');

const app = express();
const server = http.createServer(app);

// Allowed browser origins (CLIENT_URL may be a comma-separated list).
// The dev client talks to this server at an absolute origin with
// credentials: 'include', so CORS must echo the exact origin (a wildcard
// '*ACC*' is rejected by browsers for credentialed requests).
const CLIENT_ORIGINS = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const PORT = process.env.PORT || 3001;

// --- Hardening helpers ---

// Sanitize user-provided text: strip control chars, trim, cap length.
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function cleanPassword(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, 50);
}

// Failed join-attempt throttle (password brute-force guard), keyed by client IP.
const joinAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(socket) {
  const fwd = socket.handshake?.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return socket.handshake?.address || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = joinAttempts.get(ip);
  if (!entry) return false;
  if (now - entry.firstAt > WINDOW_MS) {
    joinAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const entry = joinAttempts.get(ip);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    joinAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
  // Bound memory: if the table grows too large, drop it entirely.
  if (joinAttempts.size > 10000) joinAttempts.clear();
}

function clearAttempts(ip) {
  joinAttempts.delete(ip);
}

// REST gate: requires the room's host socket id header. Deliberately spoofable
// (same posture as the client isAdmin flag) - blocks casual abuse, not a threat model.
// In-app flows use socket events gated by socket.data.isHost instead.
function requireRoomHost(req, res, roomId) {
  const room = getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }
  const hostId = req.headers['x-host-id'];
  if (!hostId || !room.hostId || hostId !== room.hostId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return room;
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || CLIENT_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true
}));

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Recording upload router is mounted on its path BEFORE the global JSON parser
// so only upload requests get the 200mb limit; all other endpoints use 1mb.
// mergeParams: true so req.params.roomId from the mount path
// /api/rooms/:roomId/recording/upload is visible inside this sub-router.
const uploadRouter = express.Router({ mergeParams: true });
uploadRouter.use(express.json({ limit: '200mb' }));
uploadRouter.post('/', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const { folder, filename, data, hostId } = req.body || {};
  if (!folder || typeof folder !== 'string' || !folder.trim()) {
    return res.status(400).json({ error: 'folder is required' });
  }
  if (!filename || typeof filename !== 'string' || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'data is required' });
  }
  if (!hostId || hostId !== room.hostId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (Buffer.byteLength(data, 'base64') > 500 * 1024 * 1024) {
    return res.status(413).json({ error: 'Recording exceeds 500MB limit' });
  }
  try {
    const result = await recording.saveRecording({ roomName: room.name, folder: folder.trim(), filename, base64Data: data });
    res.json(result);
  } catch (err) {
    const status = ['FOLDER_REQUIRED', 'INVALID_FILENAME', 'DATA_REQUIRED', 'FOLDER_UNSAFE'].includes(err.code) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
}));
app.use('/api/rooms/:roomId/recording/upload', uploadRouter);

// Global JSON parser: 1mb for all non-upload endpoints (recording uploads use
// the route-specific 200mb parser above).
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// --- Authentication routes ---

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const result = await auth.registerUser(req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const { cookieValue, cookieOptions } = await auth.createSession(result.user.id);
  res.cookie(auth.COOKIE_NAME, cookieValue, cookieOptions);
  res.status(201).json({ user: result.user });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await auth.verifyCredentials(email, password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const { cookieValue, cookieOptions } = await auth.createSession(user.id);
  res.cookie(auth.COOKIE_NAME, cookieValue, cookieOptions);
  res.json({ user });
}));

// Password reset, self-hosted pattern: there is no mail infrastructure, so the
// reset link is returned in the API response itself. The deployed client is a
// separate origin (Vite SPA), so the link points at the client (CLIENT_URL),
// never at the API host.
app.post('/api/auth/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  const result = await auth.requestPasswordReset(email);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const CLIENT_BASE = (process.env.CLIENT_URL || (req.protocol + '://' + req.get('host'))).split(',')[0].trim();
  const resetLink = `${CLIENT_BASE.replace(/\/$/, '')}/reset-password?token=${result.resetToken}`;
  res.json({ ok: true, resetLink });
}));

app.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};
  const result = await auth.applyPasswordReset(token, password);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
}));

app.post('/api/auth/logout', asyncHandler(async (req, res) => {
  await auth.destroySession(req.cookies && req.cookies[auth.COOKIE_NAME]);
  res.clearCookie(auth.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}));

// Session probe: answers 200 with { user } for a valid session and 200 with
// { user: null } when logged out. It must NOT 401 - the login screen calls this
// on every mount to check for a restorable session, and a 401 for anonymous
// visitors (a) spams the browser console and (b) is semantically wrong for a
// "who am I" query. Auth-required endpoints keep requireAuth.
app.get('/api/auth/me', auth.loadUser, asyncHandler(async (req, res) => {
  res.json({ user: req.user || null });
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: getRooms().size, timestamp: Date.now() });
});

// WebRTC TURN credentials (Cloudflare Realtime), fetched by the client before
// it creates peer connections. Deliberately public - guests joining via an
// invite link are not logged in, but still need relay credentials.
app.get('/api/turn-credentials', asyncHandler(async (req, res) => {
  const creds = await turn.getTurnCredentials();
  if (!creds) return res.status(503).json({ error: 'TURN not configured' });
  res.json(creds);
}));

// --- Meeting scheduling API (task 17) ---
// hostUserId is always req.user.id on create, so no account can schedule
// meetings on another user's behalf.

function meetingWithInvite(meeting) {
  return { ...meeting, invite: invite.inviteFor(meeting) };
}

app.get('/api/meetings', auth.requireAuth, asyncHandler(async (req, res) => {
  const list = await meetings.listMeetings({ hostUserId: req.user.id });
  res.json({ meetings: list.map(meetingWithInvite) });
}));

app.post('/api/meetings', auth.requireAuth, asyncHandler(async (req, res) => {
  const input = {
    hostUserId: req.user.id,
    title: req.body?.title,
    startTime: req.body?.startTime,
    endTime: req.body?.endTime,
    roomName: req.body?.roomName,
    passcode: req.body?.passcode,
    waitingRoomEnabled: req.body?.waitingRoomEnabled
  };
  try {
    const meeting = await meetings.createMeeting(input);
    res.status(201).json({ meeting: meetingWithInvite(meeting) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.get('/api/meetings/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const meeting = await meetings.getMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.hostUserId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  res.json({ meeting: meetingWithInvite(meeting) });
}));

// Deliberately public like a calendar invite: anyone holding the link can
// fetch the ICS without an account.
app.get('/api/meetings/:id/invite.ics', asyncHandler(async (req, res) => {
  const meeting = await meetings.getMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="webinar-${meeting.id}.ics"`);
  res.send(invite.toICS(meeting));
}));

app.delete('/api/meetings/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const meeting = await meetings.getMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.hostUserId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  await meetings.deleteMeeting(req.params.id);
  res.json({ ok: true });
}));

// Start a scheduled meeting (owner only): materializes the in-memory room
// with the scheduled settings so /meeting/:id joins work. Idempotent - a
// second start reuses the live room. An ended meeting refuses to start.
app.post('/api/meetings/:id/start', auth.requireAuth, asyncHandler(async (req, res) => {
  const row = await meetings.getMeetingRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Meeting not found' });
  if (row.host_user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (Date.now() > row.end_time) {
    return res.status(410).json({ error: 'This meeting has ended', code: 'MEETING_ENDED' });
  }

  let room = getRoom(row.id);
  if (!room) {
    room = createRoomWithHash(row.id, {
      hostName: req.user.name,
      roomName: row.title,
      passwordHash: row.passcode_hash || null,
      waitingRoomEnabled: Boolean(row.waiting_room_enabled),
      isLocked: false
    });
  }
  const meeting = await meetings.getMeeting(row.id);
  res.json({
    roomId: row.id,
    roomName: meeting.roomName || row.title,
    hasPassword: Boolean(row.passcode_hash),
    invite: invite.inviteFor(meeting)
  });
}));

// Create room
app.post('/api/rooms', asyncHandler(async (req, res) => {
  try {
    const hostName = cleanText(req.body?.hostName || 'Host', 60) || 'Host';
    const roomName = cleanText(req.body?.roomName || '', 100) || null;
    const password = cleanPassword(req.body?.password);
    const roomId = uuidv4().slice(0, 8);
    await createRoom(roomId, hostName, null, password, roomName);
    res.status(201).json({
      roomId,
      roomName: (roomName || hostName + "'s Meeting"),
      hasPassword: Boolean(password),
      message: 'Room created'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}));

// Get room info. A room that has not been started (or has ended) surfaces its
// scheduled-meeting status so guests with an invite link see a clear state
// instead of a bare "not found".
app.get('/api/rooms/:roomId', asyncHandler(async (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    const scheduled = await meetings.getMeetingRow(req.params.roomId);
    if (scheduled) {
      const now = Date.now();
      if (now > scheduled.end_time) {
        return res.status(410).json({
          error: 'This meeting has ended',
          code: 'MEETING_ENDED',
          meeting: { title: scheduled.title, startTime: scheduled.start_time, endTime: scheduled.end_time }
        });
      }
      return res.status(404).json({
        error: 'This meeting has not started yet. The host will start it shortly.',
        code: 'MEETING_NOT_STARTED',
        meeting: { title: scheduled.title, startTime: scheduled.start_time, endTime: scheduled.end_time }
      });
    }
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    settings: room.settings,
    hasPassword: roomHasPassword(room),
    participantCount: room.participants.size,
    isRecording: room.isRecording
  });
}));

// List participants
app.get('/api/rooms/:roomId/participants', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const participants = Array.from(room.participants.values()).map(p => ({
    socketId: p.socketId,
    userId: p.userId,
    displayName: p.displayName,
    isHost: p.isHost,
    isMuted: p.isMuted,
    isVideoOff: p.isVideoOff,
    isScreenSharing: p.isScreenSharing
  }));
  res.json(participants);
});

// Room attendance log (host-gated; in-app download uses socket 'get-attendance')
app.get('/api/rooms/:roomId/attendance', (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  res.json({ attendance: getAttendance(req.params.roomId) });
});

app.get('/api/rooms/:roomId/recording/status', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const rows = await db.all('SELECT id, room_name, status, created_at, url FROM recordings WHERE room_name = ? ORDER BY id DESC', room.name);
  const recordings = rows.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.created_at,
    filename: require('path').basename(r.url)
  }));
  res.json({ recordings });
}));

// --- Breakout room endpoints (host-gated via x-host-id; task 12) ---

// Emit persisted breakout state to the room so client panels refresh.
async function broadcastBreakouts(roomId) {
  const state = await breakout.listBreakouts(roomId);
  if (!state.error) io.to(roomId).emit('breakout-updated', state);
}

app.get('/api/rooms/:roomId/breakouts', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await breakout.listBreakouts(req.params.roomId);
  if (result.error) return res.status(404).json(result);
  res.json(result);
}));

app.post('/api/rooms/:roomId/breakouts', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await breakout.createBreakout(
    req.params.roomId,
    req.body?.name || null,
    req.headers['x-host-id']
  );
  if (result.error) {
    const status = result.code === 'DUPLICATE_BREAKOUT' ? 409 : 400;
    return res.status(status).json(result);
  }
  await broadcastBreakouts(req.params.roomId);
  res.status(201).json(result);
}));

app.post('/api/rooms/:roomId/breakouts/assign', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const { identity, name } = req.body || {};
  const result = await breakout.assignParticipant(req.params.roomId, identity, name);
  if (result.error) {
    const status = result.code === 'BREAKOUT_NOT_FOUND' ? 404
      : result.code === 'PARTICIPANT_NOT_FOUND' ? 404 : 400;
    return res.status(status).json(result);
  }
  await broadcastBreakouts(req.params.roomId);
  res.json(result);
}));

app.post('/api/rooms/:roomId/breakouts/return', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const { identity } = req.body || {};
  const result = await breakout.returnParticipant(req.params.roomId, identity);
  if (result.error) {
    return res.status(400).json(result);
  }
  await broadcastBreakouts(req.params.roomId);
  res.json(result);
}));

app.post('/api/rooms/:roomId/breakouts/teardown', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await breakout.teardownBreakouts(req.params.roomId);
  if (result.error) {
    return res.status(400).json(result);
  }
  await broadcastBreakouts(req.params.roomId);
  res.json(result);
}));

// Get chat history
app.get('/api/rooms/:roomId/chat', (req, res) => {
  const history = getChatHistory(req.params.roomId);
  if (history.error) return res.status(404).json(history);
  res.json(history);
});

// --- Polls & Q&A endpoints (task 15) ---
// Live traffic rides the 'poll'/'qa' data channels; these routes keep
// the durable record (SQLite) so results survive a refresh and the host can
// download them. Poll creation and "mark answered" are host-gated; votes and
// questions require the caller to be a current roster participant.

// REST gate: participant actions must come from a socket currently in the room
// roster (identity === socket.id, same contract as the socket relay).
function requireRoomParticipant(req, res, roomId) {
  const room = getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }
  const identity = cleanText(req.body?.identity, 100);
  if (!identity || !room.participants.has(identity)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return room;
}

// Create a poll (host-only, x-host-id gate).
app.post('/api/rooms/:roomId/polls', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await engagement.createPoll({
    roomName: req.params.roomId,
    question: req.body?.question,
    options: req.body?.options,
    hostIdentity: req.headers['x-host-id']
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json({ poll: result.poll });
}));

// Cast / replace a participant's vote (idempotent per voter).
app.post('/api/rooms/:roomId/polls/:pollId/votes', asyncHandler(async (req, res) => {
  const room = requireRoomParticipant(req, res, req.params.roomId);
  if (!room) return;
  const result = await engagement.recordPollVote({
    pollId: req.params.pollId,
    voterIdentity: req.body?.identity,
    optionIndex: req.body?.optionIndex
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ results: result.results });
}));

// Poll list with tallies (refresh restore / host download; room-scoped).
app.get('/api/rooms/:roomId/polls', asyncHandler(async (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ polls: await engagement.listPolls(req.params.roomId) });
}));

// Ask a Q&A question (participant).
app.post('/api/rooms/:roomId/qa', asyncHandler(async (req, res) => {
  const room = requireRoomParticipant(req, res, req.params.roomId);
  if (!room) return;
  const result = await engagement.createQuestion({
    roomName: req.params.roomId,
    authorIdentity: req.body?.identity,
    authorName: req.body?.name,
    body: req.body?.body
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json({ question: result.question });
}));

// Vote on a question (participant): delta +1 upvote / -1 downvote / 0 neutral.
// The net score is the SUM of per-voter deltas.
app.post('/api/rooms/:roomId/qa/:questionId/vote', asyncHandler(async (req, res) => {
  const room = requireRoomParticipant(req, res, req.params.roomId);
  if (!room) return;
  const result = await engagement.recordQuestionVote({
    questionId: req.params.questionId,
    voterIdentity: req.body?.identity,
    delta: req.body?.delta
  });
  const status = result.error === 'QUESTION_NOT_FOUND' ? 404 : 400;
  if (!result.ok) return res.status(status).json({ error: result.error });
  res.json({ question: result.question });
}));

// Mark a question answered / unanswered (host-only).
app.post('/api/rooms/:roomId/qa/:questionId/answered', asyncHandler(async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await engagement.markQuestionAnswered(req.params.questionId, Boolean(req.body?.isAnswered));
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json({ question: result.question });
}));

// Q&A list (refresh restore / host download; room-scoped).
app.get('/api/rooms/:roomId/qa', asyncHandler(async (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ questions: await engagement.listQuestions(req.params.roomId) });
}));

// Whiteboard scene save (participant-gated; debounced by the client).
app.post('/api/rooms/:roomId/whiteboard', asyncHandler(async (req, res) => {
  const room = requireRoomParticipant(req, res, req.params.roomId);
  if (!room) return;
  const result = await whiteboard.saveScene(req.params.roomId, req.body?.elements);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

// Whiteboard scene load (room-scoped; reload recovery).
app.get('/api/rooms/:roomId/whiteboard', asyncHandler(async (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ elements: await whiteboard.getScene(req.params.roomId) || [] });
}));

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // Store which room this socket is in
  socket.data.roomId = null;
  socket.data.displayName = null;
  socket.data.isHost = false;
  socket.data.isAdmin = false;

  // --- Room management events ---

  // Create a new room via socket
  socket.on('create-room', async ({ displayName = 'Host', password = null, roomName = null, isAdmin = false } = {}, callback) => {
    try {
      const cleanName = cleanText(displayName, 60) || 'Host';
      const cleanRoomName = cleanText(roomName, 100) || null;
      const cleanPwd = cleanPassword(password);
      const roomId = uuidv4().slice(0, 8);
      const room = await createRoom(roomId, cleanName, socket.id, cleanPwd, cleanRoomName);
      socket.data.roomId = roomId;
      socket.data.displayName = cleanName;
      socket.data.isHost = true;
      socket.data.isAdmin = Boolean(isAdmin);
      socket.join(roomId);
      socket.emit('room-created', { roomId, roomName: room.name, hasPassword: Boolean(cleanPwd) });
      socket.emit('attendance-updated', { attendance: getAttendance(roomId) });
      if (typeof callback === 'function') callback({ success: true, roomId, roomName: room.name, hasPassword: Boolean(cleanPwd) });
    } catch (err) {
      console.error('[create-room error]', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message || 'Failed to create room' });
    }
  });

  // Join an existing room
  socket.on('join-room', async ({ roomId, displayName = 'Guest', password = null, isAdmin = false }, callback) => {
    try {
      const cleanName = cleanText(displayName, 60) || 'Guest';
      const cleanPwd = cleanPassword(password);

      const room = getRoom(roomId);
      if (!room) {
        socket.emit('error-message', { message: 'Room not found' });
        if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
        return;
      }

      if (room.settings.isLocked) {
        socket.emit('error-message', { message: 'Room is locked' });
        if (typeof callback === 'function') callback({ success: false, error: 'Room is locked' });
        return;
      }

      const ip = clientIp(socket);
      if (roomHasPassword(room) && isRateLimited(ip)) {
        const message = 'Too many failed attempts. Try again in 15 minutes.';
        socket.emit('error-message', { message });
        if (typeof callback === 'function') callback({ success: false, error: message, code: 'RATE_LIMITED' });
        return;
      }

      if (roomHasPassword(room) && !verifyPassword(room, cleanPwd)) {
        recordFailedAttempt(ip);
        const message = 'Incorrect meeting password';
        socket.emit('error-message', { message });
        if (typeof callback === 'function') callback({ success: false, error: message, code: 'WRONG_PASSWORD' });
        return;
      }
      clearAttempts(ip);

      // Waiting room gate: when enabled, non-host joiners are held without room
      // membership (no participant entry, not in the socket room) until the host
      // admits them. The first arrival bypasses the gate so the meeting can be
      // started even when the host enables the waiting room from an empty room.
      const isJoiningAsHost = socket.id === room.hostId || room.participants.size === 0;
      if (room.settings.waitingRoomEnabled && !isJoiningAsHost) {
        addWaiting(roomId, {
          socketId: socket.id,
          userId: uuidv4(),
          displayName: cleanName
        });
        socket.data.roomId = roomId;
        socket.data.displayName = cleanName;
        socket.data.waiting = true;
        socket.emit('waiting-room', { roomId, displayName: cleanName });
        io.to(roomId).emit('waiting-list-updated', { waitingList: getWaitingList(roomId) });
        if (typeof callback === 'function') callback({ success: true, waiting: true });
        console.log(`[⏳] ${displayName} waiting in room ${roomId}`);
        return;
      }

      let participant;
      try {
        const isHost = (room.hostId === socket.id);
        participant = joinRoom(roomId, {
          socketId: socket.id,
          userId: uuidv4(),
          displayName: cleanName,
          isHost: isHost || room.participants.size === 0,
          isMuted: false,
          isVideoOff: false,
          isScreenSharing: false
        });
      } catch (error) {
        const message = error.message || 'Unable to join room';
        socket.emit('error-message', { message });
        if (typeof callback === 'function') callback({ success: false, error: message });
        return;
      }

      socket.data.roomId = roomId;
      socket.data.displayName = cleanName;
      socket.data.isHost = participant.isHost;
      socket.data.isAdmin = Boolean(isAdmin);
      socket.join(roomId);

      // Notify existing participants
      const existingParticipants = Array.from(room.participants.values())
        .filter(p => p.socketId !== socket.id)
        .map(p => ({
          socketId: p.socketId,
          userId: p.userId,
          displayName: p.displayName,
          isHost: p.isHost,
          isMuted: p.isMuted,
          isVideoOff: p.isVideoOff,
          isScreenSharing: p.isScreenSharing
        }));

      socket.emit('room-joined', {
        roomId,
        roomName: room.name,
        participants: existingParticipants,
        isHost: participant.isHost,
        hasPassword: roomHasPassword(room),
        settings: room.settings
      });

      // Notify others that someone joined
      socket.to(roomId).emit('participant-joined', {
        participant: {
          socketId: socket.id,
          userId: participant.userId,
          displayName: cleanName,
          isHost: participant.isHost,
          isMuted: false,
          isVideoOff: false,
          isScreenSharing: false
        }
      });

      console.log(`[+] ${displayName} joined room ${roomId}`);
      io.to(roomId).emit('attendance-updated', { attendance: getAttendance(roomId) });
      if (typeof callback === 'function') callback({ success: true, isHost: participant.isHost });
    } catch (err) {
      console.error('[join-room error]', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message || 'Failed to join room' });
    }
  });

  // Leave room
  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
  });

  // Attendance download (host or admin only)
  socket.on('get-attendance', (callback) => {
    const room = getRoom(socket.data.roomId);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'ROOM_NOT_FOUND' });
      return;
    }
    if (!socket.data.isHost && !socket.data.isAdmin) {
      if (typeof callback === 'function') callback({ success: false, error: 'FORBIDDEN' });
      return;
    }
    if (typeof callback === 'function') callback({ success: true, attendance: getAttendance(room.id) });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    console.log(`[-] Client disconnected: ${socket.id}`);
  });

  function leaveCurrentRoom(socket) {
    const { roomId, displayName } = socket.data;
    if (!roomId) return;

    // A held waiting joiner never became a participant - just release the
    // waiting seat and refresh the host's list.
    if (socket.data.waiting) {
      if (removeWaiting(roomId, socket.id)) {
        const room = getRoom(roomId);
        if (room) io.to(roomId).emit('waiting-list-updated', { waitingList: getWaitingList(roomId) });
      }
      socket.data.roomId = null;
      socket.data.waiting = false;
      return;
    }

    const room = getRoom(roomId);
    if (room) {
      const wasHost = room.participants.get(socket.id)?.isHost || false;
      leaveRoom(roomId, socket.id);

      if (wasHost && room.hostId) {
        // leaveRoom() reassigned room.hostId - mirror it on the successor's socket
        // because host-gated handlers check socket.data.isHost. If the successor
        // already disconnected, promote the first remaining connected participant.
        let successor = io.sockets.sockets.get(room.hostId);
        if (!successor) {
          const nextConnected = Array.from(room.participants.keys()).find((id) => io.sockets.sockets.get(id));
          if (nextConnected) {
            room.hostId = nextConnected;
            successor = io.sockets.sockets.get(nextConnected);
            room.participants.get(nextConnected).isHost = true;
          }
        }
        if (successor) successor.data.isHost = true;
      }

      // Notify everyone else in the room
      io.to(roomId).emit('participant-left', {
        socketId: socket.id,
        roomId,
        newHost: room.hostId
      });
      io.to(roomId).emit('attendance-updated', { attendance: getAttendance(roomId) });

      console.log(`[-] ${displayName || socket.id} left room ${roomId}`);
      // Empty-room cleanup (after 5 min) is handled inside rooms.js
    }

    socket.data.roomId = null;
    socket.data.displayName = null;
  }

  // --- Host controls ---

  // Mute a participant (host only)
  socket.on('mute-participant', ({ targetId }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;

    const target = room.participants.get(targetId);
    if (target) {
      target.isMuted = true;
      updateParticipant(room.id, targetId, { isMuted: true });
      io.to(targetId).emit('force-mute');
      socket.emit('participant-muted', { socketId: targetId, displayName: target.displayName });
    }
  });

  // Kick a participant (host only)
  socket.on('kick-participant', ({ targetId }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;

    const target = room.participants.get(targetId);
    if (target) {
      io.to(targetId).emit('kicked', { byHost: socket.data.displayName });
      // Give a moment for the kicked client to handle the event
      setTimeout(() => {
        const client = io.sockets.sockets.get(targetId);
        if (client) {
          leaveCurrentRoom(client);
          client.disconnect(true);
        }
      }, 500);
    }
  });

  // Toggle waiting room (host only)
  socket.on('toggle-waiting-room', async () => {
    try {
      const room = getRoom(socket.data.roomId);
      if (!room || !socket.data.isHost) return;
      const enabling = !room.settings.waitingRoomEnabled;
      const settings = await updateRoomSettings(room.id, { waitingRoomEnabled: enabling });
      io.to(room.id).emit('room-settings-updated', settings);

      if (!enabling) {
        // Waiting room turned off: admit everyone currently held, so no joiner
        // is left stuck outside the meeting with no path in.
        const waitingList = getWaitingList(room.id);
        for (const w of waitingList) {
          await admitWaitingJoiner(room, w);
        }
        io.to(room.id).emit('waiting-list-updated', { waitingList: getWaitingList(room.id) });
      }
    } catch (err) {
      console.error('[toggle-waiting-room error]', err);
    }
  });

  async function admitWaitingJoiner(room, waiting) {
    removeWaiting(room.id, waiting.socketId);
    const target = io.sockets.sockets.get(waiting.socketId);
    if (!target) return;
    const participant = await joinRoom(room.id, {
      socketId: waiting.socketId,
      userId: waiting.userId,
      displayName: waiting.displayName,
      isHost: false,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false
    });
    target.data.roomId = room.id;
    target.data.displayName = waiting.displayName;
    target.data.isHost = false;
    target.data.waiting = false;
    target.join(room.id);

    const existingParticipants = Array.from(room.participants.values())
      .filter((p) => p.socketId !== waiting.socketId)
      .map((p) => ({
        socketId: p.socketId,
        userId: p.userId,
        displayName: p.displayName,
        isHost: p.isHost,
        isMuted: p.isMuted,
        isVideoOff: p.isVideoOff,
        isScreenSharing: p.isScreenSharing
      }));

    target.emit('room-joined', {
      roomId: room.id,
      roomName: room.name,
      participants: existingParticipants,
      isHost: false,
      hasPassword: roomHasPassword(room),
      settings: room.settings
    });
    target.to(room.id).emit('participant-joined', {
      participant: {
        socketId: waiting.socketId,
        userId: participant.userId,
        displayName: participant.displayName,
        isHost: false,
        isMuted: false,
        isVideoOff: false,
        isScreenSharing: false
      }
    });
    io.to(room.id).emit('attendance-updated', { attendance: getAttendance(room.id) });
  }

  // Admit a waiting joiner (host only): promotes them to a participant, puts
  // their socket in the room, and hands them the standard room-joined payload
  // so the client's normal admission path runs (store sync + media connect).
  socket.on('admit-waiting', async ({ targetId } = {}, ack) => {
    try {
      const room = getRoom(socket.data.roomId);
      if (!room || !socket.data.isHost) {
        ack?.({ success: false, error: 'FORBIDDEN' });
        return;
      }
      const waiting = getWaitingList(room.id).find((w) => w.socketId === targetId);
      if (!waiting) {
        ack?.({ success: false, error: 'NOT_WAITING' });
        return;
      }
      await admitWaitingJoiner(room, waiting);
      io.to(room.id).emit('waiting-list-updated', { waitingList: getWaitingList(room.id) });
      ack?.({ success: true, socketId: targetId, displayName: waiting.displayName });
      console.log(`[✅] ${waiting.displayName} admitted to room ${room.id}`);
    } catch (err) {
      console.error('[admit-waiting error]', err);
      ack?.({ success: false, error: err.message || 'Failed to admit' });
    }
  });

  // Deny a waiting joiner (host only): back to the lobby with a message.
  socket.on('deny-waiting', ({ targetId } = {}) => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;
    if (removeWaiting(room.id, targetId)) {
      const target = io.sockets.sockets.get(targetId);
      if (target) {
        target.data.roomId = null;
        target.data.waiting = false;
        target.emit('waiting-denied', { message: 'The host did not admit you to this meeting.' });
      }
      io.to(room.id).emit('waiting-list-updated', { waitingList: getWaitingList(room.id) });
    }
  });

  // Lock room (host only)
  socket.on('lock-room', async ({ isLocked }, ack) => {
    try {
      const room = getRoom(socket.data.roomId);
      if (!room || !socket.data.isHost) return;
      const settings = await updateRoomSettings(room.id, { isLocked: Boolean(isLocked) });
      io.to(room.id).emit('room-locked', { isLocked: settings.isLocked });
      ack?.({ success: true, roomId: room.id, isLocked: settings.isLocked });
    } catch (err) {
      console.error('[lock-room error]', err);
      ack?.({ success: false, error: err.message || 'Failed to update room' });
    }
  });

  // --- WebRTC signaling ---
  handleSignaling(io, socket);

  // --- Chat ---
  handleChat(io, socket);

  // --- Recording controls (host only) ---
  socket.on('start-recording', () => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;
    io.to(room.id).emit('recording-started');
  });

  socket.on('stop-recording', () => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;
    io.to(room.id).emit('recording-stopped');
  });
});

// JSON 404 for unknown API routes + final error handler (never leak HTML/stack traces)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use((err, req, res, next) => {
  console.error('[Server error]', err);
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Payload too large' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

db.schemaReady.then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀 Webinar Server running on http://localhost:${PORT}`);
    console.log(`   Signaling URL: ws://localhost:${PORT}\n`);
  });
});
