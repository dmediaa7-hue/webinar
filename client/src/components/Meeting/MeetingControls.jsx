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
import { createRecordingGrid } from '../../utils/recordingGrid';
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
  const [showRecordingFolder, setShowRecordingFolder] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const folderHandleRef = useRef(null);
  const recordingGridRef = useRef(null);
  const folderPickerSupported = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

  const pickRecordingFolder = useCallback(async () => {
    try {
      const handle = await window.showDirectoryPicker();
      folderHandleRef.current = handle;
      setRecordingFolder(handle.name);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[Recording] Folder picker error:', err);
        setRecordingStatus('Could not access that folder');
        setTimeout(() => setRecordingStatus(''), 5000);
      }
    }
  }, []);

  const disposeRecordingGrid = useCallback(() => {
    if (recordingGridRef.current) {
      recordingGridRef.current.stop();
      recordingGridRef.current = null;
    }
  }, []);

  const handleStartRecording = useCallback(() => {
    const store = useStore.getState();
    const roomId = store.roomId;
    const hostId = store.mySocketId;
    const folder = recordingFolder.trim();
    const folderHandle = folderHandleRef.current;

    if (!folderHandle && !folder) {
      setRecordingStatus('Choose a save folder first (tap the folder button to set it)');
      setTimeout(() => setRecordingStatus(''), 5000);
      return;
    }

    const localStream = store.localStream;
    const screenStream = store.screenShareStream;
    const sourceStream = store.isScreenSharing && screenStream ? screenStream : localStream;
    // Recording captures the full participant grid, so any stream at all
    // (local camera, one remote peer, or a screen share) can anchor it.
    const anyStream = sourceStream || [...store.participants.values()].some((p) => p.stream);
    if (!anyStream) {
      setRecordingStatus('No camera/mic stream available to record');
      setTimeout(() => setRecordingStatus(''), 5000);
      return;
    }

    let audioDestination = null;
    let mixedStream = sourceStream;
    let recordingGrid = null;

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

      // Canvas grid of ALL participants (local + every remote stream) becomes
      // the recorded video, so recordings are a fullscreen gallery view.
      try {
        recordingGrid = createRecordingGrid();
      } catch (err) {
        console.error('[Recording] Canvas grid compositor failed, recording local source only:', err);
      }
      recordingGridRef.current = recordingGrid;

      audioDestination = destination;
      // Canvas grid tracks are VP8/VP9 (Chrome/Firefox), so WebM is the safe
      // container there; MP4 stays for Safari (H.264 canvas) and for the
      // non-composited fallback where the source is a camera/screen track.
      const candidates = (
        recordingGrid
          ? [
              'video/webm;codecs=vp9,opus',
              'video/webm;codecs=vp8,opus',
              'video/webm',
              'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
            ]
          : [
              'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
              'video/webm;codecs=vp9,opus',
              'video/webm'
            ]
      ).filter((t) => MediaRecorder.isTypeSupported(t));

      const mimeType = candidates[0];
      if (!mimeType) {
        disposeRecordingGrid();
        setRecordingStatus('Recording is not supported in this browser');
        setTimeout(() => setRecordingStatus(''), 5000);
        return;
      }
      const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

      const gridVideoTracks = recordingGrid ? recordingGrid.stream.getVideoTracks() : [];
      const videoTracks = gridVideoTracks.length ? gridVideoTracks : sourceStream?.getVideoTracks() || [];
      const audioTracks = destination.stream.getAudioTracks();
      mixedStream = new MediaStream([...videoTracks, ...audioTracks]);
    } catch (err) {
      console.error('[Recording] AudioContext mixing failed, using source stream audio:', err);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      disposeRecordingGrid();
      mixedStream = sourceStream;
    }

    let recorder;
    try {
      recorder = new MediaRecorder(mixedStream, { mimeType });
    } catch {
      setRecordingStatus('Failed to start recording in this browser');
      setTimeout(() => setRecordingStatus(''), 5000);
      return;
    }
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      disposeRecordingGrid();

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      const filename = `recording-${roomId}-${Date.now()}.${extension}`;
      chunksRef.current = [];

      const folderHandle = folderHandleRef.current;
      setRecordingStatus(folderHandle ? 'Saving recording...' : 'Uploading recording...');
      try {
        if (folderHandle) {
          // Write straight to the user-picked directory (File System Access API),
          // so recordings land on their computer without a server round-trip.
          const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          setRecordingStatus(`Saved to ${folderHandle.name}/${filename}`);
        } else {
          // Browsers without showDirectoryPicker fall back to the server path
          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
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
        }
      } catch (err) {
        console.error('[Recording] Save error:', err);
        setRecordingStatus('Failed to save recording');
      }
      setTimeout(() => setRecordingStatus(''), 5000);
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
    disposeRecordingGrid();
    setLocalRecording(false);

    stopRecording();
  }, [disposeRecordingGrid]);

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
    <div className="px-2 sm:px-4 py-2 sm:py-3 bg-meeting-surface border-t border-meeting-border">
      {/* Recording status */}
      {recordingStatus && (
        <div className="max-w-3xl mx-auto mb-2 text-xs text-gray-400 text-center truncate">{recordingStatus}</div>
      )}

      {isHost && showRecordingFolder && !isRecording && !localRecording && (
        <div className="max-w-3xl mx-auto mb-2">
          <div className="bg-meeting-card border border-meeting-border rounded-lg p-2 shadow-lg">
            <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Save recordings to</label>
            <div className="flex items-center gap-1">
              <FolderOpen size={12} className="text-gray-500 shrink-0" />
              {folderPickerSupported ? (
                <button
                  onClick={pickRecordingFolder}
                  className="w-full bg-meeting-bg border border-meeting-border rounded px-2 py-1 text-xs text-gray-200 text-left truncate hover:border-primary/50 focus:outline-none focus:border-primary/50"
                  title="Choose a folder on this computer to save recordings"
                >
                  {recordingFolder ? `Your computer: ${recordingFolder}` : 'Choose a folder on this computer...'}
                </button>
              ) : (
                <input
                  type="text"
                  value={recordingFolder}
                  onChange={(e) => setRecordingFolder(e.target.value)}
                  placeholder="Server folder path (e.g. /home/user/Recordings)"
                  className="w-full bg-meeting-bg border border-meeting-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-primary/50"
                />
              )}
              <button
                onClick={() => setShowRecordingFolder(false)}
                className="p-1 rounded text-gray-400 hover:text-white shrink-0"
                aria-label="Close recording folder settings"
              >
                ✕
              </button>
            </div>
            {folderPickerSupported && (
              <p className="mt-1 text-[10px] text-gray-500">Saved directly to the folder you choose, on this computer.</p>
            )}
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto flex items-center justify-center gap-1 sm:gap-2 overflow-x-auto py-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]">
        {/* Right-side main controls (always visible, first on mobile) */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Mic toggle */}
          <button
            onClick={onToggleAudio}
            className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
              isMuted
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          {/* Video toggle */}
          <button
            onClick={onToggleVideo}
            className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
              isVideoOff
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
            aria-label={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
          >
            {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
          </button>

          {/* Flip camera */}
          <button
            onClick={onFlipCamera}
            className="p-2.5 sm:p-3 rounded-lg transition-all duration-200 bg-meeting-card hover:bg-white/10"
            title="Flip camera"
            aria-label="Flip camera"
          >
            <SwitchCamera size={20} />
          </button>

          {/* Screen share */}
          <button
            onClick={onToggleScreenShare}
            className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
              isScreenSharing
                ? 'bg-primary hover:bg-primary-dark'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
            aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
          >
            {isScreenSharing ? <MonitorDown size={20} /> : <MonitorUp size={20} />}
          </button>

          {/* Leave (red, always visible) */}
          <button
            onClick={onLeave}
            className="p-2.5 sm:p-3 rounded-lg bg-red-600 hover:bg-red-700 transition-colors ml-1"
            title="Leave meeting"
            aria-label="Leave meeting"
          >
            <PhoneOff size={20} />
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-6 bg-meeting-border mx-1 shrink-0" />

        {/* Left-side secondary controls (scrollable on mobile) */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Lock room (host only) */}
          {isHost && (
            <button
              onClick={onToggleLock}
              className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
                isRoomLocked
                  ? 'bg-primary hover:bg-primary-dark'
                  : 'bg-meeting-card hover:bg-white/10'
              }`}
              title={isRoomLocked ? 'Unlock room' : 'Lock room'}
              aria-label={isRoomLocked ? 'Unlock room' : 'Lock room'}
            >
              {isRoomLocked ? <Unlock size={20} /> : <Lock size={20} />}
            </button>
          )}

          {/* Recording (host only) */}
          {isHost && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleToggleRecording}
                className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
                  isRecording || localRecording
                    ? 'bg-red-600 text-white'
                    : 'bg-meeting-card hover:bg-white/10'
                }`}
                title={isRecording || localRecording ? 'Stop recording' : 'Start recording'}
                aria-label={isRecording || localRecording ? 'Stop recording' : 'Start recording'}
              >
                <CircleDot size={20} className={isRecording || localRecording ? 'recording-pulse' : ''} />
              </button>

              {/* Folder path toggle (tap-friendly, works on touch devices) */}
              {!isRecording && !localRecording && (
                <button
                  onClick={() => setShowRecordingFolder((v) => !v)}
                  className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
                    showRecordingFolder ? 'bg-primary hover:bg-primary-dark' : 'bg-meeting-card hover:bg-white/10'
                  }`}
                  title="Recording folder"
                  aria-label="Set recording folder"
                >
                  <FolderOpen size={20} />
                </button>
              )}
            </div>
          )}

          {/* Chat */}
          <button
            onClick={onToggleChat}
            className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
              activePanel === 'chat'
                ? 'bg-primary hover:bg-primary-dark'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title="Chat"
            aria-label="Toggle chat"
          >
            <MessageSquare size={20} />
          </button>

          {/* Participants */}
          <button
            onClick={onToggleParticipants}
            className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
              activePanel === 'participants'
                ? 'bg-primary hover:bg-primary-dark'
                : 'bg-meeting-card hover:bg-white/10'
            }`}
            title="Participants"
            aria-label="Toggle participants list"
          >
            <Users size={20} />
          </button>

          {/* Breakouts (host only) */}
          {isHost && (
            <button
              onClick={onToggleBreakouts}
              className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
                activePanel === 'breakouts'
                  ? 'bg-primary hover:bg-primary-dark'
                  : 'bg-meeting-card hover:bg-white/10'
              }`}
              title="Breakout rooms"
              aria-label="Toggle breakout rooms"
            >
              <Grid2x2 size={20} />
            </button>
          )}

          {/* Polls */}
          {mediaConnected && (
            <button
              onClick={onTogglePolls}
              className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
                activePanel === 'polls'
                  ? 'bg-primary hover:bg-primary-dark'
                  : 'bg-meeting-card hover:bg-white/10'
              }`}
              title="Polls"
              aria-label="Toggle polls"
            >
              <BarChart3 size={20} />
            </button>
          )}

          {/* Q&A */}
          {mediaConnected && (
            <button
              onClick={onToggleQa}
              className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
                activePanel === 'qa'
                  ? 'bg-primary hover:bg-primary-dark'
                  : 'bg-meeting-card hover:bg-white/10'
              }`}
              title="Q&A"
              aria-label="Toggle Q and A"
            >
              <HelpCircle size={20} />
            </button>
          )}

          {/* Whiteboard */}
          {mediaConnected && (
            <button
              onClick={onToggleWhiteboard}
              className={`p-2.5 sm:p-3 rounded-lg transition-all duration-200 ${
                activePanel === 'whiteboard'
                  ? 'bg-primary hover:bg-primary-dark'
                  : 'bg-meeting-card hover:bg-white/10'
              }`}
              title="Whiteboard"
              aria-label="Toggle whiteboard"
            >
              <PenTool size={20} />
            </button>
          )}

          {/* Reactions */}
          {mediaConnected && <ReactionPicker />}
        </div>
      </div>
    </div>
  );
}
