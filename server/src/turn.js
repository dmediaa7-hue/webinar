'use strict';

// TURN relay credential generation (server side), with layered providers.
//
// STUN-only ICE fails when both peers sit behind symmetric NAT/CGNAT, so the
// app needs a TURN relay to fall back to. The providers, in priority order:
//
//   1. Static relay (env):          TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL
//   2. Cloudflare Realtime:         CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN
//   3. Metered Realtime (free):     METERED_APP_NAME / METERED_API_KEY
//   4. Open Relay (config-less):    the legacy free public relay
//                                   (staticauth.openrelay.metered.ca) - served
//                                   ONLY when a live STUN probe confirms it is
//                                   actually answering, because this public
//                                   service has repeatedly gone dark. A dead
//                                   relay advertised with `configured: true`
//                                   silently breaks every NAT'd participant.
//
// Whatever the provider, the response shape is the same:
//   { iceServers, ttl, configured, provider }
// `configured` is now honest: false means "serving STUN-only; remote peers
// behind symmetric NAT/CGNAT will not connect", so the client can surface a
// clear warning instead of letting calls fail mysteriously.
//
// Open Relay uses coturn static-auth ("auth-secret") credentials: the browser
// authenticates with username = <expiry unix timestamp> and credential =
// base64(HMAC-SHA1(secret, username)). The shared secret is publicly
// documented on the Open Relay site precisely because the relay is open by
// design. TTL stays inside coturn's allowed clock-skew (3600s default).

const crypto = require('node:crypto');
const net = require('node:net');

// Seconds a minted/fetched credential stays valid. 3600 = coturn clock skew;
// also the TTL requested from Cloudflare Realtime (max allowed is 48h).
const TURN_TTL_SECONDS = 3600;

// How long probe / Cloudflare results are reused before re-checking.
const PROBE_CACHE_MS = 60 * 1000;
const CLOUDFLARE_CACHE_MS = 30 * 60 * 1000;
const METERED_CACHE_MS = 30 * 60 * 1000;

// Cloudflare Realtime TURN REST endpoint. The key ID + a Calls API token are
// provided via env; this call mints short-lived per-user credentials.
const CLOUDFLARE_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

// Metered Realtime TURN REST endpoint. The app subdomain (the part before
// .metered.live) + a free API key come via env; this returns a bare
// iceServers array.
const METERED_TURN_API = (appName) => `https://${appName}.metered.live/api/v1/turn/credentials`;

// Open Relay constants (legacy default; probe-gated, see module comment).
const OPEN_RELAY_HOST = 'staticauth.openrelay.metered.ca';
const OPEN_RELAY_SECRET = 'openrelayprojectsecret';

let probeCache = null; // { at, alive }
let cloudflareCache = null; // { at, config }
let meteredCache = null; // { at, config }

// Port 53 is blocked by web browsers for TURN UDP/TCP, so those URLs only
// stall candidate gathering. Drop them before handing config to the client.
// `urls` may arrive as an array (Cloudflare wrapper shape) or a single string
// (Metered bare-array shape), so normalize both to an array first.
function filterBrowserBlockedUrls(iceServers) {
  return (iceServers || [])
    .map((entry) => {
      const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls].filter(Boolean);
      return {
        ...entry,
        urls: urls.filter((url) => !/(^|:)(53)(\?|$)/.test(url))
      };
    })
    .filter((entry) => entry.urls.length > 0);
}

// http://www.rfc-editor.org/rfc/rfc5389: Binding request = type 0x0001,
// 0x0000 length, magic cookie 0x2112A442, 12 random bytes transaction id.
function stunBindingRequest() {
  const txId = crypto.randomBytes(12);
  const req = Buffer.alloc(20);
  req.writeUInt16BE(0x0001, 0);
  req.writeUInt16BE(0x0000, 2);
  req.writeUInt32BE(0x2112a442, 4);
  txId.copy(req, 8);
  return req;
}

