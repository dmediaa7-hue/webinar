import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWhiteboardDelta,
  diffWhiteboardElements,
  mergeWhiteboardElements,
  encodeWhiteboardMessage,
  decodeWhiteboardMessage,
  isStaleWhiteboardDelta,
  recordWhiteboardSeq
} from '../src/utils/whiteboardCodec.js';

function el(id, versionNonce, version = 1, extra = {}) {
  return { id, type: 'rectangle', x: 0, y: 0, width: 100, height: 50, strokeColor: '#000', version, versionNonce, ...extra };
}

test('scene-delta round-trips through encode/decode', () => {
  const msg = buildWhiteboardDelta({
    senderId: 'sock-1',
    senderName: 'Host A',
    seq: 3,
    changed: [el('e1', 2), el('e2', 5)],
    removed: ['e3']
  });
  const decoded = decodeWhiteboardMessage(encodeWhiteboardMessage(msg));

  assert.ok(decoded, 'decodes to an object');
  assert.equal(decoded.kind, 'whiteboard');
  assert.equal(decoded.action, 'scene-delta');
  assert.equal(decoded.seq, 3);
  assert.equal(decoded.senderId, 'sock-1');
  assert.equal(decoded.senderName, 'Host A');
  assert.equal(decoded.changed.length, 2);
  assert.equal(decoded.changed[0].id, 'e1');
  assert.equal(decoded.changed[0].versionNonce, 2);
  assert.deepEqual(decoded.removed, ['e3']);
});

test('scene-delta decodes ArrayBuffer payloads (Socket.io binary wire format)', () => {
  const msg = buildWhiteboardDelta({
    senderId: 'sock-1',
    senderName: 'Host A',
    seq: 3,
    changed: [el('e1', 2)],
    removed: ['e3']
  });
  const wire = encodeWhiteboardMessage(msg).slice().buffer;
  assert.ok(wire instanceof ArrayBuffer, 'sender bytes land as ArrayBuffer on the wire');
  const decoded = decodeWhiteboardMessage(wire);
  assert.ok(decoded, 'decodes to an object');
  assert.equal(decoded.seq, 3);
  assert.equal(decoded.changed[0].id, 'e1');
  assert.deepEqual(decoded.removed, ['e3']);
});

test('decode rejects malformed messages', () => {
  assert.equal(decodeWhiteboardMessage(encodeWhiteboardMessage({ kind: 'chat', text: 'hi' })), null);
  assert.equal(decodeWhiteboardMessage(encodeWhiteboardMessage({ kind: 'whiteboard', action: 'full-scene' })), null);
  assert.equal(decodeWhiteboardMessage(new Uint8Array([1, 2, 3])), null);
  assert.equal(decodeWhiteboardMessage('not-json'), null);
  assert.equal(decodeWhiteboardMessage(null), null);
  assert.equal(decodeWhiteboardMessage(''), null);
});

test('diff detects added, changed, and removed elements', () => {
  const prev = [el('a', 1), el('b', 1), el('c', 1)];
  const next = [el('a', 1), el('b', 2), el('d', 1)];
  const { changed, removed } = diffWhiteboardElements(prev, next);

  assert.deepEqual(changed.map((e) => e.id), ['b', 'd'], 'b modified + d added');
  assert.deepEqual(removed, ['c'], 'c deleted');
});

test('diff skips untouched elements', () => {
  const prev = [el('a', 1), el('b', 1)];
  const next = [el('a', 1), el('b', 1), el('c', 1)];
  const { changed, removed } = diffWhiteboardElements(prev, next);
  assert.deepEqual(changed.map((e) => e.id), ['c']);
  assert.deepEqual(removed, []);
});

test('serialized delta applies to a second component instance (acceptance)', () => {
  const instanceA = [el('a', 1), el('b', 1), el('c', 1)];
  const instanceB = [el('a', 1), el('b', 1), el('c', 1)];

  const nextA = [el('a', 1), el('b', 2), el('c', 1), el('d', 1)];
  const delta = buildWhiteboardDelta({
    senderId: 'sock-1',
    seq: 1,
    changed: diffWhiteboardElements(instanceA, nextA).changed,
    removed: diffWhiteboardElements(instanceA, nextA).removed
  });

  const wire = decodeWhiteboardMessage(encodeWhiteboardMessage(delta));
  const mergedB = mergeWhiteboardElements(instanceB, wire);

  const byId = (arr) => Object.fromEntries(arr.map((e) => [e.id, e.versionNonce]));
  assert.deepEqual(byId(mergedB), byId(nextA), 'B converges to A after applying the delta');
});

