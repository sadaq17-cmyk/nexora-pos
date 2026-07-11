const { ipcMain, dialog, app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { dbPath } = require("../db/database");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");

const backupsDir = path.join(app.getPath("userData"), "backups");

function ensureBackupsDir() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
}

// Checkpoints WAL to disk, then copies the .db file to `dest`. Shared by
// manual export and the scheduled auto-backup.
function writeBackupTo(dest) {
  const { db } = require("../db/database");
  db.pragma("wal_checkpoint(TRUNCATE)");
  fs.copyFileSync(dbPath, dest);
}

// Called on app start and on an hourly timer from main.js. Runs a local
// backup (no dialog) if enough time has passed since the last one, per the
// auto_backup_enabled / auto_backup_interval_hours settings.
function runAutoBackupIfDue() {
  const { db } = require("../db/database");
  const get = (key) => db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value;
  if (get("auto_backup_enabled") !== "true") return { ran: false, reason: "disabled" };

  const intervalHours = parseFloat(get("auto_backup_interval_hours") || "24");
  const lastBackupAt = get("last_backup_at");
  const dueAt = lastBackupAt ? new Date(lastBackupAt).getTime() + intervalHours * 3600_000 : 0;
  if (Date.now() < dueAt) return { ran: false, reason: "not_due" };

  try {
    ensureBackupsDir();
    const fileName = `auto-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    const dest = path.join(backupsDir, fileName);
    writeBackupTo(dest);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO settings (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(now);
    logAudit("auto_backup", "settings", { fileName });

    // Keep the last 14 auto-backups so the folder doesn't grow unbounded.
    const files = fs.readdirSync(backupsDir).filter((f) => f.startsWith("auto-")).sort();
    while (files.length > 14) fs.unlinkSync(path.join(backupsDir, files.shift()));

    return { ran: true, fileName };
  } catch (err) {
    return { ran: false, reason: "error", error: err.message };
  }
}

function registerBackupHandlers() {
  ipcMain.handle("backup:export", async () => {
    try {
      requirePermission("settings", "edit");
    } catch (err) {
      return { success: false, error: err.message };
    }
    const win = BrowserWindow.getFocusedWindow();
    const defaultName = `nexora-backup-${new Date().toISOString().slice(0, 10)}.db`;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save NEXORA POS backup",
      defaultPath: path.join(app.getPath("documents"), defaultName),
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };

    try {
      writeBackupTo(filePath);
      logAudit("manual_backup", "settings", { filePath });
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("backup:restore", async () => {
    try {
      requirePermission("settings", "edit");
    } catch (err) {
      return { success: false, error: err.message };
    }
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Restore NEXORA POS backup",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return { success: false, canceled: true };

    try {
      logAudit("restore_backup", "settings", { source: filePaths[0] });
      const { db } = require("../db/database");
      db.close();
      fs.copyFileSync(filePaths[0], dbPath);
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("backup:getHistory", () => {
    ensureBackupsDir();
    return fs
      .readdirSync(backupsDir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const stat = fs.statSync(path.join(backupsDir, f));
        return { fileName: f, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  ipcMain.handle("backup:runNow", () => runAutoBackupIfDue());
}

module.exports = { registerBackupHandlers, runAutoBackupIfDue };
