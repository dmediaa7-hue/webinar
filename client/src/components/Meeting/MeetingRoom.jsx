import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import { useSocket, joinRoom, leaveRoom, roomRequiresPassword, sendChatMessage, sendTyping, toggleAudio, toggleVideo, screenShareStarted, screenShareStopped, muteParticipant, kickParticipant, startRecording, stopRecording, getAttendance } from '../../hooks/useSocket';
import { useMedia } from '../../hooks/useMedia';
import { useWebRTC } from '../../hooks/useWebRTC';
import { formatTime, EVENTS } from '../../utils/constants';
import VideoGrid from './VideoGrid';
import MeetingControls from './MeetingControls';
import ChatPanel from '../Chat/ChatPanel';
import ParticipantList from '../Participants/ParticipantList';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Video, Users, Link, Copy, Check, Shield, Maximize2, Minimize2 } from 'lucide-react';

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
  const screenStreamRef = useRef(null);
  // Snapshot of the camera stream so screen sharing can be reverted to it
  const cameraStreamRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Media hook
  const { stream: localStream, startMedia, stopStream, toggleMute, toggleVideo: toggleCam, flipCamera, isMuted, isVideoOff } = useMedia();

  // WebRTC
  const webRTC = useWebRTC(socket);
  const { replaceLocalStream } = webRTC;

  // Selectors
  const displayName = store((state) => state.displayName) || localStorage.getItem('webinar-name') || 'Guest';
  const roomName = store((state) => state.roomName);
  const participants = store((state) => state.participants);
  const isHost = store((state) => state.isHost);
  const activePanel = store((state) => state.activePanel);
  const isRecording = store((state) => state.isRecording);
  const storePassword = store((state) => state.roomPassword);
  const attendance = store((state) => state.attendance);
  const isAdmin = store((state) => state.isLoggedIn && state.username === 'Admin');

  const getInviteLink = () => `${window.location.origin}/meeting/${roomId}`;

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
      const stream = await startMedia();
      if (!stream) {
        setJoinError('Unable to access camera/microphone');
        setIsJoining(false);
        return;
      }
      const name = store.getState().displayName || localStorage.getItem('webinar-name') || 'Guest';
      store.getState().setLocalStream(stream);
      store.getState().setDisplayName(name);
      cameraStreamRef.current = stream;

      const result = await joinRoom(roomId, name, password);
      if (!result?.success) {
        setJoinError(result?.error || 'Failed to join room');
        setIsJoining(false);
        return;
      }
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

  // Run the room check + join after the participant's name is known
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

  // Guests joining via shared link have no saved name -> prompt for it first
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
      store.getState().resetAll();
      if (socket) webRTC.cleanupAllPeers();
      exitFullscreen().catch(() => {});
    };
  }, [roomId]);

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (!passwordInput.trim()) {
      setPasswordError('Please enter the meeting password');
      return;
    }
    setShowPasswordPrompt(false);
    attemptJoin(passwordInput.trim());
  };

  // Draw local video
  const localVideoRef = useRef(null);
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const handleToggleMute = useCallback(() => {
    toggleMute();
    toggleAudio(!isMuted);
  }, [isMuted, toggleMute]);

  const handleToggleVideo = useCallback(() => {
    toggleCam();
    toggleVideo(!isVideoOff);
  }, [isVideoOff, toggleCam]);

  const handleFlipCamera = useCallback(async () => {
    if (!localStream) return;
    const result = await flipCamera();
    if (!result) return;
    const { oldTrack, newTrack } = result;
    store.getState().peers.forEach((peer) => {
      if (peer && !peer.destroyed && typeof peer.replaceTrack === 'function') {
        try {
          peer.replaceTrack(oldTrack, newTrack, localStream);
        } catch (e) {
          console.warn('[WebRTC] replaceTrack failed for peer', e);
        }
      }
    });
  }, [localStream, flipCamera]);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    store.getState().setIsScreenSharing(false);
    store.getState().setScreenShareStream(null);
    if (cameraStreamRef.current) {
      replaceLocalStream(cameraStreamRef.current);
    }
    screenShareStopped();
  }, [replaceLocalStream]);

  const handleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
        screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);
        store.getState().setIsScreenSharing(true);
        store.getState().setScreenShareStream(screenStream);
        replaceLocalStream(screenStream);
        screenShareStarted();
      } catch (err) {
        // User cancelled screen share
      }
    }
  }, [isScreenSharing, stopScreenShare]);

  const handleLeave = useCallback(() => {
    leaveRoom();
    if (localStream) stopStream(localStream);
    store.getState().resetAll();
    exitFullscreen().catch(() => {});
    navigate('/');
  }, [localStream, stopStream, navigate]);

  const handleToggleRecording = useCallback(() => {
    if (!isHost) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isHost, isRecording]);

  const handleDownloadAttendance = useCallback(async () => {
    const res = await getAttendance();
    if (!res?.success) {
      console.warn('[Meeting] Attendance download not allowed:', res?.error);
      return;
    }
    const rows = [
      ['Name', 'Role', 'Joined', 'Left'],
      ...res.attendance.map(a => [
        a.displayName,
        a.isHost ? 'Host' : 'Participant',
        formatTime(a.joinedAt),
        a.leftAt ? formatTime(a.leftAt) : 'Still present'
      ])
    ];
    const csv = rows
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${roomId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [roomId]);

  const togglePanel = (panel) => {
    store.getState().setActivePanel(activePanel === panel ? 'none' : panel);
  };

  const handleSendMessage = (message) => sendChatMessage(message);
  const handleTyping = (isTyping) => sendTyping(isTyping);
  const handleMuteParticipant = (socketId) => muteParticipant(socketId);
  const handleKickParticipant = (socketId) => kickParticipant(socketId);

  const localJoinedAt = attendance.find(a => a.displayName === displayName && !a.leftAt)?.joinedAt || null;

  const localParticipant = {
    socketId: 'local',
    displayName: 'You',
    isHost,
    isMuted,
    isVideoOff,
    isScreenSharing,
    joinedAt: localJoinedAt,
    stream: localStream
  };

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

  const allParticipants = [
    localParticipant,
    ...Array.from(participants.values()).filter(p => p.socketId !== 'local')
  ];

  const participantCount = allParticipants.length;

  return (
    <div className="app-screen flex flex-col bg-meeting-bg overflow-hidden">
      {/* Top bar */}
      <div className="px-4 py-2 flex items-center justify-between bg-meeting-surface border-b border-meeting-border h-12">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">Webinar</span>
          {roomName && <span className="text-sm text-gray-300">{roomName}</span>}
          <span className="text-xs text-gray-400 bg-meeting-card px-2 py-1 rounded font-mono">
            {roomId?.toUpperCase()}
          </span>
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
            {participantCount}
          </span>
          <span className="w-2 h-2 bg-green-500 rounded-full" />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden relative">
          <VideoGrid
            participants={allParticipants}
            localVideoRef={localVideoRef}
            isScreenSharing={isScreenSharing}
            screenStream={screenStreamRef.current}
          />
        </div>

        {activePanel !== 'none' && (
          <div className="w-80 animate-slide-in-right">
            {activePanel === 'chat' && (
              <ChatPanel
                onClose={() => togglePanel('chat')}
                onSendMessage={handleSendMessage}
                onTyping={handleTyping}
                currentUserName={displayName}
              />
            )}
            {activePanel === 'participants' && (
              <ParticipantList
                onClose={() => togglePanel('participants')}
                participants={allParticipants}
                isHost={isHost}
                isAdmin={isAdmin}
                currentSocketId="local"
                onMuteParticipant={handleMuteParticipant}
                onKickParticipant={handleKickParticipant}
                onDownloadAttendance={handleDownloadAttendance}
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
        activePanel={activePanel}
        onToggleAudio={handleToggleMute}
        onToggleVideo={handleToggleVideo}
        onFlipCamera={handleFlipCamera}
        onToggleScreenShare={handleScreenShare}
        onToggleRecording={handleToggleRecording}
        onToggleChat={() => togglePanel('chat')}
        onToggleParticipants={() => togglePanel('participants')}
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
