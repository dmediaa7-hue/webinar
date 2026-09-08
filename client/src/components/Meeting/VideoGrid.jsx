import React, { useRef, useState, useEffect, useMemo } from 'react';
import VideoCard from './VideoCard';

// Compute the layout that maximizes equal tile size for `count` participants
// inside a container of `width` x `height`. Tiles keep a ~16:9 target ratio;
// more columns are preferred on ties (landscape-friendly).
function computeLayout(count, width, height, tileAspect = 16 / 9) {
  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const tileW = Math.min(width / cols, (tileAspect * height) / rows);
    if (!best || tileW > best.tileW || (tileW === best.tileW && cols > best.cols)) {
      best = { cols, rows, tileW, tileH: tileW / tileAspect };
    }
  }
  return best;
}

export default function VideoGrid({ participants, localVideoRef, isScreenSharing, screenStream }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Track the grid container size so tiles can auto-fit without scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Sort: screen sharer first (if any), then everyone else
  const sorted = [...participants].sort((a, b) => {
    if (a.isScreenSharing) return -1;
    if (b.isScreenSharing) return 1;
    return 0;
  });

  const count = sorted.length;

  const layout = useMemo(() => {
    if (count === 0) return { cols: 1, rows: 1 };
    if (size.width > 0 && size.height > 0) {
      return computeLayout(count, size.width, size.height);
    }
    // Fallback before the first ResizeObserver measurement
    const cols = Math.ceil(Math.sqrt(count)) || 1;
    return { cols, rows: Math.ceil(count / cols) || 1 };
  }, [count, size.width, size.height]);

  return (
    <div ref={containerRef} className="h-full w-full p-3 overflow-hidden">
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
        /* Normal grid layout - auto-fits every participant into the viewport */
        <div
          className="h-full w-full grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
          }}
        >
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