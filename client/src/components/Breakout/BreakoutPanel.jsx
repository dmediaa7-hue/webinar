import React, { useEffect, useState } from 'react';
import { X, Plus, Users, CornerUpLeft, DoorOpen } from 'lucide-react';
import useStore from '../../store/useStore';
import { getInitials } from '../../utils/constants';
import {
  listBreakouts,
  createBreakout,
  assignBreakout,
  returnBreakout,
  teardownBreakouts,
  breakoutRoomLabel,
  participantBreakoutName
} from '../../utils/breakout';

export default function BreakoutPanel({ onClose, roomId, hostId, isHost }) {
  const breakoutState = useStore((s) => s.breakoutState);
  const participants = useStore((s) => s.participants);
  const mySocketId = useStore((s) => s.mySocketId);

  const [layout, setLayout] = useState(breakoutState);
  const [nameInput, setNameInput] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [breakoutId, setBreakoutId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const state = await listBreakouts(roomId, hostId);
      setLayout(state);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (isHost) refresh();
  }, [roomId, hostId, isHost]);

  useEffect(() => {
    if (breakoutState) setLayout(breakoutState);
  }, [breakoutState]);

  const run = async (fn) => {
    if (!isHost || busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    run(async () => {
      await createBreakout(roomId, hostId, nameInput.trim() || null);
      setNameInput('');
    });

  const handleAssign = () => {
    if (!participantId || !breakoutId) return;
    run(async () => {
      await assignBreakout(roomId, hostId, participantId, breakoutId);
      setParticipantId('');
      setBreakoutId('');
    });
  };

  const handleReturn = (identity) =>
    run(() => returnBreakout(roomId, hostId, identity));

  const handleTeardown = () => run(() => teardownBreakouts(roomId, hostId));

  const breakoutOptions = layout?.breakouts ?? [];
  const participantOptions = Array.from(participants.values());
  const myBreakoutLabel = breakoutRoomLabel(layout?.assignments, mySocketId);

  if (!isHost) {
    return (
      <div className="panel h-full">
        <div className="px-4 py-3 border-b border-meeting-border flex items-center justify-between">
          <h3 className="font-semibold text-sm">Breakout Rooms</h3>
          <button onClick={onClose} className="icon-btn text-gray-400 hover:text-white" aria-label="Close breakout rooms">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {myBreakoutLabel ? (
            <div className="bg-meeting-card rounded-xl p-4 border border-meeting-border text-center">
              <p className="text-sm text-gray-200 mb-1">You are in breakout: <span className="font-medium text-primary">{myBreakoutLabel}</span></p>
              <p className="text-xs text-gray-500">Wait here until the host ends the breakout session.</p>
            </div>
          ) : (
            <div className="bg-meeting-card rounded-xl p-4 border border-meeting-border text-center">
              <p className="text-sm text-gray-200">You are in the main room.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="panel h-full">
      <div className="px-4 py-3 border-b border-meeting-border flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          Breakout Rooms{' '}
          <span className="ml-1 px-1.5 py-0.5 bg-meeting-card rounded text-xs text-gray-400">
            {breakoutOptions.length}
          </span>
        </h3>
        <button onClick={onClose} className="icon-btn text-gray-400 hover:text-white" aria-label="Close breakout rooms">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Create */}
        <div className="flex gap-2">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Auto-numbered, or type a label"
            maxLength={24}
            disabled={busy}
            className="flex-1 min-w-0 px-3 py-2 bg-meeting-bg border border-meeting-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={handleCreate}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary-dark rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Create breakout room"
          >
            <Plus size={16} />
            Create
          </button>
        </div>

        {/* Assign */}
        <div className="flex gap-2">
          <select
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            disabled={busy || participantOptions.length === 0}
            className="flex-1 min-w-0 px-3 py-2 bg-meeting-bg border border-meeting-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            <option value="">Participant</option>
            {participantOptions.map((p) => {
              const where = participantBreakoutName(layout?.assignments, p.socketId);
              return (
                <option key={p.socketId} value={p.socketId}>
                  {p.displayName} {where ? `(Breakout ${where})` : '(main)'}
                </option>
              );
            })}
          </select>
          <select
            value={breakoutId}
            onChange={(e) => setBreakoutId(e.target.value)}
            disabled={busy || breakoutOptions.length === 0}
            className="flex-1 min-w-0 px-3 py-2 bg-meeting-bg border border-meeting-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            <option value="">Breakout</option>
            {breakoutOptions.map((b) => (
              <option key={b.name} value={b.name}>
                Breakout {b.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleAssign}
            disabled={busy || !participantId || !breakoutId}
            className="flex items-center gap-1.5 px-3 py-2 bg-meeting-card hover:bg-white/10 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Assign participant to breakout"
          >
            <Users size={16} />
            Assign
          </button>
        </div>

        {/* Breakout list */}
        {breakoutOptions.length === 0 ? (
          <p className="text-xs text-gray-500">No breakouts yet — create one above.</p>
        ) : (
          breakoutOptions.map((b) => (
            <div key={b.name} className="bg-meeting-card rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Breakout {b.name}</span>
                <span className="px-1.5 py-0.5 bg-meeting-bg rounded text-xs text-gray-400">
                  {b.identities.length}
                </span>
              </div>
              {b.identities.length === 0 ? (
                <p className="text-xs text-gray-500">No participants assigned.</p>
              ) : (
                <div className="space-y-1.5">
                  {b.identities.map((identity) => {
                    const p = participants.get(identity);
                    const name = p?.displayName || identity;
                    return (
                      <div key={identity} className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary/60 to-meeting-card flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-semibold">{getInitials(name)}</span>
                        </div>
                        <span className="flex-1 min-w-0 text-sm text-gray-200 truncate">{name}</span>
                        <button
                          onClick={() => handleReturn(identity)}
                          disabled={busy}
                          className="p-1.5 rounded hover:bg-white/10 text-gray-300 disabled:opacity-50"
                          title={`Return ${name} to the main room`}
                        >
                          <CornerUpLeft size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="px-4 py-3 border-t border-meeting-border space-y-3">
        <p className="text-xs text-gray-500">
          You are in {myBreakoutLabel ? `Breakout ${myBreakoutLabel}` : 'the main room'}.
        </p>
        <button
          onClick={handleTeardown}
          disabled={busy || breakoutOptions.length === 0}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Move everyone back and delete all breakout rooms"
        >
          <DoorOpen size={14} />
          Close all breakouts
        </button>
      </div>
    </div>
  );
}
