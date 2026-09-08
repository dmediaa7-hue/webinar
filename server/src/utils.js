// Utility helper functions

/**
 * Generate a random room code (for display purposes)
 */
function generateRoomCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Format milliseconds into readable duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Check if a string is a valid room ID format
 */
function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^[a-zA-Z0-9-]{1,32}$/.test(roomId);
}

/**
 * Sanitize user input
 */
function sanitizeInput(str, maxLength = 100) {
  return String(str || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

module.exports = {
  generateRoomCode,
  formatDuration,
  isValidRoomId,
  sanitizeInput
};
