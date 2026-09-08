import React, { useState, useEffect, useRef } from 'react';
import { X, Send } from 'lucide-react';
import useStore from '../../store/useStore';
import { formatTime } from '../../utils/constants';

export default function ChatPanel({ onClose, onSendMessage, onTyping, currentUserName }) {
  const messages = useStore((state) => state.messages);
  const typingUsers = useStore((state) => state.typingUsers);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    onSendMessage(trimmed);
    setInput('');
    onTyping(false);
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);

    // Typing indicator with debounce
    onTyping(true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      onTyping(false);
    }, 1000);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const typingUsersList = Array.from(typingUsers);

  return (
    <div className="panel h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-meeting-border flex items-center justify-between">
        <h3 className="font-semibold text-sm">Chat</h3>
        <button onClick={onClose} className="icon-btn text-gray-400 hover:text-white" aria-label="Close chat">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <div className="mb-2">💬</div>
            <p>No messages yet.</p>
            <p className="text-xs">Say hello to everyone!</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-medium ${msg.isHost ? 'text-yellow-400' : 'text-primary'}`}
              >
                {msg.sender}
                {msg.isHost && ' (Host)'}
              </span>
              <span className="text-[10px] text-gray-500">
                {formatTime(msg.timestamp)}
              </span>
            </div>
            <p className="text-sm text-gray-200 break-words bg-meeting-card rounded-lg px-3 py-2">
              {msg.message}
            </p>
          </div>
        ))}

        {/* Typing indicator */}
        {typingUsersList.length > 0 && (
          <div className="text-xs text-gray-400 flex items-center">
            <span>
              {typingUsersList.length === 1
                ? 'Someone'
                : `${typingUsersList.length} people`}
            </span>
            <span className="ml-1">is typing</span>
            <span className="ml-2 flex items-center">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-meeting-border">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${currentUserName || 'everyone'}`}
            className="flex-1 px-3 py-2 bg-meeting-bg border border-meeting-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary transition-all"
          />
          <button
            onClick={handleSend}
            className="p-2 bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50"
            disabled={!input.trim()}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
