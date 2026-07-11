const { ipcMain } = require("electron");
const { db } = require("../db/database");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const { enqueueSync } = require("../firebase/queue");

const SELECT_ALL = `
  SELECT p.*, c.name AS category, c.color AS category_color
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.active = 1
  ORDER BY p.name
`;

function registerProductHandlers() {
  ipcMain.handle("products:getAll", () => db.prepare(SELECT_ALL).all());

  ipcMain.handle("products:getByBarcode", (event, barcode) =>
    db
      .prepare(
        `SELECT p.*, c.name AS category FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.barcode = ? AND p.active = 1`
      )
      .get(barcode) || null
  );

  ipcMain.handle("products:getCategories", () =>
    db.prepare("SELECT * FROM categories ORDER BY name").all()
  );

  ipcMain.handle("products:create", (event, product) => {
    try {
      requirePermission("products", "create");
      const info = db
        .prepare(
          `INSERT INTO products (name, barcode, category_id, price, cost, stock, reorder_level, unit)
           VALUES (@name, @barcode, @category_id, @price, @cost, @stock, @reorder_level, @unit)`
        )
        .run(product);
      logAudit("create_product", "products", { id: info.lastInsertRowid, name: product.name });
      enqueueSync("products", info.lastInsertRowid, "create", { ...product, id: info.lastInsertRowid });
      return { success: true, id: info.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("products:update", (event, { id, ...fields }) => {
    try {
      requirePermission("products", "edit");
      db.prepare(
        `UPDATE products SET name=@name, barcode=@barcode, category_id=@category_id,
         price=@price, cost=@cost, stock=@stock, reorder_level=@reorder_level, unit=@unit,
         updated_at=datetime('now') WHERE id=@id`
      ).run({ id, ...fields });
      logAudit("update_product", "products", { id, ...fields });
      enqueueSync("products", id, "update", { id, ...fields });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("products:delete", (event, id) => {
    try {
      requirePermission("products", "delete");
      db.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
      logAudit("delete_product", "products", { id });
      enqueueSync("products", id, "delete", { id });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("products:adjustStock", (event, { id, delta, reason }) => {
    try {
      requirePermission("inventory", "edit");
      db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?").run(delta, id);
      logAudit("adjust_stock", "inventory", { id, delta, reason: reason || "Manual adjustment" });
      enqueueSync("products", id, "update", { id, stockDelta: delta });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerProductHandlers };
