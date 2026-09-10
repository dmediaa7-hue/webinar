import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPollCreate,
  buildPollVote,
  buildPollClose,
  buildQaAsk,
  buildQaVote,
  buildQaAnswered,
  encodePollMessage,
  decodePollMessage,
  encodeQaMessage,
  decodeQaMessage,
  tallyPollVotes,
  sortQaQuestions
} from '../src/utils/pollCodec.js';

test('poll create round-trips through encode/decode', () => {
  const msg = buildPollCreate({ question: 'Best framework?', options: ['React', 'Vue', 'Svelte'], creator: 'Host A', creatorId: 'sock-1' });
  const decoded = decodePollMessage(encodePollMessage(msg));

  assert.ok(decoded, 'decodes to an object');
  assert.equal(decoded.kind, 'poll');
  assert.equal(decoded.action, 'create');
  assert.equal(decoded.pollId, msg.pollId);
  assert.equal(decoded.question, 'Best framework?');
  assert.deepEqual(decoded.options, ['React', 'Vue', 'Svelte']);
  assert.equal(decoded.creator, 'Host A');
  assert.equal(decoded.creatorId, 'sock-1');
  assert.equal(typeof decoded.createdAt, 'number');
});

test('poll create rejects fewer than 2 options', () => {
  const msg = buildPollCreate({ question: 'Q?', options: ['only-one'], creator: 'H', creatorId: 's' });
  assert.equal(msg.options.length, 0, 'builder drops invalid option sets');
  assert.equal(decodePollMessage(encodePollMessage(msg)), null, 'decoder rejects invalid create');
});

test('poll create decodes ArrayBuffer payloads (Socket.io binary wire format)', () => {
  const msg = buildPollCreate({ question: 'Best framework?', options: ['React', 'Vue'], creator: 'Host A', creatorId: 'sock-1' });
  const wire = encodePollMessage(msg).slice().buffer;
  assert.ok(wire instanceof ArrayBuffer, 'sender bytes land as ArrayBuffer on the wire');
  const decoded = decodePollMessage(wire);
  assert.ok(decoded, 'decodes to an object');
  assert.equal(decoded.question, 'Best framework?');
  assert.deepEqual(decoded.options, ['React', 'Vue']);
});

test('qa ask decodes ArrayBuffer payloads (Socket.io binary wire format)', () => {
  const msg = buildQaAsk({ author: 'Alice', authorId: 'sock-2', body: 'Will slides be shared?' });
  const wire = encodeQaMessage(msg).slice().buffer;
  assert.ok(wire instanceof ArrayBuffer, 'sender bytes land as ArrayBuffer on the wire');
  const decoded = decodeQaMessage(wire);
  assert.ok(decoded, 'decodes to an object');
  assert.equal(decoded.action, 'ask');
  assert.equal(decoded.body, 'Will slides be shared?');
});

