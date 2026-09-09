import React from 'react';
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
  Unlock
} from 'lucide-react';

export default function MeetingControls({
  isMuted,
  isVideoOff,
  isScreenSharing,
  isRecording,
  isRoomLocked,
  isHost,
  activePanel,
  onToggleAudio,
  onToggleVideo,
  onFlipCamera,
  onToggleScreenShare,
  onToggleRecording,
  onToggleLock,
  onToggleChat,
  onToggleParticipants,
  onLeave
}) {
  return (
    <div className="px-4 py-3 bg-meeting-surface border-t border-meeting-border">
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

        {/* Recording */}
        <button
          onClick={onToggleRecording}
          className={`p-3 rounded-lg transition-all duration-200 ${
            isRecording ? 'bg-red-600 text-white' : 'bg-meeting-card hover:bg-white/10'
          }`}
          title={isRecording ? 'Stop recording' : 'Start recording'}
        >
          <CircleDot size={20} className={isRecording ? 'recording-pulse' : ''} />
        </button>

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
