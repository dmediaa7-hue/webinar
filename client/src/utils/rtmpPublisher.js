// Live-stream publisher (host only). Renders the same participant grid as
// recording - via the unmodified createRecordingGrid() - with its OWN WebAudio
// mix, records it with MediaRecorder, and relays ~1s chunks to the server's
// RTMP relay (server/src/rtmp.js), which re-encodes and pushes them to the
// ingest URL. Fully independent from the recording pipeline: when recording
// and live streaming run at once, each gets its own canvas draw + mix (an
// accepted CPU cost), and no recording code is touched.
import { createRecordingGrid } from './recordingGrid';
import { EVENTS } from './constants';
import useStore from '../store/useStore';

const CHUNK_MS = 1000;

// MP4 (H.264/AAC) preferred - browsers that support it avoid a full video
// transcode on the server; WebM (VP8/VP9) still works, FFmpeg re-encodes.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
];

// Explicit bitrates keep 1s chunks ~400KB base64 - safely under the server's
// socket.io 1MB message cap even at peak complexity.
const VIDEO_BPS = 2500000;
const AUDIO_BPS = 128000;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve(typeof reader.result === 'string' ? reader.result.split(',')[1] : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {object} opts
 * @param {import('socket.io-client').Socket} opts.socket
 * @param {string} opts.roomId
 * @param {(status: 'starting'|'live'|'stopped'|'error', message?: string) => void} opts.onStatus
 * @returns {{ start: (cfg: {url: string, key: string}) => void, stop: () => void }}
 */
export function createRtmpPublisher({ socket, roomId, onStatus }) {
  let recorder = null;
  let core = null; // { grid, audioContext, mixSources, syncTimer }
  let stopError = null;

  const releaseCore = () => {
    if (!core) return;
    clearInterval(core.syncTimer);
    core.mixSources.forEach(({ source }) => {
      try { source.disconnect(); } catch {}
    });
    try { core.audioContext.close(); } catch {}
    try { core.grid.stop(); } catch {}
    core = null;
  };

  const fail = (message) => {
    stopError = message;
    stop();
  };

  const stop = () => {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      releaseCore();
      recorder = null;
      onStatus(stopError ? 'error' : 'stopped', stopError || undefined);
      stopError = null;
    }
  };

  const start = ({ url, key }) => {
    if (recorder && recorder.state !== 'inactive') return;
    if (!socket.connected) {
      onStatus('error', 'Not connected to the server');
      return;
    }

    const state = useStore.getState();
    let grid = null;
    let audioContext = null;
    let audioDestination = null;
    const mixSources = new Map();
    let syncTimer = null;

    try {
      audioContext = new AudioContext();
      audioDestination = audioContext.createMediaStreamDestination();

      const localMic = state.localCameraStream || state.localStream;
      if (localMic) {
        try {
          audioContext.createMediaStreamSource(localMic).connect(audioDestination);
        } catch {}
      }

      const syncAudioMix = () => {
        const current = useStore.getState();
        const currentId = current.mySocketId;

        current.participants.forEach((p, socketId) => {
          if (socketId === currentId || !p.stream) return;
          const existing = mixSources.get(socketId);
          if (existing && existing.stream === p.stream) return;
          if (existing) {
            try { existing.source.disconnect(); } catch {}
            mixSources.delete(socketId);
          }
          try {
            const source = audioContext.createMediaStreamSource(p.stream);
            source.connect(audioDestination);
            mixSources.set(socketId, { stream: p.stream, source });
          } catch {}
        });

        mixSources.forEach((entry, socketId) => {
          const p = current.participants.get(socketId);
          if (!p || !p.stream || p.stream !== entry.stream) {
            try { entry.source.disconnect(); } catch {}
            mixSources.delete(socketId);
          }
        });
      };

      syncAudioMix();
      syncTimer = setInterval(syncAudioMix, 1000);

      try {
        grid = createRecordingGrid();
      } catch (err) {
        console.error('[RTMP] Canvas grid compositor failed, using local source only:', err);
      }

      core = { grid, audioContext, mixSources, syncTimer };
    } catch (err) {
      releaseCore();
      onStatus('error', 'Could not start the live compositor');
      return;
    }

    const mimeType = MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
    const gridTracks = grid ? grid.stream.getVideoTracks() : [];
    const videoTracks = gridTracks.length
      ? gridTracks.map((t) => t.clone())
      : (state.localCameraStream || state.localStream)?.getVideoTracks() || [];

    if (!mimeType || videoTracks.length === 0) {
      releaseCore();
      onStatus('error', 'Live streaming is not supported in this browser');
      return;
    }

    const stream = new MediaStream([
      ...videoTracks,
      ...audioDestination.stream.getAudioTracks()
    ]);

    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BPS,
        audioBitsPerSecond: AUDIO_BPS
      });
    } catch (err) {
      releaseCore();
      onStatus('error', 'Failed to start the live stream recorder');
      return;
    }

    const format = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0 || !socket.connected) return;
      blobToBase64(e.data)
        .then((data) => {
          if (data && socket.connected) socket.emit(EVENTS.RTMP_CHUNK, { data });
        })
        .catch(() => {});
    };

    recorder.onstop = () => {
      socket.emit(EVENTS.RTMP_STOP, {});
      releaseCore();
      recorder = null;
      onStatus(stopError ? 'error' : 'stopped', stopError || undefined);
      stopError = null;
    };

    socket.emit(EVENTS.RTMP_START, { url, key, format }, (response) => {
      if (!response || !response.success) {
        fail(response?.error || 'Server rejected the live stream');
      }
    });

    recorder.start(CHUNK_MS);
  };

  return { start, stop };
}