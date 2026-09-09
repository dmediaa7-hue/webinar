import { create } from 'zustand';
import {
  capReactions,
  filterActiveReactions,
  pushRecentReaction,
  REACTION_TTL_MS
} from '../utils/reactionCodec';

const useStore = create((set, get) => ({
  // Room state
  roomId: null,
  roomName: null,
  isHost: false,
  roomSettings: { isLocked: false, waitingRoomEnabled: false },
  roomPassword: null,
  leftRoom: false,

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
  activePanel: 'none', // 'none' | 'chat' | 'participants' | 'captions' | 'breakouts'
  isScreenSharing: false,
  screenShareStream: null,

  // Recording
  isRecording: false,

  // Breakout state: { roomId, mainRoom, breakouts: [{name, livekitRoom, identities}], assignments: [{identity, breakoutName, livekitRoom}] } | null
  breakoutState: null,

  // Ephemeral reactions: Map<identity, [{id, type, emoji, sender, senderId, ts}]>
  // (burst overlay per participant, auto-pruned after REACTION_TTL_MS)
  reactions: new Map(),
  // Recent reactions history for the picker: [{emoji, sender, ts}], newest first
  recentReactions: [],

  // Virtual background choice: { mode: 'none'|'blur'|'image', imagePath: string|null }
  backgroundChoice: null,

  // Actions
  setRoom: (roomId) => set({ roomId }),
  setRoomName: (roomName) => set({ roomName }),
  setIsHost: (isHost) => set({ isHost }),
  setRoomSettings: (roomSettings) => set({ roomSettings }),
  setRoomPassword: (roomPassword) => set({ roomPassword }),
  setLeftRoom: (leftRoom) => set({ leftRoom }),
  setDisplayName: (displayName) => set({ displayName }),
  setMySocketId: (mySocketId) => set({ mySocketId }),
  setLocalStream: (localStream) => set({ localStream }),
  setIsMuted: (isMuted) => set({ isMuted }),
  setIsVideoOff: (isVideoOff) => set({ isVideoOff }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setBackgroundChoice: (backgroundChoice) => set({ backgroundChoice }),
  setBreakoutState: (breakoutState) => set({ breakoutState }),

  addReaction: (reaction) => {
    const { reactions, recentReactions } = get();
    const existing = filterActiveReactions(reactions.get(reaction.senderId), Date.now());
    if (existing.some((r) => r.id === reaction.id)) return;

    const next = new Map(reactions);
    next.set(reaction.senderId, capReactions([...existing, reaction]));
    set({
      reactions: next,
      recentReactions: pushRecentReaction(recentReactions, reaction.emoji, reaction.sender)
    });

    setTimeout(() => {
      const current = filterActiveReactions(get().reactions.get(reaction.senderId), Date.now());
      if (!current.length) return;
      const pruned = new Map(get().reactions);
      pruned.set(reaction.senderId, current);
      set({ reactions: pruned });
    }, REACTION_TTL_MS);
  },

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
    leftRoom: false,
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
    isRecording: false,
    backgroundChoice: null,
    breakoutState: null,
    reactions: new Map(),
    recentReactions: []
  })
}));

export default useStore;
