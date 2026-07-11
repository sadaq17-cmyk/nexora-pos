const { db } = require("../db/database");
const { isConfigured } = require("./auth");
const { createDocument, updateDocument, deleteDocument, listDocuments } = require("./firestore");
const { getPendingQueue, markSynced, markFailed } = require("./queue");

const MAX_ATTEMPTS = 10;

// ---- PUSH: drain the offline queue, one Firestore collection per entity_type ----
async function pushQueue() {
  if (!isConfigured()) return { success: false, reason: "not_configured" };

  const pending = getPendingQueue(100);
  let synced = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const payload = JSON.parse(row.payload);
      const docId = String(row.entity_id);
      if (row.operation === "delete") {
        await deleteDocument(row.entity_type, docId);
      } else if (row.operation === "create") {
        await createDocument(row.entity_type, docId, { ...payload, synced_at: new Date().toISOString() });
      } else {
        await updateDocument(row.entity_type, docId, { ...payload, synced_at: new Date().toISOString() });
      }
      markSynced(row.id);
      synced += 1;
    } catch (err) {
      failed += 1;
      markFailed(row.id, err.message);
      if (row.attempts + 1 >= MAX_ATTEMPTS) {
        db.prepare("UPDATE sync_queue SET status = 'failed' WHERE id = ?").run(row.id);
      }
    }
  }

  return { success: true, synced, failed };
}

// ---- PULL: shared master data only (customers, suppliers). Last-write-wins
// by comparing updated_at timestamps, since either side could have changed
// a given record while offline. ----
function toEpoch(sqliteOrIso) {
  if (!sqliteOrIso) return 0;
  const iso = sqliteOrIso.includes("T") ? sqliteOrIso : `${sqliteOrIso.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

const PULL_CONFIGS = {
  customers: {
    table: "customers",
    columns: ["name", "phone", "email", "points", "credit_limit", "balance"],
  },
  suppliers: {
    table: "suppliers",
    columns: ["name", "contact_person", "phone", "category", "status", "balance"],
  },
};

async function pullEntity(entityType) {
  const config = PULL_CONFIGS[entityType];
  if (!config) return { pulled: 0, applied: 0 };

  const remoteDocs = await listDocuments(entityType);
  let applied = 0;

  for (const doc of remoteDocs) {
    const id = Number(doc.id);
    if (!id) continue;
    const local = db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id);
    const remoteUpdatedAt = doc.fields.updated_at || doc.fields.synced_at;

    if (!local) {
      // Another till created this record — bring it in.
      const cols = ["id", ...config.columns];
      const placeholders = cols.map(() => "?").join(", ");
      const values = cols.map((c) => (c === "id" ? id : doc.fields[c] ?? null));
      db.prepare(`INSERT OR IGNORE INTO ${config.table} (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
      applied += 1;
      continue;
    }

    // Only overwrite the local row if the remote version is strictly newer —
    // this is the conflict-resolution rule: last write wins by timestamp.
    if (toEpoch(remoteUpdatedAt) > toEpoch(local.updated_at)) {
      const setClause = config.columns.map((c) => `${c} = ?`).join(", ");
      const values = config.columns.map((c) => doc.fields[c] ?? local[c]);
      db.prepare(`UPDATE ${config.table} SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values, remoteUpdatedAt, id);
      applied += 1;
    }
  }

  return { pulled: remoteDocs.length, applied };
}

async function pullChanges() {
  if (!isConfigured()) return { success: false, reason: "not_configured" };
  const results = {};
  for (const entityType of Object.keys(PULL_CONFIGS)) {
    results[entityType] = await pullEntity(entityType);
  }
  return { success: true, results };
}

// Full two-way sync cycle: push local changes first (so this device's edits
// aren't immediately clobbered by a pull), then pull remote master-data changes.
async function runFullSync() {
  if (!isConfigured()) return { success: false, reason: "not_configured" };
  const pushResult = await pushQueue();
  const pullResult = await pullChanges();
  return { success: true, push: pushResult, pull: pullResult.results };
}

function getPendingCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'").get().n;
}

module.exports = { pushQueue, pullChanges, runFullSync, getPendingCount, isConfigured };
