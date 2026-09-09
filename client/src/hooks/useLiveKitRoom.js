import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { SERVER_URL } from '../utils/constants';

/**
 * LiveKit room plumbing hook.
 * Fetches a short-lived token from the backend, connects to the LiveKit SFU,
 * publishes local camera/mic, and exposes room state + connect/disconnect.
 */
export function useLiveKitRoom() {
  const roomRef = useRef(null);
  const [token, setToken] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [isConfigured, setIsConfigured] = useState(null); // null = unknown
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Check whether the backend has LiveKit configured (health endpoint).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/livekit/status`);
        const data = await res.json();
        if (!cancelled) setIsConfigured(Boolean(data.configured));
      } catch {
        if (!cancelled) setIsConfigured(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchToken = useCallback(async (roomName, identity, name, roomAdmin) => {
    const params = new URLSearchParams({ room: roomName, identity });
    if (name) params.set('name', name);
    if (roomAdmin) params.set('roomAdmin', '1');
    const res = await fetch(`${SERVER_URL}/api/livekit/token?${params.toString()}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Failed to get LiveKit token');
      err.code = data.code;
      throw err;
    }
    return data;
  }, []);

  /**
   * Connect to a LiveKit room and publish local tracks.
   * @param {object} opts { roomName, identity, name, roomAdmin, audio, video }
   * @returns {Promise<Room>}
   */
  const connect = useCallback(async ({ roomName, identity, name, roomAdmin = false, audio = true, video = true }) => {
    setIsConnecting(true);
    setError('');
    try {
      const { token: tk, serverUrl: url } = await fetchToken(roomName, identity, name, roomAdmin);
      setToken(tk);
      setServerUrl(url);

      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.Connected, () => setIsConnected(true));
      room.on(RoomEvent.Disconnected, () => setIsConnected(false));
      room.on(RoomEvent.MediaDevicesError, (err) => setError(err.message));

      await room.connect(url, tk);
      await room.localParticipant.setMicrophoneEnabled(audio);
      await room.localParticipant.setCameraEnabled(video);

      setIsConnected(true);
      setIsConnecting(false);
      return room;
    } catch (err) {
      setError(err.message || 'Unable to connect');
      setIsConnecting(false);
      setIsConnected(false);
      throw err;
    }
  }, [fetchToken]);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setIsConnected(false);
    setToken(null);
    setIsConnecting(false);
  }, []);

  useEffect(() => {
    return () => {
      if (roomRef.current) {
        try { roomRef.current.disconnect(); } catch { /* already closed */ }
        roomRef.current = null;
      }
    };
  }, []);

  return {
    token,
    serverUrl,
    isConfigured,
    isConnected,
    isConnecting,
    error,
    room: roomRef.current,
    connect,
    disconnect
  };
}