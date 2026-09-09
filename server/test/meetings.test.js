// Unit tests for the DB + rooms persistence layer (task 3).
// Runs with node:test against in-memory SQLite instances (createDatabase(':memory:')).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase, initSchema } = require('../src/db');
const meetings = require('../src/meetings');
const rooms = require('../src/rooms');

function newDb() {
  return createDatabase(':memory:');
}

function insertUser(db, email = 'host@example.com') {
  const info = db.prepare(
    'INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(email, 'Test Host', 'x', Date.now());
  return Number(info.lastInsertRowid);
}

test('scheduled meeting inserts and reads back all fields', () => {
  const db = newDb();
  const hostUserId = insertUser(db);
  const created = meetings.createMeeting({
    hostUserId,
    title: 'Weekly Sync',
    startTime: Date.now() + 60 * 60 * 1000,
    endTime: Date.now() + 2 * 60 * 60 * 1000,
    roomName: 'weekly-sync',
    passcode: 's3cret',
    waitingRoomEnabled: true
  }, db);

  assert.ok(created.id, 'meeting id generated');
  assert.equal(created.hostUserId, 1);
  assert.equal(created.title, 'Weekly Sync');
  assert.equal(created.roomName, 'weekly-sync');
  assert.equal(created.hasPasscode, true);
  assert.equal(created.waitingRoomEnabled, true);

  const read = meetings.getMeeting(created.id, db);
  assert.ok(read, 'meeting readable after insert');
  assert.equal(read.title, 'Weekly Sync');
  assert.equal(read.hostUserId, 1);
  assert.equal(read.hasPasscode, true);
  assert.equal(read.waitingRoomEnabled, true);
  assert.equal(read.roomName, 'weekly-sync');
  assert.ok(read.startTime > 0 && read.endTime > read.startTime, 'timestamps persisted');
  db.close();
});

test('invalid date (end before start) rejected', () => {
  const db = newDb();
  assert.throws(
    () => meetings.createMeeting({
      hostUserId: 1,
      title: 'Bad',
      startTime: Date.now() + 60 * 60 * 1000,
      endTime: Date.now()
    }, db),
    /endTime must be after startTime/
  );
  db.close();
});

test('missing title rejected', () => {
  const db = newDb();
  assert.throws(
    () => meetings.createMeeting({
      hostUserId: 1,
      title: '  ',
      startTime: Date.now(),
      endTime: Date.now() + 60 * 60 * 1000
    }, db),
    /title is required/
  );
  db.close();
});

test('missing hostUserId rejected', () => {
  const db = newDb();
  assert.throws(
    () => meetings.createMeeting({
      hostUserId: 0,
      title: 'No host',
      startTime: Date.now(),
      endTime: Date.now() + 60 * 60 * 1000
    }, db),
    /hostUserId is required/
  );
  db.close();
});

test('listMeetings filters by host and upcoming window', () => {
  const db = newDb();
  const host1 = insertUser(db, 'one@example.com');
  const host2 = insertUser(db, 'two@example.com');
  const future = Date.now() + 24 * 60 * 60 * 1000;
  const a = meetings.createMeeting({ hostUserId: host1, title: 'A', startTime: future, endTime: future + 3600 * 1000 }, db);
  const b = meetings.createMeeting({ hostUserId: host1, title: 'B', startTime: future + 3600 * 1000, endTime: future + 7200 * 1000 }, db);
  meetings.createMeeting({ hostUserId: host2, title: 'Other user', startTime: future, endTime: future + 3600 * 1000 }, db);

  const mine = meetings.listMeetings({ hostUserId: host1 }, db);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map(m => m.id).sort(), [a.id, b.id].sort());

  // fromTime inside b's window but after a's end -> only b qualifies
  const upcoming = meetings.listMeetings({ hostUserId: host1, fromTime: future + 5400 * 1000 }, db);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].id, b.id);
  db.close();
});

test('deleteMeeting removes the row', () => {
  const db = newDb();
  const hostUserId = insertUser(db);
  const created = meetings.createMeeting({ hostUserId, title: 'To delete', startTime: Date.now() + 3600 * 1000, endTime: Date.now() + 7200 * 1000 }, db);
  assert.equal(meetings.deleteMeeting(created.id, db), true);
  assert.equal(meetings.getMeeting(created.id, db), null);
  assert.equal(meetings.deleteMeeting('does-not-exist', db), false);
  db.close();
});

test('room metadata persists (create -> read back)', () => {
  const db = newDb();
  const room = rooms.createRoom('persist-test', 'Host A', 'sock-1', 'pass123', 'Persist Room', db);

  assert.equal(room.name, 'Persist Room');
  assert.equal(room.hostName, 'Host A');

  const persisted = rooms.getPersistedRoom('persist-test', db);
  assert.ok(persisted, 'room metadata row exists');
  assert.equal(persisted.name, 'Persist Room');
  assert.equal(persisted.hostName, 'Host A');
  assert.equal(persisted.hasPassword, true);
  assert.equal(persisted.settings.waitingRoomEnabled, false);
  assert.equal(persisted.settings.isLocked, false);
  db.close();
});

test('updateRoomSettings persists lock and waiting-room state', () => {
  const db = newDb();
  rooms.createRoom('settings-test', 'Host B', 'sock-2', null, 'Settings Room', db);

  rooms.updateRoomSettings('settings-test', { isLocked: true, waitingRoomEnabled: true }, db);

  const persisted = rooms.getPersistedRoom('settings-test', db);
  assert.equal(persisted.settings.isLocked, true);
  assert.equal(persisted.settings.waitingRoomEnabled, true);
  db.close();
});

test('removePersistedRoom deletes the metadata row', () => {
  const db = newDb();
  rooms.createRoom('cleanup-test', 'Host C', 'sock-3', null, 'Cleanup Room', db);
  assert.ok(rooms.getPersistedRoom('cleanup-test', db), 'row exists before removal');

  rooms.removePersistedRoom('cleanup-test', db);
  assert.equal(rooms.getPersistedRoom('cleanup-test', db), null);
  db.close();
});

test('schema init is idempotent (re-run safe)', () => {
  const db = newDb();
  assert.doesNotThrow(() => initSchema(db));
  assert.doesNotThrow(() => initSchema(db));
  db.close();
});

test('meetings persist across database reopen (file-backed)', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dbPath = path.join(os.tmpdir(), `webinar-task3-${Date.now()}.db`);

  try {
    const first = createDatabase(dbPath);
    const hostUserId = insertUser(first, 'persist@example.com');
    const created = meetings.createMeeting({
      hostUserId,
      title: 'Persists',
      startTime: Date.now() + 60 * 60 * 1000,
      endTime: Date.now() + 2 * 60 * 60 * 1000
    }, first);
    first.close();

    const second = createDatabase(dbPath);
    const read = meetings.getMeeting(created.id, second);
    assert.ok(read, 'meeting readable after database reopen');
    assert.equal(read.title, 'Persists');
    second.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch (e) { /* ignore */ }
  }
});