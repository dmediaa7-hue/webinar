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

  // Waiting room state (task 14): set while the host has not admitted us yet.
  waitingForRoom: false,
  waitingRoomId: null,
  waitingList: [], // [{ socketId, userId, displayName, joinedAt }]

  // Auth state
  isLoggedIn: !!localStorage.getItem('webinar-auth'),
  username: localStorage.getItem('webinar-username') || '',
  user: null, // { id, email, name } from the server session
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

  // Polls (task 15): [{ pollId, question, options, creator, creatorId, createdAt, isClosed, votes: Map<voterId, optionIndex> }]
  polls: [],
  // Q&A (task 15): [{ questionId, author, authorId, body, createdAt, upvotes, isAnswered, votes: Map<voterId, delta> }]
  qaQuestions: [],

  // UI
  activePanel: 'none', // 'none' | 'chat' | 'participants' | 'captions' | 'breakouts' | 'polls' | 'qa'
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
  setWaitingForRoom: (waitingForRoom) => set({ waitingForRoom }),
  setWaitingRoomId: (waitingRoomId) => set({ waitingRoomId }),
  setWaitingList: (waitingList) => set({ waitingList }),

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

  /* ---- Polls & Q&A (task 15) ---- */

  // Idempotent data-channel appliers: create dedupes by id; vote replaces the
  // voter's position in the per-voter Map; votes for unknown/closed polls are
  // dropped - the panel's REST restore (setPolls) reconciles state on mount.
  applyPollMessage: (msg) => {
    const { polls } = get();
    if (msg.action === 'create') {
      if (polls.some((p) => p.pollId === msg.pollId)) return;
      set({
        polls: [...polls, {
          pollId: msg.pollId,
          question: msg.question,
          options: msg.options,
          creator: msg.creator,
          creatorId: msg.creatorId,
          createdAt: msg.createdAt,
          isClosed: false,
          votes: new Map()
        }]
      });
      return;
    }
    if (msg.action === 'vote') {
      set({
        polls: polls.map((p) => {
          if (p.pollId !== msg.pollId || p.isClosed) return p;
          const votes = new Map(p.votes);
          votes.set(msg.voterId, msg.optionIndex);
          return { ...p, votes };
        })
      });
      return;
    }
    if (msg.action === 'close') {
      set({
        polls: polls.map((p) =>
          p.pollId === msg.pollId ? { ...p, isClosed: true } : p
        )
      });
    }
  },

  // Idempotent data-channel appliers: ask dedupes by id; vote replaces the
  // voter's delta, with the score recomputed as the SUM of deltas (mirrors
  // the server's counter, so refresh-and-revote stays consistent).
  applyQaMessage: (msg) => {
    const { qaQuestions } = get();
    if (msg.action === 'ask') {
      if (qaQuestions.some((q) => q.questionId === msg.questionId)) return;
      set({
        qaQuestions: [...qaQuestions, {
          questionId: msg.questionId,
          author: msg.author,
          authorId: msg.authorId,
          body: msg.body,
          createdAt: msg.createdAt,
          upvotes: 0,
          isAnswered: false,
          votes: new Map()
        }]
      });
      return;
    }
    if (msg.action === 'vote') {
      set({
        qaQuestions: qaQuestions.map((q) => {
          if (q.questionId !== msg.questionId) return q;
          const votes = new Map(q.votes);
          votes.set(msg.voterId, msg.delta);
          const upvotes = [...votes.values()].reduce((sum, d) => sum + d, 0);
          return { ...q, votes, upvotes };
        })
      });
      return;
    }
    if (msg.action === 'answered') {
      set({
        qaQuestions: qaQuestions.map((q) =>
          q.questionId === msg.questionId ? { ...q, isAnswered: msg.isAnswered } : q
        )
      });
    }
  },

  // REST restore: replace poll state with the server's durable records.
  setPolls: (serverPolls) => {
    set({
      polls: (serverPolls || []).map((p) => ({
        pollId: p.id,
        question: p.question,
        options: p.options,
        creator: 'Host',
        creatorId: p.hostIdentity,
        createdAt: p.createdAt,
        isClosed: false,
        votes: new Map((p.votes || []).map((v) => [v.voterIdentity, v.optionIndex]))
      }))
    });
  },

  // REST restore: replace Q&A state with the server's durable records
  // (per-voter deltas included so refresh keeps each voter's own position).
  setQaQuestions: (serverQuestions) => {
    set({
      qaQuestions: (serverQuestions || []).map((q) => ({
        questionId: q.id,
        author: q.author,
        authorId: q.authorId,
        body: q.body,
        createdAt: q.createdAt,
        upvotes: q.upvotes,
        isAnswered: q.isAnswered,
        votes: new Map((q.votes || []).map((v) => [v.voterIdentity, v.delta]))
      }))
    });
  },

  login: (user) => {
    const shownName = user?.name || user?.email || 'Guest';
    localStorage.setItem('webinar-auth', 'true');
    localStorage.setItem('webinar-username', shownName);
    set({ isLoggedIn: true, username: shownName, user: user || null });
  },

  logout: () => {
    localStorage.removeItem('webinar-auth');
    localStorage.removeItem('webinar-username');
    set({ isLoggedIn: false, username: '', user: null });
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
    waitingForRoom: false,
    waitingRoomId: null,
    waitingList: [],
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
    recentReactions: [],
    polls: [],
    qaQuestions: []
  })
}));

export default useStore;
