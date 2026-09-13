// Broadcast overlay graphics config + the canvas renderer that draws them into
// the recorded / live-streamed output.
//
// The config shape below is the single source of truth shared by:
//   - the DOM overlay component (live in-meeting view, BroadcastOverlay.jsx)
//   - the host configuration panel (BroadcastConfig.jsx)
//   - the canvas compositor in recordingGrid.js (recording + RTMP stream),
//     which reads useStore().broadcastOverlay and calls drawBroadcastOverlay()
//     once per drawn frame.
//
// Persistence is deliberately client-side (localStorage), matching the RTMP
// URL/key pattern in RTMPStreamConfig.jsx - no server schema change is
// required, and the host's broadcast setup survives a page refresh. The host
// panel re-syncs the config to participants over the existing collab relay.
//
// All overlay dimensions are specified in the compositor's native 1920x1080
// canvas coordinates so the recorded/streamed output is deterministic; the
// DOM overlay scales them to the live container.

// Ticker separator between items, and the trailing gap (canvas px at 1920 wide)
// left between repeated loops so the marquee never appears to stall.
export const TICKER_ITEM_SEPARATOR = '      •      ';
export const TICKER_LOOP_GAP = 160;

// Multilingual font stack shared by the DOM overlay and the canvas compositor.
// Must cover Latin + Bengali + Devanagari (Hindi) on every OS the app runs on:
//   - Windows: Nirmala UI ships a full Bengali + Devanagari + Latin face;
//     Mangal (Devanagari) and Vrinda (Bengali) are legacy fallbacks.
//   - Android/ChromeOS/Linux: Noto Sans Bengali + Noto Sans Devanagari are the
//     standard system faces (Lohit is the older DejaVu-era fallback).
//   - macOS/iOS: Kohinoor Devi/Bengali are available; system-ui resolves to
//     San Francisco for Latin.
// Because the stack is a comma list, the browser/canvas performs per-glyph
// fallback: Latin renders in the first face, Bangla/Hindi glyphs fall through
// to the Bengali/Devanagari faces automatically.
export const BROADCAST_FONT_STACK =
  "'Inter','Segoe UI','Noto Sans Devanagari','Noto Sans Bengali','Nirmala UI'," +
  "'Kohinoor Devanagari','Kohinoor Bengali','Mangal','Vrinda','Lohit Devanagari','Lohit Bengali'," +
  'system-ui,sans-serif';

export const BROADCAST_OVERLAY_STORAGE_KEY = 'webinar-broadcast-overlay';

export const DEFAULT_BROADCAST_OVERLAY = {
  ticker: {
    enabled: false,
    // 'top' | 'bottom' edge of the frame
    position: 'bottom',
    // Ordered list of text items; the marquee scrolls them joined together.
    items: [],
    // Horizontal scroll speed in canvas px per second.
    speed: 90,
    // Strip height in canvas px (1080p space).
    height: 44,
    // Font size in canvas px.
    fontSize: 22,
    uppercase: false,
    bgColor: '#b91c1c',
    textColor: '#ffffff'
  },
  bug: {
    enabled: false,
    // data: URL (from the upload picker - always canvas-safe) or an http(s) URL.
    src: '',
    // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'custom'
    // 'custom' = free placement; the logo is drawn at canvas coords (x, y)
    // instead of a corner anchor.
    position: 'bottom-left',
    // Top-left corner of the logo in 1920x1080 canvas coords, used only when
    // position === 'custom' (drag-placed in the live overlay).
    x: 24,
    y: 24,
    // Longest edge in canvas px (1920-wide space) - height follows aspect ratio.
    width: 180,
    opacity: 0.85
  },
  supers: {
    enabled: false,
    // 'lower-left' | 'lower-center' | 'lower-right' | 'custom'
    // 'custom' = free placement; the panel is drawn at canvas coords (x, y)
    // like the bug logo instead of a pre-defined anchor.
    position: 'lower-left',
    // Top-left corner of the panel in 1920x1080 canvas coords, used only when
    // the resolved position is 'custom' (drag-placed in the live overlay).
    x: 24,
    y: 24,
    // Catalog of cueable lower-third graphics. activeIndex picks the one on air;
    // -1 means nothing is on air (manual CG-style cueing).
    // Each item may carry its own 'position' ('lower-left' | 'lower-center' |
    // 'lower-right' | 'custom'); empty string falls back to the section-level
    // position (dragging an item also clears its per-item position so the
    // section-level 'custom' x/y takes effect).
    items: [
      // { id: string, name: string, designation: string, headline: string, position: string }
    ],
    activeIndex: -1,
    fontSize: 30,
    uppercase: false,
    bgColor: '#0f172a',
    accentColor: '#f59e0b',
    textColor: '#ffffff',
    headlineColor: '#e2e8f0'
  }
};

