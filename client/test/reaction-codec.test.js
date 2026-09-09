import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildReaction,
  encodeReaction,
  decodeReaction,
  capReactions,
  filterActiveReactions,
  pushRecentReaction,
  REACTION_TTL_MS,
  MAX_VISIBLE_PER_PARTICIPANT
} from '../src/utils/reactionCodec.js';

test('reaction serialization round-trips a reaction object', () => {
  const reaction = buildReaction({ emoji: '🎉', sender: 'Host A', senderId: 'socket-1', ts: 1700000000000 });
  const decoded = decodeReaction(encodeReaction(reaction));
  assert.deepEqual(decoded, reaction);
  assert.equal(decoded.type, 'emoji');
});

test('decodeReaction accepts string payloads from the wire', () => {
  const reaction = { id: 'r1', type: 'emoji', emoji: '👍', sender: 'A', senderId: 's1', ts: 1000 };
  assert.deepEqual(decodeReaction(JSON.stringify(reaction)), reaction);
});

test('decodeReaction rejects malformed or empty-emoji payloads', () => {
  assert.equal(decodeReaction('not json'), null);
  assert.equal(decodeReaction(''), null);
  assert.equal(decodeReaction(null), null);
  assert.equal(decodeReaction(undefined), null);
  assert.equal(decodeReaction(JSON.stringify({ emoji: '' })), null);
  assert.equal(decodeReaction(JSON.stringify({ type: 'emoji' })), null);
});

test('buildReaction fills defaults and truncates long fields', () => {
  const reaction = buildReaction({ emoji: '🔥'.repeat(20), sender: 'X'.repeat(500), senderId: 'Y'.repeat(500) });
  assert.equal(Array.from(reaction.emoji).length, 8);
  assert.equal(reaction.sender.length, 100);
  assert.equal(reaction.senderId.length, 100);
  assert.equal(reaction.type, 'emoji');
  assert.equal(typeof reaction.id, 'string');
  assert.equal(typeof reaction.ts, 'number');
});

test('capReactions keeps only the most recent bubbles per participant', () => {
  const list = [
    { id: 'a', ts: 1 },
    { id: 'b', ts: 2 },
    { id: 'c', ts: 3 },
    { id: 'd', ts: 4 }
  ];
  const capped = capReactions(list);
  assert.equal(capped.length, MAX_VISIBLE_PER_PARTICIPANT);
  assert.deepEqual(capped.map((r) => r.id), ['b', 'c', 'd']);
  assert.deepEqual(capReactions([]), []);
  assert.deepEqual(capReactions(null), []);
});

test('filterActiveReactions drops expired bubbles (no memory leak on render)', () => {
  const now = Date.now();
  const fresh = { id: 'fresh', ts: now - 100 };
  const stale = { id: 'stale', ts: now - REACTION_TTL_MS - 1 };
  const active = filterActiveReactions([fresh, stale], now);
  assert.deepEqual(active.map((r) => r.id), ['fresh']);
});

test('pushRecentReaction keeps newest-first list capped at max', () => {
  let list = [];
  for (let i = 0; i < 12; i++) list = pushRecentReaction(list, '🎉', 'user' + i);
  assert.equal(list.length, 8);
  assert.equal(list[0].sender, 'user11');
  assert.equal(list[7].sender, 'user4');

  const single = pushRecentReaction([], '👍', 'u');
  assert.equal(single.length, 1);
  assert.equal(single[0].emoji, '👍');
  assert.equal(single[0].sender, 'u');
  assert.equal(typeof single[0].ts, 'number');
});