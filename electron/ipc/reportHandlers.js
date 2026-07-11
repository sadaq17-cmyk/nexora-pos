const { ipcMain } = require("electron");
const { db } = require("../db/database");

function registerReportHandlers() {
  ipcMain.handle("reports:getRevenueVsExpenses", () => {
    const revenue = db
      .prepare(
        `SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(total),0) AS revenue
         FROM sales WHERE created_at >= date('now', '-6 months') GROUP BY month`
      )
      .all();
    const expenses = db
      .prepare(
        `SELECT strftime('%Y-%m', expense_date) AS month, COALESCE(SUM(amount),0) AS expenses
         FROM expenses WHERE expense_date >= date('now', '-6 months') GROUP BY month`
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
         GROUP BY c.name HAVING value > 0 ORDER BY value DESC`
      )
      .all()
  );

  ipcMain.handle("reports:getProfitSummary", () => {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(qty * price),0) AS revenue, COALESCE(SUM(qty * cost),0) AS cost
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE strftime('%Y-%m', s.created_at) = strftime('%Y-%m', 'now')`
      )
      .get();
    return { revenue: row.revenue, cost: row.cost, profit: row.revenue - row.cost };
  });

  // ---- Sales Report ----
  ipcMain.handle("reports:getSalesReport", (event, { start, end } = {}) => {
    const s = start || "2000-01-01";
    const e = end || "2100-01-01";
    const rows = db
      .prepare(
        `SELECT s.id, s.invoice_no, s.total, s.subtotal, s.discount, s.vat, s.payment_method, s.created_at,
                COALESCE(c.name, 'Walk-in') AS customer
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE date(s.created_at) BETWEEN date(?) AND date(?)
         ORDER BY s.created_at DESC`
      )
      .all(s, e);
    const totals = rows.reduce(
      (acc, r) => ({ subtotal: acc.subtotal + r.subtotal, discount: acc.discount + r.discount, vat: acc.vat + r.vat, total: acc.total + r.total }),
      { subtotal: 0, discount: 0, vat: 0, total: 0 }
    );
    return { rows, totals };
  });

  // ---- Purchase Report ----
  ipcMain.handle("reports:getPurchaseReport", (event, { start, end } = {}) => {
    const s = start || "2000-01-01";
    const e = end || "2100-01-01";
    const rows = db
      .prepare(
        `SELECT p.id, p.po_number, p.total, p.status, p.created_at, COALESCE(sup.name, 'Unknown') AS supplier
         FROM purchases p LEFT JOIN suppliers sup ON sup.id = p.supplier_id
         WHERE date(p.created_at) BETWEEN date(?) AND date(?)
         ORDER BY p.created_at DESC`
      )
      .all(s, e);
    const totals = rows.reduce((acc, r) => acc + r.total, 0);
    return { rows, total: totals };
  });

  // ---- Profit & Loss ----
  ipcMain.handle("reports:getProfitLoss", (event, { month } = {}) => {
    const m = month || new Date().toISOString().slice(0, 7);
    const sales = db
      .prepare(
        `SELECT COALESCE(SUM(si.qty * si.price),0) AS revenue, COALESCE(SUM(si.qty * si.cost),0) AS cogs
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE strftime('%Y-%m', s.created_at) = ?`
      )
      .get(m);
    const expenses = db
      .prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE strftime('%Y-%m', expense_date) = ?`)
      .get(m);
    const grossProfit = sales.revenue - sales.cogs;
    const netProfit = grossProfit - expenses.total;
    return { month: m, revenue: sales.revenue, cogs: sales.cogs, grossProfit, expenses: expenses.total, netProfit };
  });

  // ---- Expense Report ----
  ipcMain.handle("reports:getExpenseReport", (event, { start, end } = {}) => {
    const s = start || "2000-01-01";
    const e = end || "2100-01-01";
    const rows = db
      .prepare("SELECT * FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?) ORDER BY expense_date DESC")
      .all(s, e);
    const byCategory = db
      .prepare(
        `SELECT category, COALESCE(SUM(amount),0) AS total FROM expenses
         WHERE date(expense_date) BETWEEN date(?) AND date(?) GROUP BY category ORDER BY total DESC`
      )
      .all(s, e);
    const total = rows.reduce((acc, r) => acc + r.amount, 0);
    return { rows, byCategory, total };
  });

  // ---- Inventory Report ----
  ipcMain.handle("reports:getInventoryReport", () => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.stock, p.cost, p.price, p.reorder_level, c.name AS category,
                (p.stock * p.cost) AS stock_value
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.active = 1 ORDER BY stock_value DESC`
      )
      .all();
    const totalValue = rows.reduce((acc, r) => acc + r.stock_value, 0);
    return { rows, totalValue };
  });

  ipcMain.handle("reports:getLowStockReport", () =>
    db
      .prepare(
        `SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.active = 1 AND p.stock <= p.reorder_level ORDER BY p.stock ASC`
      )
      .all()
  );

  // ---- Customer Report ----
  ipcMain.handle("reports:getCustomerReport", () =>
    db
      .prepare(
        `SELECT cu.id, cu.name, cu.phone, cu.points, cu.balance,
           COALESCE((SELECT COUNT(*) FROM sales s WHERE s.customer_id = cu.id), 0) AS visits,
           COALESCE((SELECT SUM(total) FROM sales s WHERE s.customer_id = cu.id), 0) AS spent
         FROM customers cu ORDER BY spent DESC`
      )
      .all()
  );

  // ---- Supplier Report ----
  ipcMain.handle("reports:getSupplierReport", () =>
    db
      .prepare(
        `SELECT s.id, s.name, s.category, s.balance,
           COALESCE((SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id), 0) AS order_count,
           COALESCE((SELECT SUM(total) FROM purchases p WHERE p.supplier_id = s.id), 0) AS total_ordered
         FROM suppliers s ORDER BY total_ordered DESC`
      )
      .all()
  );
}

module.exports = { registerReportHandlers };
