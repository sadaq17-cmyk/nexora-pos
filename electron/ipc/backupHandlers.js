const { ipcMain, dialog, app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { dbPath } = require("../db/database");

function registerBackupHandlers() {
  ipcMain.handle("backup:export", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const defaultName = `nexora-backup-${new Date().toISOString().slice(0, 10)}.db`;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save NEXORA POS backup",
      defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };

    try {
      // WAL mode keeps recent writes in a -wal file; checkpoint first so the
      // .db file on disk is fully up to date before we copy it.
      const { db } = require("../db/database");
      db.pragma("wal_checkpoint(TRUNCATE)");
      fs.copyFileSync(dbPath, filePath);
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("backup:restore", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Restore NEXORA POS backup",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return { success: false, canceled: true };

    try {
      const { db } = require("../db/database");
      db.close();
      fs.copyFileSync(filePaths[0], dbPath);
      // The DB connection + schema are re-established fresh on relaunch.
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerBackupHandlers };
