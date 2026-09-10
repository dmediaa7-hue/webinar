import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  SwitchCamera,
  MonitorUp,
  MonitorDown,
  MessageSquare,
  Users,
  PhoneOff,
  CircleDot,
  Lock,
  Unlock,
  Grid2x2,
  BarChart3,
  HelpCircle,
  PenTool,
  FolderOpen
} from 'lucide-react';
import { SERVER_URL } from '../../utils/constants';
import useStore from '../../store/useStore';
import { startRecording, stopRecording } from '../../hooks/useSocket';
import ReactionPicker from './ReactionPicker';

export default function MeetingControls({
  isMuted,
  isVideoOff,
  isScreenSharing,
  isRecording,
  isRoomLocked,
  isHost,
  activePanel,
  mediaConnected,
  onToggleAudio,
  onToggleVideo,
  onFlipCamera,
  onToggleScreenShare,
  onToggleLock,
  onToggleChat,
  onToggleParticipants,
  onToggleBreakouts,
  onTogglePolls,
  onToggleQa,
  onToggleWhiteboard,
  onLeave
}) {
  const [recordingFolder, setRecordingFolder] = useState('');
  const [localRecording, setLocalRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioContextRef = useRef(null);

  const handleStartRecording = useCallback(() => {
    const store = useStore.getState();
    const roomId = store.roomId;
    const hostId = store.mySocketId;
    const folder = recordingFolder.trim();

    if (!folder) {
      setRecordingStatus('Enter a folder path first (hover the record button to set it)');
      setTimeout(() => setRecordingStatus(''), 5000);
      return;
    }

    const localStream = store.localStream;
    const screenStream = store.screenShareStream;
    const sourceStream = store.isScreenSharing && screenStream ? screenStream : localStream;
    if (!sourceStream) {
      setRecordingStatus('No camera/mic stream available to record');
      setTimeout(() => setRecordingStatus(''), 5000);
      return;
    }

    let audioDestination = null;
    let mixedStream = sourceStream;

    try {
      audioContextRef.current = new AudioContext();
      const destination = audioContextRef.current.createMediaStreamDestination();

      if (sourceStream) {
        const source = audioContextRef.current.createMediaStreamSource(sourceStream);
        source.connect(destination);
      }

      const participants = store.participants;
      participants.forEach((p) => {
        if (p.stream) {
          try {
            const source = audioContextRef.current.createMediaStreamSource(p.stream);
            source.connect(destination);
          } catch {}
        }
      });

      audioDestination = destination;
      const videoTracks = sourceStream.getVideoTracks();
      const audioTracks = destination.stream.getAudioTracks();
      mixedStream = new MediaStream([...videoTracks, ...audioTracks]);
    } catch (err) {
      console.error('[Recording] AudioContext mixing failed, using source stream audio:', err);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      mixedStream = sourceStream;
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    const recorder = new MediaRecorder(mixedStream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      const filename = `recording-${roomId}-${Date.now()}.webm`;
      chunksRef.current = [];

      setRecordingStatus('Uploading recording...');
      try {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Data = reader.result.split(',')[1];
          try {
            const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}/recording/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-host-id': hostId },
              credentials: 'include',
              body: JSON.stringify({ folder, filename, data: base64Data, hostId })
            });
            if (res.ok) {
              const data = await res.json();
              setRecordingStatus(`Saved to ${data.path || folder || filename}`);
            } else {
              setRecordingStatus('Upload failed');
            }
          } catch (err) {
            console.error('[Recording] Upload error:', err);
            setRecordingStatus('Upload failed');
          }
          setTimeout(() => setRecordingStatus(''), 5000);
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.error('[Recording] Save error:', err);
        setRecordingStatus('Failed to save recording');
      }
    };

    recorderRef.current = recorder;
    recorder.start(1000);
    setLocalRecording(true);
    store.setIsRecording(true);

    startRecording();
  }, [recordingFolder]);

  const handleStopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recorderRef.current = null;
    setLocalRecording(false);

    stopRecording();
  }, []);

  const handleToggleRecording = useCallback(() => {
    if (!isHost) return;
    if (isRecording || localRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [isHost, isRecording, localRecording, handleStartRecording, handleStopRecording]);

  useEffect(() => {
    const handleVisibility = () => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') return;
      if (document.hidden) {
        recorder.pause();
      } else {
        recorder.resume();
      }
    };
    const handlePageHide = () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state === 'recording') {
        recorder.pause();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  return (
    <div className="px-4 py-3 bg-meeting-surface border-t border-meeting-border">
      {/* Recording status */}
      {recordingStatus && (
        <div className="max-w-3xl mx-auto mb-2 text-xs text-gray-400 text-center truncate">{recordingStatus}</div>
      )}

      <div className="max-w-3xl mx-auto flex items-center justify-center gap-2">
        {/* Mic toggle */}
        <button
          onClick={onToggleAudio}
          className={`p-3 rounded-lg transition-all duration-200 ${
            isMuted
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-meeting-card hover:bg-white/10'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {/* Video toggle */}
        <button
          onClick={onToggleVideo}
          className={`p-3 rounded-lg transition-all duration-200 ${
            isVideoOff
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-meeting-card hover:bg-white/10'
          }`}
          title={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
        >
          {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
        </button>

        {/* Flip camera */}
        <button
          onClick={onFlipCamera}
          className="p-3 rounded-lg transition-all duration-200 bg-meeting-card hover:bg-white/10"
          title="Flip camera"
        >
          <SwitchCamera size={20} />
        </button>

        {/* Screen share */}
        <button
          onClick={onToggleScreenShare}
          className={`p-3 rounded-lg transition-all duration-200 ${
            isScreenSharing
              ? 'bg-primary hover:bg-primary-dark'
              : 'bg-meeting-card hover:bg-white/10'
          }`}
          title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
        >
          {isScreenSharing ? <MonitorDown size={20} /> : <MonitorUp size={20} />}
        </button>

        {/* Lock room (host only) */}
        {isHost && (
          <button
            onClick={onToggleLock}
            className={`p-3 rounded-lg transition-all duration-200 ${
              isRoomLocked
                ? 'bg-primary hover:bg-primary-dark'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title={isRoomLocked ? 'Unlock room' : 'Lock room'}
          >
            {isRoomLocked ? <Unlock size={20} /> : <Lock size={20} />}
          </button>
        )}

        {/* Separator */}
        <div className="w-px h-6 bg-meeting-border mx-1" />

        {/* Recording (host only) */}
        {isHost && (
          <div className="flex items-center gap-1">
            <div className="relative group">
              <button
                onClick={handleToggleRecording}
                className={`p-3 rounded-lg transition-all duration-200 ${
                  isRecording || localRecording
                    ? 'bg-red-600 text-white'
                    : 'bg-meeting-card hover:bg-white/10'
                }`}
                title={isRecording || localRecording ? 'Stop recording' : 'Start recording'}
              >
                <CircleDot size={20} className={isRecording || localRecording ? 'recording-pulse' : ''} />
              </button>

              {/* Folder path tooltip on hover */}
              {!isRecording && !localRecording && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-64">
                  <div className="bg-meeting-surface border border-meeting-border rounded-lg p-2 shadow-lg">
                    <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Save recordings to</label>
                    <div className="flex items-center gap-1">
                      <FolderOpen size={12} className="text-gray-500 shrink-0" />
                      <input
                        type="text"
                        value={recordingFolder}
                        onChange={(e) => setRecordingFolder(e.target.value)}
                        placeholder="E:\WebinarRecordings"
                        className="w-full bg-meeting-card border border-meeting-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chat */}
        <button
          onClick={onToggleChat}
          className={`p-3 rounded-lg transition-all duration-200 ${
            activePanel === 'chat'
              ? 'bg-primary hover:bg-primary-dark'
              : 'bg-meeting-card hover:bg-white/10'
          }`}
          title="Chat"
        >
          <MessageSquare size={20} />
        </button>

        {/* Participants */}
        <button
          onClick={onToggleParticipants}
          className={`p-3 rounded-lg transition-all duration-200 ${
            activePanel === 'participants'
              ? 'bg-primary hover:bg-primary-dark'
              : 'bg-meeting-card hover:bg-white/10'
          }`}
          title="Participants"
        >
          <Users size={20} />
        </button>

        {/* Breakouts (host only) */}
        {isHost && (
          <button
            onClick={onToggleBreakouts}
            className={`p-3 rounded-lg transition-all duration-200 ${
              activePanel === 'breakouts'
                ? 'bg-primary hover:bg-primary-dark'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title="Breakout rooms"
          >
            <Grid2x2 size={20} />
          </button>
        )}

        {/* Polls */}
        {mediaConnected && (
          <button
            onClick={onTogglePolls}
            className={`p-3 rounded-lg transition-all duration-200 ${
              activePanel === 'polls'
                ? 'bg-primary hover:bg-primary-dark'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title="Polls"
          >
            <BarChart3 size={20} />
          </button>
        )}

        {/* Q&A */}
        {mediaConnected && (
          <button
            onClick={onToggleQa}
            className={`p-3 rounded-lg transition-all duration-200 ${
              activePanel === 'qa'
                ? 'bg-primary hover:bg-primary-dark'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title="Q&A"
          >
            <HelpCircle size={20} />
          </button>
        )}

        {/* Whiteboard */}
        {mediaConnected && (
          <button
            onClick={onToggleWhiteboard}
            className={`p-3 rounded-lg transition-all duration-200 ${
              activePanel === 'whiteboard'
                ? 'bg-primary hover:bg-primary-dark'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title="Whiteboard"
          >
            <PenTool size={20} />
          </button>
        )}

        {/* Reactions */}
        {mediaConnected && <ReactionPicker />}

        {/* Separator */}
        <div className="w-px h-6 bg-meeting-border mx-1" />

        {/* Leave */}
        <button
          onClick={onLeave}
          className="p-3 rounded-lg bg-red-600 hover:bg-red-700 transition-colors"
          title="Leave meeting"
        >
          <PhoneOff size={20} />
        </button>
      </div>
    </div>
  );
}
