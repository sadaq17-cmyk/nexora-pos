const { ipcMain } = require("electron");
const { db } = require("../db/database");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const { enqueueSync } = require("../firebase/queue");

function registerSupplierHandlers() {
  ipcMain.handle("suppliers:getAll", () =>
    db
      .prepare(
        `SELECT s.*,
           COALESCE((SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id), 0) AS order_count,
           COALESCE((SELECT SUM(total) FROM purchases p WHERE p.supplier_id = s.id), 0) AS total_ordered
         FROM suppliers s ORDER BY s.name`
      )
      .all()
  );

  ipcMain.handle("suppliers:create", (event, s) => {
    try {
      requirePermission("suppliers", "create");
      const info = db
        .prepare(
          "INSERT INTO suppliers (name, contact_person, phone, category, status) VALUES (?, ?, ?, ?, ?)"
        )
        .run(s.name, s.contact_person || null, s.phone || null, s.category || null, s.status || "Active");
      logAudit("create_supplier", "suppliers", { id: info.lastInsertRowid, name: s.name });
      enqueueSync("suppliers", info.lastInsertRowid, "create", { ...s, id: info.lastInsertRowid });
      return { success: true, id: info.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("suppliers:update", (event, { id, ...s }) => {
    try {
      requirePermission("suppliers", "edit");
      db.prepare(
        `UPDATE suppliers SET name=@name, contact_person=@contact_person, phone=@phone,
         category=@category, status=@status, updated_at = datetime('now') WHERE id=@id`
      ).run({ id, ...s });
      logAudit("update_supplier", "suppliers", { id, ...s });
      enqueueSync("suppliers", id, "update", { id, ...s });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("suppliers:delete", (event, id) => {
    try {
      requirePermission("suppliers", "delete");
      db.prepare("DELETE FROM suppliers WHERE id = ?").run(id);
      logAudit("delete_supplier", "suppliers", { id });
      enqueueSync("suppliers", id, "delete", { id });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("suppliers:addPayment", (event, { supplier_id, amount, method, note }) => {
    try {
      requirePermission("suppliers", "edit");
      const run = db.transaction(() => {
        db.prepare("INSERT INTO supplier_payments (supplier_id, amount, method, note) VALUES (?, ?, ?, ?)")
          .run(supplier_id, amount, method || "Cash", note || null);
        db.prepare("UPDATE suppliers SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
          .run(amount, supplier_id);
      });
      run();
      logAudit("supplier_payment", "suppliers", { supplier_id, amount, method });
      enqueueSync("supplier_payments", supplier_id, "create", { supplier_id, amount, method });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("suppliers:getStatement", (event, supplierId) => {
    const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId);
    const purchases = db
      .prepare("SELECT id, po_number, total, status, created_at FROM purchases WHERE supplier_id = ? ORDER BY created_at DESC")
      .all(supplierId);
    const payments = db
      .prepare("SELECT * FROM supplier_payments WHERE supplier_id = ? ORDER BY created_at DESC")
      .all(supplierId);
    return { supplier, purchases, payments };
  });
}

module.exports = { registerSupplierHandlers };
