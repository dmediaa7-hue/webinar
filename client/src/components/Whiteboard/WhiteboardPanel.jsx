import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { X, PenTool } from 'lucide-react';
import { RoomContext, useDataChannel } from '@livekit/components-react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import useStore from '../../store/useStore';
import { SERVER_URL } from '../../utils/constants';
import {
  buildWhiteboardDelta,
  diffWhiteboardElements,
  mergeWhiteboardElements,
  encodeWhiteboardMessage,
  decodeWhiteboardMessage,
  isStaleWhiteboardDelta,
  recordWhiteboardSeq
} from '../../utils/whiteboardCodec';

// Bridges the LiveKit 'whiteboard' data channel: send is handed up so local
// edits can broadcast deltas (same pattern as PollChannel/ChatChannel).
function WhiteboardChannel({ onMessage, onSendReady }) {
  const { send } = useDataChannel('whiteboard', onMessage);

  useEffect(() => {
    onSendReady(send);
    return () => onSendReady(null);
  }, [send, onSendReady]);

  return null;
}

export default function WhiteboardPanel({ onClose, roomId }) {
  const liveKitRoom = useContext(RoomContext);
  const mySocketId = useStore((state) => state.mySocketId);
  const displayName = useStore((state) => state.displayName);

  // null while the persisted scene is loading; Excalidraw mounts after load.
  const [restored, setRestored] = useState(null);
  const sendRef = useRef(null);
  const apiRef = useRef(null);
  const elementsRef = useRef([]);          // current authoritative scene
  const lastSentRef = useRef([]);          // snapshot already broadcast
  const seqRef = useRef(0);                // our own monotonically increasing seq
  const lastSeqBySenderRef = useRef(new Map());
  const applyingRemoteRef = useRef(false); // echo guard: onChange during updateScene
  const broadcastTimerRef = useRef(null);
  const persistTimerRef = useRef(null);

  // Load the persisted scene on open so a refreshed client recovers it.
  useEffect(() => {
    let cancelled = false;
    fetch(`${SERVER_URL}/api/rooms/${roomId}/whiteboard`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const els = Array.isArray(data?.elements) ? data.elements : [];
        elementsRef.current = els;
        lastSentRef.current = els;
        setRestored(els);
      })
      .catch(() => {
        if (!cancelled) {
          elementsRef.current = [];
          lastSentRef.current = [];
          setRestored([]);
        }
      });
    return () => { cancelled = true; };
  }, [roomId]);

  // Incoming delta: drop stale/replayed senders, merge by id, then push into
  // the canvas. The echo guard makes the resulting onChange absorb rather
  // than rebroadcast what we just applied.
  const handleIncoming = useCallback((msg) => {
    const decoded = decodeWhiteboardMessage(msg.payload);
    if (!decoded) return;
    if (isStaleWhiteboardDelta(decoded, lastSeqBySenderRef.current)) return;
    recordWhiteboardSeq(decoded, lastSeqBySenderRef.current);
    const api = apiRef.current;
    if (!api) return;
    applyingRemoteRef.current = true;
    const merged = mergeWhiteboardElements(elementsRef.current, decoded);
    elementsRef.current = merged;
    lastSentRef.current = merged;
    api.updateScene({ elements: merged });
  }, []);

  // Local edit: throttle a delta broadcast (diff against the snapshot we
  // last sent, never the full scene each stroke) and debounce a full-scene
  // REST save for reload recovery.
  const scheduleBroadcast = useCallback(() => {
    if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
    broadcastTimerRef.current = setTimeout(() => {
      const { changed, removed } = diffWhiteboardElements(lastSentRef.current, elementsRef.current);
      if (!changed.length && !removed.length) return;
      seqRef.current += 1;
      const delta = buildWhiteboardDelta({
        senderId: mySocketId,
        senderName: displayName || 'Guest',
        seq: seqRef.current,
        changed,
        removed
      });
      sendRef.current?.(encodeWhiteboardMessage(delta), { reliable: true });
      lastSentRef.current = elementsRef.current;
    }, 200);
  }, [mySocketId, displayName]);

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      fetch(`${SERVER_URL}/api/rooms/${roomId}/whiteboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: mySocketId, elements: elementsRef.current })
      }).catch(() => {});
    }, 800);
  }, [roomId, mySocketId]);

  const handleSceneChange = useCallback((elements) => {
    elementsRef.current = elements;
    if (applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      lastSentRef.current = elements;
      return;
    }
    scheduleBroadcast();
    schedulePersist();
  }, [scheduleBroadcast, schedulePersist]);

  const markSendReady = useCallback((send) => {
    sendRef.current = send;
  }, []);

  // Clear pending timers; best-effort flush of the latest scene on close.
  useEffect(() => {
    return () => {
      if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      fetch(`${SERVER_URL}/api/rooms/${roomId}/whiteboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: mySocketId, elements: elementsRef.current })
      }).catch(() => {});
    };
  }, [roomId, mySocketId]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-meeting-bg border border-meeting-border rounded-lg overflow-hidden">
      {liveKitRoom && <WhiteboardChannel onMessage={handleIncoming} onSendReady={markSendReady} />}

      <div className="px-4 py-2.5 border-b border-meeting-border flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <PenTool size={16} className="text-primary" /> Whiteboard
        </h3>
        <button onClick={onClose} className="icon-btn text-gray-400 hover:text-white" aria-label="Close whiteboard">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {restored === null ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            Loading whiteboard…
          </div>
        ) : (
          <Excalidraw
            excalidrawAPI={(api) => { apiRef.current = api; }}
            onChange={handleSceneChange}
            initialData={{ elements: restored }}
          />
        )}
      </div>
    </div>
  );
}