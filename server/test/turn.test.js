// TURN credential helper unit tests: port-53 filtering + free Open Relay
// credential generation. Pure helpers; runs with node:test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getTurnCredentials, filterBrowserBlockedUrls } = require('../src/turn');

test('filterBrowserBlockedUrls strips port-53 URLs (blocked by browsers)', () => {
  const config = {
    iceServers: [
      { urls: ['stun:stun.example.com:3478', 'stun:stun.example.com:53'] },
      {
        urls: [
          'turn:turn.example.com:3478?transport=udp',
          'turn:turn.example.com:53?transport=udp',
          'turns:turn.example.com:443?transport=tcp'
        ],
        username: 'u',
        credential: 'c'
      }
    ]
  };
  const filtered = filterBrowserBlockedUrls(config.iceServers);
  assert.deepEqual(filtered[0].urls, ['stun:stun.example.com:3478']);
  assert.deepEqual(filtered[1].urls, [
    'turn:turn.example.com:3478?transport=udp',
    'turns:turn.example.com:443?transport=tcp'
  ]);
  assert.equal(filtered[1].username, 'u');
  assert.equal(filtered[1].credential, 'c');
});

test('filterBrowserBlockedUrls drops entries left with no URLs', () => {
  const filtered = filterBrowserBlockedUrls([
    { urls: ['turn:turn.example.com:53?transport=udp'], username: 'u', credential: 'c' },
    { urls: ['stun:stun.example.com:3478'] }
  ]);
  assert.deepEqual(filtered.map((e) => e.urls), [['stun:stun.example.com:3478']]);
});

test('filterBrowserBlockedUrls tolerates missing/malformed input', () => {
  assert.deepEqual(filterBrowserBlockedUrls(undefined), []);
  assert.deepEqual(filterBrowserBlockedUrls(null), []);
  assert.deepEqual(filterBrowserBlockedUrls([{ noUrls: true }]), []);
});

test('getTurnCredentials returns the free Open Relay relay with a time-limited credential', () => {
  const now = Math.floor(Date.now() / 1000);
  const { iceServers, ttl } = getTurnCredentials();
  assert.ok(Array.isArray(iceServers) && iceServers.length === 1, 'one ICE server entry');
  const entry = iceServers[0];
  assert.ok(entry.username, 'username present');
  assert.ok(entry.credential, 'credential present');
  assert.ok(/^\d+$/.test(entry.username), 'username is a unix expiry timestamp');
  assert.ok(Number(entry.username) > now, 'expiry is in the future');
  assert.ok(Number(entry.username) <= now + ttl, 'expiry within ttl');
  assert.ok(
    entry.urls.every((u) => u.includes('staticauth.openrelay.metered.ca')),
    'all URLs point at the Open Relay host'
  );
  assert.ok(entry.urls.length >= 4, 'UDP/TCP variants on 80 and 443 provided');
});

test('getTurnCredentials credential is base64 HMAC-SHA1 of the documented public secret', () => {
  // The Open Relay secret is public by design (documented at
  // https://www.metered.ca/tools/openrelay, Static Auth section); this test
  // recomputes the expected credential to lock the auth scheme.
  const { iceServers } = getTurnCredentials();
  const entry = iceServers[0];
  const expected = crypto
    .createHmac('sha1', 'openrelayprojectsecret')
    .update(entry.username)
    .digest('base64');
  assert.equal(entry.credential, expected);
});