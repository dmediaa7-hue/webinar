import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { SERVER_URL, EVENTS } from '../utils/constants';
import useStore from '../store/useStore';

const socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket']
});

export function useSocket() {
  const store = useStore;

  useEffect(() => {
    // Auto-connect when component mounts
    if (!socket.connected) {
      socket.connect();
    }

    // Set up all event listeners
    const setupListeners = () => {
      socket.on('connect', () => {
        store.getState().setMySocketId(socket.id);
        // On an unexpected drop the server already broadcast participant-left for our old socket,
        // so rejoin to un-freeze the meeting for everyone else (skipped when left intentionally).
        const state = store.getState();
        if (state.roomId && !state.leftRoom) {
          socket.emit(EVENTS.JOIN_ROOM, {
            roomId: state.roomId,
            displayName: state.displayName || localStorage.getItem('webinar-name') || 'Guest',
            password: state.roomPassword,
            isAdmin: state.isLoggedIn && state.username === 'Admin'
          }, (response) => {
            if (!response?.success) {
              console.warn('[Socket] Auto-rejoin failed:', response?.error);
            }
          });
        }
      });
      if (socket.connected) {
        store.getState().setMySocketId(socket.id);
      }

      // Room events
      socket.on(EVENTS.ROOM_JOINED, ({ roomId, roomName, participants, isHost, settings }) => {
        store.getState().setRoom(roomId);
        if (roomName) store.getState().setRoomName(roomName);
        store.getState().setIsHost(isHost);
        store.getState().setRoomSettings(settings || {});
        // An admit promoted us from the waiting room: clear the waiting flags.
        store.getState().setWaitingForRoom(false);
        store.getState().setWaitingRoomId(null);
        // room membership resets the intentional-leave flag so later auto-rejoins work
        store.getState().setLeftRoom(false);

        participants.forEach(p => {
          store.getState().addParticipant({ ...p, stream: null });
        });

        store.getState().setIsConnecting(false);
        console.log('[Socket] Joined room:', roomId);
      });

      socket.on(EVENTS.PARTICIPANT_JOINED, ({ participant }) => {
        console.log('[Socket] Participant joined:', participant.displayName);
        store.getState().addParticipant({ ...participant, stream: null });
      });

      socket.on(EVENTS.PARTICIPANT_LEFT, ({ socketId, newHost }) => {
        console.log('[Socket] Participant left:', socketId);
        store.getState().removeParticipant(socketId);
        store.getState().removePeer(socketId);
        store.getState().removeTypingUser(socketId);
        // If the host left, the successor (first remaining participant) takes over
        if (newHost) {
          console.log('[Socket] New host:', newHost);
          store.getState().updateParticipant(newHost, { isHost: true });
          store.getState().setIsHost(newHost === socket.id);
        }
      });

      // Media toggle events
      socket.on(EVENTS.PARTICIPANT_AUDIO_TOGGLED, ({ socketId, isMuted }) => {
        store.getState().updateParticipant(socketId, { isMuted });
        // Pause/resume audio tracks
        const p = store.getState().participants.get(socketId);
        if (p?.stream) {
          p.stream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
          });
        }
      });

      socket.on(EVENTS.PARTICIPANT_VIDEO_TOGGLED, ({ socketId, isVideoOff }) => {
        store.getState().updateParticipant(socketId, { isVideoOff });
      });

      // Screen share events
      socket.on(EVENTS.SCREEN_SHARE_STARTED, ({ socketId, displayName }) => {
        store.getState().updateParticipant(socketId, { isScreenSharing: true });
      });

      socket.on(EVENTS.SCREEN_SHARE_STOPPED, ({ socketId }) => {
        store.getState().updateParticipant(socketId, { isScreenSharing: false });
      });

      // Chat events
      socket.on(EVENTS.USER_TYPING, ({ senderId, isTyping }) => {
        if (isTyping) {
          store.getState().addTypingUser(senderId);
        } else {
          store.getState().removeTypingUser(senderId);
        }
      });

      // Host control events
      socket.on(EVENTS.KICKED, ({ byHost }) => {
        console.log('[Socket] Kicked by', byHost);
        handleKicked();
      });

      socket.on(EVENTS.FORCE_MUTE, () => {
        store.getState().setIsMuted(true);
        // Actually mute local stream
        const localStream = store.getState().localStream;
        if (localStream) {
          localStream.getAudioTracks().forEach(track => {
            track.enabled = false;
          });
        }
      });

      socket.on(EVENTS.ROOM_LOCKED, ({ isLocked }) => {
        store.getState().setRoomSettings({ ...store.getState().roomSettings, isLocked });
      });

      socket.on(EVENTS.ROOM_SETTINGS_UPDATED, (settings) => {
        store.getState().setRoomSettings(settings);
      });

      socket.on(EVENTS.ERROR, ({ message }) => {
        console.error('[Socket] Error:', message);
        alert(message);
      });

      socket.on(EVENTS.RECORDING_STARTED, () => {
        store.getState().setIsRecording(true);
      });

      socket.on(EVENTS.RECORDING_STOPPED, () => {
        store.getState().setIsRecording(false);
      });

      socket.on('attendance-updated', ({ attendance }) => {
        store.getState().setAttendance(attendance);
      });

      socket.on(EVENTS.BREAKOUT_UPDATED, (breakoutState) => {
        store.getState().setBreakoutState(breakoutState);
      });

      // Waiting room (task 14)
      socket.on(EVENTS.WAITING_ROOM, ({ roomId: waitingRoomId }) => {
        store.getState().setWaitingForRoom(true);
        store.getState().setWaitingRoomId(waitingRoomId);
      });

      socket.on(EVENTS.WAITING_DENIED, () => {
        handleDenied();
      });

      socket.on(EVENTS.WAITING_LIST_UPDATED, ({ waitingList }) => {
        store.getState().setWaitingList(waitingList || []);
      });

      socket.on('disconnect', () => {
        console.log('[Socket] Disconnected from server');
      });
    };

    setupListeners();

    return () => {
      // Cleanup listeners
      socket.off('connect');
      socket.off(EVENTS.ROOM_JOINED);
      socket.off(EVENTS.PARTICIPANT_JOINED);
      socket.off(EVENTS.PARTICIPANT_LEFT);
      socket.off(EVENTS.PARTICIPANT_AUDIO_TOGGLED);
      socket.off(EVENTS.PARTICIPANT_VIDEO_TOGGLED);
      socket.off(EVENTS.SCREEN_SHARE_STARTED);
      socket.off(EVENTS.SCREEN_SHARE_STOPPED);
      socket.off(EVENTS.USER_TYPING);
      socket.off(EVENTS.KICKED);
      socket.off(EVENTS.FORCE_MUTE);
      socket.off(EVENTS.ROOM_LOCKED);
      socket.off(EVENTS.ROOM_SETTINGS_UPDATED);
      socket.off(EVENTS.ERROR);
      socket.off(EVENTS.RECORDING_STARTED);
      socket.off(EVENTS.RECORDING_STOPPED);
      socket.off('attendance-updated');
      socket.off(EVENTS.BREAKOUT_UPDATED);
      socket.off(EVENTS.WAITING_ROOM);
      socket.off(EVENTS.WAITING_DENIED);
      socket.off(EVENTS.WAITING_LIST_UPDATED);
    };
  }, []);

  return socket;
}

