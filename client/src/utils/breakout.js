// Breakout rooms (task 12) - client side of the multi-room simulation.
// The server provisions breakout rooms and moves participants via
// host-gated REST endpoints (x-host-id header = the host's socket.id).
// fetchImpl is injectable so the unit tests never touch the network.
// API base mirrors constants.js SERVER_URL, guarded for node:test where
// import.meta.env is absent (tests always inject fetchImpl).
const viteEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const API_BASE = viteEnv.VITE_SERVER_URL || (viteEnv.DEV ? 'http://localhost:3001' : '');

/** Breakout label a given identity is currently assigned to, derived from assignments (or null). */
export function breakoutRoomLabel(assignments, identity) {
  if (!Array.isArray(assignments) || !identity) return null;
  const entry = assignments.find((a) => a.identity === identity);
  return entry?.breakoutName || null;
}

/** Smallest positive sequence number not claimed by an existing breakout. */
export function nextBreakoutNumber(breakouts) {
  const used = (breakouts || [])
    .map((b) => Number(b?.name))
    .filter((n) => Number.isInteger(n) && n > 0);
  let n = 1;
  while (used.includes(n)) n += 1;
  return n;
}

/** Breakout label a given participant identity is currently assigned to (or null). */
export function participantBreakoutName(assignments, identity) {
  if (!Array.isArray(assignments)) return null;
  const entry = assignments.find((a) => a.identity === identity);
  return entry?.breakoutName || null;
}

async function request(path, { method = 'GET', hostId, body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(hostId ? { 'x-host-id': hostId } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Fetch the persisted breakout layout for a room (host only). */
export function listBreakouts(roomId, hostId, fetchImpl = fetch) {
  return request(`/api/rooms/${roomId}/breakouts`, { hostId, fetchImpl });
}

/** Provision a breakout room; name optional (auto-numbered). */
export function createBreakout(roomId, hostId, name, fetchImpl = fetch) {
  return request(`/api/rooms/${roomId}/breakouts`, {
    method: 'POST',
    hostId,
    body: { name: name || null },
    fetchImpl
  });
}

/** Move a participant into a breakout room. */
export function assignBreakout(roomId, hostId, identity, breakoutName, fetchImpl = fetch) {
  return request(`/api/rooms/${roomId}/breakouts/assign`, {
    method: 'POST',
    hostId,
    body: { identity, name: breakoutName },
    fetchImpl
  });
}

/** Move a participant back to the main room. */
export function returnBreakout(roomId, hostId, identity, fetchImpl = fetch) {
  return request(`/api/rooms/${roomId}/breakouts/return`, {
    method: 'POST',
    hostId,
    body: { identity },
    fetchImpl
  });
}

/** End all breakouts: everyone returns to main and the rooms are deleted. */
export function teardownBreakouts(roomId, hostId, fetchImpl = fetch) {
  return request(`/api/rooms/${roomId}/breakouts/teardown`, {
    method: 'POST',
    hostId,
    fetchImpl
  });
}