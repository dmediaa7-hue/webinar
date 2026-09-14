// Live RTMP publishing.
//
// Browsers cannot push RTMP, so live streaming rides the existing host
// compositor: the host's browser renders the meeting grid (the same
// createRecordingGrid used by recording), records it with MediaRecorder, and
// forwards ~1s chunks here over socket.io. The server is the first (and only)
// link in the chain that can speak RTMP: it pipes those chunks into one FFmpeg
// process PER DESTINATION (ffmpeg-static - no system install) that re-encodes
// to H.264/AAC and pushes the result to that destination's RTMP ingest
// endpoint (YouTube, Facebook Live, Twitch, any rtmp:// or rtmps:// URL).
//
// A host can stream to SEVERAL destinations at once (multi-streaming). Each
// destination runs its own FFmpeg process with its own queue, so a reject or
// network failure on one platform never tears down the others; the client's
// one MediaRecorder sends each chunk once and the server fans it out.
//
// Events:
//   client -> server   start-rtmp { targets: [{ targetId, url, key }], format }
//                      ack { success, results: [{ targetId, ok, error, url }] }
//   client -> server   rtmp-chunk { data: base64, targetIds: [targetId] }
//   client -> server   stop-rtmp  {}                     ack { success }
//   server -> room     rtmp-started { targetId, url } / rtmp-stopped { reason } / rtmp-error { message }
//
// The legacy single-target payload ({ url, key }) is still accepted and
// normalized to a single target so older clients keep working.
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { getRoom } = require('./rooms');

// Cap on how far behind FFmpeg is allowed to fall. Each chunk is ~0.3-0.4 MB
// of encoded media; 20 queued chunks (~8 MB) means the pipeline is ~20s
// behind and effectively dead, so we tear it down instead of buffering into
// memory on a single-core free-tier box. Applied per destination.
const MAX_QUEUE_CHUNKS = 20;
const MAX_TARGETS = 5;

const FORMATS = new Set(['mp4', 'webm']);

// socket.id -> Map(targetId, { roomId, targetId, url, proc, dying, queue })
const streams = new Map();

/**
 * Ingest URLs are often typed without the scheme (e.g. "live.twitch.tv/app"
 * or "192.168.1.10:1935/live"). Anything that already carries an explicit
 * scheme (rtmp:, http:, file:, ...) and anything that is not host-like (local
 * paths like C:\... or /usr/share/...) is returned unchanged so the strict
 * validator below still handles it.
 */
function withRtmpScheme(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed; // explicit scheme
  if (/^[a-zA-Z0-9.-]+(:\d+)?(\/\S*)?$/.test(trimmed)) return `rtmp://${trimmed}`;
  return trimmed;
}

