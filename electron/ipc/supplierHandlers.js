const { ipcMain } = require("electron");
const { db } = require("../db/database");

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
    const info = db
      .prepare(
        "INSERT INTO suppliers (name, contact_person, phone, category, status) VALUES (?, ?, ?, ?, ?)"
      )
      .run(s.name, s.contact_person || null, s.phone || null, s.category || null, s.status || "Active");
    return { success: true, id: info.lastInsertRowid };
  });

  ipcMain.handle("suppliers:update", (event, { id, ...s }) => {
    db.prepare(
      `UPDATE suppliers SET name=@name, contact_person=@contact_person, phone=@phone,
       category=@category, status=@status WHERE id=@id`
    ).run({ id, ...s });
    return { success: true };
  });

  ipcMain.handle("suppliers:delete", (event, id) => {
    db.prepare("DELETE FROM suppliers WHERE id = ?").run(id);
    return { success: true };
  });
}

module.exports = { registerSupplierHandlers };
