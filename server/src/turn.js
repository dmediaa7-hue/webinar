'use strict';

// Free TURN relay credential generation (server side).
//
// STUN-only ICE fails when both peers sit behind symmetric NAT/CGNAT, so the
// app needs a TURN relay to fall back to. This module serves the Open Relay
// Project (https://www.metered.ca/tools/openrelay) - a free public relay
// operated by Metered Video that needs no account, no API key and no env vars.
//
// Open Relay uses coturn static-auth ("auth-secret") credentials: the browser
// authenticates with username = <expiry unix timestamp> and credential =
// base64(HMAC-SHA1(secret, username)). The shared secret is publicly
// documented on the Open Relay site precisely because the relay is open by
// design, so this server can mint valid time-limited credentials itself.
//
// TTL must stay inside coturn's allowed clock-skew (3600s default), matching
// the same scheme Nextcloud Talk uses against this exact relay.

const crypto = require('node:crypto');

const RELAY_HOST = 'staticauth.openrelay.metered.ca';
// Public static-auth secret, published at the Open Relay Project docs page
// (Static Auth section). Not a private key - the relay is open for anyone.
const RELAY_SECRET = 'openrelayprojectsecret';

// Seconds the minted credential stays valid. 3600 = coturn allowed clock skew.
const TURN_TTL_SECONDS = 3600;

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

/**
 * Returns { iceServers, ttl } with the free Open Relay TURN relay and a fresh
 * time-limited credential. Always available - no configuration required.
 */
function getTurnCredentials() {
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = String(expiry);
  const credential = crypto
    .createHmac('sha1', RELAY_SECRET)
    .update(username)
    .digest('base64');

  const iceServers = [
    {
      urls: [
        `turn:${RELAY_HOST}:80?transport=udp`,
        `turn:${RELAY_HOST}:80?transport=tcp`,
        `turn:${RELAY_HOST}:443?transport=tcp`,
        `turns:${RELAY_HOST}:443?transport=tcp`
      ],
      username,
      credential
    }
  ];

  return { iceServers: filterBrowserBlockedUrls(iceServers), ttl: TURN_TTL_SECONDS };
}

module.exports = { getTurnCredentials, filterBrowserBlockedUrls };