// Poll & Q&A message serialization. Pure ESM over globals
// (JSON / TextEncoder / TextDecoder / Date) so node:test can import it
// directly, mirroring chatCodec/reactionCodec.
//
// Poll messages (topic 'poll'): {kind:'poll', action:'create'|'vote'|'close', ...}
//   create: {pollId, question, options[], creator, creatorId, createdAt}
//   vote:   {pollId, voterId, voterName, optionIndex}
//   close:  {pollId, creatorId}
// QA messages (topic 'qa'): {kind:'qa', action:'ask'|'vote'|'answered', ...}
//   ask:      {questionId, author, authorId, body, createdAt}
//   vote:     {questionId, voterId, delta}   delta: +1 upvote / -1 downvote / 0 neutral
//   answered: {questionId, isAnswered}
//
// Store appliers are idempotent (voter-choice replace, dedupe by ids).

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 8;
export const MAX_QUESTION_LENGTH = 300;
export const MAX_OPTION_LENGTH = 100;
export const MAX_BODY_LENGTH = 500;
export const MAX_NAME_LENGTH = 100;

export function createMessageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function pick(list) {
  return (list || []).map((v) => String(v ?? '').trim().slice(0, MAX_OPTION_LENGTH)).filter(Boolean);
}

// --- Builders -------------------------------------------------------------

export function buildPollCreate({ question, options, creator = 'Host', creatorId = '', createdAt, pollId, id }) {
  const cleanOptions = pick(options).slice(0, POLL_MAX_OPTIONS);
  return {
    id: id || createMessageId(),
    kind: 'poll',
    action: 'create',
    pollId: pollId || createMessageId(),
    question: String(question || '').trim().slice(0, MAX_QUESTION_LENGTH),
    options: cleanOptions.length >= POLL_MIN_OPTIONS ? cleanOptions : [],
    creator: String(creator || 'Host').slice(0, MAX_NAME_LENGTH),
    creatorId: String(creatorId || '').slice(0, MAX_NAME_LENGTH),
    createdAt: typeof createdAt === 'number' ? createdAt : Date.now()
  };
}

export function buildPollVote({ pollId, voterId, voterName = 'Guest', optionIndex, id }) {
  return {
    id: id || createMessageId(),
    kind: 'poll',
    action: 'vote',
    pollId: String(pollId || ''),
    voterId: String(voterId || '').slice(0, MAX_NAME_LENGTH),
    voterName: String(voterName || 'Guest').slice(0, MAX_NAME_LENGTH),
    optionIndex: Number(optionIndex)
  };
}

export function buildPollClose({ pollId, creatorId, id }) {
  return {
    id: id || createMessageId(),
    kind: 'poll',
    action: 'close',
    pollId: String(pollId || ''),
    creatorId: String(creatorId || '').slice(0, MAX_NAME_LENGTH)
  };
}

export function buildQaAsk({ author, authorId = '', body, createdAt, questionId, id }) {
  return {
    id: id || createMessageId(),
    kind: 'qa',
    action: 'ask',
    questionId: questionId || createMessageId(),
    author: String(author || 'Guest').slice(0, MAX_NAME_LENGTH),
    authorId: String(authorId || '').slice(0, MAX_NAME_LENGTH),
    body: String(body || '').trim().slice(0, MAX_BODY_LENGTH),
    createdAt: typeof createdAt === 'number' ? createdAt : Date.now()
  };
}

export function buildQaVote({ questionId, voterId, delta, id }) {
  const d = Number(delta);
  return {
    id: id || createMessageId(),
    kind: 'qa',
    action: 'vote',
    questionId: String(questionId || ''),
    voterId: String(voterId || '').slice(0, MAX_NAME_LENGTH),
    delta: [1, 0, -1].includes(d) ? d : 0
  };
}

export function buildQaAnswered({ questionId, isAnswered, id }) {
  return {
    id: id || createMessageId(),
    kind: 'qa',
    action: 'answered',
    questionId: String(questionId || ''),
    isAnswered: Boolean(isAnswered)
  };
}

