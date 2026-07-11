const { ipcMain } = require("electron");
const { db } = require("../db/database");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const { enqueueSync } = require("../firebase/queue");

function nextPoNumber() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM purchases").get();
  return `PO-${1040 + row.n + 1}`;
}

function registerPurchaseHandlers() {
  const createPurchase = db.transaction((purchase) => {
    const po_number = nextPoNumber();
    const total = purchase.items.reduce((s, it) => s + it.qty * it.cost, 0);
    const info = db
      .prepare("INSERT INTO purchases (po_number, supplier_id, invoice_no, total, status) VALUES (?, ?, ?, ?, ?)")
      .run(po_number, purchase.supplier_id, purchase.invoice_no || null, total, purchase.status || "Pending");
    const purchaseId = info.lastInsertRowid;
    const insertItem = db.prepare(
      "INSERT INTO purchase_items (purchase_id, product_id, qty, cost) VALUES (?, ?, ?, ?)"
    );
    purchase.items.forEach((it) => insertItem.run(purchaseId, it.product_id, it.qty, it.cost));
    return { id: purchaseId, po_number, total };
  });

  // Receiving a PO both increases stock for every item and increases what
  // the store owes the supplier (accounts payable) — goods-received is the
  // point at which a liability is recognized, not PO creation.
  const receivePurchase = db.transaction((purchaseId) => {
    const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchaseId);
    if (!purchase) throw new Error("Purchase order not found.");
    if (purchase.status === "Received") throw new Error("This purchase order was already received.");
    const items = db.prepare("SELECT * FROM purchase_items WHERE purchase_id = ?").all(purchaseId);
    const bump = db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?");
    items.forEach((it) => { if (it.product_id) bump.run(it.qty, it.product_id); });
    db.prepare("UPDATE purchases SET status = 'Received' WHERE id = ?").run(purchaseId);
    if (purchase.supplier_id) {
      db.prepare("UPDATE suppliers SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
        .run(purchase.total, purchase.supplier_id);
    }
  });

  // A purchase return reduces stock (goods physically leave) and reduces
  // what's owed to the supplier by the returned value.
  const createReturn = db.transaction((ret) => {
    const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(ret.purchase_id);
    if (!purchase) throw new Error("Purchase order not found.");
    const info = db
      .prepare("INSERT INTO purchase_returns (purchase_id, product_id, qty, cost, reason) VALUES (?, ?, ?, ?, ?)")
      .run(ret.purchase_id, ret.product_id, ret.qty, ret.cost, ret.reason || null);
    db.prepare("UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ?")
      .run(ret.qty, ret.product_id);
    if (purchase.supplier_id) {
      db.prepare("UPDATE suppliers SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?")
        .run(ret.qty * ret.cost, purchase.supplier_id);
    }
    return { id: info.lastInsertRowid };
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

  ipcMain.handle("purchases:getReturns", (event, purchaseId) =>
    db
      .prepare(
        `SELECT pr.*, p.name AS product_name FROM purchase_returns pr
         LEFT JOIN products p ON p.id = pr.product_id WHERE pr.purchase_id = ?`
      )
      .all(purchaseId)
  );

  ipcMain.handle("purchases:create", (event, purchase) => {
    try {
      requirePermission("purchases", "create");
      const result = createPurchase(purchase);
      logAudit("create_purchase", "purchases", { po_number: result.po_number, total: result.total });
      enqueueSync("purchases", result.id, "create", { ...purchase, ...result });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("purchases:receive", (event, purchaseId) => {
    try {
      requirePermission("purchases", "edit");
      receivePurchase(purchaseId);
      logAudit("receive_purchase", "purchases", { id: purchaseId });
      enqueueSync("purchases", purchaseId, "update", { id: purchaseId, status: "Received" });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("purchases:updateStatus", (event, { id, status }) => {
    try {
      requirePermission("purchases", "edit");
      db.prepare("UPDATE purchases SET status = ? WHERE id = ?").run(status, id);
      logAudit("update_purchase_status", "purchases", { id, status });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("purchases:createReturn", (event, ret) => {
    try {
      requirePermission("purchases", "edit");
      const result = createReturn(ret);
      logAudit("purchase_return", "purchases", { ...ret, ...result });
      enqueueSync("purchase_returns", result.id, "create", { ...ret, ...result });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerPurchaseHandlers };
