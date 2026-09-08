// ICE server configuration for NAT traversal
export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
    // For production, add TURN servers:
    // { urls: 'turn:your-turn.example.com:3478', username: 'user', credential: 'pass' }
  ]
};

// Socket.io server URL
// Dev: Vite dev server on :5173 -> absolute backend URL on localhost.
// Prod: use VITE_SERVER_URL from .env.production pointing at the deployed
// Node backend (e.g. https://webinar-api.onrender.com). InfinityFree is a
// static host and cannot run Node / mod_proxy, so the browser connects
// directly to the backend URL. CORS is wide open on the server.
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');

// Socket events
export const EVENTS = {
  // Room management
  CREATE_ROOM: 'create-room',
  JOIN_ROOM: 'join-room',
  LEAVE_ROOM: 'leave-room',
  ROOM_CREATED: 'room-created',
  ROOM_JOINED: 'room-joined',
  PARTICIPANT_JOINED: 'participant-joined',
  PARTICIPANT_LEFT: 'participant-left',

  // Signaling
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',

  // Media controls
  TOGGLE_AUDIO: 'toggle-audio',
  TOGGLE_VIDEO: 'toggle-video',
  PARTICIPANT_AUDIO_TOGGLED: 'participant-audio-toggled',
  PARTICIPANT_VIDEO_TOGGLED: 'participant-video-toggled',

  // Screen share
  SCREEN_SHARE_STARTED: 'screen-share-started',
  SCREEN_SHARE_STOPPED: 'screen-share-stopped',

  // Chat
  CHAT_MESSAGE: 'chat-message',
  TYPING_INDICATOR: 'typing-indicator',
  USER_TYPING: 'user-typing',

  // Host controls
  MUTE_PARTICIPANT: 'mute-participant',
  KICK_PARTICIPANT: 'kick-participant',
  TOGGLE_WAITING_ROOM: 'toggle-waiting-room',
  LOCK_ROOM: 'lock-room',

  // Events received
  KICKED: 'kicked',
  ROOM_LOCKED: 'room-locked',
  ROOM_SETTINGS_UPDATED: 'room-settings-updated',
  FORCE_MUTE: 'force-mute',
  ERROR: 'error-message',
  RECORDING_STARTED: 'recording-started',
  RECORDING_STOPPED: 'recording-stopped'
};

// Media constraints for camera/mic
export const MEDIA_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'user'
  }
};

export const SCREEN_SHARE_CONSTRAINTS = {
  video: {
    cursor: 'always',
    displaySurface: 'monitor'
  },
  audio: false
};

// Helper function to get initials from a name
export function getInitials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map(part => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Format timestamp for chat
export function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
