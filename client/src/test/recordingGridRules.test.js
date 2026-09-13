import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecordingColumns } from '../utils/gridLayout.js';

// Effective recording grid = recordingGrid.js draw() rule: a lone participant
// fills the frame (1x1); otherwise columns come from computeRecordingColumns
// and rows are ceil(count / cols).
const effectiveRecordingGrid = (count) => {
  const cols = count === 1 ? 1 : computeRecordingColumns(count);
  return { cols, rows: Math.ceil(count / cols) };
};

test('recording grid matches the spec layout table for 1-16 participants', () => {
  const expected = {
    1: [1, 1],
    2: [2, 1],
    3: [2, 2],
    4: [2, 2],
    5: [3, 2],
    6: [3, 2],
    7: [3, 3],
    8: [3, 3],
    9: [3, 3],
    10: [4, 3],
    11: [4, 3],
    12: [4, 3],
    13: [4, 4],
    14: [4, 4],
    15: [4, 4],
    16: [4, 4]
  };
  for (const [count, [cols, rows]] of Object.entries(expected)) {
    const grid = effectiveRecordingGrid(Number(count));
    assert.deepEqual([grid.cols, grid.rows], [cols, rows], `participant count ${count}`);
  }
});