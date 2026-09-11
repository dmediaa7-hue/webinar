const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDatabase } = require('../src/db');
const { saveScene, getScene } = require('../src/whiteboard');

async function newDb() {
  return createDatabase(':memory:');
}

test('saveScene persists an element array and getScene reads it back', async () => {
  const db = await newDb();
  const elements = [
    { id: 'el-1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, version: 1, versionNonce: 1 },
    { id: 'el-2', type: 'ellipse', x: 30, y: 40, width: 80, height: 60, version: 1, versionNonce: 1 }
  ];

  const result = await saveScene('room-a', elements, db);
  assert.ok(result.ok);

  const loaded = await getScene('room-a', db);
  assert.deepEqual(loaded, elements);
  await db.close();
});

test('saveScene upserts: a later save for the same room replaces the scene', async () => {
  const db = await newDb();

  await saveScene('room-a', [{ id: 'el-1', type: 'rectangle', version: 1 }], db);
  await saveScene('room-a', [{ id: 'el-2', type: 'ellipse', version: 2 }], db);

  const loaded = await getScene('room-a', db);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'el-2');
  await db.close();
});

test('getScene returns null when no scene exists yet for the room', async () => {
  const db = await newDb();
  assert.equal(await getScene('missing-room', db), null);
  await db.close();
});

test('saveScene validates input', async () => {
  const db = await newDb();
  assert.equal((await saveScene('', [{ id: 'a' }], db)).ok, false);
  assert.equal((await saveScene('room-a', 'not-an-array', db)).ok, false);
  assert.equal((await saveScene('room-a', null, db)).ok, false);
  await db.close();
});

test('whiteboard scene survives a database reopen (file-backed)', async () => {
  const dbPath = path.join(os.tmpdir(), `wb-test-${Date.now()}.db`);
  try {
    const first = await createDatabase(dbPath);
    await saveScene('persist-room', [{ id: 'el-9', type: 'line', version: 3 }], first);
    await first.close();

    const second = await createDatabase(dbPath);
    const loaded = await getScene('persist-room', second);
    assert.deepEqual(loaded, [{ id: 'el-9', type: 'line', version: 3 }]);
    await second.close();
  } finally {
    try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch (e) { /* ignore */ }
  }
});