/** Join a YouTube-style RTMP ingest URL and its stream key. */
function resolveRtmpUrl(url, key) {
  const trimmedKey = String(key || '').trim();
  const normalizedUrl = withRtmpScheme(url);
  if (!trimmedKey) return normalizedUrl;
  return normalizedUrl.endsWith('/')
    ? normalizedUrl + trimmedKey
    : normalizedUrl + '/' + trimmedKey;
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
 * Recompute the room's aggregate stream state from the set of live sessions.
 * isStreaming is true while ANY destination is live; rtmpUrl exposes the
 * summary of the URLs the room is currently pushing to.
 */
function refreshRoomState(room) {
  const liveUrls = [];
  streams.forEach((targets) => {
    targets.forEach((session) => {
      if (!session.dying) liveUrls.push(session.url);
    });
  });
  room.isStreaming = liveUrls.length > 0;
  room.rtmpUrl = liveUrls.length ? liveUrls.join(', ') : null;
  return liveUrls.length;
}

// All of a socket's destinations go down together (host left the meeting or
// ended the stream): clear room state exactly once.
function teardownAll(io, socket, targetSessions, reason) {
  let hadLive = false;
  targetSessions.forEach((session) => {
    if (session.dying) return;
    session.dying = true;
    hadLive = true;

    try { session.proc.stdin.end(); } catch { /* EPIPE - ffmpeg already gone */ }
    const killer = setTimeout(() => {
      try { session.proc.kill('SIGKILL'); } catch { /* already gone */ }
    }, 5000);
    session.proc.once('exit', () => clearTimeout(killer));
  });
  targetSessions.clear();

  const room = socket.data.roomId ? getRoom(socket.data.roomId) : null;
  if (room) refreshRoomState(room);

  if (hadLive) {
    io.to(socket.data.roomId).emit('rtmp-stopped', { reason: reason || null });
    if (reason) console.error(`[RTMP] ${socket.data.roomId}: ${reason}`);
  }
}

/**
 * Wire the RTMP relay for one connected socket.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function handleRtmp(io, socket) {
  // One isolated FFmpeg pipeline per destination. Failures (bad endpoint,
  // rejected key, network drop) tear down ONLY the affected session - an
  // error on YouTube must never cut the Facebook/RTMPS feed.
  function startSession({ targetId, fullUrl, format }) {
    let stderrTail = ''; // last ~4KB of FFmpeg diagnostics for error reporting
    let session = null;

    const proc = spawn(ffmpegPath, buildFfmpegArgs(format, fullUrl), {
      stdio: ['pipe', 'ignore', 'pipe']
    });

    session = { roomId: socket.data.roomId, targetId, url: fullUrl, proc, dying: false, queue: [] };

    const fail = (message) => {
      const detail = stderrTail.trim() ? ` (${stderrTail.trim().split('\n').pop()})` : '';
      teardownSession(session, message);
      io.to(session.roomId).emit('rtmp-error', { targetId, message: `${message}${detail}` });
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

    return session;
  }

  function teardownSession(session, reason) {
    if (!session || session.dying) return;
    session.dying = true;

    try { session.proc.stdin.end(); } catch { /* EPIPE - ffmpeg already gone */ }
    const killer = setTimeout(() => {
      try { session.proc.kill('SIGKILL'); } catch { /* already gone */ }
    }, 5000);
    session.proc.once('exit', () => clearTimeout(killer));

    let liveTargets = null;
    const targetSessions = streams.get(socket.id);
    if (targetSessions) {
      targetSessions.delete(session.targetId);
      liveTargets = targetSessions.size;
    }

    const room = getRoom(session.roomId);
    if (room) refreshRoomState(room);

    // With the room still live on other destinations, keep the UI accurate by
    // signaling the individual target's stop; a full stop event is emitted only
    // when the last target ends (teardownAll).
    if (liveTargets > 0) {
      io.to(session.roomId).emit('rtmp-stopped', { targetId: session.targetId, reason: reason || null });
    } else {
      io.to(session.roomId).emit('rtmp-stopped', { reason: reason || null });
    }

    if (reason) console.error(`[RTMP] ${session.roomId}: ${reason}`);
    else console.log(`[RTMP] ${session.roomId}: target ${session.targetId} stopped`);
  }

  socket.on('start-rtmp', ({ targets, url, key, format } = {}, ack) => {
    // Room must be resolved per-event: socket.data.roomId is only populated
    // after join-room, which fires after handleRtmp wired this socket up.
    const room = socket.data.roomId ? getRoom(socket.data.roomId) : null;
    if (!room || !socket.data.isHost) {
      ack?.({ success: false, error: 'Only the host can start a live stream' });
      return;
    }

    // Normalize: new multi-destination payload (array of targets) or the
    // legacy single-target { url, key } shape -> one implicit target.
    let targetList = [];
    if (Array.isArray(targets) && targets.length) {
      targetList = targets;
    } else if (typeof url === 'string' && url.trim()) {
      targetList = [{ targetId: 'target-1', url, key }];
    }
    if (!targetList.length || targetList.length > MAX_TARGETS) {
      ack?.({ success: false, error: `Provide between 1 and ${MAX_TARGETS} stream destinations` });
      return;
    }
    if (streams.get(socket.id)?.size) {
      ack?.({ success: false, error: 'Stream already active' });
      return;
    }

    // Validate every destination up front so a bad URL never kills a valid one
    // mid-flight (reject the whole start instead, before any process spawns).
    for (const target of targetList) {
      if (!target || typeof target.targetId !== 'string' || !target.targetId.trim()) {
        ack?.({ success: false, error: 'Each destination needs a targetId' });
        return;
      }
      const fullUrl = resolveRtmpUrl(target.url, target.key);
      if (!isValidRtmpUrl(fullUrl)) {
        ack?.({ success: false, error: 'RTMP URL must start with rtmp:// or rtmps://' });
        return;
      }
      target._fullUrl = fullUrl;
    }

    const fmt = FORMATS.has(format) ? format : 'webm';
    const targetSessions = new Map();
    const results = [];

    for (const target of targetList) {
      const session = startSession({ targetId: target.targetId, fullUrl: target._fullUrl, format: fmt });
      targetSessions.set(target.targetId, session);
      results.push({ targetId: target.targetId, ok: true, url: target._fullUrl });
    }

    streams.set(socket.id, targetSessions);
    refreshRoomState(room);

    // Broadcast each live destination so everyone in the room sees what is
    // being pushed (the host's ack carries the same per-target results).
    targetList.forEach((target) => {
      io.to(room.id).emit('rtmp-started', { targetId: target.targetId, url: target._fullUrl });
    });

    ack?.({ success: true, results });
    targetList.forEach((target) => {
      console.log(`[RTMP] ${room.id}: live stream started -> ${target._fullUrl}`);
    });
  });

  socket.on('rtmp-chunk', ({ data, targetIds } = {}) => {
    const targetSessions = streams.get(socket.id);
    if (!targetSessions || targetSessions.size === 0) return;
    if (typeof data !== 'string' || data.length === 0) return;

    const buf = Buffer.from(data, 'base64');
    if (buf.length === 0) return;

    // Fan out to the requested destinations (default: all live ones).
    const ids = Array.isArray(targetIds) && targetIds.length
      ? targetIds
      : Array.from(targetSessions.keys());

    for (const id of ids) {
      const session = targetSessions.get(id);
      if (!session || session.dying) continue;
      if (session.queue.length > 0 || !session.proc.stdin.write(buf)) {
        session.queue.push(buf);
        if (session.queue.length > MAX_QUEUE_CHUNKS) {
          const message = 'Live stream fell too far behind and was stopped';
          teardownSession(session, message);
          io.to(session.roomId).emit('rtmp-error', { targetId: id, message });
        }
      }
    }
  });

  socket.on('stop-rtmp', (_payload, ack) => {
    const targetSessions = streams.get(socket.id);
    if (!targetSessions || targetSessions.size === 0) {
      ack?.({ success: false, error: 'No active stream' });
      return;
    }
    teardownAll(io, socket, targetSessions, null);
    ack?.({ success: true });
  });

  // If the host's socket drops, the compositor in their browser is gone -
  // kill the streams instead of pushing frozen frames.
  socket.on('disconnect', () => {
    const targetSessions = streams.get(socket.id);
    if (targetSessions && targetSessions.size) {
      teardownAll(io, socket, targetSessions, null);
    }
    streams.delete(socket.id);
  });
}

module.exports = { handleRtmp, resolveRtmpUrl, isValidRtmpUrl, buildFfmpegArgs };