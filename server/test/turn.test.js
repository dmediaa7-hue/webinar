// TURN credential helper unit tests: port-53 filtering, provider priority
// (static env > Cloudflare Realtime > probe-gated Open Relay) and honest
// `configured` reporting. Pure helpers; runs with node:test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getTurnCredentials, filterBrowserBlockedUrls, _resetCaches } = require('../src/turn');

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

// The default (no env, dead relay) path must not touch the network in tests:
// getTurnCredentials accepts { probe, fetchCloudflare } overrides for that.

test('static env relay is used when TURN_URLS/USERNAME/CREDENTIAL are set', async () => {
  const prev = {
    TURN_URLS: process.env.TURN_URLS,
    TURN_USERNAME: process.env.TURN_USERNAME,
    TURN_CREDENTIAL: process.env.TURN_CREDENTIAL
  };
  try {
    _resetCaches();
    process.env.TURN_URLS =
      'turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turn:turn.example.com:53?transport=udp';
    process.env.TURN_USERNAME = 'env-user';
    process.env.TURN_CREDENTIAL = 'env-cred';

    const config = await getTurnCredentials();
    assert.equal(config.configured, true);
    assert.equal(config.provider, 'static');
    assert.equal(config.ttl, 3600);
    assert.equal(config.iceServers.length, 1);
    const entry = config.iceServers[0];
    assert.equal(entry.username, 'env-user');
    assert.equal(entry.credential, 'env-cred');
    // Port-53 URL filtered out even for env-provided relays.
    assert.ok(!entry.urls.some((u) => u.includes(':53')));
    assert.ok(entry.urls.includes('turn:turn.example.com:3478?transport=udp'));
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('static env relay wins even when Cloudflare vars are also set', async () => {
  const prev = {
    TURN_URLS: process.env.TURN_URLS,
    TURN_USERNAME: process.env.TURN_USERNAME,
    TURN_CREDENTIAL: process.env.TURN_CREDENTIAL,
    CLOUDFLARE_TURN_KEY_ID: process.env.CLOUDFLARE_TURN_KEY_ID,
    CLOUDFLARE_TURN_API_TOKEN: process.env.CLOUDFLARE_TURN_API_TOKEN
  };
  try {
    _resetCaches();
    process.env.TURN_URLS = 'turns:turn.example.com:5349?transport=tcp';
    process.env.TURN_USERNAME = 'u';
    process.env.TURN_CREDENTIAL = 'c';
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';

    const config = await getTurnCredentials();
    assert.equal(config.provider, 'static');
    // fetchCloudflare was never called (verify priority without injection).
    assert.equal(config.iceServers[0].urls[0], 'turns:turn.example.com:5349?transport=tcp');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('Cloudflare Realtime config is used, filtered, and reported configured', async () => {
  const prev = {
    CLOUDFLARE_TURN_KEY_ID: process.env.CLOUDFLARE_TURN_KEY_ID,
    CLOUDFLARE_TURN_API_TOKEN: process.env.CLOUDFLARE_TURN_API_TOKEN
  };
  const realFetch = globalThis.fetch;
  try {
    _resetCaches();
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';

    // Stub the Cloudflare REST endpoint: mirrors the documented response shape,
    // including the port-53 URLs Cloudflare's API actually returns.
    let calledUrl = null;
    globalThis.fetch = async (url, opts) => {
      calledUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:3478?transport=tcp',
                'turn:turn.cloudflare.com:80?transport=tcp',
                'turns:turn.cloudflare.com:443?transport=tcp',
                'turn:turn.cloudflare.com:53?transport=udp'
              ],
              username: 'cf-user',
              credential: 'cf-cred'
            }
          ]
        })
      };
    };

    const config = await getTurnCredentials();
    assert.equal(calledUrl, 'https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers');
    assert.equal(config.configured, true);
    assert.equal(config.provider, 'cloudflare');
    assert.equal(config.ttl, 3600);
    const turnEntry = config.iceServers.find((e) => e.username === 'cf-user');
    assert.ok(turnEntry, 'TURN entry with credentials present');
    assert.ok(!turnEntry.urls.some((u) => u.includes(':53')), ':53 URLs stripped');
    // The STUN-only entry (no username/credential) is kept intact.
    assert.ok(config.iceServers.some((e) => e.urls.includes('stun:stun.cloudflare.com:3478')));
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('Cloudflare fetch failure resolves to configured:false, not a dead relay', async () => {
  const prev = {
    CLOUDFLARE_TURN_KEY_ID: process.env.CLOUDFLARE_TURN_KEY_ID,
    CLOUDFLARE_TURN_API_TOKEN: process.env.CLOUDFLARE_TURN_API_TOKEN
  };
  const realFetch = globalThis.fetch;
  try {
    _resetCaches();
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';

    globalThis.fetch = async () => {
      throw new Error('HTTP 500');
    };

    const config = await getTurnCredentials();
    assert.equal(config.configured, false);
    assert.equal(config.provider, 'cloudflare-error');
    assert.deepEqual(config.iceServers, []);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('Metered Realtime config (bare array shape) is used, filtered, and reported configured', async () => {
  const prev = {
    METERED_APP_NAME: process.env.METERED_APP_NAME,
    METERED_API_KEY: process.env.METERED_API_KEY
  };
  const realFetch = globalThis.fetch;
  try {
    _resetCaches();
    process.env.METERED_APP_NAME = 'myapp';
    process.env.METERED_API_KEY = 'pk_live_abc';

    let calledUrl = null;
    globalThis.fetch = async (url) => {
      calledUrl = String(url);
      return {
        ok: true,
        json: async () => [
          { urls: 'stun:stun.metered.ca:80' },
          {
            urls: 'turn:global.turn.metered.ca:80?transport=udp',
            username: 'metered-user',
            credential: 'metered-cred'
          },
          {
            urls: 'turn:global.turn.metered.ca:80?transport=tcp',
            username: 'metered-user',
            credential: 'metered-cred'
          },
          {
            urls: 'turns:global.turn.metered.ca:443?transport=tcp',
            username: 'metered-user',
            credential: 'metered-cred'
          },
          {
            urls: 'turn:global.turn.metered.ca:53?transport=udp',
            username: 'metered-user',
            credential: 'metered-cred'
          }
        ]
      };
    };

    const config = await getTurnCredentials();
    assert.equal(calledUrl, 'https://myapp.metered.live/api/v1/turn/credentials?apiKey=pk_live_abc');
    assert.equal(config.configured, true);
    assert.equal(config.provider, 'metered');
    assert.equal(config.ttl, 3600);
    const turnEntry = config.iceServers.find((e) => e.username === 'metered-user');
    assert.ok(turnEntry, 'TURN entry with credentials present');
    assert.ok(!turnEntry.urls.some((u) => u.includes(':53')), ':53 URLs stripped');
    assert.ok(config.iceServers.some((e) => e.urls.includes('stun:stun.metered.ca:80')));
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('Metered Realtime tolerates the { iceServers } wrapped shape', async () => {
  const prev = {
    METERED_APP_NAME: process.env.METERED_APP_NAME,
    METERED_API_KEY: process.env.METERED_API_KEY
  };
  const realFetch = globalThis.fetch;
  try {
    _resetCaches();
    process.env.METERED_APP_NAME = 'wrapapp';
    process.env.METERED_API_KEY = 'pk_wrap';

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        iceServers: [
          {
            urls: ['turn:global.turn.metered.ca:80?transport=udp', 'turns:global.turn.metered.ca:443?transport=tcp'],
            username: 'wrapped-user',
            credential: 'wrapped-cred'
          }
        ]
      })
    });

    const config = await getTurnCredentials();
    assert.equal(config.configured, true);
    assert.equal(config.provider, 'metered');
    assert.equal(config.iceServers[0].username, 'wrapped-user');
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('Metered fetch failure resolves to configured:false, not a dead relay', async () => {
  const prev = {
    METERED_APP_NAME: process.env.METERED_APP_NAME,
    METERED_API_KEY: process.env.METERED_API_KEY
  };
  const realFetch = globalThis.fetch;
  try {
    _resetCaches();
    process.env.METERED_APP_NAME = 'app';
    process.env.METERED_API_KEY = 'bad-key';

    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' })
    });

    const config = await getTurnCredentials();
    assert.equal(config.configured, false);
    assert.equal(config.provider, 'metered-error');
    assert.deepEqual(config.iceServers, []);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('Metered provider is consulted before the Open Relay probe', async () => {
  const prev = {
    METERED_APP_NAME: process.env.METERED_APP_NAME,
    METERED_API_KEY: process.env.METERED_API_KEY
  };
  const realFetch = globalThis.fetch;
  try {
    _resetCaches();
    process.env.METERED_APP_NAME = 'app';
    process.env.METERED_API_KEY = 'key';

    let probeCalled = false;
    let meteredCalled = false;
    globalThis.fetch = async () => {
      meteredCalled = true;
      return { ok: true, json: async () => [{ urls: ['turn:global.turn.metered.ca:80?transport=udp'], username: 'u', credential: 'c' }] };
    };

    const config = await getTurnCredentials({
      probe: async () => {
        probeCalled = true;
        return true;
      }
    });

    assert.equal(meteredCalled, true, 'Metered fetch was called');
    assert.equal(probeCalled, false, 'Open Relay probe was not consulted when Metered is configured');
    assert.equal(config.provider, 'metered');
    assert.equal(config.configured, true);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('dead Open Relay (probe=false) resolves to STUN-only with configured:false', async () => {
  // Reproduces production reality as of 2026-09: no env vars set, the free
  // Open Relay no longer answers STUN, so the server must say so honestly.
  const prev = {
    TURN_URLS: process.env.TURN_URLS,
    TURN_USERNAME: process.env.TURN_USERNAME,
    TURN_CREDENTIAL: process.env.TURN_CREDENTIAL,
    CLOUDFLARE_TURN_KEY_ID: process.env.CLOUDFLARE_TURN_KEY_ID,
    CLOUDFLARE_TURN_API_TOKEN: process.env.CLOUDFLARE_TURN_API_TOKEN
  };
  try {
    for (const k of Object.keys(prev)) delete process.env[k];
    _resetCaches();

    const config = await getTurnCredentials({ probe: async () => false });
    assert.equal(config.configured, false);
    assert.equal(config.provider, 'openrelay-unreachable');
    assert.deepEqual(config.iceServers, []);
    assert.equal(config.ttl, 0);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});

test('live Open Relay (probe=true) still mints HMAC credentials', async () => {
  const prev = {
    TURN_URLS: process.env.TURN_URLS,
    TURN_USERNAME: process.env.TURN_USERNAME,
    TURN_CREDENTIAL: process.env.TURN_CREDENTIAL,
    CLOUDFLARE_TURN_KEY_ID: process.env.CLOUDFLARE_TURN_KEY_ID,
    CLOUDFLARE_TURN_API_TOKEN: process.env.CLOUDFLARE_TURN_API_TOKEN
  };
  try {
    for (const k of Object.keys(prev)) delete process.env[k];
    _resetCaches();

    const now = Math.floor(Date.now() / 1000);
    const config = await getTurnCredentials({ probe: async () => true });
    assert.equal(config.configured, true);
    assert.equal(config.provider, 'openrelay');
    assert.equal(config.iceServers.length, 1);
    const entry = config.iceServers[0];
    assert.ok(/^\d+$/.test(entry.username), 'username is a unix expiry timestamp');
    assert.ok(Number(entry.username) > now, 'expiry is in the future');
    assert.ok(Number(entry.username) <= now + config.ttl, 'expiry within ttl');
    const expected = crypto
      .createHmac('sha1', 'openrelayprojectsecret')
      .update(entry.username)
      .digest('base64');
    assert.equal(entry.credential, expected);
    assert.ok(
      entry.urls.every((u) => u.includes('staticauth.openrelay.metered.ca')),
      'all URLs point at the Open Relay host'
    );
    assert.ok(entry.urls.length >= 4, 'UDP/TCP variants on 80 and 443 provided');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetCaches();
  }
});