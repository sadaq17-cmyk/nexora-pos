const { ipcMain } = require("electron");
const { db } = require("../db/database");

function nextInvoiceNo() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sales").get();
  return `TXN-${8000 + row.n + 1}`;
}

function registerSalesHandlers() {
  const createSale = db.transaction((sale) => {
    const invoice_no = nextInvoiceNo();
    const info = db
      .prepare(
        `INSERT INTO sales (invoice_no, customer_id, user_id, subtotal, discount, vat, total, payment_method)
         VALUES (@invoice_no, @customer_id, @user_id, @subtotal, @discount, @vat, @total, @payment_method)`
      )
      .run({ invoice_no, ...sale });

    const saleId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, product_name, qty, price, cost)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const decrementStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");

    for (const item of sale.items) {
      insertItem.run(saleId, item.product_id, item.name, item.qty, item.price, item.cost || 0);
      decrementStock.run(item.qty, item.product_id);
    }

    return { id: saleId, invoice_no };
  });

  ipcMain.handle("sales:create", (event, sale) => {
    try {
      const result = createSale(sale);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("sales:getRecent", (event, limit = 20) =>
    db
      .prepare(
        `SELECT s.id, s.invoice_no, s.total, s.subtotal, s.discount, s.vat, s.payment_method, s.created_at,
                COALESCE(c.name, 'Walk-in') AS customer,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         ORDER BY s.created_at DESC
         LIMIT ?`
      )
      .all(limit)
  );

  ipcMain.handle("sales:getSummary", () => {
    const today = db
      .prepare(
        `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count
         FROM sales WHERE date(created_at) = date('now')`
      )
      .get();
    const month = db
      .prepare(
        `SELECT COALESCE(SUM(total),0) AS revenue
         FROM sales WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
      )
      .get();
    return { today: today.total, todayCount: today.count, monthRevenue: month.revenue };
  });

  ipcMain.handle("sales:getWeeklyTrend", () =>
    db
      .prepare(
        `SELECT date(created_at) AS day, COALESCE(SUM(total), 0) AS sales
         FROM sales
         WHERE created_at >= date('now', '-6 days')
         GROUP BY date(created_at)
         ORDER BY day ASC`
      )
      .all()
  );

  ipcMain.handle("sales:getItems", (event, saleId) =>
    db.prepare("SELECT * FROM sale_items WHERE sale_id = ?").all(saleId)
  );
}

module.exports = { registerSalesHandlers };
