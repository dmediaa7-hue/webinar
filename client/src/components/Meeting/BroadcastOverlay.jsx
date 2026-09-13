import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useStore from '../../store/useStore';
import useCollabChannel from '../../hooks/useCollabChannel';
import { EVENTS } from '../../utils/constants';
import {
  TICKER_ITEM_SEPARATOR,
  TICKER_LOOP_GAP,
  BROADCAST_FONT_STACK,
  sanitizeBroadcastOverlay,
  saveBroadcastOverlay
} from '../../utils/broadcastOverlay';

// The live in-meeting view of the broadcast graphics (ticker / bug / super).
// The same config the canvas compositor bakes into recordings and RTMP streams
// (see utils/broadcastOverlay.js) is rendered here in DOM so the host and all
// participants see exactly what is being captured, live on top of the tiles.
//
// All sizes come straight from the config, which is expressed in the
// compositor's native 1920x1080 coordinates, so the DOM copy is a single
// uniformly-scaled duplicate of the canvas layout (same anchors, same insets,
// same "keep clear of the ticker" nudges) rather than a separate design.
const DESIGN_W = 1920;
const DESIGN_H = 1080;
const CORNER_INSET = 24;

// Mirrors the tickerZoneHeight() nudge in utils/broadcastOverlay.js: overlays
// sharing an edge with an active ticker sit clear of it by its strip height.
function tickerZoneHeight(overlay) {
  const t = overlay?.ticker;
  if (!t || !t.enabled || !t.items?.length) return 0;
  return t.height;
}

function applyCase(text, uppercase) {
  return uppercase ? String(text).toUpperCase() : String(text);
}

// Full-width scrolling strip. The track holds TWO copies of [body + trailing
// gap]; the .broadcast-ticker-track CSS animation slides it -50%, which is
// exactly one copy, so the loop is seamless. Duration = loop width / speed,
// the same math the canvas uses (offset = nowMs * speed / 1000 mod loopW).
function Ticker({ overlay }) {
  const ticker = overlay.ticker;
  const items = (ticker.items || []).filter(Boolean);
  const [bodyWidth, setBodyWidth] = useState(0);
  const measureRef = useRef(null);

  const body = applyCase(items.join(TICKER_ITEM_SEPARATOR), ticker.uppercase);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (el) setBodyWidth(el.offsetWidth);
  }, [body, ticker.fontSize]);

  if (!items.length) return null;

  const loopW = bodyWidth + TICKER_LOOP_GAP;
  const durationSec = loopW > 0 && ticker.speed > 0 ? loopW / ticker.speed : 0;
  const isTop = ticker.position === 'top';
  // The visible text must carry the exact same font (family/size/weight) as
  // the hidden measuring copy, otherwise config font-size changes move the
  // measure box without the rendered glyphs following.
  const textStyle = {
    fontFamily: BROADCAST_FONT_STACK,
    fontWeight: 600,
    fontSize: ticker.fontSize,
    lineHeight: 1
  };

  return (
    <div
      className="absolute left-0 right-0 flex items-center overflow-hidden"
      style={{
        top: isTop ? 0 : undefined,
        bottom: isTop ? undefined : 0,
        height: ticker.height,
        backgroundColor: ticker.bgColor
      }}
    >
      {/* Hidden measuring copy: same font, same transformed text */}
      <span
        ref={measureRef}
        aria-hidden="true"
        className="absolute invisible whitespace-nowrap"
        style={textStyle}
      >
        {body}
      </span>
      {durationSec > 0 ? (
        <div
          className="broadcast-ticker-track"
          style={{ animationDuration: `${durationSec}s` }}
        >
          <span style={{ paddingRight: TICKER_LOOP_GAP, ...textStyle }}>{body}</span>
          <span style={{ paddingRight: TICKER_LOOP_GAP, ...textStyle }}>{body}</span>
        </div>
      ) : null}
    </div>
  );
}

