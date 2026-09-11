import React, { useRef, useEffect } from 'react';
import { getInitials } from '../../utils/constants';
import { MicOff, VideoOff, MonitorUp } from 'lucide-react';
import { filterActiveReactions } from '../../utils/reactionCodec';
import { shouldMirrorLocalVideo } from '../../utils/mirror';

export default function VideoCard({ participant, stream, isLocal, facingMode = '', isMuted, isVideoOff, isScreenSharing, reactions = [] }) {
  const videoRef = useRef(null);

  const displayName = participant?.displayName || 'Guest';
  const isParticipantHost = participant?.isHost;

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && !isVideoOff) {
      el.srcObject = stream;
    } else if (el && el.srcObject) {
      el.srcObject = null;
    }
  }, [stream, isVideoOff]);

  useEffect(() => {
    return () => {
      const el = videoRef.current;
      if (el && el.srcObject) el.srcObject = null;
    };
  }, []);

  const hasVideo = Boolean(stream && !isVideoOff);
  const mirrorClass = !isScreenSharing && isLocal && shouldMirrorLocalVideo(facingMode) ? ' mirrored-video' : '';

  const activeReactions = filterActiveReactions(reactions, Date.now());

  return (
    <div className={`video-container h-full w-full relative min-h-0 min-w-0`}>
      {hasVideo && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover${mirrorClass}`}
        />
      )}

      {/* Reaction burst */}
      {activeReactions.length > 0 && (
        <div className="absolute top-2 right-2 z-10 flex gap-1 px-2 py-1 bg-black/40 rounded-full backdrop-blur-sm pointer-events-none">
          {activeReactions.map((reaction) => (
            <span key={reaction.id} className="reaction-burst text-xl leading-none">
              {reaction.emoji}
            </span>
          ))}
        </div>
      )}

      {/* Avatar fallback when no video */}
      {!hasVideo && (
        <div className="avatar-fallback">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-meeting-surface border border-meeting-border flex items-center justify-center mx-auto mb-2">
              <span className="text-xl font-bold text-gray-300">
                {getInitials(displayName)}
              </span>
            </div>
            <p className="text-sm text-gray-400">{displayName}</p>
            {participant?.connecting && (
              <p className="text-xs text-primary animate-pulse mt-1">Connecting...</p>
            )}
          </div>
        </div>
      )}

      {/* Screen sharing indicator */}
      {isScreenSharing && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-primary/90 rounded-full text-xs text-white flex items-center gap-1">
          <MonitorUp size={12} />
          Sharing
        </div>
      )}

      {/* Status badges */}
      <div className="absolute bottom-2 left-2 flex gap-2">
        {isMuted && (
          <div className="w-6 h-6 rounded-full bg-red-600/90 flex items-center justify-center" title="Microphone muted">
            <MicOff size={12} />
          </div>
        )}
        {!isMuted && hasVideo && (
          <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center" title="Microphone on">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
        )}
        {isVideoOff && (
          <div className="w-6 h-6 rounded-full bg-red-600/90 flex items-center justify-center" title="Camera off">
            <VideoOff size={12} />
          </div>
        )}
      </div>

      {/* Name label */}
      <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/50 rounded text-xs text-gray-200">
        {displayName} {isLocal && '(You)'}
        {isParticipantHost && <span className="text-yellow-400 ml-1">&#x1F451;</span>}
      </div>
    </div>
  );
}