// Valid STUN Binding *response* = type 0x0101 with the same magic cookie.
function isStunResponse(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 20 &&
    buf.readUInt16BE(0) === 0x0101 &&
    buf.readUInt32BE(4) === 0x2112a442
  );
}

// Probes one TCP endpoint with a STUN Binding request. A web server accepts
// TCP but never answers STUN, so this distinguishes "real relay" from "site
// is up" (the openrelay.metered.ca trap). Resolves false on any failure.
function probeHostTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.on('connect', () => sock.write(stunBindingRequest()));
    sock.on('data', (chunk) => {
      if (isStunResponse(chunk)) finish(true);
    });
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.on('error', () => finish(false));
    sock.on('close', () => finish(false));
  });
}

// Resolves whether the Open Relay host answers STUN binding requests. Cached
// for PROBE_CACHE_MS so a dead relay is not re-probed on every peer creation.
async function probeOpenRelay() {
  if (probeCache && Date.now() - probeCache.at < PROBE_CACHE_MS) {
    return probeCache.alive;
  }
  const alive =
    (await probeHostTcp(OPEN_RELAY_HOST, 443)) ||
    (await probeHostTcp(OPEN_RELAY_HOST, 80));
  probeCache = { at: Date.now(), alive };
  if (!alive) {
    console.warn(
      '[turn] Open Relay STUN probe failed - relay appears offline. Falling back to STUN-only config.'
    );
  }
  return alive;
}

// Builds the Open Relay ICE server entry with a fresh time-limited credential.
function makeOpenRelayConfig() {
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = String(expiry);
  const credential = crypto
    .createHmac('sha1', OPEN_RELAY_SECRET)
    .update(username)
    .digest('base64');

  const iceServers = [
    {
      urls: [
        `turn:${OPEN_RELAY_HOST}:80?transport=udp`,
        `turn:${OPEN_RELAY_HOST}:80?transport=tcp`,
        `turn:${OPEN_RELAY_HOST}:443?transport=tcp`,
        `turns:${OPEN_RELAY_HOST}:443?transport=tcp`
      ],
      username,
      credential
    }
  ];

  return { iceServers: filterBrowserBlockedUrls(iceServers), ttl: TURN_TTL_SECONDS };
}

// Reads the static-relay env vars, if all three are present.
function staticRelayFromEnv() {
  const urls = (process.env.TURN_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  if (urls.length && username && credential) return { urls, username, credential };
  return null;
}

// Reads the Cloudflare Realtime env vars, if both are present.
function cloudflareFromEnv() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (keyId && apiToken) return { keyId, apiToken };
  return null;
}

// Reads the Metered Realtime env vars, if both are present.
function meteredFromEnv() {
  const appName = process.env.METERED_APP_NAME;
  const apiKey = process.env.METERED_API_KEY;
  if (appName && apiKey) return { appName, apiKey };
  return null;
}

