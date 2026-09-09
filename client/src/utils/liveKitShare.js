// Screen-share publisher helper for LiveKit rooms.
// setScreenShareEnabled(true) triggers getDisplayMedia internally and
// resolves only after the user grants a capture source; it rejects when
// the picker is cancelled (caller decides whether to swallow that).

export async function toggleScreenShare(room, isSharing) {
  if (!room) return false;
  await room.localParticipant.setScreenShareEnabled(!isSharing);
  return true;
}