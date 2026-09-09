import React from 'react';
import { useTranscriptions } from '@livekit/components-react';
import { toCaptionSegments } from '../../utils/captions';

// Floating captions over the video grid.
// Subscribes to the LiveKit 'transcription' data topic and renders the most
// recent caption segments at the bottom of the video area. Interim segments
// are dimmed and italic; confirmed (final) segments render steady.
// Only mounted when a live room exists (room is passed explicitly).
export default function CaptionsOverlay({ room, maxSegments = 2 }) {
  const transcriptions = useTranscriptions({ room });
  const segments = toCaptionSegments(transcriptions);
  if (!segments.length) return null;

  const recent = segments.slice(-maxSegments);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-2xl px-4 pointer-events-none">
      <div className="space-y-1.5">
        {recent.map((seg) => (
          <div
            key={seg.id}
            className={`rounded-lg px-3 py-1.5 text-sm border backdrop-blur-sm ${
              seg.isFinal
                ? 'bg-black/60 border-white/10 text-white'
                : 'bg-black/40 border-white/5 text-gray-300 italic'
            }`}
          >
            <span className="font-medium text-primary mr-2">{seg.identity}</span>
            {seg.text}
          </div>
        ))}
      </div>
    </div>
  );
}