// Unit tests for the polls & Q&A persistence layer (task 15).
// Runs with node:test against in-memory SQLite instances.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const engagement = require('../src/engagement');

function newDb() {
  return createDatabase(':memory:');
}

test('createPoll persists a poll and reads it back with parsed options', () => {
  const db = newDb();
  const result = engagement.createPoll({
    roomName: 'room-1',
    question: 'Best framework?',
    options: ['React', 'Vue', 'Svelte'],
    hostIdentity: 'sock-host'
  }, db);

  assert.equal(result.ok, true);
  const poll = result.poll;
  assert.ok(poll.id, 'poll id generated');
  assert.equal(poll.question, 'Best framework?');
  assert.deepEqual(poll.options, ['React', 'Vue', 'Svelte']);
  assert.equal(poll.hostIdentity, 'sock-host');
  assert.equal(poll.roomName, 'room-1');

  const reread = engagement.getPoll(poll.id, db);
  assert.ok(reread, 'poll readable after insert');
  assert.deepEqual(reread.options, ['React', 'Vue', 'Svelte']);
  db.close();
});

test('createPoll rejects invalid input', () => {
  const db = newDb();
  const base = { roomName: 'r', question: 'Q?', hostIdentity: 'h' };

  assert.equal(engagement.createPoll({ ...base, options: ['only-one'] }, db).error, 'OPTIONS_INVALID');
  assert.equal(engagement.createPoll({ ...base, options: [] }, db).error, 'OPTIONS_INVALID');
  assert.equal(engagement.createPoll({ ...base, options: ['', '  '] }, db).error, 'OPTIONS_INVALID');
  assert.equal(engagement.createPoll({ ...base, options: 'not-array' }, db).error, 'OPTIONS_INVALID');
  assert.equal(engagement.createPoll({ ...base, question: '   ', options: ['a', 'b'] }, db).error, 'QUESTION_REQUIRED');
  assert.equal(engagement.createPoll({ ...base, roomName: '', options: ['a', 'b'] }, db).error, 'ROOM_REQUIRED');
  assert.equal(engagement.createPoll({ ...base, options: ['a', 'b'], hostIdentity: '' }, db).error, 'HOST_REQUIRED');
  db.close();
});

test('createPoll caps options at 8 and trims whitespace', () => {
  const db = newDb();
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const result = engagement.createPoll({
    roomName: 'r', question: 'Q?', options: many, hostIdentity: 'h'
  }, db);
  assert.equal(result.ok, true);
  assert.equal(result.poll.options.length, 8);
  db.close();
});

test('recordPollVote persists a vote and tallies it', () => {
  const db = newDb();
  const created = engagement.createPoll({
    roomName: 'room-1', question: 'Q?', options: ['A', 'B'], hostIdentity: 'sock-host'
  }, db);

  const vote = engagement.recordPollVote({ pollId: created.poll.id, voterIdentity: 'sock-1', optionIndex: 0 }, db);
  assert.equal(vote.ok, true);
  assert.equal(vote.results.totalVotes, 1);
  assert.deepEqual(vote.results.counts, [1, 0]);

  const results = engagement.getPollResults(created.poll.id, db);
  assert.equal(results.totalVotes, 1);
  assert.equal(results.votes.length, 1);
  assert.equal(results.votes[0].voterIdentity, 'sock-1');
  assert.equal(results.votes[0].optionIndex, 0);
  db.close();
});

test('recordPollVote replaces a prior vote from the same voter (upsert)', () => {
  const db = newDb();
  const created = engagement.createPoll({
    roomName: 'room-1', question: 'Q?', options: ['A', 'B'], hostIdentity: 'sock-host'
  }, db);

  engagement.recordPollVote({ pollId: created.poll.id, voterIdentity: 'sock-1', optionIndex: 0 }, db);
  const second = engagement.recordPollVote({ pollId: created.poll.id, voterIdentity: 'sock-1', optionIndex: 1 }, db);

  assert.equal(second.ok, true);
  assert.equal(second.results.totalVotes, 1, 're-vote does not add a row');
  assert.deepEqual(second.results.counts, [0, 1]);
  assert.equal(second.results.votes[0].optionIndex, 1);
  db.close();
});

test('recordPollVote rejects unknown poll and out-of-range option', () => {
  const db = newDb();
  assert.equal(engagement.recordPollVote({ pollId: 'nope', voterIdentity: 's', optionIndex: 0 }, db).error, 'POLL_NOT_FOUND');

  const created = engagement.createPoll({
    roomName: 'r', question: 'Q?', options: ['A', 'B'], hostIdentity: 'h'
  }, db);
  assert.equal(engagement.recordPollVote({ pollId: created.poll.id, voterIdentity: 's', optionIndex: 5 }, db).error, 'OPTION_OUT_OF_RANGE');
  assert.equal(engagement.recordPollVote({ pollId: created.poll.id, voterIdentity: 's', optionIndex: 'x' }, db).error, 'OPTION_OUT_OF_RANGE');
  assert.equal(engagement.recordPollVote({ pollId: created.poll.id, voterIdentity: '', optionIndex: 0 }, db).error, 'VOTER_REQUIRED');
  db.close();
});

test('listPolls returns all polls for a room with tallies', () => {
  const db = newDb();
  const a = engagement.createPoll({ roomName: 'room-1', question: 'A?', options: ['x', 'y'], hostIdentity: 'h' }, db);
  const b = engagement.createPoll({ roomName: 'room-1', question: 'B?', options: ['p', 'q'], hostIdentity: 'h' }, db);
  engagement.createPoll({ roomName: 'other-room', question: 'C?', options: ['m', 'n'], hostIdentity: 'h' }, db);

  engagement.recordPollVote({ pollId: a.poll.id, voterIdentity: 's1', optionIndex: 1 }, db);
  engagement.recordPollVote({ pollId: b.poll.id, voterIdentity: 's1', optionIndex: 0 }, db);

  const polls = engagement.listPolls('room-1', db);
  assert.equal(polls.length, 2);
  assert.deepEqual(polls.map(p => p.question).sort(), ['A?', 'B?']);
  const pollA = polls.find(p => p.id === a.poll.id);
  assert.deepEqual(pollA.counts, [0, 1]);
  assert.equal(pollA.totalVotes, 1);
  db.close();
});