// --- Encode / decode ------------------------------------------------------

function encode(msg) {
  return new TextEncoder().encode(JSON.stringify(msg));
}

function toText(payload) {
  if (typeof payload === 'string') return payload;
  if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
  return null;
}

function parse(text) {
  try {
    const raw = JSON.parse(text);
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

export function encodePollMessage(msg) {
  return encode(msg);
}

export function decodePollMessage(payload) {
  const raw = parse(toText(payload));
  if (!raw || raw.kind !== 'poll') return null;
  if (raw.action === 'create') {
    const options = pick(raw.options).slice(0, POLL_MAX_OPTIONS);
    if (options.length < POLL_MIN_OPTIONS) return null;
    return {
      id: String(raw.id ?? ''),
      kind: 'poll',
      action: 'create',
      pollId: String(raw.pollId ?? ''),
      question: String(raw.question ?? '').slice(0, MAX_QUESTION_LENGTH),
      options,
      creator: String(raw.creator ?? 'Host').slice(0, MAX_NAME_LENGTH),
      creatorId: String(raw.creatorId ?? '').slice(0, MAX_NAME_LENGTH),
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
    };
  }
  if (raw.action === 'vote') {
    const idx = Number(raw.optionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= POLL_MAX_OPTIONS) return null;
    return {
      id: String(raw.id ?? ''),
      kind: 'poll',
      action: 'vote',
      pollId: String(raw.pollId ?? ''),
      voterId: String(raw.voterId ?? '').slice(0, MAX_NAME_LENGTH),
      voterName: String(raw.voterName ?? 'Guest').slice(0, MAX_NAME_LENGTH),
      optionIndex: idx
    };
  }
  if (raw.action === 'close') {
    return {
      id: String(raw.id ?? ''),
      kind: 'poll',
      action: 'close',
      pollId: String(raw.pollId ?? ''),
      creatorId: String(raw.creatorId ?? '').slice(0, MAX_NAME_LENGTH)
    };
  }
  return null;
}

export function encodeQaMessage(msg) {
  return encode(msg);
}

export function decodeQaMessage(payload) {
  const raw = parse(toText(payload));
  if (!raw || raw.kind !== 'qa') return null;
  if (raw.action === 'ask') {
    if (!String(raw.body ?? '').trim()) return null;
    return {
      id: String(raw.id ?? ''),
      kind: 'qa',
      action: 'ask',
      questionId: String(raw.questionId ?? ''),
      author: String(raw.author ?? 'Guest').slice(0, MAX_NAME_LENGTH),
      authorId: String(raw.authorId ?? '').slice(0, MAX_NAME_LENGTH),
      body: String(raw.body ?? '').slice(0, MAX_BODY_LENGTH),
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
    };
  }
  if (raw.action === 'vote') {
    const d = Number(raw.delta);
    if (![1, 0, -1].includes(d)) return null;
    return {
      id: String(raw.id ?? ''),
      kind: 'qa',
      action: 'vote',
      questionId: String(raw.questionId ?? ''),
      voterId: String(raw.voterId ?? '').slice(0, MAX_NAME_LENGTH),
      delta: d
    };
  }
  if (raw.action === 'answered') {
    return {
      id: String(raw.id ?? ''),
      kind: 'qa',
      action: 'answered',
      questionId: String(raw.questionId ?? ''),
      isAnswered: Boolean(raw.isAnswered)
    };
  }
  return null;
}

// --- Pure aggregation helpers --------------------------------------------

// Tally a poll's votes Map (voterId -> optionIndex) into per-option counts.
export function tallyPollVotes(votes, optionCount) {
  const counts = Array(optionCount).fill(0);
  votes.forEach((optionIndex) => {
    if (Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < optionCount) {
      counts[optionIndex] += 1;
    }
  });
  return counts;
}

// Sort QA questions by upvotes desc, newest first on ties (stable ordering).
export function sortQaQuestions(questions) {
  return [...(questions || [])].sort((a, b) => {
    if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}