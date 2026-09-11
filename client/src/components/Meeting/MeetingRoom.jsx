import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import { useSocket, joinRoom, leaveRoom, roomRequiresPassword, sendTyping, muteParticipant, kickParticipant, lockRoom, getAttendance } from '../../hooks/useSocket';
import { useWebRTC } from '../../hooks/useWebRTC';
import { useMedia } from '../../hooks/useMedia';
import { MEDIA_CONSTRAINTS, EVENTS } from '../../utils/constants';
import { downloadAttendanceCSV, downloadAttendancePDF } from '../../utils/attendanceExport';
import VideoGrid from './VideoGrid';
import MeetingControls from './MeetingControls';
import ChatPanel from '../Chat/ChatPanel';
import ParticipantList from '../Participants/ParticipantList';
import BreakoutPanel from '../Breakout/BreakoutPanel';
import PollPanel from '../Engagement/PollPanel';
import QnAPanel from '../Engagement/QnAPanel';
import WhiteboardPanel from '../Whiteboard/WhiteboardPanel';
import WaitingRoomScreen from './WaitingRoomScreen';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Video, Users, Link, Copy, Check, Shield, Maximize2, Minimize2 } from 'lucide-react';

function ParticipantCount() {
  const count = useStore((s) => s.participants.size);
  return <span>{count}</span>;
}

