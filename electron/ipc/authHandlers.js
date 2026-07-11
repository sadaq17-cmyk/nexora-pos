const { ipcMain } = require("electron");
const bcrypt = require("bcryptjs");
const { db } = require("../db/database");
const { setCurrentUser, getCurrentUser } = require("../session");
const { logAudit } = require("../audit");
const { requirePermission } = require("../permissions");

function registerAuthHandlers() {
  ipcMain.handle("auth:login", (event, { email, password }) => {
    const user = db
      .prepare("SELECT * FROM users WHERE email = ? AND active = 1")
      .get(String(email).trim().toLowerCase());

    if (!user) {
      logAudit("login_failed", "auth", { email });
      return { success: false, error: "No account found for that email." };
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      logAudit("login_failed", "auth", { email });
      return { success: false, error: "Incorrect password." };
    }

    const { password_hash, ...safeUser } = user;
    setCurrentUser(safeUser);
    logAudit("login", "auth", { email });
    return { success: true, user: safeUser };
  });

  // Called once on app start if the renderer has a cached session, so the
  // main process (which has no access to localStorage) knows who's active
  // for audit attribution and permission checks.
  ipcMain.handle("auth:restoreSession", (event, user) => {
    const dbUser = db.prepare("SELECT id, name, email, role, active FROM users WHERE id = ? AND active = 1").get(user?.id);
    if (dbUser) setCurrentUser(dbUser);
    return { success: !!dbUser };
  });

  ipcMain.handle("auth:logout", () => {
    const user = getCurrentUser();
    if (user) logAudit("logout", "auth", { email: user.name });
    setCurrentUser(null);
    return { success: true };
  });

  ipcMain.handle("auth:listUsers", () => {
    return db
      .prepare("SELECT id, name, email, role, active, created_at FROM users ORDER BY name")
      .all();
  });

  ipcMain.handle("auth:createUser", (event, { name, email, password, role }) => {
    try {
      requirePermission("users", "create");
      const hash = bcrypt.hashSync(password, 10);
      const info = db
        .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
        .run(name, email.trim().toLowerCase(), hash, role);
      logAudit("create_user", "users", { name, email, role });
      return { success: true, id: info.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message.includes("UNIQUE") ? "That email is already in use." : err.message };
    }
  });

  ipcMain.handle("auth:setUserActive", (event, { id, active }) => {
    try {
      requirePermission("users", "edit");
      db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
      logAudit(active ? "activate_user" : "deactivate_user", "users", { id });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("auth:setUserRole", (event, { id, role }) => {
    try {
      requirePermission("users", "edit");
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
      logAudit("change_role", "users", { id, role });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerAuthHandlers };
