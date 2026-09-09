import { test } from 'node:test';
import assert from 'node:assert';
import { buildChatMessage, encodeChatMessage, decodeChatMessage } from '../src/utils/chatCodec.js';

test('chat serialization round-trips a message object', () => {
  const msg = buildChatMessage({
    sender: 'Host A',
    senderId: 'socket-123',
    message: 'Hello everyone',
    isHost: true
  });
  const decoded = decodeChatMessage(encodeChatMessage(msg));
  assert.deepEqual(decoded, msg);
});

test('decodeChatMessage accepts string payloads from the wire', () => {
  const msg = { id: 'x', sender: 'A', senderId: 's1', message: 'hi', timestamp: 1000, isHost: false };
  assert.deepEqual(decodeChatMessage(JSON.stringify(msg)), msg);
});

test('decodeChatMessage rejects malformed payloads', () => {
  assert.equal(decodeChatMessage('not json'), null);
  assert.equal(decodeChatMessage(''), null);
  assert.equal(decodeChatMessage(null), null);
  assert.equal(decodeChatMessage(undefined), null);
});

test('buildChatMessage fills defaults and truncates long fields', () => {
  const msg = buildChatMessage({ sender: 'A'.repeat(500), message: 'm' });
  assert.equal(msg.sender.length, 100);
  assert.equal(msg.message, 'm');
  assert.equal(typeof msg.id, 'string');
  assert.equal(typeof msg.timestamp, 'number');
  assert.equal(msg.isHost, false);
  assert.equal(msg.senderId, '');
});