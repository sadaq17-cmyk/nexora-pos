const { ipcMain } = require("electron");
const { db } = require("../db/database");

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
    const info = db
      .prepare(
        `INSERT INTO products (name, barcode, category_id, price, cost, stock, reorder_level, unit)
         VALUES (@name, @barcode, @category_id, @price, @cost, @stock, @reorder_level, @unit)`
      )
      .run(product);
    return { success: true, id: info.lastInsertRowid };
  });

  ipcMain.handle("products:update", (event, { id, ...fields }) => {
    db.prepare(
      `UPDATE products SET name=@name, barcode=@barcode, category_id=@category_id,
       price=@price, cost=@cost, stock=@stock, reorder_level=@reorder_level, unit=@unit
       WHERE id=@id`
    ).run({ id, ...fields });
    return { success: true };
  });

  ipcMain.handle("products:delete", (event, id) => {
    db.prepare("UPDATE products SET active = 0 WHERE id = ?").run(id);
    return { success: true };
  });

  ipcMain.handle("products:adjustStock", (event, { id, delta }) => {
    db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(delta, id);
    return { success: true };
  });
}

module.exports = { registerProductHandlers };