// Corner-anchored logo/bug, inset like the canvas (CORNER_INSET) and nudged
// clear of an active ticker on the same edge. In 'custom' mode the host can
// drag the logo anywhere inside the frame; the placement (x/y canvas coords)
// is written back to the store like any other config change, so participants
// and the recording compositor see the same free position.
function Bug({ overlay, dragEnabled, send }) {
  const bug = overlay.bug;
  const setBroadcastOverlay = useStore((s) => s.setBroadcastOverlay);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  if (!bug.src) return null;

  const tickerH = tickerZoneHeight(overlay);
  const tickerAtTop = overlay.ticker?.position === 'top';
  const topInset = tickerAtTop ? CORNER_INSET + tickerH : CORNER_INSET;
  const bottomInset = !tickerAtTop && tickerH > 0 ? CORNER_INSET + tickerH : CORNER_INSET;

  const style = {
    position: 'absolute',
    width: bug.width,
    opacity: bug.opacity
  };
  if (bug.position === 'custom') {
    style.left = bug.x;
    style.top = bug.y;
  } else {
    switch (bug.position) {
      case 'top-right': style.top = topInset; style.right = CORNER_INSET; break;
      case 'bottom-left': style.bottom = bottomInset; style.left = CORNER_INSET; break;
      case 'bottom-right': style.bottom = bottomInset; style.right = CORNER_INSET; break;
      case 'top-left':
      default: style.top = topInset; style.left = CORNER_INSET; break;
    }
  }

  // Host drag: the img sits inside the 1920x1080 stage that is CSS-scaled to
  // the container, so pointer deltas convert to design coords by /scale. Only
  // the host drags; participants keep pointer-events: none (container default).
  if (dragEnabled) {
    style.pointerEvents = 'auto';
    style.cursor = dragging ? 'grabbing' : 'grab';
    style.touchAction = 'none';
  }

  const onPointerDown = (e) => {
    if (!dragEnabled) return;
    e.preventDefault();
    const img = e.currentTarget;
    const stage = img.parentElement;
    const scale = stage.getBoundingClientRect().width / DESIGN_W;
    const h = img.naturalHeight && img.naturalWidth
      ? bug.width * (img.naturalHeight / img.naturalWidth)
      : 0;
    dragRef.current = {
      startX: bug.x,
      startY: bug.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      scale,
      maxX: Math.max(0, DESIGN_W - bug.width),
      maxY: Math.max(0, DESIGN_H - h)
    };
    img.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = Math.min(Math.max(
      drag.startX + (e.clientX - drag.startClientX) / drag.scale, 0), drag.maxX);
    const y = Math.min(Math.max(
      drag.startY + (e.clientY - drag.startClientY) / drag.scale, 0), drag.maxY);
    // Live local feedback while dragging; broadcast once on release.
    setBroadcastOverlay({
      ...useStore.getState().broadcastOverlay,
      bug: { ...useStore.getState().broadcastOverlay.bug, position: 'custom', x, y }
    });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag) return;
    const next = sanitizeBroadcastOverlay(useStore.getState().broadcastOverlay);
    setBroadcastOverlay(next);
    saveBroadcastOverlay(next);
    send(next);
  };

  return (
    <img
      src={bug.src}
      alt=""
      draggable={false}
      className="select-none"
      style={style}
      onPointerDown={dragEnabled ? onPointerDown : undefined}
      onPointerMove={dragEnabled ? onPointerMove : undefined}
      onPointerUp={dragEnabled ? onPointerUp : undefined}
      onPointerCancel={dragEnabled ? onPointerUp : undefined}
    />
  );
}

