import React, { useRef, useEffect } from 'react';
import { getInitials } from '../../utils/constants';
import { MicOff, VideoOff, MonitorUp } from 'lucide-react';

export default function VideoCard({ participant, isLocal, localVideoRef, isActiveSpeaker }) {
  const videoRef = useRef(null);
  const { displayName, stream } = participant;

  useEffect(() => {
    // Handle local video
    if (isLocal && localVideoRef) {
      // localVideoRef is passed from parent for shared ref
    } else if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, isLocal, localVideoRef]);

  const showOffScreen = participant.isVideoOff || !stream;

  return (
    <div className={`video-container h-full w-full relative ${isActiveSpeaker ? 'active-indicator' : ''}`}>
      {!showOffScreen && (
        <>
          {/* Local video (muted to prevent echo) */}
          {isLocal ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          )}
        </>
      )}

      {/* Avatar fallback when camera is off or no stream */}
      {showOffScreen && (
        <div className="avatar-fallback">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-meeting-surface border border-meeting-border flex items-center justify-center mx-auto mb-2">
              <span className="text-xl font-bold text-gray-300">
                {getInitials(displayName)}
              </span>
            </div>
            <p className="text-sm text-gray-400">{displayName}</p>
          </div>
        </div>
      )}

      {/* Screen sharing indicator */}
      {participant.isScreenSharing && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-primary/90 rounded-full text-xs text-white flex items-center gap-1">
          <MonitorUp size={12} />
          Sharing
        </div>
      )}

      {/* Status badges */}
      <div className="absolute bottom-2 left-2 flex gap-2">
        {participant.isMuted && (
          <div className="w-6 h-6 rounded-full bg-red-600/90 flex items-center justify-center" title="Microphone muted">
            <MicOff size={12} />
          </div>
        )}
        {!participant.isMuted && stream && (
          <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center" title="Microphone on">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
        )}
        {participant.isVideoOff && (
          <div className="w-6 h-6 rounded-full bg-red-600/90 flex items-center justify-center" title="Camera off">
            <VideoOff size={12} />
          </div>
        )}
      </div>

      {/* Name label */}
      <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/50 rounded text-xs text-gray-200">
        {displayName} {isLocal && '(You)'}
        {participant.isHost && <span className="text-yellow-400 ml-1">👑</span>}
      </div>
    </div>
  );
}
