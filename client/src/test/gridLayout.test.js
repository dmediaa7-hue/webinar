import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, computeRecordingColumns, computePinnedLayout } from '../utils/gridLayout.js';

test('computeRecordingColumns thresholds', () => {
  assert.equal(computeRecordingColumns(1), 2);
  assert.equal(computeRecordingColumns(2), 2);
  assert.equal(computeRecordingColumns(4), 2);
  assert.equal(computeRecordingColumns(5), 3);
  assert.equal(computeRecordingColumns(9), 3);
  assert.equal(computeRecordingColumns(10), 4);
});

test('computePinnedLayout lays one camera across a single strip row', () => {
  const stripWidth = 576;
  const stripHeight = 1080;
  const layout = computePinnedLayout(stripWidth, stripHeight, 1);
  assert.equal(layout.cols, 1);
  assert.equal(layout.rows, 1);
  assert.ok(layout.cellW > 0);
  assert.ok(layout.cellH > 0);
  assert.equal(layout.cellW, stripWidth);
  assert.equal(layout.cellH, stripHeight);
});

test('computePinnedLayout stacks four cameras in the strip', () => {
  const stripWidth = 576;
  const stripHeight = 1080;
  const layout = computePinnedLayout(stripWidth, stripHeight, 4);
  assert.equal(layout.cols, 1);
  assert.equal(layout.rows, 4);
  assert.ok(layout.cellW > 0);
  assert.ok(layout.cellH > 0);
  assert.equal(layout.cellW, stripWidth);
  assert.equal(layout.cellH, stripHeight / 4);
});

test('computeLayout unchanged behavior for 2 participants', () => {
  const layout = computeLayout(2, 1920, 1080);
  assert.equal(layout.cols, 2);
  assert.equal(layout.rows, 1);
});

test('computeLayout unchanged behavior for 4 participants', () => {
  const layout = computeLayout(4, 1920, 1080);
  assert.equal(layout.cols, 2);
  assert.equal(layout.rows, 2);
});