// Fetches short-lived Cloudflare Realtime credentials (POST, REST). The
// response shape mirrors draft-uberti-behave-turn-rest-00: { iceServers: [{urls,
// username, credential}] } with a TURN entry and a separate STUN-only entry,
// and does NOT carry the requested TTL back (so we supply it ourselves).
// Their default URLs include :53 variants, which filterBrowserBlockedUrls
// strips. Cached for CLOUDFLARE_CACHE_MS; failures resolve to a
// configured:false config with provider 'cloudflare-error'.
async function fetchCloudflareConfig(cf) {
  if (cloudflareCache && Date.now() - cloudflareCache.at < CLOUDFLARE_CACHE_MS) {
    return cloudflareCache.config;
  }
  let config;
  try {
    const res = await fetch(`${CLOUDFLARE_TURN_API}/${cf.keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cf.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS })
    });
    if (!res.ok) throw new Error(`Cloudflare TURN HTTP ${res.status}`);
    const data = await res.json();
    const iceServers = filterBrowserBlockedUrls(data.iceServers || []);
    if (!iceServers.length) {
      throw new Error('Cloudflare TURN returned no usable iceServers');
    }
    config = {
      iceServers,
      ttl: TURN_TTL_SECONDS,
      configured: true,
      provider: 'cloudflare'
    };
  } catch (err) {
    console.warn(`[turn] Cloudflare TURN credential fetch failed: ${err.message}`);
    config = { iceServers: [], ttl: 0, configured: false, provider: 'cloudflare-error' };
  }
  cloudflareCache = { at: Date.now(), config };
  return config;
}

// Fetches short-lived Metered Realtime credentials (GET, REST). The docs show
// the response IS a bare iceServers array: [{ urls, username, credential }, ...]
// (unlike Cloudflare's { iceServers: [...] } wrapper), so both shapes are
// tolerated. Credentials are minted server-side by Metered with their own TTL.
// Cached for METERED_CACHE_MS; failures resolve to a configured:false config
// with provider 'metered-error'.
async function fetchMeteredConfig(met) {
  if (meteredCache && Date.now() - meteredCache.at < METERED_CACHE_MS) {
    return meteredCache.config;
  }
  let config;
  try {
    const res = await fetch(
      `${METERED_TURN_API(met.appName)}?apiKey=${encodeURIComponent(met.apiKey)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' }
      }
    );
    if (!res.ok) throw new Error(`Metered TURN HTTP ${res.status}`);
    const data = await res.json();
    const raw = Array.isArray(data) ? data : data.iceServers;
    const iceServers = filterBrowserBlockedUrls(raw || []);
    if (!iceServers.length) {
      throw new Error('Metered TURN returned no usable iceServers');
    }
    config = {
      iceServers,
      ttl: TURN_TTL_SECONDS,
      configured: true,
      provider: 'metered'
    };
  } catch (err) {
    console.warn(`[turn] Metered TURN credential fetch failed: ${err.message}`);
    config = { iceServers: [], ttl: 0, configured: false, provider: 'metered-error' };
  }
  meteredCache = { at: Date.now(), config };
  return config;
}

/**
 * Returns { iceServers, ttl, configured, provider } for the client's peer
 * connections. `options` exists for hermetic unit tests:
 *   - options.probe            override the Open Relay liveness probe
 *   - options.fetchCloudflare  override the Cloudflare credential fetch
 *   - options.fetchMetered     override the Metered credential fetch
 */
async function getTurnCredentials(options = {}) {
  const probe = options.probe || probeOpenRelay;
  const fetchCloudflare = options.fetchCloudflare || fetchCloudflareConfig;
  const fetchMetered = options.fetchMetered || fetchMeteredConfig;

  // 1. Static relay from env - highest priority, operator-configured.
  const staticRelay = staticRelayFromEnv();
  if (staticRelay) {
    return {
      iceServers: filterBrowserBlockedUrls([
        { urls: staticRelay.urls, username: staticRelay.username, credential: staticRelay.credential }
      ]),
      ttl: TURN_TTL_SECONDS,
      configured: true,
      provider: 'static'
    };
  }

  // 2. Cloudflare Realtime.
  const cf = cloudflareFromEnv();
  if (cf) return fetchCloudflare(cf);

  // 3. Metered Realtime (free account).
  const met = meteredFromEnv();
  if (met) return fetchMetered(met);

  // 4. Open Relay - config-less legacy default, served only when it is live.
  if (await probe()) {
    return { ...makeOpenRelayConfig(), configured: true, provider: 'openrelay' };
  }

  // No relay available: STUN-only, and say so honestly. The client keeps
  // working on relay-reachable NATs and warns that NAT'd peers cannot join.
  return { iceServers: [], ttl: 0, configured: false, provider: 'openrelay-unreachable' };
}

// Test-only: clears cached probe/Cloudflare/Metered results between tests.
function _resetCaches() {
  probeCache = null;
  cloudflareCache = null;
  meteredCache = null;
}

module.exports = { getTurnCredentials, filterBrowserBlockedUrls, _resetCaches };