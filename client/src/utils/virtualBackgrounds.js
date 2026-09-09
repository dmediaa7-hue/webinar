// Virtual background helpers (task 11).
// Thin, pure wrappers over @livekit/track-processors so the UI logic stays
// testable without a browser/WebGL. The heavy package is only constructed
// through createBackgroundProcessor(), which is dependency-injectable so Node
// unit tests can pass fakes instead of the real (browser-only) factory.

import {
  BackgroundProcessor,
  supportsBackgroundProcessors
} from '@livekit/track-processors';

export const BACKGROUND_MODES = {
  NONE: 'none',
  BLUR: 'blur',
  IMAGE: 'image'
};

// Registry of selectable backgrounds, in display order.
export const BACKGROUND_OPTIONS = [
  { mode: BACKGROUND_MODES.NONE, label: 'None', description: 'Original background' },
  { mode: BACKGROUND_MODES.BLUR, label: 'Blur', description: 'Blur the background' },
  { mode: BACKGROUND_MODES.IMAGE, label: 'Image', description: 'Replace with an image' }
];

export const DEFAULT_BLUR_RADIUS = 12;

/**
 * Whether the current browser can run background processors (WebGL /
 * canvas / wasm support). Must be guarded in try/catch: the underlying
 * check can throw in non-browser environments.
 */
export function isBackgroundSupported(supportFn = supportsBackgroundProcessors) {
  try {
    return supportFn() === true;
  } catch {
    return false;
  }
}

/**
 * Normalize a raw mode value to one of BACKGROUND_MODES.
 * Unknown/empty values fall back to NONE.
 */
export function resolveBackgroundMode(mode) {
  return BACKGROUND_OPTIONS.some((o) => o.mode === mode)
    ? mode
    : BACKGROUND_MODES.NONE;
}

/**
 * Build a background processor for the given mode, or null when the
 * browser cannot support processors / the mode is NONE / an image mode
 * has no imagePath. `factory` defaults to the real BackgroundProcessor
 * and is injectable for tests.
 */
export function createBackgroundProcessor(
  mode,
  imagePath = null,
  factory = BackgroundProcessor,
  supportFn = supportsBackgroundProcessors
) {
  if (!isBackgroundSupported(supportFn)) return null;
  const resolved = resolveBackgroundMode(mode);
  if (resolved === BACKGROUND_MODES.NONE) return null;

  if (resolved === BACKGROUND_MODES.BLUR) {
    return factory({ mode: 'background-blur', blurRadius: DEFAULT_BLUR_RADIUS });
  }
  if (resolved === BACKGROUND_MODES.IMAGE && imagePath) {
    return factory({ mode: 'virtual-background', imagePath });
  }
  return null;
}