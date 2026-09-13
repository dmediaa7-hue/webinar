import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Play, Square, Download, Clock, FileVideo, Trash2 } from 'lucide-react';
import apiFetch from '../../utils/api';

const RECORDING_STATUS_META = {
  recording: { label: 'Recording', cls: 'bg-red-600/20 text-red-400' },
  processing: { label: 'Processing', cls: 'bg-yellow-600/20 text-yellow-400' },
  completed: { label: 'Completed', cls: 'bg-green-600/20 text-green-400' },
  failed: { label: 'Failed', cls: 'bg-red-600/20 text-red-400' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-700/40 text-gray-400' }
};

export function formatDurationMs(durationMs) {
  const ms = typeof durationMs === 'string' ? Number(durationMs) : durationMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

export function formatTimestamp(timestamp) {
  if (timestamp === null || timestamp === undefined || timestamp === '') return '';
  const date = new Date(
    typeof timestamp === 'string' && /^\d+$/.test(timestamp) ? Number(timestamp) : timestamp
  );
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getStatusMeta(status) {
  return RECORDING_STATUS_META[status] || { label: 'Unknown', cls: 'bg-gray-700/40 text-gray-400' };
}

function recordingDetails(recording) {
  const created = formatTimestamp(recording?.createdAt);
  const started = formatTimestamp(recording?.startedAt);
  const duration = formatDurationMs(recording?.durationMs);
  const parts = [];
  if (created) parts.push(`Created ${created}`);
  if (started && started !== created) parts.push(`Started ${started}`);
  if (duration) parts.push(`Duration ${duration}`);
  return parts.join(' · ');
}

export default function RecordingsSection() {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deletingProcessing, setDeletingProcessing] = useState(false);

  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/recordings');
      if (!res.ok) throw new Error('Failed to load recordings');
      const data = await res.json();
      setRecordings(Array.isArray(data.recordings) ? data.recordings : []);
    } catch {
      setError('Could not load recordings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecordings();
  }, [fetchRecordings]);

  const handleRefresh = () => {
    setPlayingId(null);
    fetchRecordings();
  };

  const handleDeleteRecording = async (recording) => {
    if (!window.confirm(`Delete "${recording.roomName || 'Untitled meeting'}"?`)) return;
    setDeletingId(recording.id);
    try {
      const res = await apiFetch(`/api/recordings/${recording.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setRecordings((prev) => prev.filter((r) => r.id !== recording.id));
      if (playingId === recording.id) setPlayingId(null);
    } catch {
      setError('Could not delete recording.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteProcessing = async () => {
    if (!window.confirm('Delete all recordings currently processing?')) return;
    setDeletingProcessing(true);
    try {
      const res = await apiFetch('/api/recordings/processing', { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setRecordings((prev) => prev.filter((r) => r.status !== 'processing'));
      if (playingId) setPlayingId(null);
    } catch {
      setError('Could not delete processing recordings.');
    } finally {
      setDeletingProcessing(false);
    }
  };

  const processingCount = recordings.filter((r) => r.status === 'processing').length;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex justify-end gap-2">
        {processingCount > 0 && (
          <button
            onClick={handleDeleteProcessing}
            disabled={deletingProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800/40 transition-colors disabled:opacity-50"
            title="Delete all recordings with Processing status"
          >
            <Trash2 size={15} />
            {deletingProcessing ? 'Deleting...' : `Delete Processing (${processingCount})`}
          </button>
        )}
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-meeting-surface hover:bg-white/10 text-gray-200 border border-meeting-border transition-colors disabled:opacity-50"
          title="Refresh recordings"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="text-sm text-gray-400 bg-meeting-surface border border-meeting-border rounded-xl p-6">
          Loading recordings…
        </div>
      )}

      {!loading && error && (
        <div className="text-sm text-red-400 bg-meeting-surface border border-red-800/40 rounded-xl p-6">
          {error}
        </div>
      )}

      {!loading && !error && recordings.length === 0 && (
        <div className="text-sm text-gray-400 bg-meeting-surface border border-meeting-border rounded-xl p-6 flex items-center gap-2">
          <FileVideo size={16} className="shrink-0" />
          No recordings yet...
        </div>
      )}

      {!loading && recordings.length > 0 && (
        <div className="space-y-3">
          {recordings.map((recording) => {
            const meta = getStatusMeta(recording.status);
            const hasFile = Boolean(recording.url);
            const isPlaying = playingId === recording.id;
            return (
              <div
                key={recording.id}
                className="bg-meeting-surface border border-meeting-border rounded-xl p-4"
              >
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold truncate">
                        {recording.roomName || 'Untitled meeting'}
                      </h4>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-medium ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mt-1 flex items-center gap-1.5">
                      <Clock size={13} />
                      <span>{recordingDetails(recording)}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {hasFile && (
                      <>
                        <button
                          onClick={() => setPlayingId(isPlaying ? null : recording.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-meeting-surface hover:bg-white/10 text-gray-200 border border-meeting-border transition-colors"
                          title={isPlaying ? 'Hide player' : 'Play recording'}
                        >
                          {isPlaying ? <Square size={13} /> : <Play size={13} />}
                          {isPlaying ? 'Hide' : 'Play'}
                        </button>
                        <a
                          href={recording.url}
                          download
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-meeting-surface hover:bg-white/10 text-gray-200 border border-meeting-border transition-colors"
                          title="Download recording"
                        >
                          <Download size={13} /> Download
                        </a>
                      </>
                    )}
                    <button
                      onClick={() => handleDeleteRecording(recording)}
                      disabled={deletingId === recording.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800/40 transition-colors disabled:opacity-50"
                      title="Delete recording"
                    >
                      <Trash2 size={13} />
                      {deletingId === recording.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>

                {isPlaying && hasFile && (
                  <video
                    key={recording.id}
                    controls
                    src={recording.url}
                    preload="metadata"
                    className="mt-3 w-full max-w-xl rounded-lg bg-black border border-meeting-border"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}