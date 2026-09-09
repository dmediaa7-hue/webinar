import React from 'react';
import { Track } from 'livekit-client';
import { VideoTrack, useLocalParticipant } from '@livekit/components-react';
import { getInitials } from '../../utils/constants';
import { MicOff, VideoOff, MonitorUp } from 'lucide-react';
import { filterActiveReactions } from '../../utils/reactionCodec';

// Renders one LiveKit tile from a TrackReferenceOrPlaceholder. Camera tiles
// are mirrored; screen-share tiles (sourced from their own Track.Source)
// stay unmirrored so overlaid text is not flipped.
export default function VideoCard({ trackRef, isActiveSpeaker, reactions = [] }) {
  const { localParticipant } = useLocalParticipant();
  const isLocal = trackRef?.participant?.identity === localParticipant.identity;
  const participant = trackRef?.participant;

  const displayName = participant?.name || participant?.displayName || participant?.identity || 'Guest';

  // A placeholder track has withPlaceholder=true and no real track/publication.
  const hasVideo = Boolean(trackRef?.track && trackRef.publication);
  const isCamera = trackRef?.source === Track.Source.Camera;
  const isScreenShare = trackRef?.source === Track.Source.ScreenShare;

  const isMuted = Boolean(trackRef?.publication?.isMuted) || Boolean(participant?.isMicrophoneEnabled === false);
  const isVideoOff = !hasVideo;

  const mirrorClass = isCamera ? ' mirrored-video' : '';

  const activeReactions = filterActiveReactions(reactions, Date.now());

  return (
    <div className={`video-container h-full w-full relative min-h-0 min-w-0 ${isActiveSpeaker ? 'active-indicator' : ''}`}>
      {hasVideo && (
        <VideoTrack
          trackRef={trackRef}
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

      {/* Avatar fallback when camera track has no published video */}
      {!hasVideo && (
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
      {isScreenShare && (
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
        {participant?.metadata?.includes('host') && <span className="text-yellow-400 ml-1">👑</span>}
      </div>
    </div>
  );
}