// Handle being kicked - navigate away
const handleKicked = () => {
  useStore.getState().resetAll();
  useStore.getState().setIsConnecting(false);
  window.location.href = '/?kicked=true';
};

// Handle being denied from the waiting room - back to the lobby with a banner
const handleDenied = () => {
  useStore.getState().resetAll();
  useStore.getState().setIsConnecting(false);
  window.location.href = '/?denied=true';
};

// Helper methods for actions
export function createRoom(displayName, password = null, roomName = null) {
  const { isLoggedIn, username } = useStore.getState();
  return new Promise((resolve, reject) => {
    socket.emit(EVENTS.CREATE_ROOM, { displayName, password, roomName, isAdmin: isLoggedIn && username === 'Admin' }, (response) => {
      if (response?.success) {
        resolve({ roomId: response.roomId, roomName: response.roomName, hasPassword: Boolean(response.hasPassword) });
      } else {
        reject(response?.error || 'Failed to create room');
      }
    });
  });
}

export function joinRoom(roomId, displayName, password = null) {
  const { isLoggedIn, username } = useStore.getState();
  return new Promise((resolve, reject) => {
    socket.emit(EVENTS.JOIN_ROOM, { roomId, displayName, password, isAdmin: isLoggedIn && username === 'Admin' }, (response) => {
      if (response?.success) {
        resolve(response);
      } else {
        const err = new Error(response?.error || 'Failed to join room');
        err.code = response?.code;
        reject(err);
      }
    });
  });
}

export async function roomRequiresPassword(roomId) {
  const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}`);
  if (!res.ok) {
    let err = new Error('Room not found');
    err.code = 'ROOM_NOT_FOUND';
    try {
      const body = await res.json();
      if (body && (body.code === 'MEETING_ENDED' || body.code === 'MEETING_NOT_STARTED')) {
        err = new Error(body.error || err.message);
        err.code = body.code;
        err.meeting = body.meeting || null;
      }
    } catch { /* non-JSON body: keep ROOM_NOT_FOUND */ }
    throw err;
  }
  const data = await res.json();
  return Boolean(data.hasPassword);
}

export function leaveRoom() {
  socket.emit(EVENTS.LEAVE_ROOM);
}

export function sendTyping(isTyping) {
  socket.emit(EVENTS.TYPING_INDICATOR, { isTyping });
}

export function toggleAudio(isMuted) {
  socket.emit(EVENTS.TOGGLE_AUDIO, { isMuted });
}

export function toggleVideo(isVideoOff) {
  socket.emit(EVENTS.TOGGLE_VIDEO, { isVideoOff });
}

export function screenShareStarted() {
  socket.emit(EVENTS.SCREEN_SHARE_STARTED);
}

export function screenShareStopped() {
  socket.emit(EVENTS.SCREEN_SHARE_STOPPED);
}

export function muteParticipant(targetId) {
  socket.emit(EVENTS.MUTE_PARTICIPANT, { targetId });
}

export function kickParticipant(targetId) {
  socket.emit(EVENTS.KICK_PARTICIPANT, { targetId });
}

export function lockRoom(isLocked) {
  socket.emit(EVENTS.LOCK_ROOM, { isLocked });
}

export function toggleWaitingRoom() {
  socket.emit(EVENTS.TOGGLE_WAITING_ROOM);
}

export function admitWaitingUser(targetId) {
  socket.emit(EVENTS.ADMIT_WAITING, { targetId });
}

export function denyWaitingUser(targetId) {
  socket.emit(EVENTS.DENY_WAITING, { targetId });
}

export function startRecording() {
  socket.emit(EVENTS.RECORDING_START);
}

export function stopRecording() {
  socket.emit(EVENTS.RECORDING_STOP);
}

export function getAttendance() {
  return new Promise((resolve) => {
    socket.emit('get-attendance', (response) => resolve(response));
  });
}

export default socket;
