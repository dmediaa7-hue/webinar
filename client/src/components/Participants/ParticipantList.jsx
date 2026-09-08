import React from 'react';
import { X, MicOff, VideoOff, LogOut, Crown } from 'lucide-react';
import { getInitials } from '../../utils/constants';

export default function ParticipantList({
  onClose,
  participants,
  isHost,
  currentSocketId,
  onMuteParticipant,
  onKickParticipant
}) {
  return (
    <div className="panel h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-meeting-border flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          Participants{' '}
          <span className="ml-1 px-1.5 py-0.5 bg-meeting-card rounded text-xs text-gray-400">
            {participants.length}
          </span>
        </h3>
        <button onClick={onClose} className="icon-btn text-gray-400 hover:text-white" aria-label="Close participants list">
          <X size={18} />
        </button>
      </div>

      {/* Participant list */}
      <div className="flex-1 overflow-y-auto">
        {participants.map((p) => (
          <div
            key={p.socketId}
            className="flex items-center px-4 py-2.5 hover:bg-white/5 transition-colors group"
          >
            {/* Avatar */}
            <div className="relative mr-3 shrink-0">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/60 to-meeting-card flex items-center justify-center">
                <span className="text-sm font-semibold">
                  {getInitials(p.displayName)}
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
                  {p.displayName}
                  {p.socketId === currentSocketId && <span className="text-gray-400"> (You)</span>}
                </span>
                {p.isHost && (
                  <Crown size={12} className="text-yellow-400" />
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-gray-500">
                {p.isMuted && <span className="flex items-center gap-0.5"><MicOff size={8} /> Muted</span>}
                {p.isVideoOff && <span className="flex items-center gap-0.5"><VideoOff size={8} /> Video off</span>}
                {!p.isMuted && !p.isVideoOff && <span className="text-green-500">Active</span>}
              </div>
            </div>

            {/* Host controls (host only, not self) */}
            {isHost && p.socketId !== currentSocketId && (
              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  onClick={() => onMuteParticipant(p.socketId)}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-300"
                  title="Mute"
                >
                  <MicOff size={14} />
                </button>
                <button
                  onClick={() => onKickParticipant(p.socketId)}
                  className="p-1.5 rounded hover:bg-red-600/80 text-gray-300 hover:text-white"
                  title="Remove from meeting"
                >
                  <LogOut size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Host info footer */}
      {isHost && (
        <div className="px-4 py-3 border-t border-meeting-border">
          <p className="text-xs text-gray-500">
            You are the host. Hover over a participant to mute or remove them.
          </p>
        </div>
      )}
    </div>
  );
}
