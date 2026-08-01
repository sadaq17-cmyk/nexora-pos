/**
 * Enterprise ERP real-time synchronization bus.
 *
 * Every meaningful mutation on the server (create/update/delete/payment/
 * purchase/sale/return/transfer/adjustment) already writes a row to
 * `audit_log` with a `module` + `action` tag (see writeAudit() in
 * api/_posData.js). This module subscribes to Supabase Realtime
 * `postgres_changes` INSERT events on that table — scoped to the caller's
 * own company by Postgres RLS — and turns each row into a lightweight
 * in-browser pub/sub event.
 *
 * Any page/context can call `useRealtimeRefresh(modules, callback)` (see
 * src/hooks/useRealtimeRefresh.js) to auto-reload the instant a relevant
 * module changes anywhere in the company — no polling, no manual refresh,
 * and every open tab/session stays in sync automatically.
 *
 * It also invalidates the client-side request cache (src/lib/requestCache.js)
 * for affected entities so the very next read — even without a subscriber —
 * is guaranteed to be fresh.
 */
import { supabase } from "./supabaseClient";
import { invalidateCache } from "./requestCache";

/** Maps audit_log `module` values to requestCache key prefixes to invalidate. */
const MODULE_CACHE_PREFIXES = {
  products: ["products", "categories", "barcode", "dashboard", "reports", "inventory"],
  inventory: ["inventory", "products", "dashboard", "reports", "stock"],
  purchases: ["purchases", "suppliers", "products", "inventory", "dashboard", "reports"],
  suppliers: ["suppliers", "purchases", "dashboard", "reports"],
  sales: ["sales", "products", "customers", "inventory", "dashboard", "reports"],
  customers: ["customers", "sales", "dashboard", "reports"],
  expenses: ["expenses", "dashboard", "reports"],
  branches: ["branches", "dashboard", "reports"],
  currencies: ["currencies", "dashboard", "reports"],
  subscription: ["subscription", "dashboard"],
  auth: ["users", "profiles"],
  payroll: ["payroll", "dashboard"],
};

/** @type {import("@supabase/supabase-js").RealtimeChannel | null} */
let channel = null;
let currentCompanyId = null;
let reconnectTimer = null;

/** @type {Set<{ modules: Set<string> | null, cb: (evt: SyncEvent) => void }>} */
const listeners = new Set();

/** @typedef {{ module: string, action: string, userId: string|null, userName: string|null, at: string }} SyncEvent */

function notify(/** @type {SyncEvent} */ event) {
  const prefixes = MODULE_CACHE_PREFIXES[event.module] || [];
  prefixes.forEach((prefix) => invalidateCache(prefix));
  for (const entry of listeners) {
    if (!entry.modules || entry.modules.has(event.module)) {
      try {
        entry.cb(event);
      } catch (err) {
        // A subscriber's own refresh logic must never break the shared bus.
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.error("[realtimeSync] listener error:", err);
      }
    }
  }
}

/**
 * Start (or restart, if the company changed) the real-time sync channel for
 * the signed-in user's company. Safe to call repeatedly — no-ops if already
 * subscribed to the same company.
 */
export function initRealtimeSync(companyId) {
  if (!supabase || companyId == null || companyId === "") return;
  const normalized = String(companyId);
  if (channel && currentCompanyId === normalized) return;
  stopRealtimeSync();
  currentCompanyId = normalized;

  channel = supabase
    .channel(`company-sync-${normalized}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "audit_log", filter: `company_id=eq.${normalized}` },
      (payload) => {
        const row = payload?.new;
        if (!row) return;
        notify({
          module: String(row.module || "").toLowerCase(),
          action: String(row.action || ""),
          userId: row.user_id || null,
          userName: row.user_name || null,
          at: row.created_at || new Date().toISOString(),
        });
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // supabase-js retries the websocket itself; this is a soft backstop
        // in case the channel needs a full resubscribe after a long outage.
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (currentCompanyId === normalized) {
            stopRealtimeSync();
            initRealtimeSync(normalized);
          }
        }, 5000);
      }
    });
}

/** Tear down the active real-time channel (call on logout). */
export function stopRealtimeSync() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (channel) {
    try {
      supabase?.removeChannel(channel);
    } catch {
      /* noop */
    }
  }
  channel = null;
  currentCompanyId = null;
  listeners.clear();
}

/**
 * Subscribe to sync events. Pass `null`/`undefined` modules to receive every
 * event. Returns an unsubscribe function.
 * @param {string[] | null} modules
 * @param {(evt: SyncEvent) => void} cb
 */
export function subscribeSync(modules, cb) {
  const entry = { modules: Array.isArray(modules) && modules.length ? new Set(modules.map((m) => String(m).toLowerCase())) : null, cb };
  listeners.add(entry);
  return () => listeners.delete(entry);
}

export function isRealtimeSyncActive() {
  return channel != null;
}
