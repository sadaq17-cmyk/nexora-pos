const { ipcMain } = require("electron");
const { db } = require("../db/database");
const { requirePermission } = require("../permissions");

function registerAuditHandlers() {
  ipcMain.handle("audit:getAll", (event, { module, limit = 200 } = {}) => {
    try {
      requirePermission("audit", "view");
    } catch (err) {
      return { success: false, error: err.message };
    }
    if (module) {
      return db
        .prepare("SELECT * FROM audit_log WHERE module = ? ORDER BY created_at DESC LIMIT ?")
        .all(module, limit);
    }
    return db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?").all(limit);
  });

  ipcMain.handle("audit:getLoginHistory", (event, limit = 100) => {
    try {
      requirePermission("audit", "view");
    } catch (err) {
      return { success: false, error: err.message };
    }
    return db
      .prepare("SELECT * FROM audit_log WHERE module = 'auth' ORDER BY created_at DESC LIMIT ?")
      .all(limit);
  });
}

module.exports = { registerAuditHandlers };
