import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEETING_STATUS,
  computeMeetingStatus,
  formatMeetingTime,
  toLocalInputValue,
  fromLocalInputValue
} from '../src/utils/schedule.js';

const NOW = Date.parse('2026-09-10T12:00:00Z');

test('computeMeetingStatus classifies upcoming / live / ended windows', () => {
  const meeting = { startTime: NOW - 3600_000, endTime: NOW + 3600_000 };
  assert.equal(computeMeetingStatus(meeting, NOW - 7200_000), MEETING_STATUS.UPCOMING);
  assert.equal(computeMeetingStatus(meeting, NOW), MEETING_STATUS.LIVE);
  assert.equal(computeMeetingStatus(meeting, NOW + 7200_000), MEETING_STATUS.ENDED);
});

test('computeMeetingStatus treats the exact boundary instants sensibly', () => {
  const meeting = { startTime: NOW, endTime: NOW + 1000 };
  assert.equal(computeMeetingStatus(meeting, NOW), MEETING_STATUS.LIVE);
  assert.equal(computeMeetingStatus(meeting, NOW + 1000), MEETING_STATUS.ENDED);
});

test('computeMeetingStatus returns upcoming for a null meeting', () => {
  assert.equal(computeMeetingStatus(null, NOW), MEETING_STATUS.UPCOMING);
});

test('toLocalInputValue round-trips through fromLocalInputValue', () => {
  const ms = Date.parse('2026-09-10T09:30:00');
  const value = toLocalInputValue(ms);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(fromLocalInputValue(value), ms);
});

test('fromLocalInputValue rejects empty/invalid input', () => {
  assert.ok(Number.isNaN(fromLocalInputValue('')));
  assert.ok(Number.isNaN(fromLocalInputValue('garbage')));
});

test('formatMeetingTime renders a human-readable window', () => {
  const start = Date.parse('2026-09-10T09:00:00');
  const end = Date.parse('2026-09-10T10:00:00');
  const out = formatMeetingTime(start, end);
  assert.match(out, /Sep/);
  assert.match(out, /9:00/);
  assert.match(out, /10:00/);
});