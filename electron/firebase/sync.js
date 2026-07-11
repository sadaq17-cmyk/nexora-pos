const { db } = require("../db/database");
const { isConfigured } = require("./auth");
const { createDocument } = require("./firestore");

async function syncPendingSales() {
  if (!isConfigured()) {
    return { success: false, reason: "not_configured" };
  }

  const pending = db
    .prepare(
      `SELECT s.*, GROUP_CONCAT(si.product_name || '×' || si.qty, ', ') AS item_summary
       FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
       WHERE s.synced = 0 GROUP BY s.id`
    )
    .all();

  if (pending.length === 0) return { success: true, synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const markSynced = db.prepare("UPDATE sales SET synced = 1 WHERE id = ?");

  for (const sale of pending) {
    try {
      await createDocument("sales", sale.invoice_no, {
        invoice_no: sale.invoice_no,
        total: sale.total,
        subtotal: sale.subtotal,
        discount: sale.discount,
        vat: sale.vat,
        payment_method: sale.payment_method,
        item_summary: sale.item_summary || "",
        created_at: sale.created_at,
        synced_at: new Date().toISOString(),
      });
      markSynced.run(sale.id);
      synced += 1;
    } catch (err) {
      failed += 1;
      // Leave synced = 0 so the next sync attempt retries this sale.
      console.warn(`[firebase-sync] failed to sync ${sale.invoice_no}:`, err.message);
    }
  }

  return { success: true, synced, failed };
}

function getPendingCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM sales WHERE synced = 0").get().n;
}

module.exports = { syncPendingSales, getPendingCount, isConfigured };
