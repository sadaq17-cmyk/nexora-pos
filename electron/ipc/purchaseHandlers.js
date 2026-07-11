const { ipcMain } = require("electron");
const { db } = require("../db/database");

function nextPoNumber() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM purchases").get();
  return `PO-${1040 + row.n + 1}`;
}

function registerPurchaseHandlers() {
  const createPurchase = db.transaction((purchase) => {
    const po_number = nextPoNumber();
    const total = purchase.items.reduce((s, it) => s + it.qty * it.cost, 0);
    const info = db
      .prepare("INSERT INTO purchases (po_number, supplier_id, total, status) VALUES (?, ?, ?, ?)")
      .run(po_number, purchase.supplier_id, total, purchase.status || "Pending");
    const purchaseId = info.lastInsertRowid;
    const insertItem = db.prepare(
      "INSERT INTO purchase_items (purchase_id, product_id, qty, cost) VALUES (?, ?, ?, ?)"
    );
    purchase.items.forEach((it) => insertItem.run(purchaseId, it.product_id, it.qty, it.cost));
    return { id: purchaseId, po_number, total };
  });

  // Marking a PO Received increases stock for every item on it, in one transaction.
  const receivePurchase = db.transaction((purchaseId) => {
    const items = db.prepare("SELECT * FROM purchase_items WHERE purchase_id = ?").all(purchaseId);
    const bump = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
    items.forEach((it) => { if (it.product_id) bump.run(it.qty, it.product_id); });
    db.prepare("UPDATE purchases SET status = 'Received' WHERE id = ?").run(purchaseId);
  });

  ipcMain.handle("purchases:getAll", () =>
    db
      .prepare(
        `SELECT p.*, s.name AS supplier,
           (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
         FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
         ORDER BY p.created_at DESC`
      )
      .all()
  );

  ipcMain.handle("purchases:getItems", (event, purchaseId) =>
    db
      .prepare(
        `SELECT pi.*, pr.name AS product_name FROM purchase_items pi
         LEFT JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ?`
      )
      .all(purchaseId)
  );

  ipcMain.handle("purchases:create", (event, purchase) => {
    try {
      const result = createPurchase(purchase);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("purchases:receive", (event, purchaseId) => {
    try {
      receivePurchase(purchaseId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("purchases:updateStatus", (event, { id, status }) => {
    db.prepare("UPDATE purchases SET status = ? WHERE id = ?").run(status, id);
    return { success: true };
  });
}

module.exports = { registerPurchaseHandlers };
