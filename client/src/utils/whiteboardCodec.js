// Whiteboard message serialization (topic 'whiteboard').
// Pure ESM over globals (JSON / TextEncoder / TextDecoder) so node:test can
// import it directly, mirroring chatCodec/reactionCodec/pollCodec.
//
// Delta message shape:
//   {kind:'whiteboard', action:'scene-delta', seq, senderId, senderName,
//    changed:[excalidrawElement...], removed:[elementId...]}
//
// Reconciliation model (last-write-wins):
//  - Each sender issues monotonically increasing `seq`; a receiver drops any
//    delta whose seq <= last seq seen from that sender, so out-of-order or
//    replayed deltas are ignored and the newest state wins.
//  - Within a delta, elements are keyed by Excalidraw id: `changed` are
//    upserted (replace-or-append), `removed` are deleted by id. Applying a
//    delta twice is idempotent (merge keyed by id, never duplicated).

export const MAX_DELTA_ELEMENTS = 500;
export const MAX_REMOVED_IDS = 500;
export const MAX_NAME_LENGTH = 100;

function pick(list) {
  return (list || []).filter((el) => el && typeof el === 'object' && typeof el.id === 'string' && el.id);
}

function pickIds(list) {
  return (list || []).map((v) => String(v ?? '')).filter(Boolean).slice(0, MAX_REMOVED_IDS);
}

// --- Builders -------------------------------------------------------------

// Build a scene-delta message from the elements that changed plus the ids
// that were removed since the last broadcast.
export function buildWhiteboardDelta({ senderId, senderName = 'Guest', seq = 0, changed = [], removed = [] }) {
  return {
    kind: 'whiteboard',
    action: 'scene-delta',
    seq: Number.isFinite(Number(seq)) ? Number(seq) : 0,
    senderId: String(senderId || '').slice(0, MAX_NAME_LENGTH),
    senderName: String(senderName || 'Guest').slice(0, MAX_NAME_LENGTH),
    changed: pick(changed).slice(0, MAX_DELTA_ELEMENTS),
    removed: pickIds(removed).slice(0, MAX_REMOVED_IDS)
  };
}

// --- Diffing --------------------------------------------------------------

// Compare two element snapshots (arrays) and return what changed between
// them: elements that were added or modified, plus ids that were removed.
// Comparison is by id and Excalidraw's versionNonce (bumped on every edit),
// so untouched elements are skipped.
export function diffWhiteboardElements(prev, next) {
  const prevById = new Map((prev || []).map((el) => [el.id, el]));
  const nextById = new Map((next || []).map((el) => [el.id, el]));
  const changed = [];
  const removed = [];

  nextById.forEach((el, id) => {
    const before = prevById.get(id);
    if (!before || before.versionNonce !== el.versionNonce || before.version !== el.version) {
      changed.push(el);
    }
  });

  prevById.forEach((el, id) => {
    if (!nextById.has(id)) removed.push(id);
  });

  return { changed, removed };
}

// --- Merging --------------------------------------------------------------

// Apply a decoded delta onto the local element snapshot, returning a NEW
// array. Removed ids are filtered out; changed elements are inserted by id
// (replace existing, else append in the order they arrived). Idempotent.
// Cross-sender conflicts resolve by Excalidraw versionNonce: an older
// element version never overwrites a newer one the local client already has.
export function mergeWhiteboardElements(local, delta) {
  if (!delta || delta.action !== 'scene-delta') return local;
  const removed = new Set(delta.removed || []);
  const changed = delta.changed || [];
  const byId = new Map((local || []).filter((el) => !removed.has(el.id)).map((el) => [el.id, el]));

  changed.forEach((el) => {
    if (!el || typeof el.id !== 'string' || !el.id) return;
    const existing = byId.get(el.id);
    if (existing && (el.versionNonce ?? 0) < (existing.versionNonce ?? 0)) return;
    byId.set(el.id, el);
  });

  return Array.from(byId.values());
}

// --- Encode / decode ------------------------------------------------------

function encode(msg) {
  return new TextEncoder().encode(JSON.stringify(msg));
}

function toText(payload) {
  if (typeof payload === 'string') return payload;
  if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
  return null;
}

function parse(text) {
  try {
    const raw = JSON.parse(text);
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

export function encodeWhiteboardMessage(msg) {
  return encode(msg);
}

export function decodeWhiteboardMessage(payload) {
  const raw = parse(toText(payload));
  if (!raw || raw.kind !== 'whiteboard' || raw.action !== 'scene-delta') return null;
  return buildWhiteboardDelta(raw);
}

// --- Replay guard ---------------------------------------------------------

// Stale when the sender's seq is not ahead of the last one we applied, so
// out-of-order/replayed deltas are dropped (last-write-wins by sequence).
export function isStaleWhiteboardDelta(delta, lastSeqBySender) {
  if (!delta || delta.action !== 'scene-delta') return true;
  const last = lastSeqBySender.get(delta.senderId) ?? -1;
  return delta.seq <= last;
}

export function recordWhiteboardSeq(delta, lastSeqBySender) {
  if (!delta || delta.action !== 'scene-delta' || !delta.senderId) return;
  lastSeqBySender.set(delta.senderId, delta.seq);
}