// Cueable lower-third (news SUPER/CG): translucent panel, accent rail on the
// left, name / designation / headline stacked - mirrors drawSupers(). In
// 'custom' mode the host can drag the panel anywhere inside the frame; the
// placement (x/y canvas coords) is written back to the store like any other
// config change, so participants and the recording compositor see the same
// free position (same contract as the Bug above).
function Supers({ overlay, dragEnabled, send }) {
  const supers = overlay.supers;
  const item = supers.items[supers.activeIndex];
  if (!item || (!item.name && !item.designation && !item.headline)) return null;

  // Per-item position overrides the section default ('' = inherit).
  const pos = item.position || supers.position;

  const fs = supers.fontSize;
  const padX = Math.round(fs * 0.6);
  const padY = Math.round(fs * 0.35);
  const accentW = Math.max(4, Math.round(fs * 0.22));
  const lineGap = Math.round(fs * 0.22);

  const boxStyle = {
    position: 'absolute',
    maxWidth: DESIGN_W - 80,
    // box-sizing: border-box makes the content start at accent rail + padX,
    // exactly where the canvas places its text (x + accentW + padX).
    padding: `${padY}px ${padX}px`,
    backgroundColor: supers.bgColor,
    opacity: 0.92,
    borderRadius: 6,
    borderLeft: `${accentW}px solid ${supers.accentColor}`,
    boxSizing: 'border-box',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: lineGap
  };
  if (pos === 'custom') {
    boxStyle.left = Number(supers.x) || 0;
    boxStyle.top = Number(supers.y) || 0;
  } else {
    boxStyle.bottom = tickerZoneHeight(overlay) + CORNER_INSET;
    if (pos === 'lower-center') {
      boxStyle.left = '50%';
      boxStyle.transform = 'translateX(-50%)';
    } else if (pos === 'lower-right') {
      boxStyle.right = CORNER_INSET;
    } else {
      boxStyle.left = CORNER_INSET;
    }
  }

  const tickerH = tickerZoneHeight(overlay);
  // Same y ceiling drawSupers() applies to custom placement: keep the panel
  // above an active bottom ticker and off the very edge.
  const bottomPx = DESIGN_H - (tickerH > 0 ? tickerH : 0) - CORNER_INSET;

  // Host drag: the box sits inside the 1920x1080 stage that is CSS-scaled to
  // the container, so pointer deltas convert to design coords by /scale. Only
  // the host drags; participants keep pointer-events: none (container default).
  const setBroadcastOverlay = useStore((s) => s.setBroadcastOverlay);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  if (dragEnabled) {
    boxStyle.pointerEvents = 'auto';
    boxStyle.cursor = dragging ? 'grabbing' : 'grab';
    boxStyle.touchAction = 'none';
    boxStyle.userSelect = 'none';
  }

  const onPointerDown = (e) => {
    if (!dragEnabled) return;
    e.preventDefault();
    const box = e.currentTarget;
    const stage = box.parentElement;
    const scale = stage.getBoundingClientRect().width / DESIGN_W;
    // offsetLeft/offsetTop/offsetWidth/offsetHeight are layout values in the
    // unscaled stage space = design px already; only clientX needs /scale.
    const boxW = box.offsetWidth;
    const centeringShift = pos === 'lower-center' ? boxW / 2 : 0;
    dragRef.current = {
      startX: box.offsetLeft - centeringShift,
      startY: box.offsetTop,
      startClientX: e.clientX,
      startClientY: e.clientY,
      scale,
      maxX: Math.max(0, DESIGN_W - boxW),
      maxY: Math.max(0, bottomPx - box.offsetHeight)
    };
    box.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = Math.min(Math.max(
      drag.startX + (e.clientX - drag.startClientX) / drag.scale, 0), drag.maxX);
    const y = Math.min(Math.max(
      drag.startY + (e.clientY - drag.startClientY) / drag.scale, 0), drag.maxY);
    // Live local feedback while dragging; broadcast once on release.
    const st = useStore.getState();
    const sup = st.broadcastOverlay.supers;
    setBroadcastOverlay({
      ...st.broadcastOverlay,
      supers: {
        ...sup,
        position: 'custom',
        x,
        y,
        // Clearing the dragged item's per-item position makes the section-level
        // custom x/y apply (a leftover per-item 'lower-*' would override it).
        items: sup.items.map((it, idx) =>
          idx === sup.activeIndex ? { ...it, position: '' } : it
        )
      }
    });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag) return;
    const next = sanitizeBroadcastOverlay(useStore.getState().broadcastOverlay);
    setBroadcastOverlay(next);
    saveBroadcastOverlay(next);
    send(next);
  };

  const line = (size, weight, color, content) => ({
    fontFamily: BROADCAST_FONT_STACK,
    fontWeight: weight,
    fontSize: size,
    lineHeight: 1.1,
    color,
    whiteSpace: 'nowrap'
  });

  return (
    <div
      className="broadcast-super-enter"
      style={boxStyle}
      onPointerDown={dragEnabled ? onPointerDown : undefined}
      onPointerMove={dragEnabled ? onPointerMove : undefined}
      onPointerUp={dragEnabled ? onPointerUp : undefined}
      onPointerCancel={dragEnabled ? onPointerUp : undefined}
    >
      {item.name ? (
        <div style={line(fs, 600, supers.textColor, applyCase(item.name, supers.uppercase))}>
          {applyCase(item.name, supers.uppercase)}
        </div>
      ) : null}
      {item.designation ? (
        <div style={line(Math.round(fs * 0.68), 500, supers.accentColor, applyCase(item.designation, supers.uppercase))}>
          {applyCase(item.designation, supers.uppercase)}
        </div>
      ) : null}
      {item.headline ? (
        <div style={line(Math.round(fs * 0.58), 500, supers.headlineColor, applyCase(item.headline, supers.uppercase))}>
          {applyCase(item.headline, supers.uppercase)}
        </div>
      ) : null}
    </div>
  );
}