export default function MeetingRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useSocket();
  const store = useStore;

  const [isJoining, setIsJoining] = useState(true);
  const [joinError, setJoinError] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isCheckingRoom, setIsCheckingRoom] = useState(true);
  const [copied, setCopied] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [techNotice, setTechNotice] = useState('');

  const {
    createPeer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    cleanupPeer,
    cleanupAllPeers,
    replaceLocalStream,
    replaceLocalTrack
  } = useWebRTC(socket);

  const media = useMedia();
  const mediaStartedRef = useRef(false);

  const displayName = store((state) => state.displayName) || localStorage.getItem('webinar-name') || 'Guest';
  const roomName = store((state) => state.roomName);
  const participants = store((state) => state.participants);
  const isHost = store((state) => state.isHost);
  const activePanel = store((state) => state.activePanel);
  const isRecording = store((state) => state.isRecording);
  const storePassword = store((state) => state.roomPassword);
  const isRoomLocked = store((state) => state.roomSettings?.isLocked);
  const mySocketId = store((state) => state.mySocketId);
  const waitingForRoom = store((state) => state.waitingForRoom);
  const waitingRoomId = store((state) => state.waitingRoomId);
  const localStream = store((state) => state.localStream);
  const joinedRoomId = store((state) => state.roomId);
  const mediaConnected = Boolean(localStream);
  const cameraStreamRef = useRef(null);

  const getInviteLink = () => `${window.location.origin}/join?room=${roomId}`;

  const handleCopyLink = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const requestFullscreen = () => {
    const el = document.documentElement;
    if (el.requestFullscreen) return el.requestFullscreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    return Promise.reject(new Error('Fullscreen not supported'));
  };

  const exitFullscreen = () => {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    return Promise.resolve();
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      exitFullscreen().catch(() => {});
    } else {
      requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const attemptJoin = async (password = null) => {
    setIsJoining(true);
    setJoinError('');
    setPasswordError('');
    try {
      const name = store.getState().displayName || localStorage.getItem('webinar-name') || 'Guest';
      store.getState().setDisplayName(name);

      const result = await joinRoom(roomId, name, password);
      if (result?.waiting) {
        store.getState().setWaitingForRoom(true);
        store.getState().setWaitingRoomId(roomId);
        setIsJoining(false);
        return;
      }
      if (!result?.success) {
        setJoinError(result?.error || 'Failed to join room');
        setIsJoining(false);
        return;
      }
      if (password) store.getState().setRoomPassword(password);
      setIsJoining(false);
      if (
        window.matchMedia('(pointer: coarse)').matches &&
        typeof document.documentElement.requestFullscreen === 'function' &&
        !document.fullscreenElement
      ) {
        requestFullscreen().catch(() => {});
      }
    } catch (err) {
      if (err.code === 'WRONG_PASSWORD') {
        setPasswordError(err.message);
        setShowPasswordPrompt(true);
        setIsJoining(false);
        return;
      }
      console.error('Failed to join:', err);
      setJoinError('Failed to connect. Is the server running?');
      setIsJoining(false);
    }
  };

  const startJoinFlow = useCallback(async () => {
    setIsCheckingRoom(true);
    try {
      const hasPassword = await roomRequiresPassword(roomId);
      setIsCheckingRoom(false);

      if (hasPassword && storePassword) {
        attemptJoin(storePassword);
      } else if (hasPassword) {
        setShowPasswordPrompt(true);
        setIsJoining(false);
      } else {
        attemptJoin();
      }
    } catch (err) {
      setIsCheckingRoom(false);
      if (err.code === 'ROOM_NOT_FOUND') {
        setJoinError('Room not found. Check the meeting ID and try again.');
        setIsJoining(false);
      } else if (err.code === 'MEETING_ENDED' || err.code === 'MEETING_NOT_STARTED') {
        setJoinError(err.message || 'This meeting is not available.');
        setIsJoining(false);
      } else {
        attemptJoin();
      }
    }
  }, [roomId, storePassword]);

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    localStorage.setItem('webinar-name', nameInput.trim());
    store.getState().setDisplayName(nameInput.trim());
    setNeedsName(false);
    startJoinFlow();
  };

  const startJoinFlowRef = useRef(startJoinFlow);
  startJoinFlowRef.current = startJoinFlow;

  useEffect(() => {
    if (!localStorage.getItem('webinar-name')) {
      setNeedsName(true);
      setIsJoining(false);
      setIsCheckingRoom(false);
    } else {
      startJoinFlowRef.current();
    }

    return () => {
      leaveRoom();
      cleanupAllPeers();
      media.stopStream();
      store.getState().resetAll();
      exitFullscreen().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    if (!joinedRoomId || joinedRoomId !== roomId) return;
    if (waitingForRoom) return;
    if (mediaStartedRef.current) return;
    mediaStartedRef.current = true;

    media.startMedia(MEDIA_CONSTRAINTS).then((stream) => {
      if (stream) {
        cameraStreamRef.current = stream;
        store.getState().setLocalStream(stream);
        store.getState().setLocalFacingMode(media.facingMode);
      } else {
        setTechNotice('Unable to access camera/microphone. Check your browser permissions and try again.');
      }
    });
  }, [joinedRoomId, roomId, waitingForRoom]);

  // createPeer bails without local media, so re-initiate to existing room
  // participants once media lands (idempotent; covers the pre-media window).
  useEffect(() => {
    if (!localStream) return;
    if (!joinedRoomId || joinedRoomId !== roomId) return;
    if (waitingForRoom) return;
    store.getState().participants.forEach((p, socketId) => {
      if (socketId !== socket.id) {
        createPeer(socketId, true);
      }
    });
  }, [localStream, joinedRoomId, roomId, waitingForRoom]);

  // Wire signaling listeners
  useEffect(() => {
    if (!socket) return;

    socket.on(EVENTS.OFFER, ({ from, fromName, sdp }) => handleOffer(from, fromName, sdp));
    socket.on(EVENTS.ANSWER, ({ from, sdp }) => handleAnswer(from, sdp));
    socket.on(EVENTS.ICE_CANDIDATE, ({ from, candidate }) => handleIceCandidate(from, candidate));

    const onParticipantLeft = ({ socketId }) => {
      cleanupPeer(socketId);
    };

    socket.on(EVENTS.PARTICIPANT_LEFT, onParticipantLeft);

    socket.on(EVENTS.PARTICIPANT_JOINED, ({ participant }) => {
      if (participant.socketId !== socket.id) {
        createPeer(participant.socketId, false);
      }
    });

    socket.on(EVENTS.ROOM_JOINED, ({ participants: roomParticipants }) => {
      store.getState().participants.forEach((p, socketId) => {
        if (socketId !== socket.id) {
          createPeer(socketId, true);
        }
      });
    });

    socket.on(EVENTS.PARTICIPANT_AUDIO_TOGGLED, ({ socketId, isMuted: muted }) => {
      store.getState().updateParticipant(socketId, { isMuted: muted });
    });

    socket.on(EVENTS.PARTICIPANT_VIDEO_TOGGLED, ({ socketId, isVideoOff: videoOff }) => {
      store.getState().updateParticipant(socketId, { isVideoOff: videoOff });
    });

    socket.on(EVENTS.SCREEN_SHARE_STARTED, ({ socketId }) => {
      store.getState().updateParticipant(socketId, { isScreenSharing: true });
    });

    socket.on(EVENTS.SCREEN_SHARE_STOPPED, ({ socketId }) => {
      store.getState().updateParticipant(socketId, { isScreenSharing: false });
    });

    socket.on('force-stop-screen-share', () => handleStopScreenShare());

    return () => {
      socket.off(EVENTS.OFFER);
      socket.off(EVENTS.ANSWER);
      socket.off(EVENTS.ICE_CANDIDATE);
      socket.off(EVENTS.PARTICIPANT_LEFT, onParticipantLeft);
      socket.off(EVENTS.PARTICIPANT_JOINED);
      socket.off(EVENTS.ROOM_JOINED);
      socket.off(EVENTS.PARTICIPANT_AUDIO_TOGGLED);
      socket.off(EVENTS.PARTICIPANT_VIDEO_TOGGLED);
      socket.off(EVENTS.SCREEN_SHARE_STARTED);
      socket.off(EVENTS.SCREEN_SHARE_STOPPED);
      socket.off('force-stop-screen-share');
      cleanupAllPeers();
      media.stopStream();
    };
  }, [socket]);

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (!passwordInput.trim()) {
      setPasswordError('Please enter the meeting password');
      return;
    }
    setShowPasswordPrompt(false);
    attemptJoin(passwordInput.trim());
  };

  const handleToggleMute = useCallback(() => {
    media.toggleMute();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    store.getState().setIsMuted(nextMuted);
    socket.emit(EVENTS.TOGGLE_AUDIO, { isMuted: nextMuted });
  }, [isMuted, socket]);

  const handleToggleVideo = useCallback(() => {
    media.toggleVideo();
    const nextOff = !isVideoOff;
    setIsVideoOff(nextOff);
    store.getState().setIsVideoOff(nextOff);
    socket.emit(EVENTS.TOGGLE_VIDEO, { isVideoOff: nextOff });
  }, [isVideoOff, socket]);

  const handleFlipCamera = useCallback(async () => {
    const result = await media.flipCamera();
    if (result) {
      replaceLocalTrack(result.oldTrack, result.newTrack, store.getState().localStream);
      store.getState().setLocalFacingMode(media.facingMode);
    }
  }, [media, replaceLocalTrack]);

  const handleStopScreenShare = useCallback(() => {
    const storeState = store.getState();
    const camStream = cameraStreamRef.current;
    if (camStream) {
      replaceLocalStream(camStream);
    }
    if (storeState.screenShareStream) {
      storeState.screenShareStream.getTracks().forEach((t) => t.stop());
    }
    setIsScreenSharing(false);
    store.getState().setIsScreenSharing(false);
    store.getState().setScreenShareStream(null);
    socket.emit(EVENTS.SCREEN_SHARE_STOPPED);
  }, [socket]);

  const handleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      handleStopScreenShare();
      return;
    }
    const screenStream = await media.startScreenShare();
    if (!screenStream) return;

    replaceLocalStream(screenStream);
    socket.emit(EVENTS.SCREEN_SHARE_STARTED);
    setIsScreenSharing(true);
    store.getState().setIsScreenSharing(true);
    store.getState().setScreenShareStream(screenStream);

    const videoTrack = screenStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', handleStopScreenShare);
    }
  }, [isScreenSharing, socket, replaceLocalStream, handleStopScreenShare]);

  const handleLeave = useCallback(() => {
    store.getState().setLeftRoom(true);
    leaveRoom();
    cleanupAllPeers();
    media.stopStream();
    store.getState().resetAll();
    exitFullscreen().catch(() => {});
    navigate('/');
  }, [navigate]);

  const handleDownloadAttendance = useCallback(async (format) => {
    const res = await getAttendance();
    if (!res?.success) {
      console.warn('[Meeting] Attendance download not allowed:', res?.error);
      return;
    }
    const hostName = [...participants.values()].find((p) => p.isHost)?.displayName || displayName;
    const payload = { attendance: res.attendance, roomName, roomId, hostName };
    if (format === 'pdf') {
      downloadAttendancePDF(payload);
    } else {
      downloadAttendanceCSV(payload);
    }
  }, [participants, displayName, roomName, roomId]);

  const togglePanel = (panel) => {
    store.getState().setActivePanel(activePanel === panel ? 'none' : panel);
  };

  const handleTyping = (isTyping) => sendTyping(isTyping);
  const handleMuteParticipant = (socketId) => muteParticipant(socketId);
  const handleKickParticipant = (socketId) => kickParticipant(socketId);
  const handleToggleLock = () => lockRoom(!isRoomLocked);

  if (isCheckingRoom || isJoining) {
    return (
      <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-300">{isCheckingRoom ? 'Checking meeting...' : 'Connecting to meeting...'}</p>
      </div>
    );
  }

  if (needsName) {
    return (
      <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Video size={28} className="text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Join Meeting</h1>
            <p className="text-gray-400 text-sm">You've been invited to a meeting. Enter your name to join.</p>
          </div>

          <form onSubmit={handleNameSubmit} className="space-y-4">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              autoFocus
              maxLength={30}
              className="w-full px-4 py-3 bg-meeting-surface border border-meeting-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="w-full py-3 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join Meeting
            </button>
          </form>

          {joinError && <p className="text-red-400 text-sm text-center">{joinError}</p>}

          <button
            onClick={() => navigate('/')}
            className="w-full py-2 text-sm text-gray-400 hover:text-white transition-colors text-center"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (showPasswordPrompt) {
    return (
      <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-yellow-900/40 border border-yellow-700/50 flex items-center justify-center mx-auto mb-4">
              <Shield size={28} className="text-yellow-400" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Password Required</h1>
            <p className="text-gray-400 text-sm">This meeting is password protected. Enter the password shared by the host.</p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="relative">
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(''); }}
                placeholder="Enter meeting password"
                autoFocus
                className="w-full px-4 py-3 bg-meeting-surface border border-meeting-border rounded-lg text-white text-center tracking-[0.2em] text-lg font-mono placeholder-gray-500 placeholder:tracking-normal placeholder:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {passwordError && (
              <p className="text-red-400 text-sm text-center">{passwordError}</p>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors"
            >
              Join Meeting
            </button>
          </form>

          <button
            onClick={() => navigate('/')}
            className="w-full py-2 text-sm text-gray-400 hover:text-white transition-colors text-center"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (joinError) {
    return (
      <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center p-4">
        <div className="text-6xl mb-6">😕</div>
        <h1 className="text-2xl font-bold mb-4">Cannot Join Meeting</h1>
        <p className="text-red-400 mb-8">{joinError}</p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
        >
          Back to Home
        </button>
      </div>
    );
  }

  if (waitingForRoom) {
    return (
      <WaitingRoomScreen
        roomId={waitingRoomId || roomId}
        displayName={displayName}
        onLeave={handleLeave}
      />
    );
  }

  return (
    <div className="app-screen flex flex-col bg-meeting-bg overflow-hidden">
      {/* Top bar */}
      <div className="px-2 sm:px-4 py-2 flex items-center justify-between bg-meeting-surface border-b border-meeting-border h-12 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="font-semibold text-sm hidden xs:inline">Webinar</span>
          {roomName && <span className="text-sm text-gray-300 truncate max-w-[40vw] hidden md:inline">{roomName}</span>}
          <span className="text-xs text-gray-400 bg-meeting-card px-2 py-1 rounded font-mono hidden sm:inline">
            {roomId?.toUpperCase()}
          </span>
          <button
            onClick={() => handleCopyLink(getInviteLink())}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="Copy invite link"
            aria-label="Copy invite link"
          >
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
          {isRecording && (
            <span className="text-xs text-red-400 flex items-center gap-1 recording-pulse">
              <span className="w-2 h-2 bg-red-500 rounded-full inline-block" />
              REC
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={toggleFullscreen}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-meeting-card hover:bg-white/10 text-xs text-gray-300 transition-colors"
          >
            <Link size={13} />
            <span className="hidden xs:inline">Invite</span>
          </button>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Users size={14} />
            <ParticipantCount />
          </span>
          <span className="w-2 h-2 bg-green-500 rounded-full" />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden relative">
          {techNotice ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-md text-center bg-meeting-surface border border-meeting-border rounded-xl p-8">
                <h2 className="text-lg font-semibold mb-2">Media unavailable</h2>
                <p className="text-sm text-gray-400">{techNotice}</p>
              </div>
            </div>
          ) : mediaConnected ? (
            <VideoGrid />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-gray-400">Connecting to media…</p>
            </div>
          )}

          {activePanel === 'whiteboard' && mediaConnected && (
            <WhiteboardPanel
              onClose={() => togglePanel('whiteboard')}
              roomId={roomId}
            />
          )}
        </div>

        {activePanel !== 'none' && activePanel !== 'whiteboard' && (
          <div className="fixed inset-x-0 bottom-0 top-12 z-40 sm:static sm:inset-auto sm:top-auto sm:z-auto w-full sm:w-80 animate-slide-in-right shadow-2xl sm:shadow-none">
            {activePanel === 'chat' && (
              <ChatPanel
                onClose={() => togglePanel('chat')}
                onTyping={handleTyping}
                currentUserName={displayName}
              />
            )}
            {activePanel === 'participants' && mediaConnected && (
              <ParticipantList
                onClose={() => togglePanel('participants')}
                isHost={isHost}
                onMuteParticipant={handleMuteParticipant}
                onKickParticipant={handleKickParticipant}
                onDownloadAttendance={handleDownloadAttendance}
              />
            )}
            {activePanel === 'breakouts' && (
              <BreakoutPanel
                onClose={() => togglePanel('breakouts')}
                roomId={roomId}
                hostId={mySocketId}
                isHost={isHost}
              />
            )}
            {activePanel === 'polls' && mediaConnected && (
              <PollPanel
                onClose={() => togglePanel('polls')}
                roomId={roomId}
              />
            )}
            {activePanel === 'qa' && mediaConnected && (
              <QnAPanel
                onClose={() => togglePanel('qa')}
                roomId={roomId}
              />
            )}
          </div>
        )}
      </div>

      <MeetingControls
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        isScreenSharing={isScreenSharing}
        isRecording={isRecording}
        isRoomLocked={isRoomLocked}
        isHost={isHost}
        activePanel={activePanel}
        mediaConnected={mediaConnected}
        onToggleAudio={handleToggleMute}
        onToggleVideo={handleToggleVideo}
        onFlipCamera={handleFlipCamera}
        onToggleScreenShare={handleScreenShare}
        onToggleLock={handleToggleLock}
        onToggleChat={() => togglePanel('chat')}
        onToggleParticipants={() => togglePanel('participants')}
        onToggleBreakouts={() => togglePanel('breakouts')}
        onTogglePolls={() => togglePanel('polls')}
        onToggleQa={() => togglePanel('qa')}
        onToggleWhiteboard={() => togglePanel('whiteboard')}
        onLeave={handleLeave}
      />

      {/* Invite Link Modal */}
      {showInviteModal && (
        <Modal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} title="Invite Participants">
          <div className="space-y-4">
            <p className="text-sm text-gray-400">Share this link with participants to invite them to the meeting.</p>

            {roomName && (
              <div className="bg-meeting-bg rounded-lg p-3 border border-meeting-border">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Meeting Name</p>
                <p className="text-gray-200 text-sm">{roomName}</p>
              </div>
            )}

            <div className="bg-meeting-bg rounded-lg p-3 border border-meeting-border">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Invite Link</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-gray-200 truncate select-all">{getInviteLink()}</code>
                <button
                  onClick={() => handleCopyLink(getInviteLink())}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors shrink-0"
                  title="Copy link"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div className="bg-meeting-bg rounded-lg p-3 border border-meeting-border">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Meeting ID</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-gray-200 tracking-wider select-all font-mono">{roomId?.toUpperCase()}</code>
                <button
                  onClick={() => handleCopyLink(roomId?.toUpperCase() || '')}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors shrink-0"
                  title="Copy meeting ID"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            {storePassword && (
              <div className="bg-yellow-900/30 border border-yellow-700/40 rounded-lg p-3">
                <p className="text-[10px] text-yellow-500 uppercase tracking-wide mb-1">Meeting Password</p>
                <code className="text-lg tracking-[0.2em] font-mono text-yellow-200">{storePassword}</code>
                <p className="text-xs text-yellow-600/70 mt-1.5">Share this password separately with participants.</p>
              </div>
            )}

            <Button
              variant="primary"
              className="w-full"
              onClick={() => handleCopyLink(getInviteLink())}
            >
              {copied ? 'Link Copied!' : 'Copy Invite Link'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
