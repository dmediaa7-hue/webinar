import { useState, useEffect, useCallback, useRef } from 'react';
import { MEDIA_CONSTRAINTS } from '../utils/constants';

/**
 * Hook for managing camera/microphone access
 */
export function useMedia() {
  const [stream, setStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [error, setError] = useState(null);
  const [devices, setDevices] = useState({ cameras: [], microphones: [] });
  const streamRef = useRef(null);

  /**
   * Get available media devices
   */
  const getDevices = useCallback(async () => {
    try {
      // Request permission first
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      
      const devicesList = await navigator.mediaDevices.enumerateDevices();
      const cameras = devicesList.filter(d => d.kind === 'videoinput');
      const microphones = devicesList.filter(d => d.kind === 'audioinput');
      setDevices({ cameras, microphones });
    } catch (err) {
      console.error('Failed to get devices:', err);
      setError(err.message);
    }
  }, []);

  /**
   * Start local media stream
   */
  const startMedia = useCallback(async (constraints = MEDIA_CONSTRAINTS) => {
    try {
      setError(null);
      const localStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = localStream;
      setStream(localStream);
      return localStream;
    } catch (err) {
      console.error('Failed to access media:', err);
      setError(err.message || 'Failed to access camera/microphone');
      return null;
    }
  }, []);

  /**
   * Stop all tracks in a stream
   */
  const stopStream = useCallback((streamToStop) => {
    if (streamToStop) {
      streamToStop.getTracks().forEach(track => {
        track.stop();
      });
    }
    streamRef.current = null;
    setStream(null);
  }, []);

  /**
   * Toggle microphone
   */
  const toggleMute = useCallback(() => {
    if (!streamRef.current) return;
    setIsMuted(prev => {
      const newState = !prev;
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !newState;
      });
      return newState;
    });
  }, []);

  /**
   * Toggle camera
   */
  const toggleVideo = useCallback(() => {
    if (!streamRef.current) return;
    setIsVideoOff(prev => {
      const newState = !prev;
      streamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !newState;
      });
      return newState;
    });
  }, []);

  /**
   * Flip between front/rear camera (or next physical camera on desktop).
   * Swaps the video track IN PLACE on the existing MediaStream so the local
   * <video> element keeps playing; the caller must peer.replaceTrack() the
   * same old/new tracks so remote participants see the flipped feed.
   */
  const flipCamera = useCallback(async () => {
    if (!streamRef.current) return null;
    const currentTrack = streamRef.current.getVideoTracks()[0];
    if (!currentTrack) return null;

    const wasOff = !currentTrack.enabled;
    const settings = currentTrack.getSettings?.() || {};
    const nextFacing = settings.facingMode === 'environment' ? 'user' : 'environment';

    let newTrack = null;
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextFacing } });
      newTrack = nextStream.getVideoTracks()[0];
    } catch {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const cameras = devices.filter(d => d.kind === 'videoinput');
      const other = cameras.find(c => c.deviceId !== settings.deviceId);
      if (cameras.length > 1 && other) {
        try {
          const nextStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: other.deviceId } } });
          newTrack = nextStream.getVideoTracks()[0];
        } catch {
          return null;
        }
      }
      if (!newTrack) return null;
    }

    newTrack.enabled = !wasOff;
    streamRef.current.getVideoTracks().forEach(track => track.stop());
    streamRef.current.removeTrack(currentTrack);
    streamRef.current.addTrack(newTrack);
    return { oldTrack: currentTrack, newTrack };
  }, []);

  /**
   * Start screen sharing
   */
  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });
      return screenStream;
    } catch (err) {
      console.error('Screen share failed:', err);
      return null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    stream,
    isMuted,
    isVideoOff,
    error,
    devices,
    startMedia,
    stopStream,
    toggleMute,
    toggleVideo,
    startScreenShare,
    flipCamera,
    getDevices
  };
}