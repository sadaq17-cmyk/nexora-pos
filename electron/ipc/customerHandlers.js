const { ipcMain } = require("electron");
const { db } = require("../db/database");

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
    const info = db
      .prepare("INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)")
      .run(customer.name, customer.phone || null, customer.email || null);
    return { success: true, id: info.lastInsertRowid };
  });
}

module.exports = { registerCustomerHandlers };
