// Caption segmentation helpers (task 10).
// LiveKit transcription agents publish text streams on the 'transcription'
// data topic; each segment carries attributes:
//   lk.segment_id          - stable id shared by interim + final updates
//   lk.transcription_final - 'true' once the agent confirms the segment
// The raw feed from useTranscriptions() can contain multiple updates for the
// same segment; consumers must merge by segment id so the final text replaces
// the interim text in place. These helpers are pure and unit-tested.

export const CAPTION_SEGMENT_ATTR = 'lk.segment_id';
export const CAPTION_FINAL_ATTR = 'lk.transcription_final';

/**
 * Merge raw transcription text streams into stable caption segments.
 * One entry per segment id (latest text wins, isFinal reflects the newest
 * state); streams without lk.segment_id fall back to the stream id.
 * Segments are returned oldest-first by stream timestamp.
 *
 * @param {Array<object>} textStreams - TextStreamData[] from useTranscriptions()
 * @returns {Array<{id: string, identity: string, text: string, isFinal: boolean, timestamp: number}>}
 */
export function toCaptionSegments(textStreams = []) {
  const byId = new Map();

  for (const stream of textStreams || []) {
    if (!stream?.streamInfo?.id || !stream.text) continue;
    const attrs = stream.streamInfo.attributes || {};
    const segmentId = attrs[CAPTION_SEGMENT_ATTR] || stream.streamInfo.id;
    const rawFinal = attrs[CAPTION_FINAL_ATTR];
    const isFinal = rawFinal === true || rawFinal === 'true';

    const existing = byId.get(segmentId);
    byId.set(segmentId, {
      id: segmentId,
      identity: stream.participantInfo?.identity || 'unknown',
      text: stream.text,
      isFinal,
      timestamp: stream.streamInfo.timestamp ?? existing?.timestamp ?? 0
    });
  }

  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}