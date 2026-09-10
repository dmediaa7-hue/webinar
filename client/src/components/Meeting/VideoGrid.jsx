import React, { useRef, useState, useEffect, useMemo } from 'react';
import VideoCard from './VideoCard';
import { computeLayout, computeGridMode } from '../../utils/gridLayout';
import useStore from '../../store/useStore';

export default function VideoGrid() {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const participants = useStore((s) => s.participants);
  const localStream = useStore((s) => s.localStream);
  const isMuted = useStore((s) => s.isMuted);
  const isVideoOff = useStore((s) => s.isVideoOff);
  const isScreenSharing = useStore((s) => s.isScreenSharing);
  const screenShareStream = useStore((s) => s.screenShareStream);
  const reactions = useStore((s) => s.reactions);
  const displayName = useStore((s) => s.displayName) || localStorage.getItem('webinar-name') || 'Guest';
  const mySocketId = useStore((s) => s.mySocketId);
  const isHost = useStore((s) => s.isHost);

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

  const remoteEntries = useMemo(() => Array.from(participants.entries()).filter(([id]) => id !== mySocketId), [participants, mySocketId]);

  const hasScreenShare = isScreenSharing && screenShareStream;
  const remoteWithScreenShare = remoteEntries.filter(([, p]) => p.isScreenSharing && p.stream);
  const screenSourceCount = hasScreenShare ? 1 : remoteWithScreenShare.length;
  const cameraCount = 1 + remoteEntries.length;
  const totalTiles = hasScreenShare ? 1 + cameraCount : (remoteWithScreenShare.length > 0 ? remoteWithScreenShare.length + cameraCount : cameraCount);

  const mode = computeGridMode(screenSourceCount, cameraCount);

  const screenLayout = useMemo(() => {
    if (screenSourceCount === 0) return { cols: 1, rows: 1 };
    if (size.width > 0 && size.height > 0) {
      return computeLayout(screenSourceCount, size.width, size.height);
    }
    const cols = Math.ceil(Math.sqrt(screenSourceCount)) || 1;
    return { cols, rows: Math.ceil(screenSourceCount / cols) || 1 };
  }, [screenSourceCount, size.width, size.height]);

  const layout = useMemo(() => {
    if (totalTiles === 0) return { cols: 1, rows: 1 };
    if (size.width > 0 && size.height > 0) {
      return computeLayout(totalTiles, size.width, size.height);
    }
    const cols = Math.ceil(Math.sqrt(totalTiles)) || 1;
    return { cols, rows: Math.ceil(totalTiles / cols) || 1 };
  }, [totalTiles, size.width, size.height]);

  const cameraStripLayout = useMemo(() => {
    const n = cameraCount;
    if (n === 0) return { cols: 1, rows: 1 };
    if (size.width > 0 && size.height > 0) {
      return computeLayout(n, size.width, 200);
    }
    const cols = Math.ceil(Math.sqrt(n)) || 1;
    return { cols, rows: Math.ceil(n / cols) || 1 };
  }, [cameraCount, size.width, size.height]);

  const localTile = (
    <VideoCard
      key="local"
      participant={{ socketId: mySocketId, displayName, isHost }}
      stream={localStream}
      isLocal={true}
      isMuted={isMuted}
      isVideoOff={isVideoOff}
      isScreenSharing={false}
      reactions={reactions.get(mySocketId) || []}
    />
  );

  const remoteCameraTiles = remoteEntries.map(([socketId, p]) => (
    <VideoCard
      key={socketId}
      participant={p}
      stream={p.stream}
      isLocal={false}
      isMuted={p.isMuted}
      isVideoOff={p.isVideoOff}
      isScreenSharing={false}
      reactions={reactions.get(socketId) || []}
    />
  ));

  const screenShareTiles = [];
  if (hasScreenShare) {
    screenShareTiles.push(
      <VideoCard
        key="local-screen"
        participant={{ socketId: mySocketId, displayName, isHost }}
        stream={screenShareStream}
        isLocal={true}
        isMuted={false}
        isVideoOff={false}
        isScreenSharing={true}
        reactions={[]}
      />
    );
  }
  remoteWithScreenShare.forEach(([socketId, p]) => {
    screenShareTiles.push(
      <VideoCard
        key={`${socketId}-screen`}
        participant={p}
        stream={p.stream}
        isLocal={false}
        isMuted={false}
        isVideoOff={false}
        isScreenSharing={true}
        reactions={reactions.get(socketId) || []}
      />
    );
  });

  const allCameraTiles = [localTile, ...remoteCameraTiles];

  if (totalTiles === 0) {
    return (
      <div ref={containerRef} className="h-full w-full p-3 overflow-hidden flex items-center justify-center">
        <p className="text-gray-400 text-sm">Waiting for participants to join…</p>
      </div>
    );
  }

  if (mode === 'pinned') {
    return (
      <div ref={containerRef} className="h-full w-full p-3 overflow-hidden flex gap-3">
        <div
          className="flex-1 min-w-0 grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${screenLayout.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${screenLayout.rows}, minmax(0, 1fr))`,
          }}
        >
          {screenShareTiles}
        </div>

        {allCameraTiles.length > 0 && (
          <div className="w-60 shrink-0 overflow-y-auto grid gap-3 auto-rows-fr">
            {allCameraTiles}
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
        {allCameraTiles}
      </div>
    </div>
  );
}
