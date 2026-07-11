const { ipcMain } = require("electron");
const bcrypt = require("bcryptjs");
const { db } = require("../db/database");

function registerAuthHandlers() {
  ipcMain.handle("auth:login", (event, { email, password }) => {
    const user = db
      .prepare("SELECT * FROM users WHERE email = ? AND active = 1")
      .get(String(email).trim().toLowerCase());

    if (!user) return { success: false, error: "No account found for that email." };

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return { success: false, error: "Incorrect password." };

    const { password_hash, ...safeUser } = user;
    return { success: true, user: safeUser };
  });

  ipcMain.handle("auth:listUsers", () => {
    return db
      .prepare("SELECT id, name, email, role, active, created_at FROM users ORDER BY name")
      .all();
  });

  ipcMain.handle("auth:createUser", (event, { name, email, password, role }) => {
    try {
      const hash = bcrypt.hashSync(password, 10);
      const info = db
        .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
        .run(name, email.trim().toLowerCase(), hash, role);
      return { success: true, id: info.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message.includes("UNIQUE") ? "That email is already in use." : err.message };
    }
  });

  ipcMain.handle("auth:setUserActive", (event, { id, active }) => {
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
    return { success: true };
  });

  ipcMain.handle("auth:setUserRole", (event, { id, role }) => {
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    return { success: true };
  });
}

module.exports = { registerAuthHandlers };
