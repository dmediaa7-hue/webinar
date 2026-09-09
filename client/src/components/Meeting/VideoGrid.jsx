import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
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

// VideoGrid is fully LiveKit-native: camera tiles (with placeholder for
// audio-only participants) plus any active screen-share tiles. No props — all
// data is read from LiveKit hooks via RoomContext.
export default function VideoGrid() {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Camera tiles for every participant (placeholder => avatar for audio-only),
  // plus real screen-share tiles for participants currently sharing.
  const cameraRefs = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screenRefs = useTracks([Track.Source.ScreenShare]);

  // ResizeObserver to measure the container and fit tiles without scroll.
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

  // Screen-share tiles first, then camera tiles (sorted in order of
  // participant connect time by LiveKit).
  const tiles = useMemo(() => {
    const screens = screenRefs.map(ref => ({
      ref,
      isScreenShare: true,
    }));
    const cams = cameraRefs.map(ref => ({
      ref,
      isScreenShare: ref.source === Track.Source.ScreenShare,
    }));
    return [...screens, ...cams];
  }, [screenRefs, cameraRefs]);

  const count = tiles.length;

  const layout = useMemo(() => {
    if (count === 0) return { cols: 1, rows: 1 };
    if (size.width > 0 && size.height > 0) {
      return computeLayout(count, size.width, size.height);
    }
    const cols = Math.ceil(Math.sqrt(count)) || 1;
    return { cols, rows: Math.ceil(count / cols) || 1 };
  }, [count, size.width, size.height]);

  if (count === 0) {
    return (
      <div ref={containerRef} className="h-full w-full p-3 overflow-hidden flex items-center justify-center">
        <p className="text-gray-400 text-sm">Waiting for participants to join…</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full p-3 overflow-hidden">
      <div
        className="h-full w-full grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        }}
      >
        {tiles.map(({ ref }, index) => (
          <VideoCard
            key={`${ref.participant.identity}-${ref.source}`}
            trackRef={ref}
            isActiveSpeaker={index === 0}
          />
        ))}
      </div>
    </div>
  );
}