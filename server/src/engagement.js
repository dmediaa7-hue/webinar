// Polls & Q&A persistence layer (task 15).
// CRUD over the `polls`, `poll_votes` and `qa_questions` tables (schema in
// db.js). Functions accept an optional `db` handle so unit tests can use
// ':memory:'. Live traffic rides the LiveKit 'poll'/'qa' data channels; these
// stores keep the durable record so results survive refresh and the host can
// download them.
const { v4: uuidv4 } = require('uuid');
const defaultDb = require('./db');

const MAX_QUESTION_LENGTH = 300;
const MAX_OPTION_LENGTH = 100;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const MAX_BODY_LENGTH = 500;
const MAX_NAME_LENGTH = 100;

function cleanOptions(options) {
  if (!Array.isArray(options)) return null;
  const cleaned = options
    .map((o) => String(o ?? '').trim().slice(0, MAX_OPTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
  if (cleaned.length < MIN_OPTIONS) return null;
  return cleaned;
}

function pollRowToPoll(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomName: row.room_name,
    question: row.question,
    options: JSON.parse(row.options),
    hostIdentity: row.host_identity,
    createdAt: row.created_at
  };
}

function questionRowToQuestion(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomName: row.room_name,
    author: row.author_name,
    authorId: row.author_identity,
    body: row.body,
    upvotes: row.upvotes,
    isAnswered: Boolean(row.is_answered),
    createdAt: row.created_at
  };
}

/**
 * Create a poll. Returns {ok:true,poll} or {ok:false,error}.
 */
