// Meeting invite generation (task 17): RFC 5545 .ics file + Google
// "Add to Calendar" link. Pure helpers over meeting rows so unit tests can
// import them directly. No external Google API calls / OAuth - the calendar
// link is a plain TEMPLATE URL per scope guardrails.

const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');

/**
 * Escape a text field per RFC 5545 (backslash, comma, semicolon, newline).
 */
function icsEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Format a timestamp as an RFC 5545 UTC string: YYYYMMDDTHHMMSSZ.
 */
function icsUtc(ts) {
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Join URL for a scheduled meeting. Meetings route through the public
 * /meeting/:roomId client path (see client/src/App.jsx) with the meeting id
 * as the room id, so the link works for guests without an account.
 */
function meetingJoinUrl(meeting) {
  return `${CLIENT_URL}/meeting/${encodeURIComponent(meeting.id)}`;
}

/**
 * Build a single-VEVENT calendar file for a meeting.
 * Returns the raw .ics text (CRLF line endings per RFC 5545).
 */
function toICS(meeting) {
  const joinUrl = meetingJoinUrl(meeting);
  const description =
    `Join the webinar "${meeting.title}".\n\n` +
    `Join link: ${joinUrl}\n` +
    (meeting.roomName ? `Room: ${meeting.roomName}\n` : '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Webinar//Scheduled Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@webinar`,
    `DTSTAMP:${icsUtc(meeting.createdAt || Date.now())}`,
    `DTSTART:${icsUtc(meeting.startTime)}`,
    `DTEND:${icsUtc(meeting.endTime)}`,
    `SUMMARY:${icsEscape(meeting.title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(joinUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.join('\r\n');
}

/**
 * Google Calendar "Add to Calendar" TEMPLATE link. The dates parameter uses
 * the same UTC window as the ICS so both exports agree.
 */
function toGoogleCalendarUrl(meeting) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: meeting.title,
    dates: `${icsUtc(meeting.startTime)}/${icsUtc(meeting.endTime)}`,
    details: `Join the webinar "${meeting.title}". Join link: ${meetingJoinUrl(meeting)}`,
    location: meetingJoinUrl(meeting)
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Invite payload attached to meeting responses: ready-to-use join link,
 * the ICS download path (server-relative, client prefixes SERVER_URL), and
 * the Google add-to-calendar URL.
 */
function inviteFor(meeting) {
  return {
    joinUrl: meetingJoinUrl(meeting),
    icsPath: `/api/meetings/${meeting.id}/invite.ics`,
    googleCalendarUrl: toGoogleCalendarUrl(meeting)
  };
}

module.exports = {
  CLIENT_URL,
  icsEscape,
  icsUtc,
  meetingJoinUrl,
  toICS,
  toGoogleCalendarUrl,
  inviteFor
};