const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const { createRoom, joinRoom, leaveRoom, getRoom, getRooms, updateParticipant, roomHasPassword, verifyPassword, getAttendance } = require('./rooms');
const { handleSignaling } = require('./signaling');
const { handleChat, getChatHistory } = require('./chat');
const recording = require('./recording');

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
app.post('/api/rooms/:roomId/recording/start', (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = recording.startRecording(req.params.roomId);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.post('/api/rooms/:roomId/recording/stop', (req, res) => {
  const room = requireRoomHost(req, res, req.params.roomId);
  if (!room) return;
  const result = recording.stopRecording(req.params.roomId);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.get('/api/rooms/:roomId/recording/status', (req, res) => {
  const result = recording.getRecordingStatus(req.params.roomId);
  if (result.error) return res.status(404).json(result);
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
  socket.on('toggle-waiting-room', () => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;
    room.settings.waitingRoomEnabled = !room.settings.waitingRoomEnabled;
    io.to(room.id).emit('room-settings-updated', room.settings);
  });

  // Lock room (host only)
  socket.on('lock-room', ({ isLocked }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;
    room.settings.isLocked = isLocked;
    io.to(room.id).emit('room-locked', { isLocked });
  });

  // --- WebRTC signaling ---
  handleSignaling(io, socket);

  // --- Chat ---
  handleChat(io, socket);

  // --- Recording controls (host only) ---
  socket.on('start-recording', () => {
    if (!socket.data.isHost) return;
    startRecordingSocket(socket.data.roomId);
  });

  socket.on('stop-recording', () => {
    if (!socket.data.isHost) return;
    stopRecordingSocket(socket.data.roomId);
  });
});

// Start recording via socket - delegates to recording module and notifies room
function startRecordingSocket(roomId) {
  const result = recording.startRecording(roomId);
  if (!result.error) {
    io.to(roomId).emit('recording-started');
  }
  return result;
}

function stopRecordingSocket(roomId) {
  const result = recording.stopRecording(roomId);
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
