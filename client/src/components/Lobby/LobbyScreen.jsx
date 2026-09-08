import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../ui/Button';
import { useMedia } from '../../hooks/useMedia';
import { Mic, MicOff, Video, VideoOff, ArrowLeft } from 'lucide-react';
import useStore from '../../store/useStore';

export default function LobbyScreen() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [deviceError, setDeviceError] = useState('');

  const { startMedia, stopStream, toggleMute, toggleVideo, isMuted, isVideoOff } = useMedia();

  useEffect(() => {
    const initMedia = async () => {
      const stream = await startMedia();
      if (stream) {
        streamRef.current = stream;
        setLocalStream(stream);
        useStore.getState().setLocalStream(stream);
      } else {
        setDeviceError('Unable to access camera/microphone. Please check permissions.');
      }
    };
    initMedia();

    return () => {
      if (streamRef.current) {
        stopStream(streamRef.current);
        useStore.getState().setLocalStream(null);
        streamRef.current = null;
      }
    };
  }, []);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const handleBack = () => {
    if (localStream) stopStream(localStream);
    navigate('/');
  };

  if (deviceError) {
    return (
      <div className="app-screen-min bg-meeting-bg flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl">📷</div>
          <h1 className="text-2xl font-bold">Camera/Mic Access Needed</h1>
          <p className="text-red-400">{deviceError}</p>
          <p className="text-gray-400">
            Webinar needs access to your camera and microphone to join video meetings.
            Please allow permissions in your browser.
          </p>
          <Button onClick={handleBack} variant="secondary">Back to Home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-screen-min bg-meeting-bg flex flex-col">
      {/* Header */}
      <header className="px-8 py-4 flex items-center gap-3">
        <button
          onClick={handleBack}
          className="icon-btn text-gray-400 hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-semibold text-gray-300">Meeting lobby</h1>
      </header>

      {/* Main preview */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-2xl">
          {/* Video preview */}
          <div className="relative rounded-xl overflow-hidden bg-meeting-card aspect-video mb-6">
            {localStream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-400">Loading camera...</p>
              </div>
            )}
            {isVideoOff && !localStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-meeting-card">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-2">
                    <span className="text-3xl">🚫</span>
                  </div>
                  <p className="text-gray-400">Camera is off</p>
                </div>
              </div>
            )}

            {/* Status badges */}
            <div className="absolute top-3 left-3 flex gap-2">
              {isVideoOff && (
                <span className="px-2 py-1 bg-black/50 rounded-full text-xs text-gray-200 flex items-center gap-1">
                  <VideoOff size={12} /> Camera off
                </span>
              )}
              {isMuted && (
                <span className="px-2 py-1 bg-black/50 rounded-full text-xs text-gray-200 flex items-center gap-1">
                  <MicOff size={12} /> Mic muted
                </span>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full transition-all ${
                isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-meeting-surface hover:bg-white/10 border border-meeting-border'
              }`}
              aria-label="Toggle microphone"
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button
              onClick={toggleVideo}
              className={`p-4 rounded-full transition-all ${
                isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-meeting-surface hover:bg-white/10 border border-meeting-border'
              }`}
              aria-label="Toggle camera"
            >
              {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
            </button>
          </div>

          <div className="text-center mt-4 text-sm text-gray-400">
            {isVideoOff ? 'Camera is off' : 'Camera is on'} ·{' '}
            {isMuted ? 'Microphone muted' : 'Microphone active'}
          </div>

          <div className="mt-8 text-center">
            <Button size="lg" variant="primary">
              Pre-join Check Complete
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

