const { ipcMain } = require("electron");
const { db } = require("../db/database");

function registerReportHandlers() {
  // Last 6 months of revenue (from sales) vs expenses, grouped by month.
  ipcMain.handle("reports:getRevenueVsExpenses", () => {
    const revenue = db
      .prepare(
        `SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(total),0) AS revenue
         FROM sales
         WHERE created_at >= date('now', '-6 months')
         GROUP BY month`
      )
      .all();
    const expenses = db
      .prepare(
        `SELECT strftime('%Y-%m', expense_date) AS month, COALESCE(SUM(amount),0) AS expenses
         FROM expenses
         WHERE expense_date >= date('now', '-6 months')
         GROUP BY month`
      )
      .all();
    const months = new Set([...revenue.map((r) => r.month), ...expenses.map((e) => e.month)]);
    return [...months].sort().map((month) => ({
      month,
      revenue: revenue.find((r) => r.month === month)?.revenue || 0,
      expenses: expenses.find((e) => e.month === month)?.expenses || 0,
    }));
  });

  ipcMain.handle("reports:getTopProducts", (event, limit = 5) =>
    db
      .prepare(
        `SELECT product_name AS name, SUM(qty * price) AS revenue, SUM(qty) AS units
         FROM sale_items GROUP BY product_name ORDER BY revenue DESC LIMIT ?`
      )
      .all(limit)
  );

  ipcMain.handle("reports:getCategorySales", () =>
    db
      .prepare(
        `SELECT COALESCE(c.name, 'Uncategorized') AS name, COALESCE(SUM(si.qty * si.price),0) AS value
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         GROUP BY c.name
         HAVING value > 0
         ORDER BY value DESC`
      )
      .all()
  );

  ipcMain.handle("reports:getProfitSummary", () => {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(qty * price),0) AS revenue, COALESCE(SUM(qty * cost),0) AS cost
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE strftime('%Y-%m', s.created_at) = strftime('%Y-%m', 'now')`
      )
      .get();
    return { revenue: row.revenue, cost: row.cost, profit: row.revenue - row.cost };
  });
}

module.exports = { registerReportHandlers };