function createPoll({ roomName, question, options, hostIdentity }, db = defaultDb) {
  const cleanRoom = String(roomName ?? '').trim().slice(0, 100);
  const cleanQuestion = String(question ?? '').trim().slice(0, MAX_QUESTION_LENGTH);
  const cleanHost = String(hostIdentity ?? '').trim().slice(0, MAX_NAME_LENGTH);
  const cleanOpts = cleanOptions(options);
  if (!cleanRoom) return { ok: false, error: 'ROOM_REQUIRED' };
  if (!cleanQuestion) return { ok: false, error: 'QUESTION_REQUIRED' };
  if (!cleanOpts) return { ok: false, error: 'OPTIONS_INVALID' };
  if (!cleanHost) return { ok: false, error: 'HOST_REQUIRED' };

  const id = uuidv4();
  db.prepare(`
    INSERT INTO polls (id, room_name, question, options, host_identity, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, cleanRoom, cleanQuestion, JSON.stringify(cleanOpts), cleanHost, Date.now());
  return { ok: true, poll: getPoll(id, db) };
}

/**
 * Record/replace a participant's choice for a poll. One active vote per voter
 * (UNIQUE(poll_id, voter_identity)); re-voting replaces the previous choice.
 */
function recordPollVote({ pollId, voterIdentity, optionIndex }, db = defaultDb) {
  const poll = getPoll(pollId, db);
  if (!poll) return { ok: false, error: 'POLL_NOT_FOUND' };
  const idx = Number(optionIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) {
    return { ok: false, error: 'OPTION_OUT_OF_RANGE' };
  }
  const voter = String(voterIdentity ?? '').trim().slice(0, MAX_NAME_LENGTH);
  if (!voter) return { ok: false, error: 'VOTER_REQUIRED' };

  db.prepare(`
    INSERT INTO poll_votes (poll_id, voter_identity, option_index, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(poll_id, voter_identity)
    DO UPDATE SET option_index = excluded.option_index, created_at = excluded.created_at
  `).run(pollId, voter, idx, Date.now());
  return { ok: true, results: getPollResults(pollId, db) };
}

/**
 * Poll plus per-option tallies and the voter list (ordered by vote time).
 */
function getPollResults(pollId, db = defaultDb) {
  const poll = getPoll(pollId, db);
  if (!poll) return null;
  const votes = db.prepare(
    'SELECT voter_identity, option_index FROM poll_votes WHERE poll_id = ? ORDER BY created_at ASC'
  ).all(pollId);
  const counts = poll.options.map(() => 0);
  votes.forEach((v) => {
    if (v.option_index >= 0 && v.option_index < counts.length) counts[v.option_index] += 1;
  });
  return {
    ...poll,
    counts,
    totalVotes: votes.length,
    votes: votes.map((v) => ({ voterIdentity: v.voter_identity, optionIndex: v.option_index }))
  };
}

function getPoll(pollId, db = defaultDb) {
  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  return pollRowToPoll(row);
}

/**
 * All polls for a room, each with results (host download / refresh restore).
 */
function listPolls(roomName, db = defaultDb) {
  const rows = db.prepare('SELECT * FROM polls WHERE room_name = ? ORDER BY created_at ASC').all(roomName);
  return rows.map((r) => getPollResults(r.id, db));
}

/**
 * Ask a Q&A question. Returns {ok:true,question} or {ok:false,error}.
 */
function createQuestion({ roomName, authorIdentity, authorName, body }, db = defaultDb) {
  const cleanRoom = String(roomName ?? '').trim().slice(0, 100);
  const cleanAuthorId = String(authorIdentity ?? '').trim().slice(0, MAX_NAME_LENGTH);
  const cleanAuthor = String(authorName ?? '').trim().slice(0, MAX_NAME_LENGTH);
  const cleanBody = String(body ?? '').trim().slice(0, MAX_BODY_LENGTH);
  if (!cleanRoom) return { ok: false, error: 'ROOM_REQUIRED' };
  if (!cleanAuthorId) return { ok: false, error: 'AUTHOR_REQUIRED' };
  if (!cleanBody) return { ok: false, error: 'BODY_REQUIRED' };

  const id = uuidv4();
  db.prepare(`
    INSERT INTO qa_questions (id, room_name, author_identity, author_name, body, upvotes, is_answered, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?)
  `).run(id, cleanRoom, cleanAuthorId, cleanAuthor, cleanBody, Date.now());
  return { ok: true, question: getQuestion(id, db) };
}

/**
 * Record a voter's position on a question (delta +1 upvote / -1 downvote /
 * 0 neutral). One record per voter: re-voting replaces the previous position,
 * and the upvotes counter is recomputed as SUM(delta) so toggles stay accurate
 * and a neutral toggle removes the row entirely (no residual bias).
 */
function recordQuestionVote({ questionId, voterIdentity, delta }, db = defaultDb) {
  const current = getQuestion(questionId, db);
  if (!current) return { ok: false, error: 'QUESTION_NOT_FOUND' };
  const voter = String(voterIdentity ?? '').trim().slice(0, MAX_NAME_LENGTH);
  if (!voter) return { ok: false, error: 'VOTER_REQUIRED' };
  const d = Number(delta);
  if (![1, 0, -1].includes(d)) return { ok: false, error: 'DELTA_INVALID' };

  if (d === 0) {
    db.prepare('DELETE FROM qa_upvotes WHERE question_id = ? AND voter_identity = ?').run(questionId, voter);
  } else {
    db.prepare(`
      INSERT INTO qa_upvotes (question_id, voter_identity, delta, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(question_id, voter_identity)
      DO UPDATE SET delta = excluded.delta, created_at = excluded.created_at
    `).run(questionId, voter, d, Date.now());
  }

  const { total } = db.prepare(
    'SELECT COALESCE(SUM(delta), 0) AS total FROM qa_upvotes WHERE question_id = ?'
  ).get(questionId);
  db.prepare('UPDATE qa_questions SET upvotes = ? WHERE id = ?').run(total, questionId);
  return { ok: true, question: getQuestion(questionId, db) };
}

function markQuestionAnswered(questionId, isAnswered, db = defaultDb) {
  const current = getQuestion(questionId, db);
  if (!current) return { ok: false, error: 'QUESTION_NOT_FOUND' };
  db.prepare('UPDATE qa_questions SET is_answered = ? WHERE id = ?').run(isAnswered ? 1 : 0, questionId);
  return { ok: true, question: getQuestion(questionId, db) };
}

function getQuestion(questionId, db = defaultDb) {
  const row = db.prepare('SELECT * FROM qa_questions WHERE id = ?').get(questionId);
  return questionRowToQuestion(row);
}

/**
 * All questions for a room, highest-voted first (stable: oldest first on
 * ties), each with the per-voter delta breakdown so clients can restore their
 * own vote position after a refresh.
 */
function listQuestions(roomName, db = defaultDb) {
  const rows = db.prepare(
    'SELECT * FROM qa_questions WHERE room_name = ? ORDER BY upvotes DESC, created_at ASC'
  ).all(roomName);
  const byId = db.prepare('SELECT voter_identity, delta FROM qa_upvotes WHERE question_id = ?');
  return rows.map((row) => {
    const question = questionRowToQuestion(row);
    const votes = byId.all(row.id).map((v) => ({ voterIdentity: v.voter_identity, delta: v.delta }));
    return { ...question, votes };
  });
}

module.exports = {
  createPoll,
  recordPollVote,
  getPoll,
  getPollResults,
  listPolls,
  createQuestion,
  recordQuestionVote,
  markQuestionAnswered,
  getQuestion,
  listQuestions
};