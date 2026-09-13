// Deterministic P2P initiator selection: for a given (myId, theirId) pair both
// endpoints compute the SAME answer, so exactly one side ever sends an offer -
// no glare regardless of join order. Tie (same id) and missing ids fall back to
// answerer so a lone peer never deadlocks waiting on itself.

export function shouldInitiate(mySocketId, theirSocketId) {
  if (!mySocketId || !theirSocketId || mySocketId === theirSocketId) return false;
  return mySocketId < theirSocketId;
}