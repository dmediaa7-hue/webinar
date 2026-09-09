const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const { createRoom, joinRoom, leaveRoom, getRoom, getRooms, updateParticipant, updateRoomSettings, roomHasPassword, verifyPassword, getAttendance, addWaiting, getWaitingList, removeWaiting } = require('./rooms');
const { handleSignaling } = require('./signaling');
const { handleChat, getChatHistory } = require('./chat');
const recording = require('./recording');
const breakout = require('./breakout');
const auth = require('./auth');
const livekit = require('./livekit');
const livekitAdmin = require('./livekitAdmin');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
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

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// --- Authentication routes ---

app.post('/api/auth/register', (req, res) => {
  const result = auth.registerUser(req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const { cookieValue, cookieOptions } = auth.createSession(result.user.id);
  res.cookie(auth.COOKIE_NAME, cookieValue, cookieOptions);
  res.status(201).json({ user: result.user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = auth.verifyCredentials(email, password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const { cookieValue, cookieOptions } = auth.createSession(user.id);
  res.cookie(auth.COOKIE_NAME, cookieValue, cookieOptions);
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  auth.destroySession(req.cookies && req.cookies[auth.COOKIE_NAME]);
  res.clearCookie(auth.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- LiveKit routes ---

// Issue a short-lived join token. `room` and `identity` are required.
// Host rights (`roomAdmin`) are derived server-side from the room's live
// participant state - the client-supplied `roomAdmin` param is ignored so a
// guest can never mint an admin token. A locked room refuses non-host joins.
app.get('/api/livekit/token', auth.loadUser, async (req, res) => {
  const room = String(req.query.room || '').trim();
  const identity = String(req.query.identity || '').trim().slice(0, 100);
  const name = String(req.query.name || req.user?.name || identity || 'Guest').slice(0, 100);
  if (!room || !identity) {
    return res.status(400).json({ error: 'room and identity are required' });
  }
  if (!livekit.isConfigured()) {
    return res.status(403).json({ error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED' });
  }

  // roomAdmin comes from the room's participant roster (identity === socket.id
  // for the socket that joined), never from a client flag.
  const roomState = getRoom(room);
  const participant = roomState && roomState.participants.get(identity);
  const roomAdmin = Boolean(participant && participant.isHost);

  // Server-side room lock: non-host joins are refused while locked.
  if (livekitAdmin.isRoomLocked(room) && !roomAdmin) {
    return res.status(403).json({ error: 'Room is locked', code: 'ROOM_LOCKED' });
  }

  // Waiting-room gate (task 14): a held joiner must not receive a media token
  // until the host admits them - "not connected to the LiveKit room" enforced
  // on the server, not just in the UI.
  if (roomState && roomState.waitingList && roomState.waitingList.has(identity)) {
    return res.status(403).json({ error: 'Please wait for the host to admit you', code: 'WAITING_ROOM' });
  }

  // A token grant is normally scoped to the requested room. For the breakout
  // simulation (task 12) every identity also gets roomCreate:true so the same
  // token authorizes the destination '{main}:N' room when the host moves a
  // participant (moveParticipant relocates the existing connection - there is
  // no re-join with a fresh token). roomAdmin is still derived server-side.
  const { token, serverUrl } = await livekit.createJoinToken({ room, identity, name, roomAdmin, roomCreate: true });
  res.json({ token, serverUrl, identity, name, roomAdmin });
});

// Health endpoint: surface whether LiveKit is configured (for the client UI).
app.get('/api/livekit/status', (req, res) => {
  res.json({ configured: livekit.isConfigured() });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: getRooms().size, timestamp: Date.now() });
});

// Create room
app.post('/api/rooms', (req, res) => {
  try {
    const hostName = cleanText(req.body?.hostName || 'Host', 60) || 'Host';
    const roomName = cleanText(req.body?.roomName || '', 100) || null;
    const password = cleanPassword(req.body?.password);
    const roomId = uuidv4().slice(0, 8);
    createRoom(roomId, hostName, null, password, roomName);
    res.status(201).json({
      roomId,
      roomName: (roomName || hostName + "'s Meeting"),
      hasPassword: Boolean(password),
      message: 'Room created'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get room info
app.get('/api/rooms/:roomId', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
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
});

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

// Recording endpoints (host-gated via x-host-id; the in-app flow uses socket events which check socket.data.isHost)
app.post('/api/rooms/:roomId/recording/start', async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await recording.startRecording(req.params.roomId);
  if (result.error) {
    const status = result.code === 'LIVEKIT_NOT_CONFIGURED' ? 503 : 404;
    return res.status(status).json(result);
  }
  res.json(result);
});

app.post('/api/rooms/:roomId/recording/stop', async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await recording.stopRecording(req.params.roomId);
  if (result.error) {
    const status = result.code === 'LIVEKIT_NOT_CONFIGURED' ? 503 : 404;
    return res.status(status).json(result);
  }
  res.json(result);
});

app.get('/api/rooms/:roomId/recording/status', (req, res) => {
  const result = recording.getRecordingStatus(req.params.roomId);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// --- Breakout room endpoints (host-gated via x-host-id; task 12) ---

// Emit persisted breakout state to the room so client panels refresh.
function broadcastBreakouts(roomId) {
  const state = breakout.listBreakouts(roomId);
  if (!state.error) io.to(roomId).emit('breakout-updated', state);
}

app.get('/api/rooms/:roomId/breakouts', (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = breakout.listBreakouts(req.params.roomId);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.post('/api/rooms/:roomId/breakouts', async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await breakout.createBreakout(
    req.params.roomId,
    req.body?.name || null,
    req.headers['x-host-id']
  );
  if (result.error) {
    const status = result.code === 'LIVEKIT_NOT_CONFIGURED' ? 503
      : result.code === 'DUPLICATE_BREAKOUT' ? 409 : 400;
    return res.status(status).json(result);
  }
  broadcastBreakouts(req.params.roomId);
  res.status(201).json(result);
});

app.post('/api/rooms/:roomId/breakouts/assign', async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const { identity, name } = req.body || {};
  const result = await breakout.assignParticipant(req.params.roomId, identity, name);
  if (result.error) {
    const status = result.code === 'LIVEKIT_NOT_CONFIGURED' ? 503
      : result.code === 'BREAKOUT_NOT_FOUND' ? 404
      : result.code === 'PARTICIPANT_NOT_FOUND' ? 404 : 400;
    return res.status(status).json(result);
  }
  broadcastBreakouts(req.params.roomId);
  res.json(result);
});

app.post('/api/rooms/:roomId/breakouts/return', async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const { identity } = req.body || {};
  const result = await breakout.returnParticipant(req.params.roomId, identity);
  if (result.error) {
    const status = result.code === 'LIVEKIT_NOT_CONFIGURED' ? 503 : 400;
    return res.status(status).json(result);
  }
  broadcastBreakouts(req.params.roomId);
  res.json(result);
});

app.post('/api/rooms/:roomId/breakouts/teardown', async (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = await breakout.teardownBreakouts(req.params.roomId);
  if (result.error) {
    const status = result.code === 'LIVEKIT_NOT_CONFIGURED' ? 503 : 400;
    return res.status(status).json(result);
  }
  broadcastBreakouts(req.params.roomId);
  res.json(result);
});

// Get chat history
app.get('/api/rooms/:roomId/chat', (req, res) => {
  const history = getChatHistory(req.params.roomId);
  if (history.error) return res.status(404).json(history);
  res.json(history);
});

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
  socket.on('create-room', ({ displayName = 'Host', password = null, roomName = null, isAdmin = false } = {}, callback) => {
    const cleanName = cleanText(displayName, 60) || 'Host';
    const cleanRoomName = cleanText(roomName, 100) || null;
    const cleanPwd = cleanPassword(password);
    const roomId = uuidv4().slice(0, 8);
    const room = createRoom(roomId, cleanName, socket.id, cleanPwd, cleanRoomName);
    socket.data.roomId = roomId;
    socket.data.displayName = cleanName;
    socket.data.isHost = true;
    socket.data.isAdmin = Boolean(isAdmin);
    socket.join(roomId);
    socket.emit('room-created', { roomId, roomName: room.name, hasPassword: Boolean(cleanPwd) });
    socket.emit('attendance-updated', { attendance: getAttendance(roomId) });
    if (typeof callback === 'function') callback({ success: true, roomId, roomName: room.name, hasPassword: Boolean(cleanPwd) });
  });

  // Join an existing room
  socket.on('join-room', ({ roomId, displayName = 'Guest', password = null, isAdmin = false }, callback) => {
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
        // because host-gated handlers check socket.data.isHost.
        const successor = io.sockets.sockets.get(room.hostId);
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

    // Mirror the mute on the SFU so the participant's published audio track is
    // silenced server-side (no-op when LiveKit keys are absent).
    livekitAdmin.muteParticipant(room.id, targetId);
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

    // Sever the SFU session too (no-op when LiveKit keys are absent).
    livekitAdmin.removeParticipant(room.id, targetId);
  });

  // Toggle waiting room (host only)
  socket.on('toggle-waiting-room', () => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;
    const settings = updateRoomSettings(room.id, { waitingRoomEnabled: !room.settings.waitingRoomEnabled });
    io.to(room.id).emit('room-settings-updated', settings);
  });

  // Admit a waiting joiner (host only): promotes them to a participant, puts
  // their socket in the room, and hands them the standard room-joined payload
  // so the client's normal admission path runs (store sync + LiveKit connect).
  socket.on('admit-waiting', ({ targetId } = {}, ack) => {
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
    removeWaiting(room.id, targetId);

    const target = io.sockets.sockets.get(targetId);
    if (target) {
      const participant = joinRoom(room.id, {
        socketId: targetId,
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
        .filter((p) => p.socketId !== targetId)
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
          socketId: targetId,
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

    io.to(room.id).emit('waiting-list-updated', { waitingList: getWaitingList(room.id) });
    ack?.({ success: true, socketId: targetId, displayName: waiting.displayName });
    console.log(`[✅] ${waiting.displayName} admitted to room ${room.id}`);
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
  socket.on('lock-room', ({ isLocked }, ack) => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;
    const result = livekitAdmin.setRoomLocked(room.id, Boolean(isLocked));
    if (result.ok) {
      io.to(room.id).emit('room-locked', { isLocked: result.settings.isLocked });
      ack?.({ success: true, roomId: room.id, isLocked: result.settings.isLocked });
    } else {
      ack?.({ success: false, error: result.error });
    }
  });

  // --- WebRTC signaling ---
  handleSignaling(io, socket);

  // --- Chat ---
  handleChat(io, socket);

  // --- Recording controls (host only) ---
  socket.on('start-recording', async () => {
    if (!socket.data.isHost) return;
    const result = await startRecordingSocket(socket.data.roomId);
    if (result.error) {
      socket.emit('error-message', { message: result.error });
    }
  });

  socket.on('stop-recording', async () => {
    if (!socket.data.isHost) return;
    const result = await stopRecordingSocket(socket.data.roomId);
    if (result.error) {
      socket.emit('error-message', { message: result.error });
    }
  });
});

// Start recording via socket - delegates to recording module and notifies room
async function startRecordingSocket(roomId) {
  const result = await recording.startRecording(roomId);
  if (!result.error) {
    io.to(roomId).emit('recording-started');
  }
  return result;
}

async function stopRecordingSocket(roomId) {
  const result = await recording.stopRecording(roomId);
  if (!result.error) {
    io.to(roomId).emit('recording-stopped');
  }
  return result;
}

// JSON 404 for unknown API routes + final error handler (never leak HTML/stack traces)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use((err, req, res, next) => {
  console.error('[Server error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Webinar Server running on http://localhost:${PORT}`);
  console.log(`   Signaling URL: ws://localhost:${PORT}\n`);
});