test('two clients drawing independently converge after exchanging deltas', () => {
  const shared = [el('base', 1)];
  const clientA = [...shared];
  const clientB = [...shared];

  const nextA = [...clientA, el('from-a', 1)];
  const nextB = [...clientB, el('from-b', 1)];
  const deltaA = buildWhiteboardDelta({ senderId: 'a', seq: 1, changed: diffWhiteboardElements(clientA, nextA).changed, removed: [] });
  const deltaB = buildWhiteboardDelta({ senderId: 'b', seq: 1, changed: diffWhiteboardElements(clientB, nextB).changed, removed: [] });

  const aHasB = mergeWhiteboardElements(nextA, decodeWhiteboardMessage(encodeWhiteboardMessage(deltaB)));
  const bHasA = mergeWhiteboardElements(nextB, decodeWhiteboardMessage(encodeWhiteboardMessage(deltaA)));

  const ids = (arr) => arr.map((e) => e.id).sort();
  const byIdSorted = (arr) => [...arr].sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(ids(aHasB), ['base', 'from-a', 'from-b']);
  assert.deepEqual(ids(bHasA), ['base', 'from-a', 'from-b']);
  assert.deepEqual(byIdSorted(aHasB), byIdSorted(bHasA), 'both clients hold the identical scene (content-wise)');
});

test('merge is idempotent: applying the same delta twice does not duplicate', () => {
  const local = [el('a', 1)];
  const delta = buildWhiteboardDelta({ senderId: 's', seq: 1, changed: [el('b', 1)], removed: [] });

  const once = mergeWhiteboardElements(local, delta);
  const twice = mergeWhiteboardElements(once, delta);
  assert.equal(once.length, 2);
  assert.equal(twice.length, 2, 'no duplicate entries after re-apply');
});

test('merge replaces an element with the same id (last-write-wins on element)', () => {
  const local = [el('a', 1)];
  const delta = buildWhiteboardDelta({ senderId: 's', seq: 1, changed: [el('a', 9)], removed: [] });
  const merged = mergeWhiteboardElements(local, delta);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].versionNonce, 9);
});

test('older remote element never overwrites a newer local one (cross-sender conflict)', () => {
  const local = [el('a', 7)];
  const staleRemote = buildWhiteboardDelta({ senderId: 'other', seq: 1, changed: [el('a', 3)], removed: [] });
  const merged = mergeWhiteboardElements(local, staleRemote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].versionNonce, 7, 'the local newer version stays');
});

test('merge honors removed ids', () => {
  const local = [el('a', 1), el('b', 1)];
  const delta = buildWhiteboardDelta({ senderId: 's', seq: 1, changed: [], removed: ['a'] });
  const merged = mergeWhiteboardElements(local, delta);
  assert.deepEqual(merged.map((e) => e.id), ['b']);
});

test('stale detection drops replayed and out-of-order deltas', () => {
  const lastSeqBySender = new Map();
  const d1 = buildWhiteboardDelta({ senderId: 'a', seq: 1, changed: [el('x', 1)], removed: [] });
  const d2 = buildWhiteboardDelta({ senderId: 'a', seq: 2, changed: [el('x', 2)], removed: [] });
  const d2replay = buildWhiteboardDelta({ senderId: 'a', seq: 2, changed: [el('x', 2)], removed: [] });

  assert.equal(isStaleWhiteboardDelta(d1, lastSeqBySender), false);
  recordWhiteboardSeq(d1, lastSeqBySender);
  assert.equal(isStaleWhiteboardDelta(d2, lastSeqBySender), false);
  recordWhiteboardSeq(d2, lastSeqBySender);
  assert.equal(isStaleWhiteboardDelta(d2replay, lastSeqBySender), true, 'replay of seq 2 after 2 seen is stale');

  const older = buildWhiteboardDelta({ senderId: 'a', seq: 1, changed: [el('x', 99)], removed: [] });
  assert.equal(isStaleWhiteboardDelta(older, lastSeqBySender), true, 'out-of-order older delta is dropped');
});

test('stale drop keeps the newest element state (last-write-wins)', () => {
  const lastSeqBySender = new Map();
  let local = [el('x', 1)];

  const fresh = buildWhiteboardDelta({ senderId: 'a', seq: 2, changed: [el('x', 2)], removed: [] });
  const replayed = buildWhiteboardDelta({ senderId: 'a', seq: 1, changed: [el('x', 99)], removed: [] });

  // Panel flow: drop stale deltas BEFORE merging, record seq only for applied ones.
  if (!isStaleWhiteboardDelta(fresh, lastSeqBySender)) {
    local = mergeWhiteboardElements(local, fresh);
    recordWhiteboardSeq(fresh, lastSeqBySender);
  }
  if (!isStaleWhiteboardDelta(replayed, lastSeqBySender)) {
    local = mergeWhiteboardElements(local, replayed);
    recordWhiteboardSeq(replayed, lastSeqBySender);
  }
  assert.equal(local[0].versionNonce, 2, 'stale element state never overwrites newer state');
});