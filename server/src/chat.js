// Chat handling - real-time messaging per room

/**
 * Handle chat events
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function handleChat(io, socket) {
  // Send a chat message to the room
  socket.on('chat-message', ({ message }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const { getRoom } = require('./rooms');
    const room = getRoom(roomId);
    if (!room) return;

    // Sanitize message
    const cleanMessage = String(message || '').trim().slice(0, 2000);
    if (!cleanMessage) return;

    const msg = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      sender: socket.data.displayName || 'Anonymous',
      senderId: socket.id,
      message: cleanMessage,
      timestamp: Date.now(),
      isHost: socket.data.isHost
    };

    // Store in room chat history (max 100)
    room.chatHistory.push(msg);
    if (room.chatHistory.length > 100) {
      room.chatHistory = room.chatHistory.slice(-100);
    }

    // Broadcast to everyone in the room including sender
    io.to(roomId).emit('chat-message', msg);
  });

  // Typing indicator
  socket.on('typing-indicator', ({ isTyping }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    socket.to(roomId).emit('user-typing', {
      senderId: socket.id,
      displayName: socket.data.displayName || 'Anonymous',
      isTyping
    });
  });

  // Get chat history (for rejoining)
  socket.on('get-chat-history', (callback) => {
    const { getRoom } = require('./rooms');
    const room = getRoom(socket.data.roomId);
    const history = room ? room.chatHistory : [];
    if (typeof callback === 'function') {
      callback(history);
    } else {
      socket.emit('chat-history', history);
    }
  });
}

/**
 * Get chat history for a room (REST endpoint)
 */
function getChatHistory(roomId) {
  const { getRoom } = require('./rooms');
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };
  return { messages: room.chatHistory };
}

module.exports = { handleChat, getChatHistory };
