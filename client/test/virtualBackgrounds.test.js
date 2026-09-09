import { test } from 'node:test';
import assert from 'node:assert';
import {
  BACKGROUND_MODES,
  BACKGROUND_OPTIONS,
  DEFAULT_BLUR_RADIUS,
  isBackgroundSupported,
  resolveBackgroundMode,
  createBackgroundProcessor
} from '../src/utils/virtualBackgrounds.js';

// Fakes for the browser-only track-processors module.
const fakeFactory = (options) => ({ fake: true, options });
const supportTrue = () => true;
const supportFalse = () => false;

test('option registry exposes none/blur/image with stable modes', () => {
  assert.deepEqual(
    BACKGROUND_OPTIONS.map((o) => o.mode),
    [BACKGROUND_MODES.NONE, BACKGROUND_MODES.BLUR, BACKGROUND_MODES.IMAGE]
  );
  assert.equal(BACKGROUND_OPTIONS.length, 3);
});

test('isBackgroundSupported proxies the support function and guards throws', () => {
  assert.equal(isBackgroundSupported(supportTrue), true);
  assert.equal(isBackgroundSupported(supportFalse), false);
  assert.equal(isBackgroundSupported(() => { throw new Error('no webgl'); }), false);
  assert.equal(isBackgroundSupported(() => 'true'), false, 'non-boolean truthy ignored');
});

test('resolveBackgroundMode normalizes unknown/empty input to none', () => {
  assert.equal(resolveBackgroundMode(BACKGROUND_MODES.BLUR), BACKGROUND_MODES.BLUR);
  assert.equal(resolveBackgroundMode('garbage'), BACKGROUND_MODES.NONE);
  assert.equal(resolveBackgroundMode(null), BACKGROUND_MODES.NONE);
  assert.equal(resolveBackgroundMode(undefined), BACKGROUND_MODES.NONE);
});

test('createBackgroundProcessor returns null when unsupported', () => {
  const result = createBackgroundProcessor(
    BACKGROUND_MODES.BLUR,
    null,
    fakeFactory,
    supportFalse
  );
  assert.equal(result, null);
});

test('createBackgroundProcessor returns null for none mode', () => {
  const result = createBackgroundProcessor(
    BACKGROUND_MODES.NONE,
    null,
    fakeFactory,
    supportTrue
  );
  assert.equal(result, null);
});

test('blur mode builds a background-blur processor with default radius', () => {
  const result = createBackgroundProcessor(
    BACKGROUND_MODES.BLUR,
    null,
    fakeFactory,
    supportTrue
  );
  assert.deepEqual(result, {
    fake: true,
    options: { mode: 'background-blur', blurRadius: DEFAULT_BLUR_RADIUS }
  });
});

test('image mode requires an imagePath and builds a virtual-background processor', () => {
  const missing = createBackgroundProcessor(
    BACKGROUND_MODES.IMAGE,
    null,
    fakeFactory,
    supportTrue
  );
  assert.equal(missing, null, 'no imagePath -> null');

  const built = createBackgroundProcessor(
    BACKGROUND_MODES.IMAGE,
    'blob:bg-1',
    fakeFactory,
    supportTrue
  );
  assert.deepEqual(built, {
    fake: true,
    options: { mode: 'virtual-background', imagePath: 'blob:bg-1' }
  });
});

test('unknown mode falls back to none (no processor built)', () => {
  const result = createBackgroundProcessor('garbage', null, fakeFactory, supportTrue);
  assert.equal(result, null);
});