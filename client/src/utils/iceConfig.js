import { ICE_SERVERS, SERVER_URL } from './constants';

let cache = null; // { iceServers, fetchedAt, ttlMs }
let inFlight = null; // dedupe concurrent calls

const CACHE_MS = 30 * 60 * 1000;
// Failure fallback TTL: short enough that a newly-configured TURN backend is
// picked up quickly, but long enough that each peer creation during an outage
// does not re-hit the dead endpoint (503 spam in the console per peer).
const FAILURE_CACHE_MS = 60 * 1000;

// Fetches short-lived TURN credentials from the backend and fuses them with
// the static STUN-only base config. Falls back to STUN-only on any failure so
// calls still work (on relay-reachable NATs) instead of breaking; the fallback
// is cached briefly so N simultaneous peer creations make 1 request, not N.
export async function getIceConfig() {
  if (cache && Date.now() - cache.fetchedAt < cache.ttlMs) return cache.iceServers;
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/turn-credentials`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const iceServers = [...ICE_SERVERS.iceServers, ...(data.iceServers || [])];
        cache = { iceServers, fetchedAt: Date.now(), ttlMs: CACHE_MS };
        return iceServers;
      } catch (err) {
        console.warn('[ICE] TURN fetch failed, using STUN-only config:', err.message);
        cache = { iceServers: ICE_SERVERS.iceServers, fetchedAt: Date.now(), ttlMs: FAILURE_CACHE_MS };
        return ICE_SERVERS.iceServers;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}