import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, PenTool } from 'lucide-react';
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
import useCollabChannel from '../../hooks/useCollabChannel';

export default function WhiteboardPanel({ onClose, roomId }) {
  const mySocketId = useStore((state) => state.mySocketId);
  const displayName = useStore((state) => state.displayName);

  const [restored, setRestored] = useState(null);
  const apiRef = useRef(null);
  const elementsRef = useRef([]);
  const lastSentRef = useRef([]);
  const seqRef = useRef(0);
  const lastSeqBySenderRef = useRef(new Map());
  const applyingRemoteRef = useRef(false);
  const broadcastTimerRef = useRef(null);
  const persistTimerRef = useRef(null);

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

  const handleIncoming = useCallback((payload) => {
    const decoded = decodeWhiteboardMessage(payload);
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

  const { send } = useCollabChannel('whiteboard', handleIncoming);
  const sendRef = useRef(send);
  sendRef.current = send;

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
      sendRef.current(encodeWhiteboardMessage(delta));
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
