import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import VideoCard from './VideoCard';
import { computeLayout, computeGridMode } from '../../utils/gridLayout';

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

  const mode = computeGridMode(screenRefs.length, cameraRefs.length);

  const screenTiles = useMemo(
    () => screenRefs.map(ref => ({ ref, isScreenShare: true })),
    [screenRefs]
  );
  const cameraTiles = useMemo(
    () => cameraRefs.map(ref => ({ ref, isScreenShare: ref.source === Track.Source.ScreenShare })),
    [cameraRefs]
  );
  const allTiles = useMemo(() => [...screenTiles, ...cameraTiles], [screenTiles, cameraTiles]);

  const count = allTiles.length;

  // Uniform grid layout when nothing is pinned.
  const layout = useMemo(() => {
    if (count === 0) return { cols: 1, rows: 1 };
    if (size.width > 0 && size.height > 0) {
      return computeLayout(count, size.width, size.height);
    }
    const cols = Math.ceil(Math.sqrt(count)) || 1;
    return { cols, rows: Math.ceil(count / cols) || 1 };
  }, [count, size.width, size.height]);

  // Screen-share tiles pack into the dominant grid; the camera strip uses the
  // same equal-tile maths so each strip tile stays proportional.
  const screenLayout = useMemo(() => {
    const n = screenTiles.length;
    if (n === 0) return { cols: 1, rows: 1 };
    if (size.width > 0 && size.height > 0) {
      return computeLayout(n, size.width, size.height);
    }
    const cols = Math.ceil(Math.sqrt(n)) || 1;
    return { cols, rows: Math.ceil(n / cols) || 1 };
  }, [screenTiles.length, size.width, size.height]);

  const videoCard = (tile, index, isActive) => (
    <VideoCard
      key={`${tile.ref.participant.identity}-${tile.ref.source}`}
      trackRef={tile.ref}
      isActiveSpeaker={isActive}
    />
  );

  if (count === 0) {
    return (
      <div ref={containerRef} className="h-full w-full p-3 overflow-hidden flex items-center justify-center">
        <p className="text-gray-400 text-sm">Waiting for participants to join…</p>
      </div>
    );
  }

  if (mode === 'pinned') {
    return (
      <div ref={containerRef} className="h-full w-full p-3 overflow-hidden flex gap-3">
        {/* Screen share dominates the layout */}
        <div
          className="flex-1 min-w-0 grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${screenLayout.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${screenLayout.rows}, minmax(0, 1fr))`,
          }}
        >
          {screenTiles.map((tile, i) => videoCard(tile, i, i === 0))}
        </div>

        {/* Camera tiles drop to a side strip when a screen is shared */}
        {cameraTiles.length > 0 && (
          <div className="w-60 shrink-0 overflow-y-auto grid gap-3 auto-rows-fr">
            {cameraTiles.map((tile, i) => videoCard(tile, i, false))}
          </div>
        )}
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
        {allTiles.map((tile, index) => videoCard(tile, index, index === 0))}
      </div>
    </div>
  );
}