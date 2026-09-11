// Unit tests for the DB + rooms persistence layer (task 3).
// Runs with node:test against in-memory SQLite instances (createDatabase(':memory:')).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase, initSchema } = require('../src/db');
const meetings = require('../src/meetings');
const rooms = require('../src/rooms');

async function newDb() {
  return createDatabase(':memory:');
}

async function insertUser(db, email = 'host@example.com') {
  const info = await db.run(
    'INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)',
    email, 'Test Host', 'x', Date.now()
  );
  return Number(info.lastInsertRowid);
}

test('scheduled meeting inserts and reads back all fields', async () => {
  const db = await newDb();
  const hostUserId = await insertUser(db);
  const created = await meetings.createMeeting({
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

  const read = await meetings.getMeeting(created.id, db);
  assert.ok(read, 'meeting readable after insert');
  assert.equal(read.title, 'Weekly Sync');
  assert.equal(read.hostUserId, 1);
  assert.equal(read.hasPasscode, true);
  assert.equal(read.waitingRoomEnabled, true);
  assert.equal(read.roomName, 'weekly-sync');
  assert.ok(read.startTime > 0 && read.endTime > read.startTime, 'timestamps persisted');
  await db.close();
});

test('invalid date (end before start) rejected', async () => {
  const db = await newDb();
  await assert.rejects(
    meetings.createMeeting({
      hostUserId: 1,
      title: 'Bad',
      startTime: Date.now() + 60 * 60 * 1000,
      endTime: Date.now()
    }, db),
    /endTime must be after startTime/
  );
  await db.close();
});

test('missing title rejected', async () => {
  const db = await newDb();
  await assert.rejects(
    meetings.createMeeting({
      hostUserId: 1,
      title: '  ',
      startTime: Date.now(),
      endTime: Date.now() + 60 * 60 * 1000
    }, db),
    /title is required/
  );
  await db.close();
});

test('missing hostUserId rejected', async () => {
  const db = await newDb();
  await assert.rejects(
    meetings.createMeeting({
      hostUserId: 0,
      title: 'No host',
      startTime: Date.now(),
      endTime: Date.now() + 60 * 60 * 1000
    }, db),
    /hostUserId is required/
  );
  await db.close();
});

test('listMeetings filters by host and upcoming window', async () => {
  const db = await newDb();
  const host1 = await insertUser(db, 'one@example.com');
  const host2 = await insertUser(db, 'two@example.com');
  const future = Date.now() + 24 * 60 * 60 * 1000;
  const a = await meetings.createMeeting({ hostUserId: host1, title: 'A', startTime: future, endTime: future + 3600 * 1000 }, db);
  const b = await meetings.createMeeting({ hostUserId: host1, title: 'B', startTime: future + 3600 * 1000, endTime: future + 7200 * 1000 }, db);
  await meetings.createMeeting({ hostUserId: host2, title: 'Other user', startTime: future, endTime: future + 3600 * 1000 }, db);

  const mine = await meetings.listMeetings({ hostUserId: host1 }, db);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map(m => m.id).sort(), [a.id, b.id].sort());

  // fromTime inside b's window but after a's end -> only b qualifies
  const upcoming = await meetings.listMeetings({ hostUserId: host1, fromTime: future + 5400 * 1000 }, db);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].id, b.id);
  await db.close();
});

test('deleteMeeting removes the row', async () => {
  const db = await newDb();
  const hostUserId = await insertUser(db);
  const created = await meetings.createMeeting({ hostUserId, title: 'To delete', startTime: Date.now() + 3600 * 1000, endTime: Date.now() + 7200 * 1000 }, db);
  assert.equal(await meetings.deleteMeeting(created.id, db), true);
  assert.equal(await meetings.getMeeting(created.id, db), null);
  assert.equal(await meetings.deleteMeeting('does-not-exist', db), false);
  await db.close();
});

test('room metadata persists (create -> read back)', async () => {
  const db = await newDb();
  const room = await rooms.createRoom('persist-test', 'Host A', 'sock-1', 'pass123', 'Persist Room', db);

  assert.equal(room.name, 'Persist Room');
  assert.equal(room.hostName, 'Host A');

  const persisted = await rooms.getPersistedRoom('persist-test', db);
  assert.ok(persisted, 'room metadata row exists');
  assert.equal(persisted.name, 'Persist Room');
  assert.equal(persisted.hostName, 'Host A');
  assert.equal(persisted.hasPassword, true);
  assert.equal(persisted.settings.waitingRoomEnabled, false);
  assert.equal(persisted.settings.isLocked, false);
  await db.close();
});

test('updateRoomSettings persists lock and waiting-room state', async () => {
  const db = await newDb();
  await rooms.createRoom('settings-test', 'Host B', 'sock-2', null, 'Settings Room', db);

  await rooms.updateRoomSettings('settings-test', { isLocked: true, waitingRoomEnabled: true }, db);

  const persisted = await rooms.getPersistedRoom('settings-test', db);
  assert.equal(persisted.settings.isLocked, true);
  assert.equal(persisted.settings.waitingRoomEnabled, true);
  await db.close();
});

test('removePersistedRoom deletes the metadata row', async () => {
  const db = await newDb();
  await rooms.createRoom('cleanup-test', 'Host C', 'sock-3', null, 'Cleanup Room', db);
  assert.ok(await rooms.getPersistedRoom('cleanup-test', db), 'row exists before removal');

  await rooms.removePersistedRoom('cleanup-test', db);
  assert.equal(await rooms.getPersistedRoom('cleanup-test', db), null);
  await db.close();
});

test('schema init is idempotent (re-run safe)', async () => {
  const db = await newDb();
  await initSchema(db);
  await initSchema(db);
  await db.close();
});

test('createRoomWithHash replicates the scheduled passcode and settings (task 18)', async () => {
  const db = await newDb();
  const hostUserId = await insertUser(db);
  const meeting = await meetings.createMeeting({
    hostUserId,
    title: 'Scheduled Room',
    startTime: Date.now() + 3600 * 1000,
    endTime: Date.now() + 7200 * 1000,
    passcode: '4242',
    waitingRoomEnabled: true
  }, db);
  const row = await meetings.getMeetingRow(meeting.id, db);

  const live = await rooms.createRoomWithHash(meeting.id, {
    hostName: 'Host',
    roomName: meeting.title,
    passwordHash: row.passcode_hash,
    waitingRoomEnabled: true
  }, db);

  assert.equal(live.settings.waitingRoomEnabled, true);
  assert.equal(rooms.roomHasPassword(live), true, 'room is passcode-protected');
  assert.equal(rooms.verifyPassword(live, '4242'), true, 'original passcode still validates');
  assert.equal(rooms.verifyPassword(live, 'wrong'), false, 'wrong passcode rejected');
  await db.close();
});

test('meetings persist across database reopen (file-backed)', async () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dbPath = path.join(os.tmpdir(), `webinar-task3-${Date.now()}.db`);

  try {
    const first = await createDatabase(dbPath);
    const hostUserId = await insertUser(first, 'persist@example.com');
    const created = await meetings.createMeeting({
      hostUserId,
      title: 'Persists',
      startTime: Date.now() + 60 * 60 * 1000,
      endTime: Date.now() + 2 * 60 * 60 * 1000
    }, first);
    await first.close();

    const second = await createDatabase(dbPath);
    const read = await meetings.getMeeting(created.id, second);
    assert.ok(read, 'meeting readable after database reopen');
    assert.equal(read.title, 'Persists');
    await second.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch (e) { /* ignore */ }
  }
});
