// LiveKit data-channel chat serialization. Pure ESM over globals
// (JSON / TextEncoder / TextDecoder) so node:test can import it directly.
// Message schema: {id, sender, senderId, message, timestamp, isHost}

export function createMessageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function buildChatMessage({ sender, senderId, message, isHost = false, id, timestamp }) {
  return {
    id: id || createMessageId(),
    sender: String(sender || 'Guest').slice(0, 100),
    senderId: String(senderId || '').slice(0, 100),
    message: String(message || ''),
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
    isHost: Boolean(isHost)
  };
}

export function encodeChatMessage(msg) {
  return new TextEncoder().encode(JSON.stringify(msg));
}

export function decodeChatMessage(payload) {
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
    return {
      id: String(raw.id ?? ''),
      sender: String(raw.sender ?? 'Guest'),
      senderId: String(raw.senderId ?? ''),
      message: String(raw.message ?? ''),
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
      isHost: Boolean(raw.isHost)
    };
  } catch (err) {
    return null;
  }
}