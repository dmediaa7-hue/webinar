import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldInitiate } from '../utils/initiator.js';

test('lexically smaller socket id initiates', () => {
  assert.equal(shouldInitiate('aaa', 'bbb'), true);
  assert.equal(shouldInitiate('bbb', 'aaa'), false);
});

test('same id delegates to answerer (never self-initiate)', () => {
  assert.equal(shouldInitiate('abc', 'abc'), false);
});

test('missing ids fall back to answerer', () => {
  assert.equal(shouldInitiate('', 'bbb'), false);
  assert.equal(shouldInitiate('aaa', ''), false);
  assert.equal(shouldInitiate(undefined, 'bbb'), false);
  assert.equal(shouldInitiate('aaa', null), false);
});

test('both endpoints agree on the same initiator (glare-free)', () => {
  const myId = 'peer-X';
  const theirId = 'peer-Y';
  const meInitiates = shouldInitiate(myId, theirId);
  const themInitiates = shouldInitiate(theirId, myId);
  // Exactly one side initiates; the decision is complementary, not symmetric.
  assert.notEqual(meInitiates, themInitiates);
  // And each side must agree with itself over repeated calls (no flip-flop).
  assert.equal(shouldInitiate(myId, theirId), meInitiates);
});