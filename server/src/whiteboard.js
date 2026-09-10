// Shared whiteboard persistence layer (task 16). Durable record of the
// Excalidraw scene per room, debounced-write from the client so a reload
// recovers the last saved state. Live traffic rides the
// 'whiteboard' data channel (deltas); this store is the reload fallback.
const defaultDb = require('./db');

/**
 * Persist the full scene snapshot for a room (upsert by room name, one
 * whiteboard per room). Elements is the Excalidraw elements array.
 * Returns {ok:true} or {ok:false,error}.
 */
function saveScene(roomName, elements, db = defaultDb) {
  const cleanRoom = String(roomName ?? '').trim().slice(0, 100);
  if (!cleanRoom) return { ok: false, error: 'ROOM_REQUIRED' };
  if (!Array.isArray(elements)) return { ok: false, error: 'ELEMENTS_REQUIRED' };

  db.prepare(`
    INSERT INTO whiteboards (id, room_name, scene_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id)
    DO UPDATE SET scene_json = excluded.scene_json, updated_at = excluded.updated_at
  `).run(cleanRoom, cleanRoom, JSON.stringify(elements), Date.now());
  return { ok: true };
}

/**
 * Load the last persisted scene for a room, or null when none exists yet.
 */
function getScene(roomName, db = defaultDb) {
  const row = db.prepare('SELECT scene_json FROM whiteboards WHERE id = ?').get(String(roomName ?? '').trim());
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.scene_json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { saveScene, getScene };