// Deep-merge a persisted/partial config over the defaults. Items arrays and the
// bug src REPLACE wholesale (merging lists position-by-position would
// resurrect deleted entries); scalars fall back per-key. Unknown keys are kept
// so a newer config version downgrading into an older client survives intact.
export function mergeBroadcastOverlay(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base };
  for (const section of ['ticker', 'bug', 'supers']) {
    const p = patch[section];
    if (!p || typeof p !== 'object') continue;
    out[section] = section === 'supers'
      ? { ...out.supers, ...p }
      : { ...out[section], ...p };
  }
  return out;
}

// Clamp a numeric config field from an untrusted source (localStorage).
function toNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toBoolean(value) {
  return value === true;
}

function toString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

// Sanitize a parsed (untrusted) config object against the defaults so a
// hand-edited localStorage value can never break the canvas compositor.
export function sanitizeBroadcastOverlay(input) {
  const d = DEFAULT_BROADCAST_OVERLAY;
  const t = input?.ticker || {};
  const b = input?.bug || {};
  const s = input?.supers || {};
  return {
    ticker: {
      enabled: toBoolean(t.enabled),
      position: t.position === 'top' ? 'top' : 'bottom',
      items: Array.isArray(t.items)
        ? t.items.filter((i) => typeof i === 'string').map((i) => i.slice(0, 200)).slice(0, 200)
        : d.ticker.items,
      speed: toNumber(t.speed, d.ticker.speed, 20, 600),
      height: toNumber(t.height, d.ticker.height, 24, 160),
      fontSize: toNumber(t.fontSize, d.ticker.fontSize, 12, 96),
      uppercase: toBoolean(t.uppercase),
      bgColor: toString(t.bgColor, d.ticker.bgColor).slice(0, 32),
      textColor: toString(t.textColor, d.ticker.textColor).slice(0, 32)
    },
    bug: {
      enabled: toBoolean(b.enabled),
      src: toString(b.src, d.bug.src).slice(0, 4000000), // dataURLs can be large
      position: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'custom'].includes(b.position)
        ? b.position
        : d.bug.position,
      x: toNumber(b.x, d.bug.x, 0, 1920),
      y: toNumber(b.y, d.bug.y, 0, 1080),
      width: toNumber(b.width, d.bug.width, 24, 900),
      opacity: toNumber(b.opacity, d.bug.opacity, 0.1, 1)
    },
    supers: {
      enabled: toBoolean(s.enabled),
      position: ['lower-left', 'lower-center', 'lower-right', 'custom'].includes(s.position)
        ? s.position
        : d.supers.position,
      x: toNumber(s.x, d.supers.x, 0, 1920),
      y: toNumber(s.y, d.supers.y, 0, 1080),
      items: Array.isArray(s.items)
        ? s.items
            .filter((i) => i && typeof i === 'object')
            .map((i) => ({
              id: toString(i.id, ''),
              name: toString(i.name, '').slice(0, 120),
              designation: toString(i.designation, '').slice(0, 120),
              headline: toString(i.headline, '').slice(0, 200),
              position: ['lower-left', 'lower-center', 'lower-right', 'custom'].includes(i.position)
                ? i.position
                : ''
            }))
            .slice(0, 100)
        : d.supers.items,
      activeIndex: Math.max(-1, Math.min(
        Array.isArray(s.items) ? s.items.length - 1 : -1,
        Math.round(toNumber(s.activeIndex, d.supers.activeIndex, -1, 99))
      )),
      fontSize: toNumber(s.fontSize, d.supers.fontSize, 14, 120),
      uppercase: toBoolean(s.uppercase),
      bgColor: toString(s.bgColor, d.supers.bgColor).slice(0, 32),
      accentColor: toString(s.accentColor, d.supers.accentColor).slice(0, 32),
      textColor: toString(s.textColor, d.supers.textColor).slice(0, 32),
      headlineColor: toString(s.headlineColor, d.supers.headlineColor).slice(0, 32)
    }
  };
}

// localStorage is only defined in the browser; node:test has no DOM.
function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // privacy mode can throw on access
  }
}

export function loadBroadcastOverlay() {
  const store = storage();
  let parsed = null;
  if (store) {
    try {
      const raw = store.getItem(BROADCAST_OVERLAY_STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch {
      parsed = null; // corrupted config: fall through to defaults
    }
  }
  return parsed ? sanitizeBroadcastOverlay(parsed) : { ...DEFAULT_BROADCAST_OVERLAY };
}

export function saveBroadcastOverlay(overlay) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(BROADCAST_OVERLAY_STORAGE_KEY, JSON.stringify(overlay));
  } catch {
    // Quota exceeded (huge bug dataURL): drop the image but keep the rest.
    try {
      store.setItem(BROADCAST_OVERLAY_STORAGE_KEY, JSON.stringify({
        ...overlay,
        bug: { ...overlay.bug, src: '' }
      }));
    } catch {
      /* storage unavailable - the in-memory store still holds the config */
    }
  }
}

