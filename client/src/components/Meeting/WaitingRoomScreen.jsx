import React, { useEffect, useRef, useState } from 'react';
import { Clock, LogOut, VideoOff } from 'lucide-react';
import { getInitials } from '../../utils/constants';

// Held-joiner view (task 14): shown while the host has not admitted us yet.
// Uses a LOCAL getUserMedia preview only - no LiveKit token is requested while
// waiting, so no media flows before the host lets us in.
export default function WaitingRoomScreen({ roomId, displayName, onLeave }) {
  const videoRef = useRef(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    let stream = null;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      });

    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-900/40 border border-yellow-700/50 flex items-center justify-center mx-auto mb-4">
            <Clock size={28} className="text-yellow-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">You're in the waiting room</h1>
          <p className="text-gray-400 text-sm">
            The host will let you into <span className="text-gray-200 font-mono">{roomId?.toUpperCase()}</span> shortly.
          </p>
        </div>

        {/* Local camera preview while waiting */}
        <div className="relative aspect-video rounded-xl overflow-hidden bg-meeting-card border border-meeting-border">
          {previewError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500">
              <VideoOff size={28} />
              <span className="text-xs">Camera preview unavailable</span>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute bottom-2 left-2 flex items-center gap-2 bg-black/60 rounded-lg pl-1 pr-2 py-1">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary/60 to-meeting-card flex items-center justify-center">
              <span className="text-[10px] font-semibold">{getInitials(displayName)}</span>
            </div>
            <span className="text-xs text-gray-200">{displayName}</span>
          </div>
        </div>

        <button
          onClick={onLeave}
          className="w-full flex items-center justify-center gap-2 py-3 bg-meeting-card hover:bg-white/10 border border-meeting-border text-gray-300 rounded-lg font-medium transition-colors"
        >
          <LogOut size={16} />
          Leave the meeting
        </button>
      </div>
    </div>
  );
}