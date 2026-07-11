const { ipcMain } = require("electron");
const { db } = require("../db/database");
const { getMatrix, MODULES, ACTIONS, requirePermission } = require("../permissions");
const { getCurrentUser } = require("../session");
const { logAudit } = require("../audit");

function registerPermissionHandlers() {
  ipcMain.handle("permissions:getMatrix", () => ({ matrix: getMatrix(), modules: MODULES, actions: ACTIONS }));

  ipcMain.handle("permissions:getMine", () => {
    const user = getCurrentUser();
    if (!user) return {};
    if (user.role === "admin") {
      const all = {};
      MODULES.forEach((m) => { all[m] = { view: true, create: true, edit: true, delete: true }; });
      return all;
    }
    const matrix = getMatrix();
    return matrix[user.role] || {};
  });

  ipcMain.handle("permissions:update", (event, { role, module, action, allowed }) => {
    try {
      requirePermission("users", "edit"); // permission management piggybacks on the users:edit permission
      if (role === "admin") return { success: false, error: "Admin permissions can't be restricted." };
      db.prepare(
        "INSERT INTO permissions (role, module, action, allowed) VALUES (?, ?, ?, ?) ON CONFLICT(role, module, action) DO UPDATE SET allowed = excluded.allowed"
      ).run(role, module, action, allowed ? 1 : 0);
      logAudit("update_permission", "users", { role, module, action, allowed });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerPermissionHandlers };
