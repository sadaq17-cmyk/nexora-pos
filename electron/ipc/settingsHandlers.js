const { ipcMain } = require("electron");
const { db } = require("../db/database");

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
    const upsert = db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    const run = db.transaction((entries) => {
      entries.forEach(([k, v]) => upsert.run(k, String(v)));
    });
    run(Object.entries(updates));
    return { success: true };
  });
}

module.exports = { registerSettingsHandlers };
