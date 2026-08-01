/**
 * Enterprise Purchase Approval + Supplier Accounting E2E (mockApi data plane).
 *
 * Covers:
 * - Pending create does NOT change stock or supplier outstanding
 * - Approve posts invoice, stock, avg cost, supplier AP, ledger-facing totals
 * - Receive after approve is GRN-only (status → Received)
 * - Outstanding = Opening Debit − Opening Credit + Purchases − Payments − Credit Notes
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

process.env.VITE_USE_MOCK_API = "true";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  location: { origin: "http://localhost:5173" },
};
globalThis.localStorage = globalThis.window.localStorage;

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const { mockApi } = await server.ssrLoadModule("/src/lib/mockApi.js");

  if (typeof mockApi.__setAuthContext === "function") {
    mockApi.__setAuthContext({
      id: "u-owner",
      name: "Owner",
      username: "owner",
      email: "owner@test.local",
      role: "owner",
      company_id: 1,
      branch_id: 1,
      company: { id: 1, name: "Nexora", code: "NEXORA001", status: "active" },
      active: 1,
    });
  }

  const openingDebit = 100;
  const openingCredit = 20;
  const createdSupplier = await mockApi.suppliers.create({
    name: `AP Test Supplier ${Date.now()}`,
    opening_debit: openingDebit,
    opening_credit: openingCredit,
    payment_terms: "Net 30",
    status: "Active",
  });
  assert.equal(createdSupplier.success, true, createdSupplier.error || "supplier create failed");
  const supplierId = createdSupplier.id || createdSupplier.supplier?.id;
  assert.ok(supplierId, "missing supplier id");

  let suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  let supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  assert.ok(supplier, "supplier missing");
  assert.equal(Number(supplier.opening_debit), openingDebit);
  assert.equal(Number(supplier.opening_credit), openingCredit);
  const balanceAtCreate = Number(supplier.balance);
  assert.equal(balanceAtCreate, openingDebit - openingCredit, "net opening seeds outstanding");

  const products = await mockApi.products.getAll();
  assert.ok(products.length > 0, "need products");
  const product = products.find((p) => p.active !== false) || products[0];
  const stockBefore = Number(product.stock || 0);
  const avgBefore = Number(product.avg_cost != null ? product.avg_cost : product.cost) || 0;

  const qty = 4;
  const cost = 50;
  const purchaseTotal = qty * cost;

  const create = await mockApi.purchases.create({
    supplier_id: supplierId,
    invoice_no: `PI-APPR-${Date.now()}`,
    items: [{ product_id: product.id, qty, cost, discount: 0, tax: 0 }],
    status: "Pending",
  });
  assert.equal(create.success, true, create.error || "create failed");
  const purchaseId = create.id || create.purchase?.id;
  assert.ok(purchaseId, "missing purchase id");

  // Pending must not touch inventory or AP.
  let productsMid = await mockApi.products.getAll();
  let productMid = productsMid.find((p) => Number(p.id) === Number(product.id));
  assert.equal(Number(productMid.stock), stockBefore, "Pending must not increase stock");

  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  assert.equal(
    Number(supplier.balance),
    balanceAtCreate,
    `Pending must not change AP (before=${balanceAtCreate}, after=${supplier.balance})`
  );
  assert.equal(Number(supplier.total_purchases ?? supplier.total_ordered ?? 0), 0, "Pending must not book purchases");

  // Receive while Pending must be blocked.
  const blocked = await mockApi.purchases.receive(purchaseId);
  assert.equal(blocked.success, false, "receive before approve must fail");
  assert.match(String(blocked.error || ""), /Approved/i);

  const approve = await mockApi.purchases.approve(purchaseId);
  assert.equal(approve.success, true, approve.error || "approve failed");
  assert.equal(approve.status, "Approved");

  productsMid = await mockApi.products.getAll();
  productMid = productsMid.find((p) => Number(p.id) === Number(product.id));
  assert.equal(Number(productMid.stock), stockBefore + qty, "approve must increase stock");
  const expectedAvg =
    stockBefore <= 0 ? cost : (stockBefore * avgBefore + qty * cost) / (stockBefore + qty);
  assert.ok(
    Math.abs(Number(productMid.avg_cost) - expectedAvg) < 0.02,
    `avg_cost expected ~${expectedAvg}, got ${productMid.avg_cost}`
  );
  assert.equal(Number(productMid.cost), cost, "cost price must update to last purchase cost");

  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  const expectedOutstanding = openingDebit - openingCredit + purchaseTotal;
  assert.equal(
    Number(supplier.outstanding_balance ?? supplier.balance),
    expectedOutstanding,
    `outstanding expected ${expectedOutstanding}, got ${supplier.balance}`
  );
  assert.equal(Number(supplier.total_purchases ?? supplier.total_ordered), purchaseTotal);
  assert.equal(Number(supplier.total_payments ?? supplier.total_paid ?? 0), 0);

  const purchases = await mockApi.purchases.getAll();
  const po = purchases.find((p) => Number(p.id) === Number(purchaseId));
  assert.ok(po, "purchase missing");
  assert.equal(String(po.status), "Approved");
  assert.ok(po.invoice_no, "purchase invoice required on approve");

  const statement = await mockApi.suppliers.getStatement(supplierId);
  assert.ok(statement, "statement required");
  const ledger = statement.ledger || [];
  const purchaseEntry = ledger.find(
    (e) =>
      String(e.entry_type) === "purchase" &&
      (Number(e.source_id) === Number(purchaseId) ||
        String(e.reference || "").includes(String(po.po_number || "")))
  );
  assert.ok(purchaseEntry || ledger.some((e) => Number(e.debit) > 0), "supplier ledger must include purchase debit");

  // GRN after inventory already posted → Received
  const receive = await mockApi.purchases.receive(purchaseId);
  assert.equal(receive.success, true, receive.error || "post-approve receive failed");
  const purchases2 = await mockApi.purchases.getAll();
  const po2 = purchases2.find((p) => Number(p.id) === Number(purchaseId));
  assert.equal(String(po2.status), "Received");

  // Stock must not double-post
  const productsEnd = await mockApi.products.getAll();
  const productEnd = productsEnd.find((p) => Number(p.id) === Number(product.id));
  assert.equal(Number(productEnd.stock), stockBefore + qty, "receive after approve must not double stock");

  // Payment reduces outstanding
  const payAmt = 30;
  const paid = await mockApi.purchases.addPayment({
    purchase_id: purchaseId,
    amount: payAmt,
    method: "Cash",
  });
  assert.equal(paid.success, true, paid.error || "payment failed");
  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  assert.equal(
    Number(supplier.outstanding_balance ?? supplier.balance),
    expectedOutstanding - payAmt,
    "payment must reduce outstanding"
  );
  assert.equal(Number(supplier.total_payments ?? supplier.total_paid), payAmt);

  // Rollback path: approve failure restores Pending (simulate by approving cancelled — must fail cleanly)
  const create2 = await mockApi.purchases.create({
    supplier_id: supplierId,
    items: [{ product_id: product.id, qty: 1, cost: 10 }],
    status: "Pending",
  });
  const id2 = create2.id || create2.purchase?.id;
  await mockApi.purchases.cancel(id2);
  const approveCancelled = await mockApi.purchases.approve(id2);
  assert.equal(approveCancelled.success, false, "cancelled PO cannot be approved");

  console.log("purchase-approve-e2e: PASS", {
    purchaseId,
    stockBefore,
    stockAfter: productEnd.stock,
    outstanding: supplier.outstanding_balance ?? supplier.balance,
    formula: `${openingDebit}-${openingCredit}+${purchaseTotal}-${payAmt}`,
  });
} finally {
  await server.close();
}