// -- Canonical ticker text helpers (panel <-> config) ------------------------

export function tickerItemsToText(items) {
  return (items || []).filter((i) => typeof i === 'string').join('\n');
}

export function textToTickerItems(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200);
}

// -- Canvas renderers --------------------------------------------------------
//
// Everything below draws in the compositor's native coordinates (1920x1080).
// The functions are pure with respect to `ctx`: given the same canvas state and
// config they produce the same frame, so the recording/stream compositor needs
// no extra bookkeeping - it just calls drawBroadcastOverlay() after the tiles.

// Module-level image cache: keyed by src so a config tweak (width/opacity/
// position) never re-fetches the logo. crossOrigin is set for http(s) URLs -
// without it, drawing a cross-origin image TAINTS the canvas and canvas
// capture produces blank/black frames; data: URLs (the upload path) are always
// safe and never tainted.
const imageCache = new Map();

function getLogoImage(src) {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src);
  if (typeof Image === 'undefined') return null; // node:test guard
  const img = new Image();
  if (/^data:/i.test(src)) {
    img.src = src;
  } else {
    // http(s) URL - the image MUST be served with CORS headers for canvas use.
    img.crossOrigin = 'anonymous';
    img.src = src;
  }
  imageCache.set(src, img);
  return img;
}

function imageReady(img) {
  return Boolean(img && img.naturalWidth > 0 && (img.naturalHeight || 0) > 0);
}

function roundedRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

// Vertical space the bottom/top ticker would occupy (canvas px), so other
// overlays can be nudged clear of it.
function tickerZoneHeight(overlay) {
  const t = overlay?.ticker;
  if (!t || !t.enabled || !t.items?.length) return 0;
  return t.height;
}

const CORNER_INSET = 24;

function cornerOrigin(position, width, height, frameW, frameH, tickerH, tickerAtTop) {
  const inset = CORNER_INSET;
  const pad = tickerH > 0 ? tickerH + 10 : 0; // keep clear of an active ticker
  const topInset = tickerAtTop ? inset + pad : inset;
  const bottomInset = !tickerAtTop && tickerH > 0 ? inset + pad : inset;
  switch (position) {
    case 'top-right': return { x: frameW - inset - width, y: topInset };
    case 'bottom-left': return { x: inset, y: frameH - bottomInset - height };
    case 'bottom-right': return { x: frameW - inset - width, y: frameH - bottomInset - height };
    case 'top-left':
    default: return { x: inset, y: topInset };
  }
}

function drawBug(ctx, width, height, overlay) {
  const bug = overlay.bug;
  const img = getLogoImage(bug.src);
  if (!imageReady(img)) return;

  const aspect = img.naturalHeight / img.naturalWidth;
  const bw = bug.width;
  const bh = bw * aspect;
  const tickerH = tickerZoneHeight(overlay);
  let x;
  let y;
  if (bug.position === 'custom') {
    // Drag-placed free position: clamp so the logo can never be pushed off
    // canvas (the DOM drag already clamps, this defends staggered storage).
    x = Math.min(Math.max(bug.x, 0), Math.max(0, width - bw));
    y = Math.min(Math.max(bug.y, 0), Math.max(0, height - bh));
  } else {
    ({ x, y } = cornerOrigin(
      bug.position,
      bw,
      bh,
      width,
      height,
      tickerH,
      overlay.ticker?.position === 'top'
    ));
  }

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0.1, bug.opacity));
  ctx.drawImage(img, x, y, bw, bh);
  ctx.restore();
}

