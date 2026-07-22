import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { getOfflineQueueStats } from "../lib/offlineSalesDb";
import {
  isBrowserOnline,
  retryFailedSales,
  startOfflineAutoSync,
  syncPendingSales,
} from "../lib/offlineSync";

/**
 * Cashier-facing offline / sync status for POS.
 * Phases: offline | syncing | synced (plus online flag).
 */
export function useOfflineSync({ enabled = true } = {}) {
  const [phase, setPhase] = useState(() => (isBrowserOnline() ? "synced" : "offline"));
  const [online, setOnline] = useState(() => isBrowserOnline());
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [lastError, setLastError] = useState(null);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await getOfflineQueueStats();
      setPending(stats.pending + stats.syncing);
      setFailed(stats.failed);
      return stats;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    return startOfflineAutoSync(api, {
      onStatus: (status) => {
        setOnline(Boolean(status.online));
        if (status.phase) setPhase(status.phase);
        if (typeof status.pending === "number") setPending(status.pending + (status.syncing || 0));
        if (typeof status.failed === "number") setFailed(status.failed);
        const err = status.lastResult?.errors?.[0]?.error;
        if (err) setLastError(err);
        else if (status.phase === "synced") setLastError(null);
      },
    });
  }, [enabled]);

  const syncNow = useCallback(async () => {
    setPhase("syncing");
    const result = await syncPendingSales(api);
    await refreshStats();
    if (result.skipped) {
      setPhase("offline");
      setOnline(false);
      return result;
    }
    setOnline(true);
    setPhase(result.failed ? "offline" : result.stats?.pending ? "syncing" : "synced");
    if (result.errors?.[0]?.error) setLastError(result.errors[0].error);
    return result;
  }, [refreshStats]);

  const retryFailed = useCallback(async () => {
    setPhase("syncing");
    const result = await retryFailedSales(api);
    await refreshStats();
    setPhase(result.failed ? "offline" : "synced");
    return result;
  }, [refreshStats]);

  const label =
    phase === "offline"
      ? pending || failed
        ? `Offline · ${pending + failed} queued`
        : "Offline"
      : phase === "syncing"
        ? "Syncing…"
        : pending
          ? `Online · ${pending} pending`
          : "Synced";

  return {
    phase,
    online,
    pending,
    failed,
    lastError,
    label,
    syncNow,
    retryFailed,
    refreshStats,
  };
}
