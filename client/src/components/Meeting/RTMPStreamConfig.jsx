import React, { useEffect, useRef, useState } from 'react';
import { Radio, X } from 'lucide-react';
import socket from '../../hooks/useSocket';
import useStore from '../../store/useStore';
import { EVENTS } from '../../utils/constants';
import { createRtmpPublisher } from '../../utils/rtmpPublisher';

const SAVED_URL = localStorage.getItem('webinar-rtmp-url') || '';
const SAVED_KEY = localStorage.getItem('webinar-rtmp-key') || '';

export default function RTMPStreamConfig({ roomId }) {
  const isHost = useStore((s) => s.isHost);
  const isStreaming = useStore((s) => s.isStreaming);
  const setIsStreaming = useStore((s) => s.setIsStreaming);
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState(SAVED_URL);
  const [key, setKey] = useState(SAVED_KEY);
  const [pending, setPending] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const publisherRef = useRef(null);

  useEffect(() => {
    publisherRef.current = createRtmpPublisher({
      socket,
      roomId,
      onStatus: (status, message) => {
        if (status === 'live') {
          setIsStreaming(true);
          setPending(false);
          setStatusMsg('');
        } else if (status === 'stopped') {
          setIsStreaming(false);
          setPending(false);
          setStatusMsg('Live stream stopped');
          setTimeout(() => setStatusMsg(''), 5000);
        } else if (status === 'error') {
          setIsStreaming(false);
          setPending(false);
          setStatusMsg(message || 'Live stream error');
        }
      }
    });
    return () => {
      publisherRef.current?.stop();
      publisherRef.current = null;
    };
  }, [roomId, setIsStreaming]);

  // Server-driven events (FFmpeg died, stream torn down, etc.). Kept as a
  // separate effect so re-renders never re-subscribe the shared socket.
  useEffect(() => {
    const onStarted = () => {
      setIsStreaming(true);
      setPending(false);
      setStatusMsg('');
    };
    const onStopped = () => {
      setIsStreaming(false);
      setPending(false);
    };
    const onError = ({ message } = {}) => {
      setStatusMsg(message || 'Live stream ended unexpectedly');
      setIsStreaming(false);
      setPending(false);
      publisherRef.current?.stop();
    };

    socket.on(EVENTS.RTMP_STARTED, onStarted);
    socket.on(EVENTS.RTMP_STOPPED, onStopped);
    socket.on(EVENTS.RTMP_ERROR, onError);
    return () => {
      socket.off(EVENTS.RTMP_STARTED, onStarted);
      socket.off(EVENTS.RTMP_STOPPED, onStopped);
      socket.off(EVENTS.RTMP_ERROR, onError);
    };
  }, [setIsStreaming]);

  if (!isHost) return null;

  const handleStart = () => {
    setStatusMsg('');
    setPending(true);
    localStorage.setItem('webinar-rtmp-url', url.trim());
    localStorage.setItem('webinar-rtmp-key', key.trim());
    publisherRef.current?.start({ url: url.trim(), key: key.trim() });
  };

  const handleStop = () => {
    setPending(true);
    publisherRef.current?.stop();
  };

  return (
    <div className="max-w-3xl mx-auto px-2 sm:px-4 pb-1">
      {expanded ? (
        <div className="bg-meeting-card border border-meeting-border rounded-lg p-2 shadow-lg mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide">
              <Radio size={12} className="text-red-500" />
              Live Stream (RTMP)
            </span>
            <button
              onClick={() => setExpanded(false)}
              className="p-1 rounded text-gray-400 hover:text-white shrink-0"
              aria-label="Close live stream settings"
            >
              <X size={14} />
            </button>
          </div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Stream URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isStreaming}
            placeholder="rtmp://a.rtmp.youtube.com/live2"
            className="w-full bg-meeting-bg border border-meeting-border rounded px-2 py-1 text-xs text-gray-200 font-mono focus:outline-none focus:border-primary/50 disabled:opacity-50"
          />
          <label className="block text-[10px] text-gray-500 uppercase tracking-wide mt-2 mb-1">Stream Key</label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={isStreaming}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            className="w-full bg-meeting-bg border border-meeting-border rounded px-2 py-1 text-xs text-gray-200 font-mono focus:outline-none focus:border-primary/50 disabled:opacity-50"
          />
          <div className="flex items-center gap-2 mt-2">
            {isStreaming || pending ? (
              <button
                onClick={handleStop}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-xs font-semibold text-white transition-colors"
              >
                Stop Live Stream
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={!url.trim() || !key.trim()}
                className="px-3 py-1.5 rounded bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold text-white transition-colors"
              >
                Start Live Stream
              </button>
            )}
            {isStreaming && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
                <span className="w-2 h-2 rounded-full bg-red-500 recording-pulse" />
                LIVE
              </span>
            )}
            {pending && !isStreaming && (
              <span className="text-xs text-gray-400">Starting…</span>
            )}
          </div>
          {statusMsg && (
            <p className="mt-1.5 text-[10px] text-gray-400 truncate">{statusMsg}</p>
          )}
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className={`mb-2 flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border transition-colors ${
            isStreaming
              ? 'bg-red-600/20 border-red-500/40 text-red-400'
              : 'bg-meeting-card border-meeting-border text-gray-300 hover:text-white'
          }`}
          title="Live stream this meeting to an RTMP destination (YouTube, Twitch, etc.)"
        >
          <Radio size={14} className={isStreaming ? 'recording-pulse text-red-500' : ''} />
          {isStreaming ? 'Live Stream Active' : 'Live Stream'}
        </button>
      )}
    </div>
  );
}