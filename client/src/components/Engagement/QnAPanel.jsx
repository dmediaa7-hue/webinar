import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { X, HelpCircle, ArrowBigUp, ArrowBigDown, CheckCircle2, Send } from 'lucide-react';
import { RoomContext, useDataChannel } from '@livekit/components-react';
import useStore from '../../store/useStore';
import { SERVER_URL } from '../../utils/constants';
import {
  buildQaAsk,
  buildQaVote,
  buildQaAnswered,
  encodeQaMessage,
  decodeQaMessage,
  sortQaQuestions,
  MAX_BODY_LENGTH
} from '../../utils/pollCodec';

// Bridges the LiveKit 'qa' data channel into the store (same bridge pattern
// as ChatChannel/PollChannel).
function QaChannel({ onMessage, onSendReady }) {
  const { send } = useDataChannel('qa', onMessage);

  useEffect(() => {
    onSendReady(send);
    return () => onSendReady(null);
  }, [send, onSendReady]);

  return null;
}

export default function QnAPanel({ onClose, roomId }) {
  const qaQuestions = useStore((state) => state.qaQuestions);
  const mySocketId = useStore((state) => state.mySocketId);
  const isHost = useStore((state) => state.isHost);
  const displayName = useStore((state) => state.displayName);
  const liveKitRoom = useContext(RoomContext);

  const [input, setInput] = useState('');
  const [hasChannel, setHasChannel] = useState(false);
  const [formError, setFormError] = useState('');
  const sendRef = useRef(null);

  // Restore persisted questions (server includes per-voter deltas so each
  // participant's own vote position survives a refresh).
  useEffect(() => {
    let cancelled = false;
    fetch(`${SERVER_URL}/api/rooms/${roomId}/qa`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.questions) useStore.getState().setQaQuestions(data.questions);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roomId]);

  const handleIncoming = useCallback((msg) => {
    const decoded = decodeQaMessage(msg.payload);
    if (decoded) useStore.getState().applyQaMessage(decoded);
  }, []);

  const markSendReady = useCallback((send) => {
    sendRef.current = send;
    setHasChannel(Boolean(send));
  }, []);

  const api = useCallback((path, options) => fetch(`${SERVER_URL}${path}`, options), []);

  const askQuestion = async () => {
    const body = input.trim();
    if (!body) return;
    setFormError('');

    try {
      const res = await api(`/api/rooms/${roomId}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: mySocketId, name: displayName || 'Guest', body })
      });
      const data = await res.json();
      if (!res.ok || !data.question) return setFormError(data.error || 'Failed to ask');

      const question = buildQaAsk({
        questionId: data.question.id,
        author: displayName || 'Guest',
        authorId: mySocketId,
        body: data.question.body,
        createdAt: data.question.createdAt
      });
      // Sender is not echoed on data channels; apply optimistically.
      useStore.getState().applyQaMessage(question);
      sendRef.current?.(encodeQaMessage(question), { reliable: true });
      setInput('');
    } catch {
      setFormError('Could not reach the server.');
    }
  };

  const castVote = (question, delta) => {
    const myDelta = question.votes.get(mySocketId) || 0;
    // Clicking the same direction again toggles back to neutral.
    const nextDelta = myDelta === delta ? 0 : delta;
    const vote = buildQaVote({ questionId: question.questionId, voterId: mySocketId, delta: nextDelta });
    useStore.getState().applyQaMessage(vote);
    sendRef.current?.(encodeQaMessage(vote), { reliable: true });
    api(`/api/rooms/${roomId}/qa/${question.questionId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: mySocketId, delta: nextDelta })
    }).catch(() => {});
  };

  const toggleAnswered = (question) => {
    const message = buildQaAnswered({ questionId: question.questionId, isAnswered: !question.isAnswered });
    useStore.getState().applyQaMessage(message);
    sendRef.current?.(encodeQaMessage(message), { reliable: true });
    api(`/api/rooms/${roomId}/qa/${question.questionId}/answered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-id': mySocketId },
      body: JSON.stringify({ isAnswered: !question.isAnswered })
    }).catch(() => {});
  };

  const sorted = sortQaQuestions(qaQuestions);

  return (
    <div className="panel h-full">
      {liveKitRoom && <QaChannel onMessage={handleIncoming} onSendReady={markSendReady} />}

      <div className="px-4 py-3 border-b border-meeting-border flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <HelpCircle size={16} className="text-primary" /> Q&A
        </h3>
        <button onClick={onClose} className="icon-btn text-gray-400 hover:text-white" aria-label="Close Q&A">
          <X size={18} />
        </button>
      </div>

      {/* Ask form */}
      <div className="px-4 py-3 border-b border-meeting-border bg-meeting-card/40">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') askQuestion(); }}
            placeholder="Ask a question…"
            maxLength={MAX_BODY_LENGTH}
            disabled={!hasChannel}
            className="flex-1 px-3 py-2 bg-meeting-bg border border-meeting-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={askQuestion}
            disabled={!input.trim() || !hasChannel}
            className="p-2 bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50"
            aria-label="Ask question"
          >
            <Send size={16} />
          </button>
        </div>
        {formError && <p className="text-red-400 text-xs mt-2">{formError}</p>}
      </div>

      {/* Question list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {sorted.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <div className="mb-2"><HelpCircle size={28} className="mx-auto" /></div>
            <p>No questions yet.</p>
            <p className="text-xs">Ask something above to get the discussion started.</p>
          </div>
        )}

        {sorted.map((question) => {
          const myDelta = question.votes.get(mySocketId) || 0;
          return (
            <div
              key={question.questionId}
              className={`bg-meeting-card rounded-xl p-4 border ${
                question.isAnswered ? 'border-green-500/40' : 'border-meeting-border'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Vote controls */}
                <div className="flex flex-col items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => castVote(question, 1)}
                    className={`p-1 rounded transition-colors ${
                      myDelta === 1 ? 'text-primary' : 'text-gray-500 hover:text-white'
                    }`}
                    aria-label="Upvote"
                  >
                    <ArrowBigUp size={18} />
                  </button>
                  <span className={`text-sm font-semibold ${question.upvotes < 0 ? 'text-gray-500' : 'text-gray-200'}`}>
                    {question.upvotes}
                  </span>
                  <button
                    onClick={() => castVote(question, -1)}
                    className={`p-1 rounded transition-colors ${
                      myDelta === -1 ? 'text-red-400' : 'text-gray-500 hover:text-white'
                    }`}
                    aria-label="Downvote"
                  >
                    <ArrowBigDown size={18} />
                  </button>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`text-xs font-medium ${isHost ? 'text-yellow-400' : 'text-primary'}`}>
                      {question.author}
                    </span>
                    {question.isAnswered && (
                      <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded shrink-0">
                        <CheckCircle2 size={10} /> Answered
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-200 break-words">{question.body}</p>

                  {isHost && (
                    <button
                      onClick={() => toggleAnswered(question)}
                      className="mt-2 text-xs text-gray-400 hover:text-green-400 transition-colors"
                    >
                      {question.isAnswered ? 'Mark unanswered' : 'Mark as answered'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}