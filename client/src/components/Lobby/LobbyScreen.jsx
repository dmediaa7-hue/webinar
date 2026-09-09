import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../ui/Button';
import { usePreviewTracks } from '@livekit/components-react';
import { Mic, MicOff, Video, VideoOff, ArrowLeft } from 'lucide-react';
import useStore from '../../store/useStore';
import {
  BACKGROUND_MODES,
  BACKGROUND_OPTIONS,
  isBackgroundSupported,
  createBackgroundProcessor
} from '../../utils/virtualBackgrounds';

/**
 * Live camera preview owned by usePreviewTracks.
 *
 * usePreviewTracks creates LOCAL preview tracks (never published) from the
 * `audio`/`video` options, re-creates them when the options change (deviceId
 * switch, enable/disable toggle) and stops them on unmount. No LiveKit token
 * or room is required for the preview.
 */
function LobbyPreview({ micEnabled, cameraEnabled, micDeviceId, cameraDeviceId, videoProcessor, onError, onDevices }) {
  const videoRef = useRef(null);

  const tracks = usePreviewTracks(
    {
      audio: micEnabled ? (micDeviceId ? { deviceId: micDeviceId } : {}) : false,
      video: cameraEnabled
        ? { deviceId: cameraDeviceId || undefined, ...(videoProcessor ? { processor: videoProcessor } : {}) }
        : false
    },
    onError
  );
  const videoTrack = tracks?.find((t) => t.kind === 'video');

  // Attach the preview video track to the <video> element (PreJoin pattern).
  useEffect(() => {
    const el = videoRef.current;
    if (el && videoTrack) {
      videoTrack.attach(el);
      return () => videoTrack.detach(el);
    }
  }, [videoTrack]);

  // Once tracks exist (permission granted) enumerate labeled devices.
  useEffect(() => {
    if (!tracks || tracks.length === 0) return;
    let cancelled = false;
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        if (!cancelled) onDevices(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tracks, onDevices]);

  return (
    <div className="relative rounded-xl overflow-hidden bg-meeting-card aspect-video mb-6">
      {cameraEnabled && videoTrack ? (
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-2">
              {cameraEnabled ? <span className="text-3xl">⏳</span> : <VideoOff size={32} className="text-gray-400" />}
            </div>
            <p className="text-gray-400">{cameraEnabled ? 'Loading camera...' : 'Camera is off'}</p>
          </div>
        </div>
      )}

      {/* Status badges */}
      <div className="absolute top-3 left-3 flex gap-2">
        {!cameraEnabled && (
          <span className="px-2 py-1 bg-black/50 rounded-full text-xs text-gray-200 flex items-center gap-1">
            <VideoOff size={12} /> Camera off
          </span>
        )}
        {!micEnabled && (
          <span className="px-2 py-1 bg-black/50 rounded-full text-xs text-gray-200 flex items-center gap-1">
            <MicOff size={12} /> Mic muted
          </span>
        )}
      </div>
    </div>
  );
}

export default function LobbyScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hintedRoom = searchParams.get('room') || useStore.getState().roomId;

  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [cameraDeviceId, setCameraDeviceId] = useState('');
  const [devices, setDevices] = useState({ mics: [], cameras: [] });
  const [deviceError, setDeviceError] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const [backgroundSupported] = useState(() => isBackgroundSupported());
  const [backgroundMode, setBackgroundMode] = useState(BACKGROUND_MODES.NONE);
  const [backgroundImagePath, setBackgroundImagePath] = useState(null);

  const videoProcessor = useMemo(
    () => createBackgroundProcessor(backgroundMode, backgroundImagePath),
    [backgroundMode, backgroundImagePath]
  );

  // Stable callbacks - usePreviewTracks re-runs when `onError` identity changes.
  const handleError = useCallback((err) => {
    setDeviceError(err?.message || 'Unable to access camera/microphone. Please check permissions.');
  }, []);

  const handleDevices = useCallback((list) => {
    setDevices({
      mics: list.filter((d) => d.kind === 'audioinput'),
      cameras: list.filter((d) => d.kind === 'videoinput')
    });
  }, []);

  const handleSelectBackground = (mode) => {
    setBackgroundMode(mode);
    // Switching away from an uploaded image releases its object URL.
    if (mode !== BACKGROUND_MODES.IMAGE && backgroundImagePath) {
      URL.revokeObjectURL(backgroundImagePath);
      setBackgroundImagePath(null);
    }
  };

  const handleBackgroundImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (backgroundImagePath) URL.revokeObjectURL(backgroundImagePath);
    const path = URL.createObjectURL(file);
    setBackgroundImagePath(path);
    setBackgroundMode(BACKGROUND_MODES.IMAGE);
    e.target.value = '';
  };

  const handleBack = () => {
    navigate('/');
  };

  const handleJoin = () => {
    // Persist the chosen background so MeetingRoom applies it when publishing.
    useStore.getState().setBackgroundChoice(
      backgroundMode !== BACKGROUND_MODES.NONE
        ? { mode: backgroundMode, imagePath: backgroundImagePath }
        : null
    );
    // Publishing happens in MeetingRoom's LiveKit connect; the lobby only
    // previews local tracks, so nothing is published before Join.
    if (hintedRoom) navigate(`/meeting/${hintedRoom}`);
    else navigate('/');
  };

  const handleRetry = () => {
    setDeviceError('');
    // Remount LobbyPreview so usePreviewTracks re-requests permissions.
    setPreviewKey((k) => k + 1);
  };

  if (deviceError) {
    return (
      <div className="app-screen-min bg-meeting-bg flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl">📷</div>
          <h1 className="text-2xl font-bold">Camera/Mic Access Needed</h1>
          <p className="text-red-400">{deviceError}</p>
          <p className="text-gray-400">
            Webinar needs access to your camera and microphone to preview your devices before joining.
            Please allow permissions in your browser.
          </p>
          <div className="flex justify-center gap-3">
            <Button onClick={handleRetry} variant="primary">Try Again</Button>
            <Button onClick={handleBack} variant="secondary">Back to Home</Button>
          </div>
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
          <LobbyPreview
            key={previewKey}
            micEnabled={micEnabled}
            cameraEnabled={cameraEnabled}
            micDeviceId={micDeviceId}
            cameraDeviceId={cameraDeviceId}
            videoProcessor={videoProcessor}
            onError={handleError}
            onDevices={handleDevices}
          />

          {/* Controls */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setMicEnabled((v) => !v)}
              className={`p-4 rounded-full transition-all ${
                !micEnabled ? 'bg-red-600 hover:bg-red-700' : 'bg-meeting-surface hover:bg-white/10 border border-meeting-border'
              }`}
              aria-label="Toggle microphone"
            >
              {micEnabled ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button
              onClick={() => setCameraEnabled((v) => !v)}
              className={`p-4 rounded-full transition-all ${
                !cameraEnabled ? 'bg-red-600 hover:bg-red-700' : 'bg-meeting-surface hover:bg-white/10 border border-meeting-border'
              }`}
              aria-label="Toggle camera"
            >
              {cameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
          </div>

          {/* Device selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 max-w-lg mx-auto">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Microphone</label>
              <select
                value={micDeviceId}
                onChange={(e) => setMicDeviceId(e.target.value)}
                disabled={!micEnabled}
                className="w-full bg-meeting-surface border border-meeting-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary/50 disabled:opacity-50"
              >
                <option value="">Default</option>
                {devices.mics.map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microphone'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Camera</label>
              <select
                value={cameraDeviceId}
                onChange={(e) => setCameraDeviceId(e.target.value)}
                disabled={!cameraEnabled}
                className="w-full bg-meeting-surface border border-meeting-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary/50 disabled:opacity-50"
              >
                <option value="">Default</option>
                {devices.cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>
                ))}
              </select>
            </div>
          </div>

          {backgroundSupported && (
            <div className="mt-4 max-w-lg mx-auto">
              <label className="block text-xs text-gray-400 mb-1">Virtual background</label>
              <div className="flex flex-wrap items-center gap-2">
                {BACKGROUND_OPTIONS.map((opt) => (
                  <button
                    key={opt.mode}
                    onClick={() => handleSelectBackground(opt.mode)}
                    disabled={!cameraEnabled}
                    className={`px-3 py-1.5 rounded-full text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      backgroundMode === opt.mode
                        ? 'bg-primary text-white'
                        : 'bg-meeting-surface border border-meeting-border text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                {backgroundMode === BACKGROUND_MODES.IMAGE && backgroundImagePath && (
                  <img
                    src={backgroundImagePath}
                    alt="Background"
                    className="h-8 w-8 rounded-md object-cover border border-meeting-border"
                  />
                )}
                <label
                  className={`px-3 py-1.5 rounded-full text-xs cursor-pointer transition-all ${
                    backgroundMode === BACKGROUND_MODES.IMAGE
                      ? 'bg-primary text-white'
                      : 'bg-meeting-surface border border-meeting-border text-gray-300 hover:bg-white/10'
                  } ${!cameraEnabled ? 'opacity-40 pointer-events-none' : ''}`}
                >
                  Upload Image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBackgroundImage}
                    className="hidden"
                  />
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Applies to the preview and your published video.
              </p>
            </div>
          )}

          <div className="text-center mt-4 text-sm text-gray-400">
            {cameraEnabled ? 'Camera is on' : 'Camera is off'} ·{' '}
            {micEnabled ? 'Microphone active' : 'Microphone muted'}
          </div>

          <div className="mt-8 text-center">
            <Button size="lg" variant="primary" onClick={handleJoin}>
              Join Meeting
            </Button>
            {!hintedRoom && (
              <p className="text-xs text-gray-500 mt-2">
                No meeting specified — joining will take you to the home page.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}