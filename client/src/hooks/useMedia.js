import { useState, useEffect, useCallback, useRef } from 'react';
import { MEDIA_CONSTRAINTS } from '../utils/constants';

// Read the camera's facing mode ('user' | 'environment' | '' | ...) from the
// current video track. Empty string when there is no video track or the
// hardware reports no facing direction (desktop webcams).
function readFacingMode(stream) {
  const track = stream?.getVideoTracks?.()[0];
  return (track && track.getSettings?.().facingMode) || '';
}

/**
 * Hook for managing camera/microphone access
 */
export function useMedia() {
  const [stream, setStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [facingMode, setFacingMode] = useState('');
  const [error, setError] = useState(null);
  const [devices, setDevices] = useState({ cameras: [], microphones: [] });
  const streamRef = useRef(null);
  const acquisitionIdRef = useRef(0);
  const startMediaChainRef = useRef(Promise.resolve());

  /**
   * Get available media devices
   */
  const getDevices = useCallback(async () => {
    try {
      // Permission is already granted by startMedia, so enumerateDevices
      // returns labeled devices without acquiring the camera again.
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
    const acquisitionId = ++acquisitionIdRef.current;
    // Serialize acquisitions: concurrent getUserMedia(video) calls on a real
    // camera throw NotReadableError ('Device in use'), e.g. under React
    // StrictMode double-mount or rapid toggle clicks. Higher ids win;
    // superseded calls skip acquiring entirely.
    const run = startMediaChainRef.current.then(async () => {
      if (acquisitionId !== acquisitionIdRef.current) return null;
      try {
        setError(null);
        // Stop previous tracks first: re-acquiring a still-held camera fails with 'Device in use' on real hardware
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        const localStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (acquisitionId !== acquisitionIdRef.current) {
          localStream.getTracks().forEach((track) => track.stop());
          return null;
        }
        streamRef.current = localStream;
        setStream(localStream);
        setFacingMode(readFacingMode(localStream));
        return localStream;
      } catch (err) {
        if (acquisitionId !== acquisitionIdRef.current) return null;
        console.error('Failed to access media:', err);
        setError(err.message || 'Failed to access camera/microphone');
        return null;
      }
    });
    startMediaChainRef.current = run.catch(() => {});
    return run;
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
    setFacingMode(readFacingMode(streamRef.current));
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
    facingMode,
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
