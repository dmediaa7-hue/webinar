// Unit tests for the broadcast-overlay config contract and render helpers.
// The canvas draw functions need a DOM (Image, measureText), so this suite
// covers the pure, dependency-free parts: defaults, sanitization, persistence
// round-trip, ticker text conversion, and that drawBroadcastOverlay() is a
// safe no-op without a canvas context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BROADCAST_OVERLAY,
  mergeBroadcastOverlay,
  sanitizeBroadcastOverlay,
  loadBroadcastOverlay,
  saveBroadcastOverlay,
  tickerItemsToText,
  textToTickerItems,
  drawBroadcastOverlay
} from '../utils/broadcastOverlay.js';

test('defaults: every overlay section is disabled with sensible news-style values', () => {
  assert.equal(DEFAULT_BROADCAST_OVERLAY.ticker.enabled, false);
  assert.equal(DEFAULT_BROADCAST_OVERLAY.ticker.position, 'bottom');
  assert.deepEqual(DEFAULT_BROADCAST_OVERLAY.ticker.items, []);
  assert.equal(DEFAULT_BROADCAST_OVERLAY.bug.enabled, false);
  assert.equal(DEFAULT_BROADCAST_OVERLAY.bug.src, '');
  assert.equal(DEFAULT_BROADCAST_OVERLAY.supers.activeIndex, -1);
  assert.deepEqual(DEFAULT_BROADCAST_OVERLAY.supers.items, []);
});

test('mergeBroadcastOverlay applies a partial patch over defaults, preserving shape', () => {
  const merged = mergeBroadcastOverlay(DEFAULT_BROADCAST_OVERLAY, {
    ticker: { enabled: true, items: ['A', 'B'] },
    bug: { src: 'data:image/png;base64,xxx', width: 300 }
  });
  assert.equal(merged.ticker.enabled, true);
  assert.deepEqual(merged.ticker.items, ['A', 'B']);
  assert.equal(merged.ticker.speed, DEFAULT_BROADCAST_OVERLAY.ticker.speed);
  assert.equal(merged.bug.src, 'data:image/png;base64,xxx');
  assert.equal(merged.bug.width, 300);
  assert.equal(merged.bug.opacity, DEFAULT_BROADCAST_OVERLAY.bug.opacity);
  assert.equal(merged.supers.enabled, false);
});

test('mergeBroadcastOverlay replaces item arrays wholesale (no position-wise merge)', () => {
  const base = sanitizeBroadcastOverlay({
    supers: { items: [{ id: 'x', name: 'Old', designation: '', headline: '' }] }
  });
  const merged = mergeBroadcastOverlay(base, {
    supers: { items: [{ id: 'y', name: 'New', designation: '', headline: '' }] }
  });
  assert.deepEqual(merged.supers.items.map((i) => i.id), ['y']);
});

test('sanitizeBroadcastOverlay clamps hostile values from localStorage', () => {
  const sanitized = sanitizeBroadcastOverlay({
    ticker: { speed: 99999, height: 'huge', enabled: 'yes', position: 'middle' },
    bug: { opacity: 50, width: -20, position: 'nowhere' },
    supers: { activeIndex: 100000, items: 'not-an-array' }
  });
  // 99999 is finite so it hits the max clamp (600), not the default fallback.
  assert.equal(sanitized.ticker.speed, 600);
  // 'huge' is NaN so it falls back to the default (44).
  assert.equal(sanitized.ticker.height, DEFAULT_BROADCAST_OVERLAY.ticker.height);
  assert.equal(sanitized.ticker.enabled, false);
  assert.equal(sanitized.ticker.position, 'bottom');
  assert.equal(sanitized.bug.opacity, 1);
  assert.equal(sanitized.bug.width, 24);
  assert.equal(sanitized.bug.position, 'bottom-left');
  assert.equal(sanitized.supers.activeIndex, -1);
  assert.deepEqual(sanitized.supers.items, []);
});

