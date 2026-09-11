// Local camera tiles render mirrored ONLY for front(-facing) cameras, so the
// self-view behaves like a mirror while real-world cameras (rear, external)
// show the raw viewfinder image. Facing values come from
// MediaStreamTrack.getSettings().facingMode:
//   'user'        -> front camera                  (mirror)
//   ''            -> desktop/external, no facing   (mirror: it is the device's
//                                                   front camera in practice)
//   'environment' -> rear camera                   (no mirror)
//   'left'/'right'-> dual rear cameras             (no mirror)
//   'external'    -> explicit external camera      (no mirror)
export function shouldMirrorLocalVideo(facingMode) {
  return !['environment', 'left', 'right', 'external'].includes(facingMode);
}