function drawSupers(ctx, width, height, overlay) {
  const supers = overlay.supers;
  const item = supers.items[supers.activeIndex];
  if (!item || (!item.name && !item.designation && !item.headline)) return;

  // Per-item position overrides the section default ('' = inherit).
  const pos = item.position || supers.position;

  const fs = supers.fontSize;
  const padX = Math.round(fs * 0.6);
  const padY = Math.round(fs * 0.35);
  const accentW = Math.max(4, Math.round(fs * 0.22));
  const lineGap = Math.round(fs * 0.22);
  const nameSize = fs;
  const designationSize = Math.round(fs * 0.68);
  const headlineSize = Math.round(fs * 0.58);
  const hasHeadline = Boolean(item.headline);

  ctx.save();
  ctx.font = `600 ${nameSize}px ${BROADCAST_FONT_STACK}`;
  const nameW = ctx.measureText(item.name).width;
  ctx.font = `500 ${designationSize}px ${BROADCAST_FONT_STACK}`;
  const designationW = ctx.measureText(item.designation).width;
  ctx.font = `500 ${headlineSize}px ${BROADCAST_FONT_STACK}`;
  const headlineW = ctx.measureText(item.headline).width;

  const textW = Math.max(nameW, designationW, headlineW);
  const boxW = Math.min(width - 80, textW + padX * 2 + accentW);
  const boxH =
    padY * 2 +
    nameSize +
    lineGap +
    designationSize +
    (hasHeadline ? lineGap + headlineSize : 0);

  const tickerH = tickerZoneHeight(overlay);
  const bottomPx = height - (tickerH > 0 ? tickerH : 0) - CORNER_INSET;

  let x;
  let y;
  if (pos === 'custom') {
    // Drag-placed free position: clamp so the panel can never be pushed off
    // canvas or under the ticker (the DOM drag already clamps, this defends
    // staggered storage).
    x = Math.min(Math.max(Number(supers.x) || 0, 0), Math.max(0, width - boxW));
    y = Math.min(Math.max(Number(supers.y) || 0, 0), Math.max(0, bottomPx - boxH));
  } else if (pos === 'lower-center') {
    x = (width - boxW) / 2;
    y = bottomPx - boxH;
  } else if (pos === 'lower-right') {
    x = width - CORNER_INSET - boxW;
    y = bottomPx - boxH;
  } else {
    x = CORNER_INSET;
    y = bottomPx - boxH;
  }

  // Translucent panel + accent rail (news-style lower third).
  ctx.fillStyle = supers.bgColor;
  ctx.globalAlpha = 0.92;
  roundedRect(ctx, x, y, boxW, boxH, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = supers.accentColor;
  ctx.fillRect(x, y, accentW, boxH);

  const textX = x + accentW + padX;
  const baseY = y + padY;
  const applyCase = (str) => (supers.uppercase ? String(str).toUpperCase() : String(str));

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${nameSize}px ${BROADCAST_FONT_STACK}`;
  ctx.fillStyle = supers.textColor;
  ctx.fillText(applyCase(item.name), textX, baseY + nameSize);
  ctx.font = `500 ${designationSize}px ${BROADCAST_FONT_STACK}`;
  ctx.fillStyle = supers.accentColor;
  ctx.fillText(applyCase(item.designation), textX, baseY + nameSize + lineGap + designationSize);
  if (hasHeadline) {
    ctx.font = `500 ${headlineSize}px ${BROADCAST_FONT_STACK}`;
    ctx.fillStyle = supers.headlineColor;
    ctx.fillText(
      applyCase(item.headline),
      textX,
      baseY + nameSize + lineGap * 2 + designationSize + headlineSize
    );
  }
  ctx.restore();
}

function drawTicker(ctx, width, height, overlay, nowMs) {
  const ticker = overlay.ticker;
  const items = (ticker.items || []).filter((i) => i);
  if (!items.length) return;

  const y = ticker.position === 'top' ? 0 : height - ticker.height;
  ctx.save();
  ctx.fillStyle = ticker.bgColor;
  ctx.fillRect(0, y, width, ticker.height);

  ctx.font = `600 ${ticker.fontSize}px ${BROADCAST_FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const body = items.join(TICKER_ITEM_SEPARATOR);
  const loopW = ctx.measureText(body).width + TICKER_LOOP_GAP;
  const loop = Math.max(loopW, width); // never leave a blank right edge
  const offset = ((nowMs * ticker.speed) / 1000) % loop;
  const x = -offset;

  ctx.fillStyle = ticker.textColor;
  ctx.fillText(body, x, y + ticker.height / 2);
  ctx.fillText(body, x + loop, y + ticker.height / 2);
  ctx.restore();
}

/**
 * Draw every enabled overlay onto the compositor canvas. Safe to call every
 * frame - animation offsets derive from `nowMs` (performance.now()) so the
 * marquee stays smooth at the compositor's 30 FPS pacing with no state here.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width canvas width (1920)
 * @param {number} height canvas height (1080)
 * @param {object} overlay the store's broadcastOverlay config
 * @param {number} nowMs performance.now() at draw time
 */
export function drawBroadcastOverlay(ctx, width, height, overlay, nowMs) {
  if (!ctx || !overlay) return;
  if (overlay.supers?.enabled && overlay.supers.items?.length) {
    drawSupers(ctx, width, height, overlay);
  }
  if (overlay.ticker?.enabled && overlay.ticker.items?.length) {
    drawTicker(ctx, width, height, overlay, nowMs);
  }
  if (overlay.bug?.enabled && overlay.bug.src) {
    drawBug(ctx, width, height, overlay);
  }
}

// Make the internal caches reset-able for tests (and on hot reload).
export function __resetBroadcastOverlayCache() {
  imageCache.clear();
}