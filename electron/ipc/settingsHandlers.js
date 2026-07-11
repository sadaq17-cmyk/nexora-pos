const { ipcMain, BrowserWindow } = require("electron");
const { db } = require("../db/database");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");

const DEFAULTS = {
  store_name: "Nexora Supermarket — Westlands",
  store_phone: "+254 700 555 123",
  store_address: "Waiyaki Way, Nairobi",
  currency: "KES (Ksh)",
  vat_rate: "16",
  tax_pin: "P051234567X",
  payment_cash: "true",
  payment_card: "true",
  payment_mpesa: "true",
  firebase_sync_enabled: "false",
  receipt_header: "Thank you for shopping with us!",
  receipt_footer: "Goods sold in good condition are exchangeable within 7 days with receipt.",
  barcode_prefix: "89",
  barcode_format: "EAN-13",
  printer_name: "",
  auto_backup_enabled: "true",
  auto_backup_interval_hours: "24",
  last_backup_at: "",
};

function registerSettingsHandlers() {
  // Ensure every default key exists without overwriting anything already set.
  const insertIfMissing = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  Object.entries(DEFAULTS).forEach(([k, v]) => insertIfMissing.run(k, v));

  ipcMain.handle("settings:getAll", () => {
    const rows = db.prepare("SELECT key, value FROM settings").all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  ipcMain.handle("settings:update", (event, updates) => {
    try {
      requirePermission("settings", "edit");
      const upsert = db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      );
      const run = db.transaction((entries) => {
        entries.forEach(([k, v]) => upsert.run(k, String(v)));
      });
      run(Object.entries(updates));
      logAudit("update_settings", "settings", updates);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("settings:getPrinters", async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return [];
    try {
      const printers = await win.webContents.getPrintersAsync();
      return printers.map((p) => ({ name: p.name, isDefault: p.isDefault }));
    } catch {
      return [];
    }
  });
}

module.exports = { registerSettingsHandlers };
