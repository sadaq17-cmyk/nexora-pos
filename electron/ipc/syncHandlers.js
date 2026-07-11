const { ipcMain } = require("electron");
const { runFullSync, getPendingCount, isConfigured } = require("../firebase/sync");
const { logAudit } = require("../audit");

let autoSyncTimer = null;

function registerSyncHandlers() {
  ipcMain.handle("sync:getStatus", () => ({
    configured: isConfigured(),
    pendingCount: getPendingCount(),
  }));

  ipcMain.handle("sync:triggerNow", async () => {
    try {
      const result = await runFullSync();
      if (result.success) {
        logAudit("manual_sync", "settings", { synced: result.push?.synced, failed: result.push?.failed });
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("sync:setAutoSync", (event, enabled) => {
    if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
    if (enabled) {
      autoSyncTimer = setInterval(() => {
        runFullSync().catch((err) => console.warn("[firebase-sync] auto-sync error:", err.message));
      }, 60_000);
    }
    return { success: true };
  });

  // Called by the renderer the moment `navigator.onLine` flips true, so
  // reconnecting doesn't wait for the next 60s tick.
  ipcMain.handle("sync:onConnectionRestored", async () => {
    try {
      return await runFullSync();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerSyncHandlers };
