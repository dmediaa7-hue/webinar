// Invite generation unit tests (task 17): ICS parse + Google calendar URL.
// Pure helpers over meeting rows; runs with node:test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  toICS,
  toGoogleCalendarUrl,
  meetingJoinUrl,
  icsEscape,
  icsUtc
} = require('../src/invite');

const T0 = Date.UTC(2026, 8, 10, 9, 30, 0);   // 2026-09-10T09:30:00Z
const T1 = Date.UTC(2026, 8, 10, 10, 30, 0);  // 2026-09-10T10:30:00Z

function sampleMeeting(overrides = {}) {
  return {
    id: 'meet-abc-123',
    hostUserId: 7,
    title: 'Weekly Sync',
    startTime: T0,
    endTime: T1,
    roomName: 'weekly-sync',
    hasPasscode: false,
    waitingRoomEnabled: false,
    createdAt: Date.UTC(2026, 8, 1, 12, 0, 0),
    ...overrides
  };
}

test('icsUtc formats a UTC timestamp as YYYYMMDDTHHMMSSZ', () => {
  assert.equal(icsUtc(T0), '20260910T093000Z');
  assert.equal(icsUtc(T1), '20260910T103000Z');
  assert.equal(icsUtc('not-a-date'), '');
});

test('icsEscape escapes RFC 5545 text metacharacters', () => {
  assert.equal(icsEscape('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  assert.equal(icsEscape('line1\nline2'), 'line1\\nline2');
  assert.equal(icsEscape('plain'), 'plain');
});

test('ICS parses: VCALENDAR wrapper with a VEVENT containing required fields', () => {
  const ics = toICS(sampleMeeting());

  assert.ok(ics.includes('BEGIN:VCALENDAR'), 'starts with VCALENDAR');
  assert.ok(ics.includes('END:VCALENDAR'), 'ends with VCALENDAR');
  assert.ok(ics.includes('BEGIN:VEVENT'), 'contains VEVENT');
  assert.ok(ics.includes('END:VEVENT'), 'closes VEVENT');
  assert.ok(ics.includes('UID:meet-abc-123@webinar'), 'UID set from meeting id');
  assert.ok(ics.includes('DTSTART:20260910T093000Z'), 'DTSTART in UTC');
  assert.ok(ics.includes('DTEND:20260910T103000Z'), 'DTEND in UTC');
  assert.ok(ics.includes('SUMMARY:Weekly Sync'), 'SUMMARY carries the title');
  assert.ok(ics.includes('DESCRIPTION:'), 'DESCRIPTION present');
  assert.ok(ics.includes('LOCATION:'), 'LOCATION present');
  assert.ok(ics.includes('METHOD:PUBLISH'), 'calendar invite semantics');
  assert.ok(ics.match(/\r\n/g), 'CRLF line endings per RFC 5545');
});

test('ICS escapes commas and semicolons in the meeting title', () => {
  const ics = toICS(sampleMeeting({ title: 'Sync, Q3; review' }));
  assert.ok(ics.includes('SUMMARY:Sync\\, Q3\\; review'), 'title escapes correctly');
});

test('Google add-to-calendar URL contains the correct dates and template params', () => {
  const url = toGoogleCalendarUrl(sampleMeeting());
  assert.ok(url.startsWith('https://calendar.google.com/calendar/render?'), 'render endpoint');

  const params = new URL(url).searchParams;
  assert.equal(params.get('action'), 'TEMPLATE');
  assert.equal(params.get('text'), 'Weekly Sync');
  assert.equal(params.get('dates'), '20260910T093000Z/20260910T103000Z',
    'dates window matches the ICS');
  assert.ok(params.get('details').includes('meet-abc-123'), 'details carry the join link');
  assert.equal(params.get('location'), meetingJoinUrl(sampleMeeting()));
});

test('join URL routes through the public meeting path with the meeting id', () => {
  const url = meetingJoinUrl(sampleMeeting({ id: 'join/me' }));
  assert.equal(url, 'http://localhost:5173/meeting/join%2Fme', 'id is URL-encoded');
  assert.ok(url.includes('/meeting/'), 'uses the /meeting/:roomId route');
});

test('ICS and Google URL agree on the meeting window', () => {
  const meeting = sampleMeeting();
  const ics = toICS(meeting);
  const url = toGoogleCalendarUrl(meeting);

  const dtStart = ics.match(/DTSTART:(\d{8}T\d{6}Z)/)[1];
  const dtEnd = ics.match(/DTEND:(\d{8}T\d{6}Z)/)[1];
  assert.equal(new URL(url).searchParams.get('dates'), `${dtStart}/${dtEnd}`);
});