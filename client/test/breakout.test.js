import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  breakoutRoomLabel,
  nextBreakoutNumber,
  participantBreakoutName,
  listBreakouts,
  createBreakout,
  assignBreakout,
  returnBreakout,
  teardownBreakouts
} from '../src/utils/breakout.js';

// --- Pure helpers ---

test('breakoutRoomLabel extracts the label from a {main}:N room', () => {
  assert.equal(breakoutRoomLabel('abc123:1', 'abc123'), '1');
  assert.equal(breakoutRoomLabel('abc123:design', 'abc123'), 'design');
  assert.equal(breakoutRoomLabel('abc123', 'abc123'), null, 'main room has no label');
  assert.equal(breakoutRoomLabel('other:1', 'abc123'), null, 'unrelated room');
  assert.equal(breakoutRoomLabel(null, 'abc123'), null);
  assert.equal(breakoutRoomLabel('abc123:', 'abc123'), null, 'empty label');
});

test('nextBreakoutNumber returns the smallest unused positive integer', () => {
  assert.equal(nextBreakoutNumber([]), 1);
  assert.equal(nextBreakoutNumber([{ name: '1' }]), 2);
  assert.equal(nextBreakoutNumber([{ name: '1' }, { name: '2' }, { name: '3' }]), 4);
  assert.equal(nextBreakoutNumber([{ name: '2' }]), 1, 'gaps are reused');
  assert.equal(nextBreakoutNumber([{ name: 'design' }, { name: '1' }]), 2, 'named labels ignored');
  assert.equal(nextBreakoutNumber(null), 1, 'null-safe');
});

test('participantBreakoutName finds a participant in the assignments', () => {
  const assignments = [
    { identity: 'sock-a', breakoutName: '1' },
    { identity: 'sock-b', breakoutName: '2' }
  ];
  assert.equal(participantBreakoutName(assignments, 'sock-b'), '2');
  assert.equal(participantBreakoutName(assignments, 'sock-c'), null);
  assert.equal(participantBreakoutName(null, 'sock-a'), null);
  assert.equal(participantBreakoutName(assignments, null), null);
});

// --- REST wrappers (fake fetch; the utils send x-host-id + correct paths) ---
// API_BASE is '' under node:test (no import.meta.env), so URLs are path-only.

function fakeFetch(routes) {
  return async (url, options = {}) => {
    const route = routes.find((r) => r.url === url && (r.method || 'GET') === (options.method || 'GET'));
    if (!route) {
      return { ok: false, status: 404, json: async () => ({ error: `no route for ${options.method || 'GET'} ${url}` }) };
    }
    return {
      ok: route.ok ?? true,
      status: route.status ?? 200,
      json: async () => route.body ?? {}
    };
  };
}

test('listBreakouts GETs the room endpoint with x-host-id', async () => {
  const state = {
    roomId: 'r1',
    breakouts: [{ name: '1', livekitRoom: 'r1:1', identities: ['sock-a'] }],
    assignments: [{ identity: 'sock-a', breakoutName: '1' }]
  };
  const callOptions = [];
  const fetchImpl = async (url, options) => {
    callOptions.push({ url, options });
    return { ok: true, status: 200, json: async () => state };
  };
  const result = await listBreakouts('r1', 'host-1', fetchImpl);
  assert.equal(result.breakouts[0].name, '1');
  assert.equal(callOptions.length, 1);
  assert.equal(callOptions[0].url, '/api/rooms/r1/breakouts');
  assert.equal(callOptions[0].options.headers['x-host-id'], 'host-1');
});

test('createBreakout POSTs { name } and surfaces created breakout', async () => {
  const fetchImpl = fakeFetch([
    {
      url: '/api/rooms/r1/breakouts',
      method: 'POST',
      status: 201,
      body: { roomId: 'r1', breakout: { name: '2', livekitRoom: 'r1:2' } }
    }
  ]);
  const result = await createBreakout('r1', 'host-1', '2', fetchImpl);
  assert.equal(result.breakout.name, '2');
});

test('createBreakout without a name sends null so the server auto-numbers', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(JSON.parse(options.body));
    return { ok: true, status: 201, json: async () => ({ roomId: 'r1', breakout: { name: '3' } }) };
  };
  await createBreakout('r1', 'host-1', null, fetchImpl);
  assert.deepEqual(seen, [{ name: null }]);
});

test('assignBreakout POSTs identity + name', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, method: options.method, headers: options.headers, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, identity: 'sock-a', livekitRoom: 'r1:1' }) };
  };
  const result = await assignBreakout('r1', 'host-1', 'sock-a', '1', fetchImpl);
  assert.equal(result.livekitRoom, 'r1:1');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].headers['x-host-id'], 'host-1');
  assert.deepEqual(seen[0].body, { identity: 'sock-a', name: '1' });
});

test('returnBreakout POSTs identity', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ ok: true, identity: 'sock-a', livekitRoom: 'r1', alreadyInMain: true }) };
  };
  const result = await returnBreakout('r1', 'host-1', 'sock-a', fetchImpl);
  assert.deepEqual(seen, [{ identity: 'sock-a' }]);
  assert.equal(result.alreadyInMain, true);
});

test('teardownBreakouts POSTs without a body', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ method: options.method, body: options.body });
    return { ok: true, status: 200, json: async () => ({ ok: true, removed: 2 }) };
  };
  const result = await teardownBreakouts('r1', 'host-1', fetchImpl);
  assert.equal(result.removed, 2);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].body, undefined);
});

test('REST wrappers throw the server error message + code on failure', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'LiveKit is not configured', code: 'LIVEKIT_NOT_CONFIGURED' })
  });
  await assert.rejects(
    () => createBreakout('r1', 'host-1', '1', fetchImpl),
    (err) => {
      assert.equal(err.message, 'LiveKit is not configured');
      assert.equal(err.code, 'LIVEKIT_NOT_CONFIGURED');
      assert.equal(err.status, 503);
      return true;
    }
  );
});

test('REST wrappers throw a generic error when the body has no message', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => listBreakouts('r1', 'bad-host', fetchImpl), /Request failed \(403\)/);
});