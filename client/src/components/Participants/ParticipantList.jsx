import React from 'react';
import { X, MicOff, VideoOff, LogOut, Crown, Download, FileText, Check, DoorOpen } from 'lucide-react';
import { getInitials, formatDateTime } from '../../utils/constants';
import useStore from '../../store/useStore';
import { admitWaitingUser, denyWaitingUser, toggleWaitingRoom } from '../../hooks/useSocket';

export default function ParticipantList({
  onClose,
  isHost,
  onMuteParticipant,
  onKickParticipant,
  onDownloadAttendance
}) {
  const attendance = useStore((s) => s.attendance);
  const participants = useStore((s) => s.participants);
  const mySocketId = useStore((s) => s.mySocketId);
  const waitingList = useStore((s) => s.waitingList);
  const waitingRoomEnabled = useStore((s) => s.roomSettings?.waitingRoomEnabled);

  const participantEntries = Array.from(participants.entries());

  const leftEntries = attendance
    .filter((a) => a.leftAt)
    .sort((a, b) => b.leftAt - a.leftAt);

  const joinedAtFor = (socketId) => {
    const entry = attendance.find((a) => a.socketId === socketId && !a.leftAt);
    return entry?.joinedAt || null;
  };

  return (
    <div className="panel h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-meeting-border flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          Participants{' '}
          <span className="ml-1 px-1.5 py-0.5 bg-meeting-card rounded text-xs text-gray-400">
            {participantEntries.length}
          </span>
        </h3>
        <button onClick={onClose} className="icon-btn text-gray-400 hover:text-white" aria-label="Close participants list">
          <X size={18} />
        </button>
      </div>

      {/* Waiting room section (host only) */}
      {isHost && waitingRoomEnabled && (
        <div className="px-4 py-3 border-b border-meeting-border">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-2 flex items-center justify-between">
            <span>Waiting room {waitingList.length > 0 && `(${waitingList.length})`}</span>
          </p>
          {waitingList.length === 0 ? (
            <p className="text-xs text-gray-500">No one is waiting to join.</p>
          ) : (
            <div className="space-y-1">
              {waitingList.map((w) => (
                <div key={w.socketId} className="flex items-center px-2 py-1.5 rounded bg-meeting-card">
                  <div className="relative mr-2.5 shrink-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500/40 to-meeting-card flex items-center justify-center">
                      <span className="text-xs font-semibold">{getInitials(w.displayName)}</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{w.displayName}</p>
                    <p className="text-[10px] text-gray-500">
                      Waiting since {formatDateTime(w.joinedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => admitWaitingUser(w.socketId)}
                      className="p-1.5 rounded hover:bg-green-600/30 text-green-400 transition-colors"
                      title="Admit to meeting"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => denyWaitingUser(w.socketId)}
                      className="p-1.5 rounded hover:bg-red-600/30 text-red-400 transition-colors"
                      title="Deny and return to lobby"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Participant list */}
      <div className="flex-1 overflow-y-auto">
        {participantEntries.map(([socketId, p]) => {
          const isLocalRow = socketId === mySocketId;
          const pDisplayName = p.displayName || 'Guest';
          const rowHost = p.isHost;
          return (
            <div
              key={socketId}
              className="flex items-center px-4 py-2.5 hover:bg-white/5 transition-colors group"
            >
              {/* Avatar */}
              <div className="relative mr-3 shrink-0">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/60 to-meeting-card flex items-center justify-center">
                  <span className="text-sm font-semibold">
                    {getInitials(pDisplayName)}
                  </span>
                </div>
                {(p.isMuted || p.isVideoOff) && (
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-red-600 flex items-center justify-center">
                    {p.isMuted ? <MicOff size={8} /> : <VideoOff size={8} />}
                  </div>
                )}
              </div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">
                    {pDisplayName}
                    {isLocalRow && <span className="text-gray-400"> (You)</span>}
                  </span>
                  {rowHost && (
                    <Crown size={12} className="text-yellow-400" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  {p.isMuted && <span className="flex items-center gap-0.5"><MicOff size={8} /> Muted</span>}
                  {p.isVideoOff && <span className="flex items-center gap-0.5"><VideoOff size={8} /> Video off</span>}
                  {!p.isMuted && !p.isVideoOff && <span className="text-green-500">Active</span>}
                  {joinedAtFor(socketId) && <span className="text-gray-500">Joined {formatDateTime(joinedAtFor(socketId))}</span>}
                </div>
              </div>

              {/* Host controls (host only, not self) */}
              {isHost && !isLocalRow && (
                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={() => onMuteParticipant(socketId)}
                    className="p-1.5 rounded hover:bg-white/10 text-gray-300"
                    title="Mute"
                  >
                    <MicOff size={14} />
                  </button>
                  <button
                    onClick={() => onKickParticipant(socketId)}
                    className="p-1.5 rounded hover:bg-red-600/80 text-gray-300 hover:text-white"
                    title="Remove from meeting"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {leftEntries.length > 0 && (
          <>
            <div className="px-4 py-2 mt-2 text-[10px] uppercase tracking-wide text-gray-500 border-t border-meeting-border">
              Left the meeting
            </div>
            {leftEntries.map((e) => (
              <div
                key={`${e.socketId}-${e.leftAt}`}
                className="flex items-center px-4 py-2 opacity-70"
              >
                <div className="relative mr-3 shrink-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-500/60 to-meeting-card flex items-center justify-center">
                    <span className="text-sm font-semibold">
                      {getInitials(e.displayName)}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate">{e.displayName}</span>
                  <div className="text-[10px] text-gray-500">
                    {formatDateTime(e.joinedAt)} → {formatDateTime(e.leftAt)}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Host info footer */}
      {isHost && (
        <div className="px-4 py-3 border-t border-meeting-border space-y-2">
          <p className="text-xs text-gray-500">
            You are the host. Hover over a participant to mute or remove them.
          </p>
          <button
            onClick={toggleWaitingRoom}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors ${
              waitingRoomEnabled
                ? 'bg-yellow-700/20 text-yellow-400 hover:bg-yellow-700/30'
                : 'bg-meeting-card text-gray-300 hover:bg-white/10'
            }`}
            title="Let new joiners wait until you admit them"
          >
            <DoorOpen size={14} />
            Waiting room {waitingRoomEnabled ? 'on' : 'off'}
          </button>
        </div>
      )}

      {/* Attendance download (host only) */}
      {isHost && (
        <div className="px-4 py-3 border-t border-meeting-border flex gap-2">
          <button
            onClick={() => onDownloadAttendance('csv')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-meeting-card hover:bg-white/10 rounded-lg text-xs text-gray-300 transition-colors"
            title="Download attendance sheet (CSV)"
          >
            <Download size={14} />
            CSV
          </button>
          <button
            onClick={() => onDownloadAttendance('pdf')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary/20 hover:bg-primary/30 rounded-lg text-xs text-white transition-colors"
            title="Export attendance report (PDF)"
          >
            <FileText size={14} />
            PDF
          </button>
        </div>
      )}
    </div>
  );
}
