import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Room, RoomEvent, Track } from 'livekit-client';
import { RoomContext, useParticipants } from '@livekit/components-react';
import useStore from '../../store/useStore';
import { useSocket, joinRoom, leaveRoom, roomRequiresPassword, sendTyping, toggleAudio, toggleVideo, screenShareStarted, screenShareStopped, muteParticipant, kickParticipant, lockRoom, startRecording, stopRecording, getAttendance } from '../../hooks/useSocket';
import { useLiveKitRoom } from '../../hooks/useLiveKitRoom';
import { toggleScreenShare } from '../../utils/liveKitShare';
import { createBackgroundProcessor } from '../../utils/virtualBackgrounds';
import { useLiveKitSync } from '../../hooks/useLiveKitSync';
import { downloadAttendanceCSV, downloadAttendancePDF } from '../../utils/attendanceExport';
import VideoGrid from './VideoGrid';
import MeetingControls from './MeetingControls';
import ChatPanel from '../Chat/ChatPanel';
import ParticipantList from '../Participants/ParticipantList';
import CaptionsOverlay from '../Captions/CaptionsOverlay';
import CaptionsPanel from '../Captions/CaptionsPanel';
import BreakoutPanel from '../Breakout/BreakoutPanel';
import { breakoutRoomLabel } from '../../utils/breakout';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Video, Users, Link, Copy, Check, Shield, Maximize2, Minimize2, AlertTriangle } from 'lucide-react';

function ParticipantCount() {
  const participants = useParticipants();
  return <span>{participants.length}</span>;
}

