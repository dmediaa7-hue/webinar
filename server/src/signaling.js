// WebRTC signaling handler
const { getRoom, getParticipant, updateParticipant } = require('./rooms');

/**
 * Handle all WebRTC signaling events
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function handleSignaling(io, socket) {
  // Target socket must be in the SAME room as the sender - prevents cross-room
  // signaling injection and relay spam to arbitrary socket ids.
  function isSameRoom(targetId) {
    const room = getRoom(socket.data.roomId);
    if (!room) return false;
    const target = io.sockets.sockets.get(targetId);
    return Boolean(target && target.data.roomId === room.id);
  }

  // Relay SDP offer to target peer
  socket.on('offer', ({ targetId, sdp, type = 'video' }) => {
    if (!isSameRoom(targetId)) return;

    // Forward to the target socket
    io.to(targetId).emit('offer', {
      from: socket.id,
      fromName: socket.data.displayName,
      sdp,
      type
    });
  });

  // Relay SDP answer to target peer
  socket.on('answer', ({ targetId, sdp }) => {
    if (!isSameRoom(targetId)) return;

    io.to(targetId).emit('answer', {
      from: socket.id,
      sdp
    });
  });

  // Relay ICE candidate to target peer
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    if (!isSameRoom(targetId)) return;

    io.to(targetId).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Toggle audio state
  socket.on('toggle-audio', ({ isMuted }) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;

    updateParticipant(room.id, socket.id, { isMuted });

    // Notify others in the room
    socket.to(room.id).emit('participant-audio-toggled', {
      socketId: socket.id,
      displayName: socket.data.displayName,
      isMuted
    });
  });

  // Toggle video state
  socket.on('toggle-video', ({ isVideoOff }) => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;

    updateParticipant(room.id, socket.id, { isVideoOff });

    socket.to(room.id).emit('participant-video-toggled', {
      socketId: socket.id,
      displayName: socket.data.displayName,
      isVideoOff
    });
  });

  // Screen share started
  socket.on('screen-share-started', () => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;

    updateParticipant(room.id, socket.id, { isScreenSharing: true });

    socket.to(room.id).emit('screen-share-started', {
      socketId: socket.id,
      displayName: socket.data.displayName
    });
  });

  // Screen share stopped
  socket.on('screen-share-stopped', () => {
    const room = getRoom(socket.data.roomId);
    if (!room) return;

    updateParticipant(room.id, socket.id, { isScreenSharing: false });

    socket.to(room.id).emit('screen-share-stopped', {
      socketId: socket.id,
      displayName: socket.data.displayName
    });
  });

  // End screen share (host can force stop)
  socket.on('force-end-screen-share', ({ targetId }) => {
    const room = getRoom(socket.data.roomId);
    if (!room || !socket.data.isHost) return;

    updateParticipant(room.id, targetId, { isScreenSharing: false });
    io.to(targetId).emit('force-stop-screen-share');
  });
}

module.exports = { handleSignaling };
