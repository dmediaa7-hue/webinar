const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDatabase } = require('../src/db');
const { saveScene, getScene } = require('../src/whiteboard');

function newDb() {
  return createDatabase(':memory:');
}

test('saveScene persists an element array and getScene reads it back', () => {
  const db = newDb();
  const elements = [
    { id: 'el-1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, version: 1, versionNonce: 1 },
    { id: 'el-2', type: 'ellipse', x: 30, y: 40, width: 80, height: 60, version: 1, versionNonce: 1 }
  ];

  const result = saveScene('room-a', elements, db);
  assert.ok(result.ok);

  const loaded = getScene('room-a', db);
  assert.deepEqual(loaded, elements);
  db.close();
});

test('saveScene upserts: a later save for the same room replaces the scene', () => {
  const db = newDb();

  saveScene('room-a', [{ id: 'el-1', type: 'rectangle', version: 1 }], db);
  saveScene('room-a', [{ id: 'el-2', type: 'ellipse', version: 2 }], db);

  const loaded = getScene('room-a', db);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'el-2');
  db.close();
});

test('getScene returns null when no scene exists yet for the room', () => {
  const db = newDb();
  assert.equal(getScene('missing-room', db), null);
  db.close();
});

test('saveScene validates input', () => {
  const db = newDb();
  assert.equal(saveScene('', [{ id: 'a' }], db).ok, false);
  assert.equal(saveScene('room-a', 'not-an-array', db).ok, false);
  assert.equal(saveScene('room-a', null, db).ok, false);
  db.close();
});

test('whiteboard scene survives a database reopen (file-backed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'));
  const file = path.join(dir, 'whiteboard.db');
  try {
    const first = createDatabase(file);
    saveScene('persist-room', [{ id: 'el-9', type: 'line', version: 3 }], first);
    first.close();

    const second = createDatabase(file);
    const loaded = getScene('persist-room', second);
    assert.deepEqual(loaded, [{ id: 'el-9', type: 'line', version: 3 }]);
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});