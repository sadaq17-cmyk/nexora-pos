const { ipcMain } = require("electron");
const { db } = require("../db/database");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const { enqueueSync } = require("../firebase/queue");

function registerCustomerHandlers() {
  ipcMain.handle("customers:getAll", () =>
    db
      .prepare(
        `SELECT cu.*,
           COALESCE((SELECT COUNT(*) FROM sales s WHERE s.customer_id = cu.id), 0) AS visits,
           COALESCE((SELECT SUM(total) FROM sales s WHERE s.customer_id = cu.id), 0) AS spent
         FROM customers cu ORDER BY cu.name`
      )
      .all()
  );

  ipcMain.handle("customers:create", (event, customer) => {
    try {
      requirePermission("customers", "create");
      const info = db
        .prepare("INSERT INTO customers (name, phone, email, credit_limit) VALUES (?, ?, ?, ?)")
        .run(customer.name, customer.phone || null, customer.email || null, customer.credit_limit || 0);
      logAudit("create_customer", "customers", { id: info.lastInsertRowid, name: customer.name });
      enqueueSync("customers", info.lastInsertRowid, "create", { ...customer, id: info.lastInsertRowid });
      return { success: true, id: info.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("customers:update", (event, { id, ...fields }) => {
    try {
      requirePermission("customers", "edit");
      db.prepare(
        `UPDATE customers SET name=@name, phone=@phone, email=@email, credit_limit=@credit_limit,
         updated_at = datetime('now') WHERE id=@id`
      ).run({ id, ...fields });
      logAudit("update_customer", "customers", { id, ...fields });
      enqueueSync("customers", id, "update", { id, ...fields });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("customers:delete", (event, id) => {
    try {
      requirePermission("customers", "delete");
      db.prepare("DELETE FROM customers WHERE id = ?").run(id);
      logAudit("delete_customer", "customers", { id });
      enqueueSync("customers", id, "delete", { id });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("customers:addPayment", (event, { customer_id, amount, method, note }) => {
    try {
      requirePermission("customers", "edit");
      const run = db.transaction(() => {
        db.prepare("INSERT INTO customer_payments (customer_id, amount, method, note) VALUES (?, ?, ?, ?)")
          .run(customer_id, amount, method || "Cash", note || null);
        db.prepare("UPDATE customers SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
          .run(amount, customer_id);
      });
      run();
      logAudit("customer_payment", "customers", { customer_id, amount, method });
      enqueueSync("customer_payments", customer_id, "create", { customer_id, amount, method });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("customers:getStatement", (event, customerId) => {
    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
    const sales = db
      .prepare("SELECT id, invoice_no, total, payment_method, created_at FROM sales WHERE customer_id = ? ORDER BY created_at DESC")
      .all(customerId);
    const payments = db
      .prepare("SELECT * FROM customer_payments WHERE customer_id = ? ORDER BY created_at DESC")
      .all(customerId);
    return { customer, sales, payments };
  });

  ipcMain.handle("customers:getPurchaseHistory", (event, customerId) =>
    db
      .prepare(
        `SELECT s.id, s.invoice_no, s.total, s.payment_method, s.created_at,
           (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
         FROM sales s WHERE s.customer_id = ? ORDER BY s.created_at DESC`
      )
      .all(customerId)
  );
}

module.exports = { registerCustomerHandlers };
