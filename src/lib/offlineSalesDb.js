/**
 * IndexedDB queue for offline POS sales.
 * Local only — never a production data plane. Cloud (Supabase) is source of truth after sync.
 */

const DB_NAME = "nexora-pos-offline";
const DB_VERSION = 1;
const STORE = "sales_queue";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Failed to open offline DB."));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("client_reference", "client_reference", { unique: true });
        store.createIndex("created_at", "created_at", { unique: false });
      }
    };
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

/** @typedef {"pending"|"syncing"|"synced"|"failed"} OfflineSaleStatus */

/**
 * @param {object} record
 * @param {string} record.client_reference
 * @param {object} record.payload — body for api.sales.create
 * @param {object} [record.receipt] — local receipt snapshot for UI
 */
export async function enqueueOfflineSale(record) {
  const client_reference = String(record.client_reference || "").trim();
  if (!client_reference) throw new Error("client_reference is required for offline sales.");
  if (!record.payload || !Array.isArray(record.payload.items) || !record.payload.items.length) {
    throw new Error("Offline sale payload must include items.");
  }

  const db = await openDb();
  try {
    const existing = await reqToPromise(
      db.transaction(STORE, "readonly").objectStore(STORE).index("client_reference").get(client_reference)
    );
    if (existing) {
      if (existing.status === "synced") return existing;
      return existing;
    }

    const entry = {
      id: client_reference,
      client_reference,
      status: /** @type {OfflineSaleStatus} */ ("pending"),
      payload: record.payload,
      receipt: record.receipt || null,
      created_at: record.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      attempts: 0,
      last_error: null,
      server_id: null,
      invoice_no: null,
    };

    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    await txDone(tx);
    return entry;
  } finally {
    db.close();
  }
}

export async function listOfflineSales({ status } = {}) {
  const db = await openDb();
  try {
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const rows = status
      ? await reqToPromise(store.index("status").getAll(status))
      : await reqToPromise(store.getAll());
    return (rows || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  } finally {
    db.close();
  }
}

export async function listPendingOfflineSales() {
  const rows = await listOfflineSales();
  return rows.filter((row) => row.status === "pending" || row.status === "failed");
}

export async function getOfflineQueueStats() {
  const rows = await listOfflineSales();
  const pending = rows.filter((r) => r.status === "pending").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const syncing = rows.filter((r) => r.status === "syncing").length;
  const synced = rows.filter((r) => r.status === "synced").length;
  return { pending, failed, syncing, synced, total: rows.length };
}

async function patchSale(id, patch) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const existing = await reqToPromise(store.get(id));
    if (!existing) {
      await txDone(tx);
      return null;
    }
    const next = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    store.put(next);
    await txDone(tx);
    return next;
  } finally {
    db.close();
  }
}

export async function markOfflineSaleSyncing(id) {
  return patchSale(id, { status: "syncing" });
}

export async function markOfflineSaleSynced(id, serverResult = {}) {
  return patchSale(id, {
    status: "synced",
    last_error: null,
    server_id: serverResult.id || serverResult.sale?.id || null,
    invoice_no: serverResult.invoice_no || serverResult.receipt_no || null,
  });
}

export async function markOfflineSaleFailed(id, error) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const existing = await reqToPromise(store.get(id));
    if (!existing) {
      await txDone(tx);
      return null;
    }
    store.put({
      ...existing,
      status: "failed",
      attempts: Number(existing.attempts || 0) + 1,
      last_error: String(error || "Sync failed"),
      updated_at: new Date().toISOString(),
    });
    await txDone(tx);
    return true;
  } finally {
    db.close();
  }
}

export async function resetFailedToPending() {
  const failed = await listOfflineSales({ status: "failed" });
  for (const row of failed) {
    await patchSale(row.id, { status: "pending", last_error: null });
  }
  return failed.length;
}
