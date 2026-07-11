const { ipcMain, dialog, app, BrowserWindow, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { db } = require("../db/database");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const { enqueueSync } = require("../firebase/queue");

const receiptsDir = path.join(app.getPath("userData"), "receipts");

function registerExpenseHandlers() {
  ipcMain.handle("expenses:getAll", () =>
    db.prepare("SELECT * FROM expenses ORDER BY expense_date DESC").all()
  );

  ipcMain.handle("expenses:getCategories", () =>
    db.prepare("SELECT * FROM expense_categories ORDER BY name").all()
  );

  ipcMain.handle("expenses:createCategory", (event, name) => {
    try {
      requirePermission("expenses", "create");
      const info = db.prepare("INSERT INTO expense_categories (name) VALUES (?)").run(name);
      logAudit("create_expense_category", "expenses", { name });
      return { success: true, id: info.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message.includes("UNIQUE") ? "That category already exists." : err.message };
    }
  });

  ipcMain.handle("expenses:create", (event, e) => {
    try {
      requirePermission("expenses", "create");
      const info = db
        .prepare("INSERT INTO expenses (name, category, amount, expense_date, receipt_path) VALUES (?, ?, ?, ?, ?)")
        .run(e.name, e.category, e.amount, e.expense_date, e.receipt_path || null);
      logAudit("create_expense", "expenses", { id: info.lastInsertRowid, name: e.name, amount: e.amount });
      enqueueSync("expenses", info.lastInsertRowid, "create", { ...e, id: info.lastInsertRowid });
      return { success: true, id: info.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("expenses:update", (event, { id, ...e }) => {
    try {
      requirePermission("expenses", "edit");
      db.prepare(
        "UPDATE expenses SET name=@name, category=@category, amount=@amount, expense_date=@expense_date, receipt_path=@receipt_path WHERE id=@id"
      ).run({ id, receipt_path: e.receipt_path || null, ...e });
      logAudit("update_expense", "expenses", { id, ...e });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("expenses:delete", (event, id) => {
    try {
      requirePermission("expenses", "delete");
      db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
      logAudit("delete_expense", "expenses", { id });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Copies the chosen file into the app's own receipts folder so the
  // original location doesn't need to stay valid, and returns the stored path.
  ipcMain.handle("expenses:attachReceipt", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Attach receipt",
      filters: [{ name: "Documents & Images", extensions: ["pdf", "png", "jpg", "jpeg"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return { success: false, canceled: true };

    try {
      if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
      const original = filePaths[0];
      const destName = `${Date.now()}-${path.basename(original)}`;
      const dest = path.join(receiptsDir, destName);
      fs.copyFileSync(original, dest);
      return { success: true, path: dest, fileName: path.basename(original) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("expenses:openReceipt", (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.openPath(filePath);
      return { success: true };
    }
    return { success: false, error: "Receipt file not found." };
  });

  ipcMain.handle("expenses:getSummary", () => {
    const total = db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM expenses
       WHERE strftime('%Y-%m', expense_date) = strftime('%Y-%m', 'now')`
    ).get();
    const byCategory = db.prepare(
      `SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses
       WHERE strftime('%Y-%m', expense_date) = strftime('%Y-%m', 'now')
       GROUP BY category ORDER BY total DESC`
    ).all();
    return { monthTotal: total.total, byCategory };
  });
}

module.exports = { registerExpenseHandlers };
