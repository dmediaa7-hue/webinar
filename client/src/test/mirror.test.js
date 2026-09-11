import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldMirrorLocalVideo } from '../utils/mirror.js';

test('front camera mirrors', () => {
  assert.equal(shouldMirrorLocalVideo('user'), true);
});

test('desktop camera (no facing info) mirrors', () => {
  assert.equal(shouldMirrorLocalVideo(''), true);
  assert.equal(shouldMirrorLocalVideo(undefined), true);
  assert.equal(shouldMirrorLocalVideo(null), true);
});

test('rear camera never mirrors', () => {
  assert.equal(shouldMirrorLocalVideo('environment'), false);
  assert.equal(shouldMirrorLocalVideo('left'), false);
  assert.equal(shouldMirrorLocalVideo('right'), false);
  assert.equal(shouldMirrorLocalVideo('external'), false);
});