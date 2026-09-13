// Live RTMP publishing.
//
// Browsers cannot push RTMP, so live streaming rides the existing host
// compositor: the host's browser renders the meeting grid (the same
// createRecordingGrid used by recording), records it with MediaRecorder, and
// forwards ~1s chunks here over socket.io. The server is the first (and only)
// link in the chain that can speak RTMP: it pipes those chunks into an FFmpeg
// process (bundled via ffmpeg-static - no system install) that re-encodes to
// H.264/AAC and pushes the result to the RTMP ingest endpoint (YouTube /
// Twitch / any rtmp:// URL). Nothing is persisted.
//
// Events:
//   client -> server   start-rtmp { url, key, format }   ack { success }
//   client -> server   rtmp-chunk { data: base64 }
//   client -> server   stop-rtmp  {}                     ack { success }
//   server -> room     rtmp-started { url } / rtmp-stopped { reason } / rtmp-error { message }
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { getRoom } = require('./rooms');

// Cap on how far behind FFmpeg is allowed to fall. Each chunk is ~0.3-0.4 MB
// of encoded media; 20 queued chunks (~8 MB) means the pipeline is ~20s
// behind and effectively dead, so we tear it down instead of buffering into
// memory on a single-core free-tier box.
const MAX_QUEUE_CHUNKS = 20;

const FORMATS = new Set(['mp4', 'webm']);

// socket.id -> { roomId, url, proc, dying, queue }
const streams = new Map();

/** Join a YouTube-style RTMP ingest URL and its stream key. */
function resolveRtmpUrl(url, key) {
  const trimmedUrl = String(url || '').trim();
  const trimmedKey = String(key || '').trim();
  if (!trimmedKey) return trimmedUrl;
  return trimmedUrl.endsWith('/')
    ? trimmedUrl + trimmedKey
    : trimmedUrl + '/' + trimmedKey;
}

/** Only rtmp:// and rtmps:// endpoints are accepted (rejects file paths, etc.). */
function isValidRtmpUrl(value) {
  return typeof value === 'string' && /^rtmps?:\/\//i.test(value.trim());
}

/**
 * FFmpeg argument list. Whatever container the browser produced is re-encoded
 * to H.264/AAC FLV so every input (webm/vp8+opus, mp4/h264+aac) yields a
 * uniform low-latency stream. `-tune zerolatency` + a 2s GOP keep cast delay
 * and keyframe wait small; `-re` is intentionally omitted - the browser is a
 * realtime source and pacing it would add unbounded drift.
 */
function buildFfmpegArgs(format, url) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', format, '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
    '-g', '60', '-keyint_min', '60',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-f', 'flv', url
  ];
}

/**
 * Wire the RTMP relay for one connected socket.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function handleRtmp(io, socket) {
  // Full stop, idempotent: close ffmpeg stdin (flushes what was written),
  // SIGKILL fallback for endpoints that hang on EOF, clear room state, and
  // notify the room. `reason` is the error message, or null for a clean stop.
  function teardown(session, reason) {
    if (!session || session.dying) return;
    session.dying = true;

    try { session.proc.stdin.end(); } catch { /* EPIPE - ffmpeg already gone */ }
    const killer = setTimeout(() => {
      try { session.proc.kill('SIGKILL'); } catch { /* already gone */ }
    }, 5000);
    session.proc.once('exit', () => clearTimeout(killer));

    streams.delete(socket.id);

    const r = getRoom(session.roomId);
    if (r) {
      r.isStreaming = false;
      r.rtmpUrl = null;
    }

    io.to(session.roomId).emit('rtmp-stopped', { reason: reason || null });

    if (reason) console.error(`[RTMP] ${session.roomId}: ${reason}`);
    else console.log(`[RTMP] ${session.roomId}: stream stopped`);
  }

  socket.on('start-rtmp', ({ url, key, format } = {}, ack) => {
    // Room must be resolved per-event: socket.data.roomId is only populated
    // after join-room, which fires after handleRtmp wired this socket up.
    const room = socket.data.roomId ? getRoom(socket.data.roomId) : null;
    if (!room || !socket.data.isHost) {
      ack?.({ success: false, error: 'Only the host can start a live stream' });
      return;
    }
    if (streams.has(socket.id)) {
      ack?.({ success: false, error: 'Stream already active' });
      return;
    }

    const fullUrl = resolveRtmpUrl(url, key);
    if (!isValidRtmpUrl(fullUrl)) {
      ack?.({ success: false, error: 'RTMP URL must start with rtmp:// or rtmps://' });
      return;
    }
    const fmt = FORMATS.has(format) ? format : 'webm';

    let stderrTail = ''; // last ~4KB of FFmpeg diagnostics for error reporting
    let session = null;

    const proc = spawn(ffmpegPath, buildFfmpegArgs(fmt, fullUrl), {
      stdio: ['pipe', 'ignore', 'pipe']
    });

    session = { roomId: room.id, url: fullUrl, proc, dying: false, queue: [] };

    const fail = (message) => {
      const detail = stderrTail.trim() ? ` (${stderrTail.trim().split('\n').pop()})` : '';
      io.to(room.id).emit('rtmp-error', { message: `${message}${detail}` });
      teardown(session, message);
    };

    proc.stderr.on('data', (buf) => {
      stderrTail = (stderrTail + '\n' + buf.toString()).slice(-4000);
    });

    // FFmpeg died on its own (bad endpoint, rejected key, network drop).
    proc.on('error', (err) => {
      if (!session.dying) fail(`FFmpeg failed to start: ${err.message}`);
    });
    proc.on('exit', (code, signal) => {
      if (!session.dying) {
        fail(`FFmpeg exited unexpectedly (code ${code}, signal ${signal})`);
      }
    });

    // Drain queued chunks as FFmpeg catches up after a backpressure stall.
    proc.stdin.on('drain', () => {
      if (session.dying) return;
      while (session.queue.length) {
        if (!proc.stdin.write(session.queue[0])) break;
        session.queue.shift();
      }
    });

    streams.set(socket.id, session);
    room.isStreaming = true;
    room.rtmpUrl = fullUrl;
    io.to(room.id).emit('rtmp-started', { url: fullUrl });
    ack?.({ success: true });
    console.log(`[RTMP] ${room.id}: live stream started -> ${fullUrl}`);
  });

  socket.on('rtmp-chunk', ({ data } = {}) => {
    const session = streams.get(socket.id);
    if (!session || session.dying) return;
    if (typeof data !== 'string' || data.length === 0) return;

    const buf = Buffer.from(data, 'base64');
    if (buf.length === 0) return;

    if (session.queue.length > 0 || !session.proc.stdin.write(buf)) {
      session.queue.push(buf);
      if (session.queue.length > MAX_QUEUE_CHUNKS) {
        fail('Live stream fell too far behind and was stopped');
      }
    }
  });

  socket.on('stop-rtmp', (_payload, ack) => {
    const session = streams.get(socket.id);
    if (!session || session.dying) {
      ack?.({ success: false, error: 'No active stream' });
      return;
    }
    teardown(session, null);
    ack?.({ success: true, url: session.url });
  });

  // If the host's socket drops, the compositor in their browser is gone -
  // kill the stream instead of pushing frozen frames.
  socket.on('disconnect', () => {
    const session = streams.get(socket.id);
    if (session && !session.dying) teardown(session, null);
  });
}

module.exports = { handleRtmp, resolveRtmpUrl, isValidRtmpUrl, buildFfmpegArgs };