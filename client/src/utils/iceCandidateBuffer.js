// Pending ICE candidate queue, keyed by remote socket id.
// Candidates that arrive before a peer object exists (e.g. while createPeer
// awaits getIceConfig) are held here and drained once the peer is up, because
// simple-peer only buffers candidates internally AFTER the peer exists.

export function bufferCandidate(pending, socketId, candidate) {
  const list = pending.get(socketId) || [];
  list.push(candidate);
  pending.set(socketId, list);
}

export function drainCandidates(pending, socketId) {
  const list = pending.get(socketId) || [];
  pending.delete(socketId);
  return list;
}

export function clearCandidates(pending, socketId) {
  pending.delete(socketId);
}

export function clearAllCandidates(pending) {
  pending.clear();
}