import React, { useCallback, useState } from 'react';
import { useDataChannel } from '@livekit/components-react';
import { Smile, X } from 'lucide-react';
import useStore from '../../store/useStore';
import { buildReaction, decodeReaction, encodeReaction } from '../../utils/reactionCodec';

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙌', '🎉', '🔥'];

// Emoji reactions over the 'reactions' data-channel topic. Mounted only while
// a LiveKit room exists (MeetingControls gates on mediaConnected), so
// RoomContext is always non-null here. Reactions are ephemeral: sent via the
// data channel, rendered as a brief burst on the sender's tile via the store,
// never persisted.
export default function ReactionPicker() {
  const [open, setOpen] = useState(false);
  const store = useStore;
  const { send } = useDataChannel('reactions', (msg) => {
    const reaction = decodeReaction(msg.payload);
    if (reaction) store.getState().addReaction(reaction);
  });

  const recentReactions = store((state) => state.recentReactions);
  const displayName = store((state) => state.displayName);
  const mySocketId = store((state) => state.mySocketId);

  const sendReaction = useCallback((emoji) => {
    const reaction = buildReaction({ emoji, sender: displayName, senderId: mySocketId });
    // Local echo so the sender sees the burst even without a wire round-trip;
    // addReaction dedupes by id against the data-channel echo.
    store.getState().addReaction(reaction);
    send(encodeReaction(reaction), { reliable: false }).catch((err) => {
      console.warn('[Reactions] send failed:', err);
    });
    setOpen(false);
  }, [displayName, mySocketId, send, store]);

  const handlePick = (emoji) => sendReaction(emoji);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`p-3 rounded-lg transition-all duration-200 ${
          open ? 'bg-primary hover:bg-primary-dark' : 'bg-meeting-card hover:bg-white/10'
        }`}
        title="Send a reaction"
      >
        <Smile size={20} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 w-64 bg-meeting-surface border border-meeting-border rounded-xl p-3 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 uppercase tracking-wide">React</span>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/10 text-gray-400">
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handlePick(emoji)}
                  className="text-2xl p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {recentReactions.length > 0 && (
              <div className="mt-3 pt-2 border-t border-meeting-border">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Recent</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {recentReactions.slice(0, 4).map((recent, i) => (
                    <button
                      key={`${recent.emoji}-${i}`}
                      onClick={() => handlePick(recent.emoji)}
                      className="px-2 py-1 rounded-full bg-meeting-card hover:bg-white/10 text-sm flex items-center gap-1"
                      title={`${recent.sender}: ${recent.emoji}`}
                    >
                      <span>{recent.emoji}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}