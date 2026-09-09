import { test } from 'node:test';
import assert from 'node:assert';
import { toCaptionSegments, CAPTION_SEGMENT_ATTR, CAPTION_FINAL_ATTR } from '../src/utils/captions.js';

// Build a TextStreamData-shaped object the same way a LiveKit transcription
// agent publishes it (streamInfo.attributes carry lk.segment_id +
// lk.transcription_final).
function makeStream({ segmentId, text, final = false, timestamp = 1000, streamId = 'st-1', identity = 'user-1' }) {
  const attributes = {};
  if (segmentId !== undefined) attributes[CAPTION_SEGMENT_ATTR] = segmentId;
  if (final !== undefined) attributes[CAPTION_FINAL_ATTR] = final;
  return {
    text,
    participantInfo: { identity },
    streamInfo: { id: streamId, topic: 'transcription', timestamp, attributes }
  };
}

test('interim segments merge into the final segment with the same id', () => {
  const interim = makeStream({ segmentId: 'seg-1', text: 'Hello wor', final: false, timestamp: 1000 });
  const final = makeStream({ segmentId: 'seg-1', text: 'Hello world', final: true, timestamp: 2000 });

  const segments = toCaptionSegments([interim, final]);

  assert.equal(segments.length, 1, 'one segment per segment id');
  assert.equal(segments[0].id, 'seg-1');
  assert.equal(segments[0].text, 'Hello world', 'final text wins');
  assert.equal(segments[0].isFinal, true, 'final flag flips on the confirmed segment');
  assert.equal(segments[0].identity, 'user-1');
});

test('empty or null feed yields an empty array (Captions unavailable state)', () => {
  assert.deepEqual(toCaptionSegments([]), []);
  assert.deepEqual(toCaptionSegments(null), []);
  assert.deepEqual(toCaptionSegments(undefined), []);
});

test('streams without lk.segment_id fall back to the stream id', () => {
  const stream = makeStream({ segmentId: undefined, text: 'fallback', final: false, streamId: 'stream-abc' });

  const segments = toCaptionSegments([stream]);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].id, 'stream-abc');
});

test('string "true" transcription_final is honored as final', () => {
  const attributes = { [CAPTION_FINAL_ATTR]: 'true' };
  const stream = {
    text: 'done',
    participantInfo: { identity: 'user-1' },
    streamInfo: { id: 'st-1', attributes, timestamp: 1000 }
  };

  const segments = toCaptionSegments([stream]);

  assert.equal(segments[0].isFinal, true);
});

test('distinct segments from multiple speakers are kept and sorted by timestamp', () => {
  const a = makeStream({ segmentId: 'seg-a', text: 'First', final: true, timestamp: 1000, identity: 'speaker-a' });
  const b = makeStream({ segmentId: 'seg-b', text: 'Second', final: false, timestamp: 3000, identity: 'speaker-b' });

  const segments = toCaptionSegments([b, a]);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].identity, 'speaker-a', 'oldest first');
  assert.equal(segments[1].identity, 'speaker-b');
  assert.equal(segments[1].isFinal, false, 'non-final kept as interim');
});

test('empty streams are skipped without crashing', () => {
  const segments = toCaptionSegments([null, undefined, {}, { text: '', streamInfo: { id: 'x' } }]);
  assert.deepEqual(segments, []);
});