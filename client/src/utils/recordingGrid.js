// Canvas compositor that renders every participant's video into a
// fullscreen-style grid for recording, mirroring the on-screen VideoGrid
// (Gallery view) instead of recording only the local camera/screen track.
import { computeRecordingColumns, computePinnedLayout } from './gridLayout';
import { shouldMirrorLocalVideo } from './mirror';
import { getInitials } from './constants';
import useStore from '../store/useStore';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const GAP = 8;
const TILE_BG = '#1e293b';
const PAGE_BG = '#0f172a';

// Creates a recording source that composites ALL participants (local + remote)
// onto a canvas and exposes it as a MediaStream. Call stop() to release the
// hidden <video> elements and the canvas track when recording ends.
export function createRecordingGrid() {
  // Hidden container must stay in the document: drawImage() only yields real
  // frames from <video> elements that are attached and playing.
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;z-index:-9999;';
  document.body.appendChild(container);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  const videos = new Map(); // key ('local' | socketId) -> <video>
  let rafId = 0;
  let lastDraw = 0;

  const syncTiles = () => {
    const state = useStore.getState();
    const myId = state.mySocketId;
    const hostName = state.displayName || localStorage.getItem('webinar-name') || 'Guest';
    const isSharing = Boolean(state.isScreenSharing && state.screenShareStream);

    const tiles = [];
    if (isSharing) {
      // Screen share is its own tile; never swapped into the camera slot.
      tiles.push({
        key: 'screen',
        stream: state.screenShareStream,
        name: `${hostName}'s screen`,
        isLocal: false,
        mirror: false,
        isScreen: true,
        hasVideo: Boolean(state.screenShareStream.getVideoTracks().length)
      });
    }

    // The local camera is always the camera stream; mirroring only applies here.
    tiles.push({
      key: 'local',
      stream: state.localStream,
      name: hostName,
      isLocal: true,
      mirror: shouldMirrorLocalVideo(state.localFacingMode),
      hasVideo: Boolean(state.localStream && !state.isVideoOff && state.localStream.getVideoTracks().length)
    });

    state.participants.forEach((p, socketId) => {
      if (socketId === myId) return;
      tiles.push({
        key: socketId,
        stream: p.stream,
        name: p.displayName || 'Guest',
        isLocal: false,
        mirror: false,
        hasVideo: Boolean(p.stream && !p.isVideoOff && p.stream.getVideoTracks().length)
      });
    });

    // Drop hidden videos for participants who left / video turned off.
    const keys = new Set(tiles.map((t) => t.key));
    videos.forEach((video, key) => {
      if (!keys.has(key)) {
        video.srcObject = null;
        video.remove();
        videos.delete(key);
      }
    });

    return tiles;
  };

  const ensureVideo = (tile) => {
    let video = videos.get(tile.key);
    if (video && video.srcObject !== tile.stream) {
      video.srcObject = null;
      video.remove();
      videos.delete(tile.key);
      video = null;
    }
    if (!video && tile.hasVideo && tile.stream) {
      video = document.createElement('video');
      video.autoplay = true;
      video.muted = true; // audio is mixed separately via WebAudio
      video.playsInline = true;
      video.srcObject = tile.stream;
      video.play().catch(() => {});
      container.appendChild(video);
      videos.set(tile.key, video);
    }
    return video;
  };

  const drawLabel = (text, x, bottom, maxWidth) => {
    const fs = Math.max(14, Math.round(maxWidth * 0.03));
    ctx.font = `500 ${fs}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, bottom - fs - 12, w, fs + 12);
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x + 8, bottom - 8);
  };

  const drawTile = (tile, x, y, cellW, cellH) => {
    const video = tile.hasVideo ? ensureVideo(tile) : null;
    const ready = video && video.videoWidth > 0 && video.videoHeight > 0;

    if (ready) {
      // object-fit: cover (center-crop) exactly like the on-screen tiles.
      const scale = Math.max(cellW / video.videoWidth, cellH / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      ctx.save();
      if (tile.mirror) {
        ctx.translate(x + cellW / 2, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(x + cellW / 2), 0);
      }
      ctx.drawImage(video, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);
      ctx.restore();
      drawLabel(`${tile.name}${tile.isLocal ? ' (You)' : ''}`, x + 8, y + cellH - 8, cellW);
    } else {
      // Camera off / still connecting: avatar fallback like VideoCard.
      ctx.fillStyle = TILE_BG;
      ctx.fillRect(x, y, cellW, cellH);
      const fs = Math.min(cellW, cellH) * 0.28;
      ctx.fillStyle = '#94a3b8';
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(getInitials(tile.name), x + cellW / 2, y + cellH / 2 - fs * 0.7);
      ctx.font = `${Math.max(13, Math.round(cellH * 0.06))}px system-ui, sans-serif`;
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(tile.name, x + cellW / 2, y + cellH / 2 + fs * 0.6);
    }
  };

  const draw = () => {
    ctx.fillStyle = PAGE_BG;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const tiles = syncTiles();
    if (!tiles.length) return;

    const screenTile = tiles.find((t) => t.isScreen);
    const cameras = screenTile ? tiles.filter((t) => !t.isScreen) : tiles;

    if (screenTile) {
      // Pinned mode: screen fills the left ~70%, cameras stack in a right strip.
      const screenW = Math.round(WIDTH * 0.7) - GAP;
      const stripX = screenW + GAP;
      const stripW = WIDTH - stripX;

      drawTile(screenTile, 0, 0, screenW, HEIGHT);

      if (cameras.length) {
        const layout = computePinnedLayout(stripW, HEIGHT, cameras.length);
        const cellW = (stripW - GAP * (layout.cols + 1)) / layout.cols;
        const cellH = (HEIGHT - GAP * (layout.rows + 1)) / layout.rows;
        cameras.forEach((tile, i) => {
          const col = i % layout.cols;
          const row = Math.floor(i / layout.cols);
          drawTile(tile, stripX + col * (cellW + GAP), GAP + row * (cellH + GAP), cellW, cellH);
        });
      }
      return;
    }

    // Uniform mode: spec column rules; a lone participant fills the frame.
    const cols = tiles.length === 1 ? 1 : computeRecordingColumns(tiles.length);
    const rows = Math.ceil(tiles.length / cols);
    const cellW = (WIDTH - GAP * (cols + 1)) / cols;
    const cellH = (HEIGHT - GAP * (rows + 1)) / rows;

    tiles.forEach((tile, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawTile(tile, GAP + col * (cellW + GAP), GAP + row * (cellH + GAP), cellW, cellH);
    });
  };

  const loop = (ts) => {
    rafId = requestAnimationFrame(loop);
    if (ts - lastDraw < 1000 / FPS) return; // pace at FPS, not 60
    lastDraw = ts;
    draw();
  };

  const stream = canvas.captureStream(FPS);

  const stop = () => {
    cancelAnimationFrame(rafId);
    videos.forEach((video) => {
      video.srcObject = null;
      video.remove();
    });
    videos.clear();
    container.remove();
    stream.getTracks().forEach((t) => t.stop());
  };

  loop(0);

  return { stream, stop };
}