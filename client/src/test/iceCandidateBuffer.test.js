import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bufferCandidate, drainCandidates, clearCandidates, clearAllCandidates } from '../utils/iceCandidateBuffer.js';

test('bufferCandidate queues candidates per socket in arrival order', () => {
  const pending = new Map();
  bufferCandidate(pending, 's1', { candidate: 'a' });
  bufferCandidate(pending, 's1', { candidate: 'b' });
  bufferCandidate(pending, 's2', { candidate: 'c' });

  assert.deepEqual(pending.get('s1'), [{ candidate: 'a' }, { candidate: 'b' }]);
  assert.deepEqual(pending.get('s2'), [{ candidate: 'c' }]);
});

test('drainCandidates returns the queued list and empties the bucket', () => {
  const pending = new Map();
  bufferCandidate(pending, 's1', 'a');
  bufferCandidate(pending, 's1', 'b');

  assert.deepEqual(drainCandidates(pending, 's1'), ['a', 'b']);
  assert.equal(pending.has('s1'), false);
  assert.deepEqual(drainCandidates(pending, 's1'), []);
});

test('clearCandidates removes only the addressed socket', () => {
  const pending = new Map();
  bufferCandidate(pending, 's1', 'a');
  bufferCandidate(pending, 's2', 'b');

  clearCandidates(pending, 's1');
  assert.equal(pending.has('s1'), false);
  assert.equal(pending.has('s2'), true);
});

test('clearAllCandidates empties every bucket', () => {
  const pending = new Map();
  bufferCandidate(pending, 's1', 'a');
  bufferCandidate(pending, 's2', 'b');

  clearAllCandidates(pending);
  assert.equal(pending.size, 0);
});