import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleScreenShare } from '../src/utils/liveKitShare.js';
import { computeGridMode, computeLayout } from '../src/utils/gridLayout.js';

test('toggleScreenShare publishes when not sharing', async () => {
  const calls = [];
  const fakeRoom = {
    localParticipant: {
      setScreenShareEnabled: async (enabled) => { calls.push(enabled); },
    },
  };
  const result = await toggleScreenShare(fakeRoom, false);
  assert.equal(result, true);
  assert.deepEqual(calls, [true]);
});

test('toggleScreenShare unpublishes when sharing', async () => {
  const calls = [];
  const fakeRoom = {
    localParticipant: {
      setScreenShareEnabled: async (enabled) => { calls.push(enabled); },
    },
  };
  await toggleScreenShare(fakeRoom, true);
  assert.deepEqual(calls, [false]);
});

test('toggleScreenShare no-ops without a room', async () => {
  assert.equal(await toggleScreenShare(null, false), false);
});

test('computeGridMode pins any screen share and stays uniform otherwise', () => {
  assert.equal(computeGridMode(0, 3), 'uniform');
  assert.equal(computeGridMode(1, 0), 'pinned');
  assert.equal(computeGridMode(2, 1), 'pinned');
  assert.equal(computeGridMode(0, 0), 'uniform');
});

test('computeLayout fits every tile', () => {
  const { cols, rows } = computeLayout(4, 1280, 720);
  assert.ok(cols * rows >= 4);
  const { cols: c2, rows: r2 } = computeLayout(9, 1920, 1080);
  assert.ok(c2 * r2 >= 9);
});