export default function MeetingRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useSocket();
  const store = useStore;

  // Room state
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
  const [breakoutLabel, setBreakoutLabel] = useState(null);

  // LiveKit media layer (token fetch + connect/disconnect)
  const { room: liveKitRoom, isConfigured, connect: connectLiveKit, disconnect: disconnectLiveKit } = useLiveKitRoom();
  useLiveKitSync(liveKitRoom);

  // MediaStream holding the local screen-share track (before publishing picks it up)
  const screenStreamRef = useRef(null);

  // Selectors
  const displayName = store((state) => state.displayName) || localStorage.getItem('webinar-name') || 'Guest';
  const roomName = store((state) => state.roomName);
  const participants = store((state) => state.participants);
  const isHost = store((state) => state.isHost);
  const activePanel = store((state) => state.activePanel);
  const isRecording = store((state) => state.isRecording);
  const storePassword = store((state) => state.roomPassword);
  const isAdmin = store((state) => state.isLoggedIn && state.username === 'Admin');
  const isRoomLocked = store((state) => state.roomSettings?.isLocked);
  const mySocketId = store((state) => state.mySocketId);

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

  useEffect(() => {
    if (!localStorage.getItem('webinar-name')) {
      setNeedsName(true);
      setIsJoining(false);
      setIsCheckingRoom(false);
    } else {
      startJoinFlow();
    }

    return () => {
      leaveRoom();
      disconnectLiveKit();
      store.getState().resetAll();
      exitFullscreen().catch(() => {});
    };
  }, [roomId, disconnectLiveKit]);

  // After the socket join succeeds the store has roomId + isHost; connect to
  // the LiveKit room so media flows through the SFU.
  const liveKitConnectAttemptedRef = useRef(false);
  useEffect(() => {
    const state = store.getState();
    if (liveKitConnectAttemptedRef.current) return;
    if (state.roomId !== roomId) return;
    if (isConfigured === false) {
      setTechNotice('LiveKit is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to server/.env to enable audio and video.');
      return;
    }
    if (!socket?.id) return;
    liveKitConnectAttemptedRef.current = true;
    const name = state.displayName || localStorage.getItem('webinar-name') || 'Guest';
    const bg = state.backgroundChoice;
    const videoProcessor = bg ? createBackgroundProcessor(bg.mode, bg.imagePath) : null;
    connectLiveKit({
      roomName: roomId,
      identity: socket.id,
      name,
      roomAdmin: state.isHost,
      audio: true,
      video: true,
      videoProcessor
    }).catch((err) => {
      if (err?.code === 'LIVEKIT_NOT_CONFIGURED') {
        setTechNotice('LiveKit is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to server/.env to enable audio and video.');
      } else {
        setTechNotice(err?.message || 'Unable to connect to the media server.');
      }
    });
  }, [roomId, isConfigured, socket, connectLiveKit]);

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (!passwordInput.trim()) {
      setPasswordError('Please enter the meeting password');
      return;
    }
    setShowPasswordPrompt(false);
    attemptJoin(passwordInput.trim());
  };

  // Reflect local participant state (mute/camera/screen) from LiveKit events
  // and rebuild the local MediaStream when tracks are (un)published.
  useEffect(() => {
    const room = liveKitRoom;
    if (!room) return;
    const local = room.localParticipant;

    const refreshLocalStream = () => {
      const camPub = local.getTrackPublication(Track.Source.Camera);
      const micPub = local.getTrackPublication(Track.Source.Microphone);
      const ms = new MediaStream();
      if (camPub?.track?.mediaStreamTrack) ms.addTrack(camPub.track.mediaStreamTrack);
      if (micPub?.track?.mediaStreamTrack) ms.addTrack(micPub.track.mediaStreamTrack);
      store.getState().setLocalStream(ms);
    };

    const onTrackMuted = (publication, participant) => {
      if (participant.identity !== local.identity) return;
      if (publication.source === Track.Source.Microphone) setIsMuted(true);
      if (publication.source === Track.Source.Camera) setIsVideoOff(true);
    };

    const onTrackUnmuted = (publication, participant) => {
      if (participant.identity !== local.identity) return;
      if (publication.source === Track.Source.Microphone) setIsMuted(false);
      if (publication.source === Track.Source.Camera) setIsVideoOff(false);
    };

    const onLocalTrackPublished = (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        if (publication.track?.mediaStreamTrack) {
          screenStreamRef.current = new MediaStream([publication.track.mediaStreamTrack]);
          setIsScreenSharing(true);
        }
        screenShareStarted();
      } else {
        refreshLocalStream();
      }
    };

    const onLocalTrackUnpublished = (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach((t) => t.stop());
          screenStreamRef.current = null;
        }
        setIsScreenSharing(false);
        screenShareStopped();
      } else {
        refreshLocalStream();
      }
    };

    setIsMuted(!local.isMicrophoneEnabled);
    setIsVideoOff(!local.isCameraEnabled);
    refreshLocalStream();

    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);

    return () => {
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    };
  }, [liveKitRoom]);

  const handleToggleMute = useCallback(() => {
    const room = liveKitRoom;
    if (!room) return;
    const nextMuted = !room.localParticipant.isMicrophoneEnabled;
    room.localParticipant.setMicrophoneEnabled(!nextMuted);
    toggleAudio(nextMuted);
  }, [liveKitRoom]);

  const handleToggleVideo = useCallback(() => {
    const room = liveKitRoom;
    if (!room) return;
    const nextOff = !room.localParticipant.isCameraEnabled;
    const bg = store.getState().backgroundChoice;
    const processor = bg ? createBackgroundProcessor(bg.mode, bg.imagePath) : null;
    // Re-apply the virtual background whenever the camera track is rebuilt.
    room.localParticipant.setCameraEnabled(!nextOff, !nextOff && processor ? { processor } : undefined);
    toggleVideo(nextOff);
  }, [liveKitRoom]);

  const handleFlipCamera = useCallback(async () => {
    const room = liveKitRoom;
    if (!room) return;
    try {
      const devices = await Room.getLocalDevices('videoinput');
      if (devices.length < 2) return;
      const current = room.localParticipant
        .getTrackPublication(Track.Source.Camera)
        ?.track?.mediaStreamTrack;
      const currentId = current?.getSettings?.().deviceId;
      const index = devices.findIndex((d) => d.deviceId === currentId);
      const next = devices[(index + 1) % devices.length];
      await room.switchActiveDevice('camera', next.deviceId);
    } catch (e) {
      console.warn('[LiveKit] Camera switch failed:', e);
    }
  }, [liveKitRoom]);

  const handleScreenShare = useCallback(async () => {
    if (!liveKitRoom) return;
    try {
      await toggleScreenShare(liveKitRoom, isScreenSharing);
    } catch (e) {
      // User cancelled the share picker or capture is unavailable
    }
  }, [liveKitRoom, isScreenSharing]);

  const handleLeave = useCallback(() => {
    store.getState().setLeftRoom(true);
    leaveRoom();
    disconnectLiveKit();
    store.getState().resetAll();
    exitFullscreen().catch(() => {});
    navigate('/');
  }, [disconnectLiveKit, navigate]);

  const handleToggleRecording = useCallback(() => {
    if (!isHost) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isHost, isRecording]);

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

  // The host can move me into a breakout via moveParticipant; LiveKit fires
  // RoomEvent.Moved with the new room name, so surface which room I'm in.
  useEffect(() => {
    const room = liveKitRoom;
    if (!room) return;
    const syncBreakoutLabel = () => setBreakoutLabel(breakoutRoomLabel(room.name, roomId));
    room.on(RoomEvent.Moved, syncBreakoutLabel);
    syncBreakoutLabel();
    return () => {
      room.off(RoomEvent.Moved, syncBreakoutLabel);
    };
  }, [liveKitRoom, roomId]);

  // Loading state
  if (isCheckingRoom || isJoining) {
    return (
      <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-300">{isCheckingRoom ? 'Checking meeting...' : 'Connecting to meeting...'}</p>
      </div>
    );
  }

  // Name prompt - guests joining via shared link
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

  // Password prompt
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

  // Error state
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

  return (
    <RoomContext.Provider value={liveKitRoom}>
      <div className="app-screen flex flex-col bg-meeting-bg overflow-hidden">
      {/* Top bar */}
      <div className="px-4 py-2 flex items-center justify-between bg-meeting-surface border-b border-meeting-border h-12">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">Webinar</span>
          {roomName && <span className="text-sm text-gray-300">{roomName}</span>}
          <span className="text-xs text-gray-400 bg-meeting-card px-2 py-1 rounded font-mono">
            {roomId?.toUpperCase()}
          </span>
          {breakoutLabel && (
            <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded font-medium">
              Breakout {breakoutLabel}
            </span>
          )}
          <button
            onClick={() => handleCopyLink(getInviteLink())}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title="Copy invite link"
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

        <div className="flex items-center gap-3">
          <button
            onClick={toggleFullscreen}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-meeting-card hover:bg-white/10 text-xs text-gray-300 transition-colors"
          >
            <Link size={13} />
            Invite
          </button>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Users size={14} />
            {liveKitRoom ? <ParticipantCount /> : <span>0</span>}
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
                <AlertTriangle size={32} className="text-yellow-500 mx-auto mb-4" />
                <h2 className="text-lg font-semibold mb-2">Media unavailable</h2>
                <p className="text-sm text-gray-400">{techNotice}</p>
              </div>
            </div>
          ) : liveKitRoom ? (
            <VideoGrid />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-gray-400">Connecting to media server…</p>
            </div>
          )}

          {activePanel === 'captions' && liveKitRoom && (
            <CaptionsOverlay room={liveKitRoom} />
          )}
        </div>

        {activePanel !== 'none' && (
          <div className="w-80 animate-slide-in-right">
            {activePanel === 'chat' && (
              <ChatPanel
                onClose={() => togglePanel('chat')}
                onTyping={handleTyping}
                currentUserName={displayName}
              />
            )}
            {activePanel === 'participants' && liveKitRoom && (
              <ParticipantList
                onClose={() => togglePanel('participants')}
                isHost={isHost}
                isAdmin={isAdmin}
                onMuteParticipant={handleMuteParticipant}
                onKickParticipant={handleKickParticipant}
                onDownloadAttendance={handleDownloadAttendance}
              />
            )}
            {activePanel === 'captions' && liveKitRoom && (
              <CaptionsPanel
                room={liveKitRoom}
                onClose={() => togglePanel('captions')}
              />
            )}
            {activePanel === 'breakouts' && (
              <BreakoutPanel
                onClose={() => togglePanel('breakouts')}
                roomId={roomId}
                hostId={mySocketId}
                isHost={isHost}
                liveKitRoom={liveKitRoom}
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
        isRecordingAvailable={isConfigured === true}
        isRoomLocked={isRoomLocked}
        isHost={isHost}
        activePanel={activePanel}
        mediaConnected={Boolean(liveKitRoom)}
        onToggleAudio={handleToggleMute}
        onToggleVideo={handleToggleVideo}
        onFlipCamera={handleFlipCamera}
        onToggleScreenShare={handleScreenShare}
        onToggleRecording={handleToggleRecording}
        onToggleLock={handleToggleLock}
        onToggleChat={() => togglePanel('chat')}
        onToggleParticipants={() => togglePanel('participants')}
        onToggleCaptions={() => togglePanel('captions')}
        onToggleBreakouts={() => togglePanel('breakouts')}
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
    </RoomContext.Provider>
  );
}