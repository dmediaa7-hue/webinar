import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../ui/Button';
import { Mic, MicOff, Video, VideoOff, ArrowLeft } from 'lucide-react';
import useStore from '../../store/useStore';
import { useMedia } from '../../hooks/useMedia';
import { MEDIA_CONSTRAINTS } from '../../utils/constants';

export default function LobbyScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hintedRoom = searchParams.get('room') || useStore.getState().roomId;

  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [cameraDeviceId, setCameraDeviceId] = useState('');
  const [deviceError, setDeviceError] = useState('');
  const [previewKey, setPreviewKey] = useState(0);

  const media = useMedia();
  const videoRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const constraints = {
      audio: micEnabled ? (micDeviceId ? { deviceId: micDeviceId } : MEDIA_CONSTRAINTS.audio) : false,
      video: cameraEnabled
        ? (cameraDeviceId ? { deviceId: cameraDeviceId } : MEDIA_CONSTRAINTS.video)
        : false
    };
    media.startMedia(constraints).then((s) => {
      if (cancelled && s) s.getTracks().forEach((t) => t.stop());
    });
    return () => { cancelled = true; };
  }, [micEnabled, cameraEnabled, micDeviceId, cameraDeviceId, previewKey]);

  useEffect(() => {
    if (media.error) setDeviceError(media.error);
  }, [media.error]);

  useEffect(() => {
    if (media.stream) media.getDevices();
  }, [media.stream]);

  const handleBack = () => {
    navigate('/');
  };

  const handleJoin = () => {
    if (hintedRoom) navigate(`/meeting/${hintedRoom}`);
    else navigate('/');
  };

  const handleRetry = () => {
    setDeviceError('');
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

      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-2xl">
          <div className="relative rounded-xl overflow-hidden bg-meeting-card aspect-video mb-6">
            {cameraEnabled && media.stream ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-2">
                    {cameraEnabled ? <span className="text-3xl">Loading...</span> : <VideoOff size={32} className="text-gray-400" />}
                  </div>
                  <p className="text-gray-400">{cameraEnabled ? 'Loading camera...' : 'Camera is off'}</p>
                </div>
              </div>
            )}

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
                {media.devices.microphones.map((m) => (
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
                {media.devices.cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>
                ))}
              </select>
            </div>
          </div>

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
