/**
 * Offline POS sync engine.
 *
 * Flow: Cashier → Offline Sale → IndexedDB → Internet returns → Auto Sync → Supabase → branches/stock updated server-side.
 * Idempotency: each sale carries client_reference; server unique index + RPC prevent double-post.
 */

import {
  enqueueOfflineSale,
  getOfflineQueueStats,
  listPendingOfflineSales,
  markOfflineSaleFailed,
  markOfflineSaleSynced,
  markOfflineSaleSyncing,
  resetFailedToPending,
} from "./offlineSalesDb";

export function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/** True when the API result looks like a transport / connectivity failure (queue-worthy). */
export function isNetworkFailure(result) {
  if (!result || result.success !== false) return false;
  if (result.code === "NETWORK" || result.code === "TIMEOUT") return true;
  const msg = String(result.error || "").toLowerCase();
  return (
    msg.includes("network")
    || msg.includes("failed to fetch")
    || msg.includes("fetch")
    || msg.includes("offline")
    || msg.includes("connection")
    || msg.includes("timeout")
  );
}

/** Business / validation errors must NOT be queued as offline sales. */
export function isQueueableSaleFailure(result) {
  if (!result || result.success !== false) return false;
  if (result.code === "PAYMENT_INVALID" || result.code === "UNAUTHENTICATED" || result.code === "CONFIG") {
    return false;
  }
  return isNetworkFailure(result);
}

export async function pingCloud(api) {
  if (!isBrowserOnline()) return false;
  try {
    const probe = await Promise.race([
      api.health?.probe?.() ?? Promise.resolve({ success: true }),
      new Promise((resolve) => setTimeout(() => resolve({ success: false, code: "TIMEOUT" }), 8000)),
    ]);
    if (probe && probe.success === false && (probe.code === "NETWORK" || probe.code === "TIMEOUT" || probe.code === "UNAUTHENTICATED")) {
      return false;
    }
    // Any JSON response means the API is reachable enough to attempt sync.
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist a completed offline sale for later sync.
 * @returns {{ success: true, offline: true, id: string, invoice_no: string, sale: object }}
 */
export async function saveOfflineSale({ client_reference, payload, receipt, user }) {
  const created_at = receipt?.created_at || new Date().toISOString();
  const localInvoice = `OFF-${String(client_reference).slice(0, 8).toUpperCase()}`;
  const localReceipt = {
    ...receipt,
    id: client_reference,
    invoice_no: localInvoice,
    receipt_no: localInvoice,
    created_at,
    time: new Date(created_at).toLocaleString(),
    cashier_name: user?.name || "Cashier",
    cashier_username: user?.username || "unknown",
    branch_name: user?.company?.branch_name || receipt?.branch_name || "Local branch",
    status: "Pending sync",
    offline: true,
    client_reference,
  };

  await enqueueOfflineSale({
    client_reference,
    payload: {
      ...payload,
      client_reference,
      branch_id: payload.branch_id ?? user?.branch_id ?? null,
    },
    receipt: localReceipt,
    created_at,
  });

  return {
    success: true,
    offline: true,
    id: client_reference,
    invoice_no: localInvoice,
    receipt_no: localInvoice,
    sale: localReceipt,
  };
}

let syncInFlight = null;

/**
 * Push pending/failed offline sales to Supabase via api.sales.create.
 * Server idempotency on client_reference prevents double-posting.
 */
export async function syncPendingSales(api, { onProgress } = {}) {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const reachable = await pingCloud(api);
    if (!reachable) {
      return { success: false, synced: 0, failed: 0, skipped: true, reason: "offline" };
    }

    const pending = await listPendingOfflineSales();
    let synced = 0;
    let failed = 0;
    const errors = [];

    for (const row of pending) {
      onProgress?.({ phase: "syncing", client_reference: row.client_reference, pending: pending.length - synced - failed });
      await markOfflineSaleSyncing(row.id);
      try {
        const result = await api.sales.create({
          ...row.payload,
          client_reference: row.client_reference,
        });

        if (result?.success) {
          await markOfflineSaleSynced(row.id, result);
          synced += 1;
        } else if (isQueueableSaleFailure(result)) {
          await markOfflineSaleFailed(row.id, result.error || "Network error");
          failed += 1;
          errors.push({ id: row.id, error: result.error });
          // Stop early if the network dropped mid-sync
          break;
        } else {
          // Permanent business error — keep failed for cashier retry/inspection
          await markOfflineSaleFailed(row.id, result?.error || "Sale rejected");
          failed += 1;
          errors.push({ id: row.id, error: result?.error });
        }
      } catch (err) {
        await markOfflineSaleFailed(row.id, err?.message || "Sync failed");
        failed += 1;
        errors.push({ id: row.id, error: err?.message });
        break;
      }
    }

    const stats = await getOfflineQueueStats();
    onProgress?.({ phase: failed && !synced ? "offline" : stats.pending || stats.failed ? "syncing" : "synced", stats });
    return { success: failed === 0, synced, failed, errors, stats };
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

export async function retryFailedSales(api, opts) {
  await resetFailedToPending();
  return syncPendingSales(api, opts);
}

/**
 * Subscribe to browser online/offline and auto-sync when connectivity returns.
 * @returns {() => void} unsubscribe
 */
export function startOfflineAutoSync(api, { onStatus, enabled = true } = {}) {
  if (typeof window === "undefined" || !enabled) return () => {};

  let disposed = false;
  let timer = null;

  const emit = async (phase) => {
    if (disposed) return;
    const stats = await getOfflineQueueStats().catch(() => ({ pending: 0, failed: 0, syncing: 0, synced: 0 }));
    onStatus?.({
      phase,
      online: isBrowserOnline(),
      ...stats,
    });
  };

  const runSync = async () => {
    if (disposed) return;
    await emit("syncing");
    const result = await syncPendingSales(api, {
      onProgress: (evt) => {
        if (!disposed) onStatus?.({ phase: evt.phase, online: isBrowserOnline(), client_reference: evt.client_reference });
      },
    });
    if (disposed) return;
    if (result.skipped) {
      await emit("offline");
      return;
    }
    const stats = result.stats || (await getOfflineQueueStats());
    if (stats.pending > 0 || stats.failed > 0) {
      onStatus?.({ phase: stats.failed ? "offline" : "syncing", online: true, ...stats, lastResult: result });
    } else {
      onStatus?.({ phase: "synced", online: true, ...stats, lastResult: result });
    }
  };

  const onOnline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void runSync();
    }, 600);
  };

  const onOffline = () => {
    clearTimeout(timer);
    void emit("offline");
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  // Initial status + opportunistic sync
  void (async () => {
    if (!isBrowserOnline()) {
      await emit("offline");
      return;
    }
    const stats = await getOfflineQueueStats().catch(() => null);
    if (stats && (stats.pending > 0 || stats.failed > 0)) {
      await runSync();
    } else {
      await emit("synced");
    }
  })();

  return () => {
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
