const { ipcMain } = require("electron");
const { syncPendingSales, getPendingCount, isConfigured } = require("../firebase/sync");

let autoSyncTimer = null;

function registerSyncHandlers() {
  ipcMain.handle("sync:getStatus", () => ({
    configured: isConfigured(),
    pendingCount: getPendingCount(),
  }));

  ipcMain.handle("sync:triggerNow", async () => {
    try {
      return await syncPendingSales();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("sync:setAutoSync", (event, enabled) => {
    if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
    if (enabled) {
      autoSyncTimer = setInterval(() => {
        syncPendingSales().catch((err) => console.warn("[firebase-sync] auto-sync error:", err.message));
      }, 60_000);
    }
    return { success: true };
  });
}

module.exports = { registerSyncHandlers };
