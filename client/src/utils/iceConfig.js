import { ICE_SERVERS, SERVER_URL } from './constants';

let cache = null; // { iceServers, fetchedAt }
let inFlight = null; // dedupe concurrent calls

const CACHE_MS = 30 * 60 * 1000;

// Fetches short-lived TURN credentials from the backend and fuses them with
// the static STUN-only base config. Falls back to STUN-only on any failure so
// calls still work on symmetric NATs (slower/less reliable) instead of breaking.
export async function getIceConfig() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.iceServers;
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/turn-credentials`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const iceServers = [...ICE_SERVERS.iceServers, ...(data.iceServers || [])];
        cache = { iceServers, fetchedAt: Date.now() };
        return iceServers;
      } catch (err) {
        console.warn('[ICE] TURN fetch failed, using STUN-only config:', err.message);
        return ICE_SERVERS.iceServers;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}