test('Q&A lifecycle: ask, upvote, mark answered, list sorted by votes', () => {
  const db = newDb();
  const first = engagement.createQuestion({ roomName: 'room-1', authorIdentity: 's1', authorName: 'Alice', body: 'First?' }, db);
  const second = engagement.createQuestion({ roomName: 'room-1', authorIdentity: 's2', authorName: 'Bob', body: 'Second?' }, db);

  assert.equal(first.ok, true);
  assert.equal(first.question.upvotes, 0);
  assert.equal(first.question.isAnswered, false);

  engagement.recordQuestionVote({ questionId: first.question.id, voterIdentity: 's1', delta: 1 }, db);
  engagement.recordQuestionVote({ questionId: first.question.id, voterIdentity: 's2', delta: 1 }, db);
  engagement.recordQuestionVote({ questionId: second.question.id, voterIdentity: 's1', delta: 1 }, db);

  const answered = engagement.markQuestionAnswered(first.question.id, true, db);
  assert.equal(answered.ok, true);
  assert.equal(answered.question.isAnswered, true);

  const questions = engagement.listQuestions('room-1', db);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].id, first.question.id, 'highest voted first');
  assert.equal(questions[0].upvotes, 2);
  assert.equal(questions[0].isAnswered, true);
  assert.equal(questions[1].upvotes, 1);
  db.close();
});

test('recordQuestionVote is per-voter: re-vote replaces, toggles stay accurate', () => {
  const db = newDb();
  const created = engagement.createQuestion({ roomName: 'r', authorIdentity: 's', authorName: 'N', body: 'Hmm' }, db);

  engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v1', delta: 1 }, db);
  engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v1', delta: 1 }, db);
  assert.equal(engagement.getQuestion(created.question.id, db).upvotes, 1, 'same voter upvoting twice is not double-counted');
  // Same voter toggling to a downvote replaces their +1 with -1 (net -1).
  engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v1', delta: -1 }, db);
  assert.equal(engagement.getQuestion(created.question.id, db).upvotes, -1);

  // A second voter upvoting moves the net score to 0.
  engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v2', delta: 1 }, db);
  assert.equal(engagement.getQuestion(created.question.id, db).upvotes, 0);
  db.close();
});

test('recordQuestionVote validates delta and rejects unknown questions', () => {
  const db = newDb();
  const created = engagement.createQuestion({ roomName: 'r', authorIdentity: 's', authorName: 'N', body: 'Hmm' }, db);

  assert.equal(engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v', delta: 2 }, db).error, 'DELTA_INVALID');
  assert.equal(engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v', delta: 'x' }, db).error, 'DELTA_INVALID');
  assert.equal(engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: '', delta: 1 }, db).error, 'VOTER_REQUIRED');
  assert.equal(engagement.recordQuestionVote({ questionId: 'nope', voterIdentity: 'v', delta: 1 }, db).error, 'QUESTION_NOT_FOUND');
  db.close();
});

test('recordQuestionVote neutral delta removes the voter row entirely', () => {
  const db = newDb();
  const created = engagement.createQuestion({ roomName: 'r', authorIdentity: 's', authorName: 'N', body: 'Hmm' }, db);

  engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v1', delta: 1 }, db);
  engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v2', delta: 1 }, db);
  assert.equal(engagement.getQuestion(created.question.id, db).upvotes, 2);

  engagement.recordQuestionVote({ questionId: created.question.id, voterIdentity: 'v1', delta: 0 }, db);
  assert.equal(engagement.getQuestion(created.question.id, db).upvotes, 1, 'neutral toggle removes only that voter');
  db.close();
});

test('createQuestion validates authorship and body', () => {
  const db = newDb();
  assert.equal(engagement.createQuestion({ roomName: 'r', authorIdentity: 's', authorName: 'N', body: '' }, db).error, 'BODY_REQUIRED');
  assert.equal(engagement.createQuestion({ roomName: 'r', authorIdentity: '', authorName: 'N', body: 'x' }, db).error, 'AUTHOR_REQUIRED');
  assert.equal(engagement.createQuestion({ roomName: '', authorIdentity: 's', authorName: 'N', body: 'x' }, db).error, 'ROOM_REQUIRED');
  db.close();
});

test('markQuestionAnswered rejects unknown question', () => {
  const db = newDb();
  assert.equal(engagement.markQuestionAnswered('nope', true, db).error, 'QUESTION_NOT_FOUND');
  db.close();
});

test('polls persist across database reopen (file-backed)', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dbPath = path.join(os.tmpdir(), `webinar-task15-${Date.now()}.db`);

  try {
    const first = createDatabase(dbPath);
    const created = engagement.createPoll({
      roomName: 'room-1', question: 'Q?', options: ['A', 'B'], hostIdentity: 'h'
    }, first);
    engagement.recordPollVote({ pollId: created.poll.id, voterIdentity: 's1', optionIndex: 1 }, first);
    first.close();

    const second = createDatabase(dbPath);
    const results = engagement.getPollResults(created.poll.id, second);
    assert.ok(results, 'poll readable after database reopen');
    assert.equal(results.totalVotes, 1);
    assert.deepEqual(results.counts, [0, 1]);
    second.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch (e) { /* ignore */ }
  }
});