export default function BroadcastOverlay() {
  const overlay = useStore((s) => s.broadcastOverlay);
  const setBroadcastOverlay = useStore((s) => s.setBroadcastOverlay);
  const isHost = useStore((s) => s.isHost);
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);

  // Participants receive the host's graphics config over the existing collab
  // relay and re-render the same overlay - no per-client setup, no server
  // changes. Sanitize because the payload crossed the socket.
  const { send } = useCollabChannel(EVENTS.BROADCAST_OVERLAY_CHANNEL, (payload) => {
    setBroadcastOverlay(sanitizeBroadcastOverlay(payload));
  });

  const hasGraphics = Boolean(
    (overlay.ticker?.enabled && overlay.ticker?.items?.length) ||
    (overlay.bug?.enabled && overlay.bug?.src) ||
    (overlay.supers?.enabled && overlay.supers?.items?.length)
  );

  // The container mounts only when graphics are enabled, so an empty-deps
  // effect would bail on mount and width would stay 0, hiding the overlay.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setWidth(rect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasGraphics]);

  if (!hasGraphics) return null;

  const scale = width / DESIGN_W;
  // Anchor the stage to the edge the ticker occupies so the strip hugs the
  // container edge exactly like it hugs the 1080p frame in the compositor.
  const anchorTop = Boolean(overlay.ticker?.enabled && overlay.ticker?.position === 'top');

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden pointer-events-none z-20"
      aria-hidden="true"
    >
      <div
        className="absolute"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          left: 0,
          top: anchorTop ? 0 : undefined,
          bottom: anchorTop ? undefined : 0,
          transform: `scale(${scale})`,
          transformOrigin: anchorTop ? 'top left' : 'bottom left'
        }}
      >
        {overlay.ticker?.enabled && overlay.ticker.items?.length ? <Ticker overlay={overlay} /> : null}
        {overlay.supers?.enabled && overlay.supers.items?.length ? <Supers overlay={overlay} dragEnabled={isHost} send={send} /> : null}
        {overlay.bug?.enabled && overlay.bug.src ? <Bug overlay={overlay} dragEnabled={isHost} send={send} /> : null}
      </div>
    </div>
  );
}