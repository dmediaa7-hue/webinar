// TURN credential helpers unit tests: port-53 filtering + config gating.
// Pure helpers over env/config; runs with node:test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filterBrowserBlockedUrls, isConfigured } = require('../src/turn');

test('filterBrowserBlockedUrls strips port-53 URLs (blocked by browsers)', () => {
  const config = {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:53?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp'
        ],
        username: 'u',
        credential: 'c'
      }
    ]
  };
  const filtered = filterBrowserBlockedUrls(config.iceServers);
  assert.deepEqual(filtered[0].urls, ['stun:stun.cloudflare.com:3478']);
  assert.deepEqual(filtered[1].urls, [
    'turn:turn.cloudflare.com:3478?transport=udp',
    'turns:turn.cloudflare.com:443?transport=tcp'
  ]);
  assert.equal(filtered[1].username, 'u');
  assert.equal(filtered[1].credential, 'c');
});

test('filterBrowserBlockedUrls drops entries left with no URLs', () => {
  const filtered = filterBrowserBlockedUrls([
    { urls: ['turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' },
    { urls: ['stun:stun.cloudflare.com:3478'] }
  ]);
  assert.deepEqual(filtered.map((e) => e.urls), [['stun:stun.cloudflare.com:3478']]);
});

test('filterBrowserBlockedUrls tolerates missing/malformed input', () => {
  assert.deepEqual(filterBrowserBlockedUrls(undefined), []);
  assert.deepEqual(filterBrowserBlockedUrls(null), []);
  assert.deepEqual(filterBrowserBlockedUrls([{ noUrls: true }]), []);
});

test('isConfigured requires both key id and API token', () => {
  const original = { keyId: process.env.CLOUDFLARE_TURN_KEY_ID, token: process.env.CLOUDFLARE_TURN_KEY_API_TOKEN };
  try {
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
    assert.equal(isConfigured(), false);
    process.env.CLOUDFLARE_TURN_KEY_ID = 'abc';
    assert.equal(isConfigured(), false);
    process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = 'secret';
    assert.equal(isConfigured(), true);
  } finally {
    original.keyId !== undefined ? (process.env.CLOUDFLARE_TURN_KEY_ID = original.keyId) : delete process.env.CLOUDFLARE_TURN_KEY_ID;
    original.token !== undefined ? (process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = original.token) : delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  }
});