const { ipcMain } = require("electron");
const { db } = require("../db/database");

function registerExpenseHandlers() {
  ipcMain.handle("expenses:getAll", () =>
    db.prepare("SELECT * FROM expenses ORDER BY expense_date DESC").all()
  );

  ipcMain.handle("expenses:create", (event, e) => {
    const info = db
      .prepare("INSERT INTO expenses (name, category, amount, expense_date) VALUES (?, ?, ?, ?)")
      .run(e.name, e.category, e.amount, e.expense_date);
    return { success: true, id: info.lastInsertRowid };
  });

  ipcMain.handle("expenses:update", (event, { id, ...e }) => {
    db.prepare(
      "UPDATE expenses SET name=@name, category=@category, amount=@amount, expense_date=@expense_date WHERE id=@id"
    ).run({ id, ...e });
    return { success: true };
  });

  ipcMain.handle("expenses:delete", (event, id) => {
    db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
    return { success: true };
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
