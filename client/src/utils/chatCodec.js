// Chat message serialization. Pure ESM over globals
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

// Socket.io delivers binary attachments (Uint8Array encoded by the sender)
// to the receiver as ArrayBuffer — normalize every binary container.
function payloadToBytes(payload) {
  if (payload instanceof Uint8Array) return new Uint8Array(payload);
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  return null;
}

export function decodeChatMessage(payload) {
  let text;
  if (typeof payload === 'string') {
    text = payload;
  } else {
    const bytes = payloadToBytes(payload);
    if (!bytes) return null;
    text = new TextDecoder().decode(bytes);
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