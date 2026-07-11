const { db } = require("../db/database");

function enqueueSync(entityType, entityId, operation, payload) {
  db.prepare(
    "INSERT INTO sync_queue (entity_type, entity_id, operation, payload) VALUES (?, ?, ?, ?)"
  ).run(entityType, entityId, operation, JSON.stringify(payload ?? {}));
}

function getPendingQueue(limit = 100) {
  return db
    .prepare("SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?")
    .all(limit);
}

function markSynced(id) {
  db.prepare("UPDATE sync_queue SET status = 'synced', synced_at = datetime('now') WHERE id = ?").run(id);
}

function markFailed(id, errorMessage) {
  db.prepare(
    "UPDATE sync_queue SET status = 'pending', attempts = attempts + 1, last_error = ? WHERE id = ?"
  ).run(errorMessage, id);
}

function getPendingCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'").get().n;
}

module.exports = { enqueueSync, getPendingQueue, markSynced, markFailed, getPendingCount };