test('poll create caps options at 8 and trims blanks', () => {
  const msg = buildPollCreate({ question: 'Q?', options: [' a ', 'b', '', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], creator: 'H', creatorId: 's' });
  assert.deepEqual(msg.options, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
});

test('poll vote round-trips with option index', () => {
  const msg = buildPollVote({ pollId: 'poll-1', voterId: 'sock-2', voterName: 'Bob', optionIndex: 1 });
  const decoded = decodePollMessage(encodePollMessage(msg));

  assert.equal(decoded.action, 'vote');
  assert.equal(decoded.pollId, 'poll-1');
  assert.equal(decoded.voterId, 'sock-2');
  assert.equal(decoded.voterName, 'Bob');
  assert.equal(decoded.optionIndex, 1);
});

test('poll vote rejects out-of-range option index', () => {
  const msg = buildPollVote({ pollId: 'poll-1', voterId: 's', optionIndex: 99 });
  assert.equal(decodePollMessage(encodePollMessage(msg)), null);
});

test('poll close round-trips with creator id', () => {
  const msg = buildPollClose({ pollId: 'poll-1', creatorId: 'sock-host' });
  const decoded = decodePollMessage(encodePollMessage(msg));

  assert.equal(decoded.action, 'close');
  assert.equal(decoded.pollId, 'poll-1');
  assert.equal(decoded.creatorId, 'sock-host');
});

test('non-poll payloads and garbage decode to null', () => {
  assert.equal(decodePollMessage('not json'), null);
  assert.equal(decodePollMessage('{}'), null);
  assert.equal(decodePollMessage(JSON.stringify({ kind: 'chat' })), null);
  assert.equal(decodePollMessage(JSON.stringify({ kind: 'poll', action: 'explode' })), null);
  assert.equal(decodeQaMessage('not json'), null);
  assert.equal(decodeQaMessage('{}'), null);
  assert.equal(decodeQaMessage(JSON.stringify({ kind: 'poll', action: 'ask' })), null);
});

test('qa ask round-trips with author and body', () => {
  const msg = buildQaAsk({ author: 'Alice', authorId: 'sock-2', body: 'Will slides be shared?' });
  const decoded = decodeQaMessage(encodeQaMessage(msg));

  assert.equal(decoded.action, 'ask');
  assert.equal(decoded.author, 'Alice');
  assert.equal(decoded.authorId, 'sock-2');
  assert.equal(decoded.body, 'Will slides be shared?');
  assert.equal(decoded.questionId, msg.questionId);
  assert.equal(typeof decoded.createdAt, 'number');
});

test('qa ask with blank body is rejected', () => {
  const msg = buildQaAsk({ author: 'A', body: '   ' });
  assert.equal(msg.body, '');
  assert.equal(decodeQaMessage(encodeQaMessage(msg)), null);
});

test('qa vote accepts +1 / -1 / 0 deltas and rejects others', () => {
  assert.equal(decodeQaMessage(encodeQaMessage(buildQaVote({ questionId: 'q1', voterId: 's', delta: 1 }))).delta, 1);
  assert.equal(decodeQaMessage(encodeQaMessage(buildQaVote({ questionId: 'q1', voterId: 's', delta: -1 }))).delta, -1);
  assert.equal(decodeQaMessage(encodeQaMessage(buildQaVote({ questionId: 'q1', voterId: 's', delta: 0 }))).delta, 0);

  const invalid = buildQaVote({ questionId: 'q1', voterId: 's', delta: 5 });
  assert.equal(decodeQaMessage(encodeQaMessage(invalid)).delta, 0, 'unknown delta coerces to neutral');
});

test('qa answered round-trips the boolean flag', () => {
  const yes = decodeQaMessage(encodeQaMessage(buildQaAnswered({ questionId: 'q1', isAnswered: true })));
  assert.equal(yes.isAnswered, true);
  const no = decodeQaMessage(encodeQaMessage(buildQaAnswered({ questionId: 'q1', isAnswered: false })));
  assert.equal(no.isAnswered, false);
});

test('tallyPollVotes counts per-option votes', () => {
  const votes = new Map([
    ['a', 0],
    ['b', 2],
    ['c', 0],
    ['d', 1]
  ]);
  assert.deepEqual(tallyPollVotes(votes, 3), [2, 1, 1]);
});

test('tallyPollVotes ignores out-of-range option indices', () => {
  const votes = new Map([
    ['a', 7],
    ['b', -1],
    ['c', 0]
  ]);
  assert.deepEqual(tallyPollVotes(votes, 2), [1, 0]);
});

test('sortQaQuestions orders by upvotes desc, oldest first on ties', () => {
  const questions = [
    { questionId: 'q1', upvotes: 2, createdAt: 200 },
    { questionId: 'q2', upvotes: 5, createdAt: 100 },
    { questionId: 'q3', upvotes: 2, createdAt: 150 },
    { questionId: 'q4', upvotes: 0, createdAt: 50 }
  ];
  const sorted = sortQaQuestions(questions);
  assert.deepEqual(sorted.map(q => q.questionId), ['q2', 'q3', 'q1', 'q4']);
});

test('sortQaQuestions does not mutate the input', () => {
  const questions = [
    { questionId: 'q1', upvotes: 1, createdAt: 10 },
    { questionId: 'q2', upvotes: 2, createdAt: 20 }
  ];
  sortQaQuestions(questions);
  assert.equal(questions[0].questionId, 'q1', 'original order preserved');
});