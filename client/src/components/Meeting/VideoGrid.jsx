import React from 'react';
import VideoCard from './VideoCard';
import { getInitials } from '../../utils/constants';

export default function VideoGrid({ participants, localVideoRef, isScreenSharing, screenStream }) {
  // Sort: screen sharer first (if any), then everyone else
  const sorted = [...participants].sort((a, b) => {
    if (a.isScreenSharing) return -1;
    if (b.isScreenSharing) return 1;
    return 0;
  });

  const count = sorted.length;
  const screensharingParticipant = sorted.find(p => p.isScreenSharing);

  // Determine grid layout classes
  let gridClass = '';
  if (count <= 1) {
    gridClass = 'grid-cols-1';
  } else if (count === 2) {
    gridClass = 'grid-cols-2';
  } else if (count <= 4) {
    gridClass = 'grid-cols-2';
  } else if (count <= 6) {
    gridClass = 'grid-cols-3';
  } else if (count <= 9) {
    gridClass = 'grid-cols-3';
  } else {
    gridClass = 'grid-cols-4';
  }

  return (
    <div className="h-full w-full p-3 overflow-y-auto">
      {isScreenSharing && screenStream ? (
        /* Screen share focused layout */
        <div className="h-full flex flex-col gap-3">
          {/* Main screen share video */}
          <div className="flex-1 min-h-0 relative rounded-lg overflow-hidden bg-black">
            <video
              autoPlay
              playsInline
              className="w-full h-full object-contain"
              srcObject={screenStream}
            />
            <div className="absolute top-2 left-2 px-3 py-1 bg-black/60 rounded-full text-xs text-gray-200">
              🔴 Screen shared by You
            </div>
          </div>

          {/* Thumbnails of all participants */}
          <div className="h-32 shrink-0 flex gap-2 overflow-x-auto">
            {sorted.map(p => (
              <div key={p.socketId} className="w-48 h-full shrink-0">
                <VideoCard
                  participant={p}
                  isLocal={p.socketId === 'local'}
                  localVideoRef={localVideoRef}
                  isActiveSpeaker={false}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Normal grid layout */
        <div className={`h-full grid ${gridClass} gap-3`}>
          {sorted.map((p, index) => (
            <VideoCard
              key={p.socketId}
              participant={p}
              isLocal={p.socketId === 'local'}
              localVideoRef={p.socketId === 'local' ? localVideoRef : null}
              isActiveSpeaker={index === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
