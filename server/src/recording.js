// Recording simulation service
const { getRoom } = require('./rooms');

/**
 * Get recording status for a room
 */
function getRecordingStatus(roomId) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  return {
    isRecording: room.isRecording,
    startedAt: room.recordingStartTime,
    durationMs: room.isRecording ? (Date.now() - room.recordingStartTime) : 0
  };
}

/**
 * Start recording (simulated - would integrate with a real recording service)
 */
function startRecording(roomId) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  if (room.isRecording) {
    return { error: 'Already recording', isRecording: true };
  }

  room.isRecording = true;
  room.recordingStartTime = Date.now();

  return {
    isRecording: true,
    startedAt: room.recordingStartTime,
    message: 'Recording started (simulated)'
  };
}

/**
 * Stop recording
 */
function stopRecording(roomId) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  if (!room.isRecording) {
    return { error: 'Not recording', isRecording: false };
  }

  const duration = Date.now() - (room.recordingStartTime || Date.now());
  room.isRecording = false;
  room.recordingStartTime = null;

  return {
    isRecording: false,
    durationMs: duration,
    message: 'Recording stopped (simulated)',
    // In production, this would return the recording file URL
    recordingUrl: `/api/rooms/${roomId}/recording/${Date.now()}.webm`
  };
}

module.exports = {
  getRecordingStatus,
  startRecording,
  stopRecording
};
