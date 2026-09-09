// LiveKit data-channel reaction serialization. Pure ESM over globals
// (JSON / TextEncoder / TextDecoder / Date) so node:test can import it
// directly. Message schema: {id, type:'emoji', emoji, sender, senderId, ts}
// Reactions are ephemeral — they are never persisted.

export const REACTION_TTL_MS = 2500;
export const REACTION_TYPE = 'emoji';
export const MAX_VISIBLE_PER_PARTICIPANT = 3;
export const MAX_RECENT = 8;

export function createReactionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Truncate by Unicode code points (not UTF-16 units) so ZWJ emoji sequences
// are not torn on a cheap half-codepoint boundary.
function truncateCodepoints(value, max) {
  return Array.from(String(value)).slice(0, max).join('');
}

export function buildReaction({ emoji, sender = 'Guest', senderId = '', ts, id }) {
  return {
    id: id || createReactionId(),
    type: REACTION_TYPE,
    emoji: truncateCodepoints(emoji || '', 8),
    sender: String(sender || 'Guest').slice(0, 100),
    senderId: String(senderId || '').slice(0, 100),
    ts: typeof ts === 'number' ? ts : Date.now()
  };
}

export function encodeReaction(reaction) {
  return new TextEncoder().encode(JSON.stringify(reaction));
}

export function decodeReaction(payload) {
  let text;
  if (typeof payload === 'string') {
    text = payload;
  } else if (payload instanceof Uint8Array) {
    text = new TextDecoder().decode(payload);
  } else {
    return null;
  }
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object') return null;
    const emoji = Array.from(String(raw.emoji ?? '')).slice(0, 8).join('');
    if (!emoji) return null;
    return {
      id: String(raw.id ?? '').slice(0, 64) || createReactionId(),
      type: raw.type === REACTION_TYPE ? REACTION_TYPE : REACTION_TYPE,
      emoji,
      sender: String(raw.sender ?? 'Guest').slice(0, 100),
      senderId: String(raw.senderId ?? '').slice(0, 100),
      ts: typeof raw.ts === 'number' ? raw.ts : Date.now()
    };
  } catch (err) {
    return null;
  }
}

// Capped burst: keep at most `max` concurrent bubbles per participant.
export function capReactions(list, max = MAX_VISIBLE_PER_PARTICIPANT) {
  return (list || []).slice(-max);
}

// View filter: drop any reaction older than REACTION_TTL_MS. Keeps the
// store-timer cleanup idempotent with the render pass (no stale bubbles even
// if a prune timer is delayed).
export function filterActiveReactions(list, now = Date.now()) {
  return (list || []).filter((r) => now - r.ts < REACTION_TTL_MS);
}

// Lightweight recent-reactions history, newest first, capped at `max` entries.
export function pushRecentReaction(list, emoji, sender, max = MAX_RECENT) {
  const entry = { emoji: truncateCodepoints(emoji || '', 8), sender: String(sender || 'Guest').slice(0, 100), ts: Date.now() };
  return [entry, ...(list || [])].slice(0, max);
}