test('sanitizeBroadcastOverlay keeps a valid config intact', () => {
  const input = {
    ticker: { enabled: true, position: 'top', items: ['A', 'B'], speed: 120, height: 60, fontSize: 28, uppercase: true, bgColor: '#000', textColor: '#fff' },
    bug: { enabled: true, src: 'https://cdn.example.com/logo.png', position: 'top-right', x: 160, y: 90, width: 200, opacity: 0.5 },
    supers: {
      enabled: true,
      position: 'lower-center',
      items: [{ id: 'a', name: 'Jane Doe', designation: 'Editor', headline: 'Markets rally', position: 'lower-left' }],
      activeIndex: 0,
      fontSize: 32,
      bgColor: '#000', accentColor: '#f00', textColor: '#fff', headlineColor: '#ccc'
    }
  };
  const sanitized = sanitizeBroadcastOverlay(input);
  assert.deepEqual(sanitized, {
    ticker: { ...input.ticker },
    bug: { ...input.bug },
    supers: { enabled: true, position: 'lower-center', x: 24, y: 24, items: input.supers.items, activeIndex: 0, fontSize: 32, uppercase: false, bgColor: '#000', accentColor: '#f00', textColor: '#fff', headlineColor: '#ccc' }
  });
});

test('sanitizeBroadcastOverlay preserves custom placements and per-item super positions', () => {
  const sanitized = sanitizeBroadcastOverlay({
    bug: { position: 'custom', x: 900, y: 700 },
    supers: {
      position: 'custom',
      items: [
        { id: 'l', name: 'Left', designation: '', headline: '', position: 'lower-left' },
        { id: 'r', name: 'Right', designation: '', headline: '', position: 'lower-right' },
        { id: 'c', name: 'Custom', designation: '', headline: '', position: 'custom' },
        { id: 'd', name: 'Default', designation: '', headline: '', position: '' }
      ]
    }
  });
  assert.equal(sanitized.bug.position, 'custom');
  assert.equal(sanitized.bug.x, 900);
  assert.equal(sanitized.bug.y, 700);
  assert.equal(sanitized.supers.position, 'custom');
  // Section x/y default to a sane inset when not supplied by the patch.
  assert.equal(sanitized.supers.x, 24);
  assert.equal(sanitized.supers.y, 24);
  assert.deepEqual(sanitized.supers.items.map((i) => i.position), ['lower-left', 'lower-right', 'custom', '']);
});

test('sanitizeBroadcastOverlay clamps custom logo x/y into the canvas frame', () => {
  const sanitized = sanitizeBroadcastOverlay({
    bug: { position: 'custom', x: -100, y: 5000 }
  });
  assert.equal(sanitized.bug.position, 'custom');
  assert.equal(sanitized.bug.x, 0);
  assert.equal(sanitized.bug.y, 1080);
});

test('sanitizeBroadcastOverlay clamps custom super x/y into the canvas frame', () => {
  const sanitized = sanitizeBroadcastOverlay({
    supers: { position: 'custom', x: -100, y: 5000 }
  });
  assert.equal(sanitized.supers.position, 'custom');
  assert.equal(sanitized.supers.x, 0);
  assert.equal(sanitized.supers.y, 1080);
});

test('ticker text conversion is a lossless newline round-trip, trimming empties', () => {
  const items = ['Breaking: storm warning', 'Markets open higher', 'Traffic update'];
  assert.equal(tickerItemsToText(items), items.join('\n'));
  assert.deepEqual(textToTickerItems('  a \n\n b \n  '), ['a', 'b']);
  assert.deepEqual(textToTickerItems(''), []);
});

test('loadBroadcastOverlay returns defaults when storage is unavailable', () => {
  assert.deepEqual(loadBroadcastOverlay(), DEFAULT_BROADCAST_OVERLAY);
});

test('saveBroadcastOverlay is a safe no-op without storage', () => {
  assert.doesNotThrow(() => saveBroadcastOverlay({ ...DEFAULT_BROADCAST_OVERLAY }));
});

test('drawBroadcastOverlay is a safe no-op without a canvas context', () => {
  assert.doesNotThrow(() => drawBroadcastOverlay(null, 1920, 1080, DEFAULT_BROADCAST_OVERLAY, 0));
  assert.doesNotThrow(() => drawBroadcastOverlay({}, 1920, 1080, null, 0));
});