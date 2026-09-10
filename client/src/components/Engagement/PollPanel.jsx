import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, BarChart3, Check, Lock, Plus, Minus } from 'lucide-react';
import useStore from '../../store/useStore';
import { SERVER_URL } from '../../utils/constants';
import {
  buildPollCreate,
  buildPollVote,
  buildPollClose,
  encodePollMessage,
  decodePollMessage,
  tallyPollVotes
} from '../../utils/pollCodec';
import useCollabChannel from '../../hooks/useCollabChannel';

export default function PollPanel({ onClose, roomId }) {
  const polls = useStore((state) => state.polls);
  const mySocketId = useStore((state) => state.mySocketId);
  const isHost = useStore((state) => state.isHost);
  const displayName = useStore((state) => state.displayName);
  const participants = useStore((state) => state.participants);

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [formError, setFormError] = useState('');

  const hostIdentity = isHost
    ? mySocketId
    : [...participants.values()].find((p) => p.isHost)?.socketId;

  useEffect(() => {
    let cancelled = false;
    fetch(`${SERVER_URL}/api/rooms/${roomId}/polls`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.polls) useStore.getState().setPolls(data.polls);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roomId]);

  const handleIncoming = useCallback((payload) => {
    const decoded = decodePollMessage(payload);
    if (!decoded) return;
    if ((decoded.action === 'create' || decoded.action === 'close') && hostIdentity && decoded.creatorId !== hostIdentity) return;
    useStore.getState().applyPollMessage(decoded);
  }, [hostIdentity]);

  const { send } = useCollabChannel('poll', handleIncoming);

  const api = useCallback((path, options) => fetch(`${SERVER_URL}${path}`, options), []);

  const launchPoll = async () => {
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) return setFormError('Enter a poll question.');
    if (cleanOptions.length < 2) return setFormError('Provide at least 2 options.');
    setFormError('');

    try {
      const res = await api(`/api/rooms/${roomId}/polls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-host-id': mySocketId },
        body: JSON.stringify({ question: question.trim(), options: cleanOptions })
      });
      const data = await res.json();
      if (!res.ok || !data.poll) return setFormError(data.error || 'Failed to create poll');

      const poll = buildPollCreate({
        pollId: data.poll.id,
        question: data.poll.question,
        options: data.poll.options,
        creator: displayName || 'Host',
        creatorId: mySocketId,
        createdAt: data.poll.createdAt
      });
      useStore.getState().applyPollMessage(poll);
      send(encodePollMessage(poll));
      setQuestion('');
      setOptions(['', '']);
    } catch {
      setFormError('Could not reach the server.');
    }
  };

  const castVote = async (poll, optionIndex) => {
    if (poll.isClosed) return;
    const vote = buildPollVote({
      pollId: poll.pollId,
      voterId: mySocketId,
      voterName: displayName || 'Guest',
      optionIndex
    });
    useStore.getState().applyPollMessage(vote);
    send(encodePollMessage(vote));
    try {
      await api(`/api/rooms/${roomId}/polls/${poll.pollId}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: mySocketId, optionIndex })
      });
    } catch {
      // Best-effort persistence; the live tally still advanced.
    }
  };

  const closePoll = (poll) => {
    if (!isHost) return;
    const closeMsg = buildPollClose({ pollId: poll.pollId, creatorId: mySocketId });
    useStore.getState().applyPollMessage(closeMsg);
    send(encodePollMessage(closeMsg));
  };

  const setOption = (index, value) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  const addOption = () => setOptions((prev) => (prev.length < 8 ? [...prev, ''] : prev));
  const removeOption = (index) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));

  return (
    <div className="panel h-full">
      <div className="px-4 py-3 border-b border-meeting-border flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <BarChart3 size={16} className="text-primary" /> Polls
        </h3>
        <button onClick={onClose} className="icon-btn text-gray-400 hover:text-white" aria-label="Close polls">
          <X size={18} />
        </button>
      </div>

      {/* Host create form */}
      {isHost && (
        <div className="px-4 py-3 border-b border-meeting-border bg-meeting-card/40">
          <p className="text-xs text-gray-400 mb-2">Launch a poll</p>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Poll question"
            maxLength={300}
            className="w-full px-3 py-2 bg-meeting-bg border border-meeting-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary mb-2"
          />
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={option}
                onChange={(e) => setOption(index, e.target.value)}
                placeholder={`Option ${index + 1}`}
                maxLength={100}
                className="flex-1 px-3 py-1.5 bg-meeting-bg border border-meeting-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {options.length > 2 && (
                <button
                  onClick={() => removeOption(index)}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  aria-label={`Remove option ${index + 1}`}
                >
                  <Minus size={14} />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button
              onClick={addOption}
              disabled={options.length >= 8}
              className="flex items-center gap-1 px-2 py-1.5 rounded bg-meeting-card hover:bg-white/10 text-xs text-gray-300 transition-colors disabled:opacity-40"
            >
              <Plus size={14} /> Add option
            </button>
            <button
              onClick={launchPoll}
              className="flex-1 py-2 bg-primary hover:bg-primary-dark rounded-lg text-sm font-medium transition-colors"
            >
              Launch poll
            </button>
          </div>
          {formError && <p className="text-red-400 text-xs mt-2">{formError}</p>}
        </div>
      )}

      {/* Poll list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {polls.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <div className="mb-2"><BarChart3 size={28} className="mx-auto" /></div>
            <p>No polls yet.</p>
            {!isHost && <p className="text-xs">The host can launch one anytime.</p>}
          </div>
        )}

        {polls.map((poll) => {
          const counts = tallyPollVotes(poll.votes, poll.options.length);
          const total = poll.votes.size;
          const myVote = poll.votes.get(mySocketId);
          return (
            <div key={poll.pollId} className="bg-meeting-card rounded-xl p-4 border border-meeting-border">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="text-sm font-medium text-gray-200 break-words">{poll.question}</h4>
                {poll.isClosed && (
                  <span className="flex items-center gap-1 text-[10px] text-gray-400 bg-meeting-bg px-2 py-0.5 rounded shrink-0">
                    <Lock size={10} /> Closed
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 mb-3">
                {total} vote{total === 1 ? '' : 's'}
              </p>

              <div className="space-y-2">
                {poll.options.map((option, index) => {
                  const pct = total ? Math.round((counts[index] / total) * 100) : 0;
                  const isMyChoice = myVote === index;
                  return (
                    <button
                      key={index}
                      onClick={() => castVote(poll, index)}
                      disabled={poll.isClosed}
                      className={`relative w-full text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                        isMyChoice
                          ? 'border-primary bg-primary/10 text-white'
                          : 'border-meeting-border bg-meeting-bg text-gray-300 hover:border-primary/60'
                      } disabled:opacity-60 disabled:hover:border-meeting-border`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 rounded-lg bg-primary/10"
                        style={{ width: `${pct}%` }}
                      />
                      <div className="relative flex items-center justify-between gap-2">
                        <span className="break-words">{option}</span>
                        <span className="text-xs text-gray-400 shrink-0">
                          {isMyChoice ? <Check size={14} className="text-primary inline mr-1" /> : null}
                          {pct}%
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {isHost && !poll.isClosed && (
                <button
                  onClick={() => closePoll(poll)}
                  className="mt-3 w-full py-1.5 rounded-lg bg-meeting-bg hover:bg-white/10 border border-meeting-border text-xs text-gray-300 transition-colors"
                >
                  Close poll
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
