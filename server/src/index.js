const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const { createRoom, joinRoom, leaveRoom, getRoom, getRooms, updateParticipant, roomHasPassword, verifyPassword } = require('./rooms');
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

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: getRooms().size, timestamp: Date.now() });
});

// Create room
app.post('/api/rooms', (req, res) => {
  try {
    const { hostName = 'Host', password = null, roomName = null } = req.body || {};
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

// Recording endpoints
app.post('/api/rooms/:roomId/recording/start', (req, res) => {
  const result = recording.startRecording(req.params.roomId);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.post('/api/rooms/:roomId/recording/stop', (req, res) => {
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

  // --- Room management events ---

  // Create a new room via socket
  socket.on('create-room', ({ displayName = 'Host', password = null, roomName = null } = {}, callback) => {
    const roomId = uuidv4().slice(0, 8);
    const room = createRoom(roomId, displayName, socket.id, password, roomName);
    socket.data.roomId = roomId;
    socket.data.displayName = displayName;
    socket.data.isHost = true;
    socket.join(roomId);
    socket.emit('room-created', { roomId, roomName: room.name, hasPassword: Boolean(password) });
    if (typeof callback === 'function') callback({ success: true, roomId, roomName: room.name, hasPassword: Boolean(password) });
  });

  // Join an existing room
  socket.on('join-room', ({ roomId, displayName = 'Guest', password = null }, callback) => {
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

    if (roomHasPassword(room) && !verifyPassword(room, password)) {
      const message = 'Incorrect meeting password';
      socket.emit('error-message', { message });
      if (typeof callback === 'function') callback({ success: false, error: message, code: 'WRONG_PASSWORD' });
      return;
    }

    const isHost = (room.hostId === socket.id);
    const participant = joinRoom(roomId, {
      socketId: socket.id,
      userId: uuidv4(),
      displayName,
      isHost: isHost || room.participants.size === 0,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false
    });

    socket.data.roomId = roomId;
    socket.data.displayName = displayName;
    socket.data.isHost = participant.isHost;
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
        displayName,
        isHost: participant.isHost,
        isMuted: false,
        isVideoOff: false,
        isScreenSharing: false
      }
    });

    console.log(`[+] ${displayName} joined room ${roomId}`);
    if (typeof callback === 'function') callback({ success: true, isHost: participant.isHost });
  });

  // Leave room
  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
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

      // Notify everyone else in the room
      io.to(roomId).emit('participant-left', {
        socketId: socket.id,
        roomId,
        newHost: room.hostId
      });

      console.log(`[-] ${displayName || socket.id} left room ${roomId}`);

      // If room is empty, schedule cleanup
      if (room.participants.size === 0) {
        setTimeout(() => {
          const r = getRoom(roomId);
          if (r && r.participants.size === 0) {
            // Room cleanup handled by rooms.js
          }
        }, 300000); // 5 min
      }
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

server.listen(PORT, () => {
  console.log(`\n🚀 Webinar Server running on http://localhost:${PORT}`);
  console.log(`   Signaling URL: ws://localhost:${PORT}\n`);
});
