import { create } from 'zustand';

const useStore = create((set, get) => ({
  // Room state
  roomId: null,
  roomName: null,
  isHost: false,
  roomSettings: { isLocked: false, waitingRoomEnabled: false },
  roomPassword: null,

  // Auth state
  isLoggedIn: !!localStorage.getItem('webinar-auth'),
  username: localStorage.getItem('webinar-username') || '',
  role: 'admin',

  // User state
  displayName: '',
  mySocketId: null,
  localStream: null,
  isMuted: false,
  isVideoOff: false,
  isConnecting: false,

  // Participants: Map of socketId -> { socketId, userId, displayName, isHost, isMuted, isVideoOff, isScreenSharing, stream }
  participants: new Map(),

  // Attendance log: [{ socketId, userId, displayName, isHost, joinedAt, leftAt }]
  attendance: [],

  // Peer connections: Map of socketId -> SimplePeer
  peers: new Map(),

  // Chat
  messages: [],
  isTyping: false,
  typingUsers: new Set(),

  // UI
  activePanel: 'none', // 'none' | 'chat' | 'participants'
  isScreenSharing: false,
  screenShareStream: null,

  // Recording
  isRecording: false,

  // Actions
  setRoom: (roomId) => set({ roomId }),
  setRoomName: (roomName) => set({ roomName }),
  setIsHost: (isHost) => set({ isHost }),
  setRoomSettings: (roomSettings) => set({ roomSettings }),
  setRoomPassword: (roomPassword) => set({ roomPassword }),
  setDisplayName: (displayName) => set({ displayName }),
  setMySocketId: (mySocketId) => set({ mySocketId }),
  setLocalStream: (localStream) => set({ localStream }),
  setIsMuted: (isMuted) => set({ isMuted }),
  setIsVideoOff: (isVideoOff) => set({ isVideoOff }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  setIsRecording: (isRecording) => set({ isRecording }),

  login: (username) => {
    localStorage.setItem('webinar-auth', 'true');
    localStorage.setItem('webinar-username', username);
    set({ isLoggedIn: true, username });
  },

  logout: () => {
    localStorage.removeItem('webinar-auth');
    localStorage.removeItem('webinar-username');
    set({ isLoggedIn: false, username: '' });
  },

  addParticipant: (participant) => {
    const participants = new Map(get().participants);
    participants.set(participant.socketId, participant);
    set({ participants });
  },

  removeParticipant: (socketId) => {
    const participants = new Map(get().participants);
    participants.delete(socketId);
    set({ participants });
  },

  updateParticipant: (socketId, updates) => {
    const participants = new Map(get().participants);
    const p = participants.get(socketId);
    if (p) {
      participants.set(socketId, { ...p, ...updates });
      set({ participants });
    }
  },

  setParticipantStream: (socketId, stream) => {
    const participants = new Map(get().participants);
    const p = participants.get(socketId);
    if (p) {
      participants.set(socketId, { ...p, stream });
      set({ participants });
    } else {
      // Add if not present (edge case)
      participants.set(socketId, {
        socketId,
        stream,
        displayName: 'Guest',
        isHost: false,
        isMuted: false,
        isVideoOff: false,
        isScreenSharing: false
      });
      set({ participants });
    }
  },

  clearParticipants: () => set({ participants: new Map() }),

  setAttendance: (attendance) => set({ attendance }),

  addPeer: (socketId, peer) => {
    const peers = new Map(get().peers);
    peers.set(socketId, peer);
    set({ peers });
  },

  removePeer: (socketId) => {
    const peers = new Map(get().peers);
    const peer = peers.get(socketId);
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch (e) {}
    }
    peers.delete(socketId);
    set({ peers });
  },

  clearPeers: () => {
    const peers = get().peers;
    peers.forEach(peer => {
      if (!peer.destroyed) {
        try { peer.destroy(); } catch (e) {}
      }
    });
    set({ peers: new Map() });
  },

  addMessage: (message) => {
    const messages = [...get().messages, message];
    // Keep last 200 messages
    set({ messages: messages.slice(-200) });
  },

  clearMessages: () => set({ messages: [] }),

  setActivePanel: (panel) => set({ activePanel: panel }),

  setIsTyping: (isTyping) => {
    set({ isTyping });
    if (!isTyping) set({ typingUsers: new Set() });
  },

  addTypingUser: (socketId) => {
    const typingUsers = new Set(get().typingUsers);
    typingUsers.add(socketId);
    set({ typingUsers });
  },

  removeTypingUser: (socketId) => {
    const typingUsers = new Set(get().typingUsers);
    typingUsers.delete(socketId);
    set({ typingUsers });
  },

  setIsScreenSharing: (isScreenSharing) => set({ isScreenSharing }),
  setScreenShareStream: (stream) => set({ screenShareStream: stream }),

  resetAll: () => set({
    roomId: null,
    roomName: null,
    isHost: false,
    roomSettings: { isLocked: false, waitingRoomEnabled: false },
    roomPassword: null,
    displayName: '',
    localStream: null,
    isMuted: false,
    isVideoOff: false,
    isConnecting: false,
    participants: new Map(),
    attendance: [],
    peers: new Map(),
    messages: [],
    isTyping: false,
    typingUsers: new Set(),
    activePanel: 'none',
    isScreenSharing: false,
    screenShareStream: null,
    isRecording: false
  })
}));

export default useStore;
