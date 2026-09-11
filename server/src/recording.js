// Recording uploads are written to a host-supplied folder on local disk; a row
// in `recordings` records the absolute file path.
const fs = require('fs');
const path = require('path');
const defaultDb = require('./db');

const SYSTEM_DIRS = new Set([
  'C:\\', 'D:\\', 'E:\\', 'A:\\', 'B:\\',                       // Windows drive roots
  process.env.WINDIR,
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)'],
  '/', '/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/lib',
  '/System', '/Applications', '/Library', '/Volumes', '/private'
].filter(Boolean).map((p) => path.resolve(p).toLowerCase()));

function isPathUnsafe(dir) {
  const resolved = path.resolve(dir).toLowerCase();
  if (SYSTEM_DIRS.has(resolved)) return true;
  // Reject any subdirectory of a blocked system root (e.g. C:\Windows\System32).
  for (const root of SYSTEM_DIRS) {
    if (root === '/') continue;
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

async function saveRecording({ roomName, folder, filename, base64Data }, db = defaultDb) {
  const dir = String(folder || '').trim();
  if (!dir) {
    const err = new Error('folder is required');
    err.code = 'FOLDER_REQUIRED';
    throw err;
  }
  if (isPathUnsafe(dir)) {
    const err = new Error('folder may not be a system/reserved directory: ' + dir);
    err.code = 'FOLDER_UNSAFE';
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

  const info = await db.run(`
    INSERT INTO recordings (room_name, url, status, created_at)
    VALUES (?, ?, ?, ?)
  `, String(roomName || ''), filePath, 'completed', Date.now());

  return { id: Number(info.lastInsertRowid), path: filePath };
}

module.exports = { saveRecording };