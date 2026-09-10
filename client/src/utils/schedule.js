// Meeting-scheduling UI helpers (task 18): pure functions over scheduled
// meeting payloads so the HomeScreen stays thin and the logic is unit-testable.
// No React imports - importable from node:test on the client.

export const MEETING_STATUS = {
  ENDED: 'ended',
  LIVE: 'live',
  UPCOMING: 'upcoming'
};

/**
 * Classify a meeting into ended / live / upcoming based on the wall clock.
 * @param {{startTime:number, endTime:number}} meeting
 * @param {number} [nowMs] injectable clock for tests
 */
export function computeMeetingStatus(meeting, nowMs = Date.now()) {
  if (!meeting) return MEETING_STATUS.UPCOMING;
  const now = Number(nowMs);
  if (now >= meeting.endTime) return MEETING_STATUS.ENDED;
  if (now >= meeting.startTime) return MEETING_STATUS.LIVE;
  return MEETING_STATUS.UPCOMING;
}

/**
 * Human-readable window: "Wed, Sep 10, 9:00 AM – 10:00 AM".
 */
export function formatMeetingTime(startTime, endTime) {
  return (
    new Date(startTime).toLocaleString([], {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) +
    ' – ' +
    new Date(endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

/**
 * Convert a millisecond timestamp to `<input type="datetime-local">` value:
 * YYYY-MM-DDTHH:mm in local time.
 */
export function toLocalInputValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Parse a datetime-local input value back to epoch milliseconds.
 * @returns {number} ms, or NaN for invalid/empty input
 */
export function fromLocalInputValue(value) {
  if (!value) return NaN;
  return new Date(value).getTime();
}