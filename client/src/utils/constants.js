// ICE server configuration for NAT traversal
//
// STUN only discovers public addresses — it cannot relay media. When at least
// one peer is behind a symmetric NAT / CGNAT (mobile data, corporate networks,
// some ISPs), a direct P2P path cannot be established and the connection fails
// with "Connection failed." unless a TURN relay server is configured.
//
// TURN credentials are fetched at runtime from the backend
// (GET /api/turn-credentials, Cloudflare Realtime) so they stay short-lived.
// This static list is only the fallback used when that fetch fails - keep it
// STUN-only; hardcoding shared TURN credentials here reintroduces the bug
// this file's history is here to avoid.
export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
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
  JOIN_ROOM: 'join-room',
  LEAVE_ROOM: 'leave-room',
  ROOM_JOINED: 'room-joined',
  PARTICIPANT_JOINED: 'participant-joined',
  PARTICIPANT_LEFT: 'participant-left',

  // Signaling (P2P WebRTC media)
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

  // Collaboration relay (chat/poll/qa/whiteboard/reactions ride this socket channel)
  COLLAB_RELAY: 'collab-relay',
  COLLAB_MESSAGE: 'collab-message',

  // Chat
  TYPING_INDICATOR: 'typing-indicator',
  USER_TYPING: 'user-typing',

  // Host controls
  MUTE_PARTICIPANT: 'mute-participant',
  KICK_PARTICIPANT: 'kick-participant',
  TOGGLE_WAITING_ROOM: 'toggle-waiting-room',
  ADMIT_WAITING: 'admit-waiting',
  DENY_WAITING: 'deny-waiting',
  LOCK_ROOM: 'lock-room',

  // Events received
  KICKED: 'kicked',
  ROOM_LOCKED: 'room-locked',
  ROOM_SETTINGS_UPDATED: 'room-settings-updated',
  FORCE_MUTE: 'force-mute',
  ERROR: 'error-message',
  RECORDING_STARTED: 'recording-started',
  RECORDING_STOPPED: 'recording-stopped',
  RECORDING_START: 'start-recording',
  RECORDING_STOP: 'stop-recording',
  WAITING_ROOM: 'waiting-room',
  WAITING_DENIED: 'waiting-denied',
  WAITING_LIST_UPDATED: 'waiting-list-updated',

  // Breakout rooms (received when the host changes the layout)
  BREAKOUT_UPDATED: 'breakout-updated',

  // Live RTMP streaming (host publishes the composited grid to an ingest URL)
  RTMP_START: 'start-rtmp',
  RTMP_CHUNK: 'rtmp-chunk',
  RTMP_STOP: 'stop-rtmp',
  RTMP_STARTED: 'rtmp-started',
  RTMP_STOPPED: 'rtmp-stopped',
  RTMP_ERROR: 'rtmp-error',

  // Collab channel carrying the host's broadcast-graphics config
  BROADCAST_OVERLAY_CHANNEL: 'broadcast-overlay'
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

// Date-only stamp, e.g. "09/09/2026" (for attendance sheets)
export function formatDateOnly(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// Date + time stamp, e.g. "09/09/2026, 02:05 PM" (for attendance records)
export function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
