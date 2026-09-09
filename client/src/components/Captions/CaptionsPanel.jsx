import React from 'react';
import { X, CaptionsOff } from 'lucide-react';
import { useTranscriptions } from '@livekit/components-react';
import { toCaptionSegments } from '../../utils/captions';

// Full-transcript side panel mirroring the overlay.
// When no transcription agent publishes text streams on the room
// (or nothing has been spoken yet), an explicit 'Captions unavailable'
// empty state is shown - we never fabricate transcriptions.
// Only mounted when a live room exists (room is passed explicitly).
export default function CaptionsPanel({ room, onClose }) {
  const transcriptions = useTranscriptions({ room });
  const segments = toCaptionSegments(transcriptions);

  return (
    <div className="panel h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-meeting-border flex items-center justify-between">
        <h3 className="font-semibold text-sm">Captions</h3>
        <button
          onClick={onClose}
          className="icon-btn text-gray-400 hover:text-white"
          aria-label="Close captions"
        >
          <X size={18} />
        </button>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {segments.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <div className="mb-2">
              <CaptionsOff size={28} className="mx-auto" />
            </div>
            <p className="text-gray-400 font-medium">Captions unavailable</p>
            <p className="text-xs mt-1">
              Add a LiveKit transcription agent to this room to enable live captions.
            </p>
          </div>
        )}

        {segments.map((seg) => (
          <div key={seg.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary">{seg.identity}</span>
              {!seg.isFinal && (
                <span className="text-[10px] text-gray-500 italic">…</span>
              )}
            </div>
            <p
              className={`text-sm break-words rounded-lg px-3 py-2 ${
                seg.isFinal
                  ? 'text-gray-200 bg-meeting-card'
                  : 'text-gray-400 italic bg-meeting-bg'
              }`}
            >
              {seg.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}