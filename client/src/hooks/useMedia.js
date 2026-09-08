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

  /**
   * Switch camera device
   */
  const switchCamera = useCallback(async (deviceId) => {
    if (!deviceId) return;
    
    // Stop current video track
    const currentTracks = streamRef.current?.getVideoTracks();
    if (currentTracks) {
      currentTracks.forEach(track => track.stop());
    }

    const newStream = await startMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: { deviceId: { exact: deviceId } }
    });

    if (newStream) {
      setStream(prev => {
        if (prev) {
          // Combine new video with old audio
          const audioTracks = prev.getAudioTracks();
          audioTracks.forEach(track => newStream.addTrack(track));
        }
        return newStream;
      });
    }
  }, [startMedia]);

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
    switchCamera,
    getDevices
  };
}
