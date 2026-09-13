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
      const onConnect = () => {
        store.getState().setMySocketId(socket.id);
        // On an unexpected drop the server already broadcast participant-left for our old socket,
        // so rejoin to un-freeze the meeting for everyone else (skipped when left intentionally).
        const state = store.getState();
        if (state.roomId && !state.leftRoom) {
          socket.emit(EVENTS.JOIN_ROOM, {
            roomId: state.roomId,
            displayName: state.displayName || localStorage.getItem('webinar-name') || 'Guest',
            password: state.roomPassword,
            isAdmin: false
          }, (response) => {
            if (!response?.success) {
              console.warn('[Socket] Auto-rejoin failed:', response?.error);
            }
          });
        }
      };
      socket.on('connect', onConnect);
      if (socket.connected) {
        store.getState().setMySocketId(socket.id);
      }

      // Room events
      const onRoomJoined = ({ roomId, roomName, participants, isHost, settings }) => {
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
      };
      socket.on(EVENTS.ROOM_JOINED, onRoomJoined);

      const onParticipantJoined = ({ participant }) => {
        console.log('[Socket] Participant joined:', participant.displayName);
        store.getState().addParticipant({ ...participant, stream: null });
      };
      socket.on(EVENTS.PARTICIPANT_JOINED, onParticipantJoined);

      const onParticipantLeft = ({ socketId, newHost }) => {
        console.log('[Socket] Participant left:', socketId);
        store.getState().removeParticipant(socketId);
        store.getState().removeTypingUser(socketId);
        // If the host left, the successor (first remaining participant) takes over
        if (newHost) {
          console.log('[Socket] New host:', newHost);
          store.getState().updateParticipant(newHost, { isHost: true });
          store.getState().setIsHost(newHost === socket.id);
        }
      };
      socket.on(EVENTS.PARTICIPANT_LEFT, onParticipantLeft);

      // Chat events
      const onUserTyping = ({ senderId, isTyping }) => {
        if (isTyping) {
          store.getState().addTypingUser(senderId);
        } else {
          store.getState().removeTypingUser(senderId);
        }
      };
      socket.on(EVENTS.USER_TYPING, onUserTyping);

      // Host control events
      const onKicked = ({ byHost }) => {
        console.log('[Socket] Kicked by', byHost);
        handleKicked();
      };
      socket.on(EVENTS.KICKED, onKicked);

      const onForceMute = () => {
        store.getState().setIsMuted(true);
        // During a screen share localStream is swapped to the display stream
        // (audio:false), so the mic track lives on localCameraStream. Disable
        // whichever stream actually carries the audio track.
        const state = store.getState();
        const audioSource = (state.localStream && state.localStream.getAudioTracks().length)
          ? state.localStream
          : state.localCameraStream;
        if (audioSource) {
          audioSource.getAudioTracks().forEach(track => {
            track.enabled = false;
          });
        }
      };
      socket.on(EVENTS.FORCE_MUTE, onForceMute);

      const onRoomLocked = ({ isLocked }) => {
        store.getState().setRoomSettings({ ...store.getState().roomSettings, isLocked });
      };
      socket.on(EVENTS.ROOM_LOCKED, onRoomLocked);

      const onRoomSettingsUpdated = (settings) => {
        store.getState().setRoomSettings(settings);
      };
      socket.on(EVENTS.ROOM_SETTINGS_UPDATED, onRoomSettingsUpdated);

      const onError = ({ message }) => {
        console.error('[Socket] Error:', message);
        useStore.getState().showToast(message || 'An error occurred');
      };
      socket.on(EVENTS.ERROR, onError);

      const onRecordingStarted = () => {
        store.getState().setIsRecording(true);
      };
      socket.on(EVENTS.RECORDING_STARTED, onRecordingStarted);

      const onRecordingStopped = () => {
        store.getState().setIsRecording(false);
      };
      socket.on(EVENTS.RECORDING_STOPPED, onRecordingStopped);

      const onAttendanceUpdated = ({ attendance }) => {
        store.getState().setAttendance(attendance);
      };
      socket.on('attendance-updated', onAttendanceUpdated);

      const onBreakoutUpdated = (breakoutState) => {
        store.getState().setBreakoutState(breakoutState);
      };
      socket.on(EVENTS.BREAKOUT_UPDATED, onBreakoutUpdated);

      // Waiting room (task 14)
      const onWaitingRoom = ({ roomId: waitingRoomId }) => {
        store.getState().setWaitingForRoom(true);
        store.getState().setWaitingRoomId(waitingRoomId);
      };
      socket.on(EVENTS.WAITING_ROOM, onWaitingRoom);

      const onWaitingDenied = () => {
        handleDenied();
      };
      socket.on(EVENTS.WAITING_DENIED, onWaitingDenied);

      const onWaitingListUpdated = ({ waitingList }) => {
        store.getState().setWaitingList(waitingList || []);
      };
      socket.on(EVENTS.WAITING_LIST_UPDATED, onWaitingListUpdated);

      const onDisconnect = () => {
        console.log('[Socket] Disconnected from server');
      };
      socket.on('disconnect', onDisconnect);

      // Return the registered [event, handler] pairs so cleanup can remove
      // exactly these - never bare-`off` (that would scrap other components'
      // listeners on this shared module-level socket).
      return [
        ['connect', onConnect],
        [EVENTS.ROOM_JOINED, onRoomJoined],
        [EVENTS.PARTICIPANT_JOINED, onParticipantJoined],
        [EVENTS.PARTICIPANT_LEFT, onParticipantLeft],
        [EVENTS.USER_TYPING, onUserTyping],
        [EVENTS.KICKED, onKicked],
        [EVENTS.FORCE_MUTE, onForceMute],
        [EVENTS.ROOM_LOCKED, onRoomLocked],
        [EVENTS.ROOM_SETTINGS_UPDATED, onRoomSettingsUpdated],
        [EVENTS.ERROR, onError],
        [EVENTS.RECORDING_STARTED, onRecordingStarted],
        [EVENTS.RECORDING_STOPPED, onRecordingStopped],
        ['attendance-updated', onAttendanceUpdated],
        [EVENTS.BREAKOUT_UPDATED, onBreakoutUpdated],
        [EVENTS.WAITING_ROOM, onWaitingRoom],
        [EVENTS.WAITING_DENIED, onWaitingDenied],
        [EVENTS.WAITING_LIST_UPDATED, onWaitingListUpdated],
        ['disconnect', onDisconnect]
      ];
    };

    const registeredHandlerPairs = setupListeners();

    return () => {
      registeredHandlerPairs.forEach(([event, handler]) => socket.off(event, handler));
    };
  }, []);

  return socket;
}

// Handle being kicked - navigate away
const handleKicked = () => {
  const state = useStore.getState();
  stopAllLocalTracks(state);
  state.resetAll();
  state.setIsConnecting(false);
  window.location.href = '/?kicked=true';
};

// Handle being denied from the waiting room - back to the lobby with a banner
const handleDenied = () => {
  const state = useStore.getState();
  stopAllLocalTracks(state);
  state.resetAll();
  state.setIsConnecting(false);
  window.location.href = '/?denied=true';
};

// Stop every locally captured track (camera/mic + screen-share) so devices
// release immediately instead of waiting for the redirect's page unload.
function stopAllLocalTracks(state) {
  const streams = [state.localStream, state.screenShareStream];
  streams.forEach((stream) => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  });
}

export function joinRoom(roomId, displayName, password = null) {
  return new Promise((resolve, reject) => {
    socket.emit(EVENTS.JOIN_ROOM, { roomId, displayName, password, isAdmin: false }, (response) => {
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
