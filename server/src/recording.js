// Recording uploads are written to a host-supplied folder on local disk; a row
// in `recordings` records the absolute file path.
const fs = require('fs');
const path = require('path');
const defaultDb = require('./db');

function saveRecording({ roomName, folder, filename, base64Data }, db = defaultDb) {
  const dir = String(folder || '').trim();
  if (!dir) {
    const err = new Error('folder is required');
    err.code = 'FOLDER_REQUIRED';
    throw err;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(String(filename || ''))) {
    const err = new Error('Invalid filename');
    err.code = 'INVALID_FILENAME';
    throw err;
  }
  if (!base64Data || typeof base64Data !== 'string') {
    const err = new Error('data is required');
    err.code = 'DATA_REQUIRED';
    throw err;
  }

  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, String(filename));
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

  const info = db.prepare(`
    INSERT INTO recordings (room_name, url, status, created_at)
    VALUES (?, ?, ?, ?)
  `).run(String(roomName || ''), filePath, 'completed', Date.now());

  return { id: Number(info.lastInsertRowid), path: filePath };
}

module.exports = { saveRecording };