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
}

module.exports = { registerAuthHandlers };
