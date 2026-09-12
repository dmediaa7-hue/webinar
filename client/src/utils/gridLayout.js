// Grid layout helpers for the meeting video grid.

// Compute the layout that maximizes equal tile size for `count` participants
// inside a container of `width` x `height`. Tiles keep a ~16:9 target ratio;
// more columns are preferred on ties (landscape-friendly).
export function computeLayout(count, width, height, tileAspect = 16 / 9) {
  if (count <= 0) return { cols: 1, rows: 1 };
  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const tileW = Math.min(width / cols, (tileAspect * height) / rows);
    if (!best || tileW > best.tileW || (tileW === best.tileW && cols > best.cols)) {
      best = { cols, rows, tileW, tileH: tileW / tileAspect };
    }
  }
  return best;
}

// Decide the grid mode: any active screen-share tile pins the layout (the
// screen dominates; cameras drop to a side strip). No screen share -> uniform.
export function computeGridMode(screenCount, cameraCount) {
  if (screenCount > 0) return 'pinned';
  return 'uniform';
}

// Recording column thresholds (recording spec): how many columns the recording
// canvas compositor uses for a uniform grid of `count` tiles.
export function computeRecordingColumns(count) {
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

// Fit `cameraCount` camera tiles into a right-hand strip of stripWidth x
// stripHeight. Reuses computeLayout so tile sizing matches the live grid;
// cellW/cellH are the gap-free fill sizes for the whole strip.
export function computePinnedLayout(stripWidth, stripHeight, cameraCount) {
  const layout = cameraCount <= 0 ? { cols: 1, rows: 1 } : computeLayout(cameraCount, stripWidth, stripHeight);
  return {
    cols: layout.cols,
    rows: layout.rows,
    cellW: stripWidth / layout.cols,
    cellH: stripHeight / layout.rows
  };
}