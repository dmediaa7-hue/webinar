'use strict';

// Cloudflare Realtime TURN credential generation (server side).
//
// STUN-only ICE fails when both peers sit behind symmetric NAT/CGNAT, so the
// app needs a TURN relay to fall back to. Cloudflare issues short-lived
// credentials via an HTTPS API; the returned iceServers are passed straight to
// the browser (RTCPeerConnection config).
//
// Setup (one-time, free Cloudflare account):
//   1. Dashboard -> Realtime -> TURN -> create a TURN key.
//   2. Save the key's uid as CLOUDFLARE_TURN_KEY_ID and its secret (shown once
//      at creation) as CLOUDFLARE_TURN_KEY_API_TOKEN.
//   3. Costs $0.05/real-time GB outbound; tiny for small meetings.
//
// Reference: https://developers.cloudflare.com/realtime/turn/generate-credentials

const CF_GENERATE_URL =
  'https://rtc.live.cloudflare.com/v1/turn/keys/_KEY_/credentials/generate-ice-servers';

// Credentials are valid up to 48h (API rejects ttl > 172800). Keep them valid
// for a full day; sessions this app can hold never outlive that.
const TURN_TTL_SECONDS = 86400;

// Refresh the cached credential set well before it actually expires.
const CACHE_MS = 60 * 60 * 1000;

let cache = null; // { iceServers, fetchedAt }
let inFlight = null; // dedupe concurrent refreshes

function isConfigured() {
  return Boolean(process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_KEY_API_TOKEN);
}

// Port 53 is blocked by web browsers for TURN UDP/TCP, so those URLs only
// stall candidate gathering. Drop them before handing config to the client.
function filterBrowserBlockedUrls(iceServers) {
  return (iceServers || [])
    .map((entry) => ({
      ...entry,
      urls: (entry.urls || []).filter((url) => !/(^|:)(53)(\?|$)/.test(url))
    }))
    .filter((entry) => entry.urls.length > 0);
}

async function fetchCredentials(ttlSeconds) {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  const url = CF_GENERATE_URL.replace('_KEY_', encodeURIComponent(keyId));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ttl: ttlSeconds })
  });
  if (!res.ok) {
    throw new Error(`TURN credential generation failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return { iceServers: filterBrowserBlockedUrls(data.iceServers), ttl: ttlSeconds };
}

/**
 * Returns { iceServers, ttl }, refreshing from Cloudflare at most hourly.
 * Resolves null when TURN is not configured (server env vars missing).
 */
async function getTurnCredentials() {
  if (!isConfigured()) return null;
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return { iceServers: cache.iceServers, ttl: TURN_TTL_SECONDS };
  }
  if (!inFlight) {
    inFlight = fetchCredentials(TURN_TTL_SECONDS)
      .then((creds) => {
        cache = { iceServers: creds.iceServers, fetchedAt: Date.now() };
        return creds;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

module.exports = { getTurnCredentials, filterBrowserBlockedUrls, isConfigured };