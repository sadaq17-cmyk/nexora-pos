/**
 * Enterprise Supplier Management — full automated workflow E2E (mockApi).
 *
 * Purchase Request → PO → Approval (invoice + AP + stock)
 * → GRN → Partial Payment → Full Payment → Return (stock + AP)
 * → Aging / Payables / Insights / Statement / Audit
 *
 * Asserts balances update automatically — never via manual supplier.balance edits.
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

function moneyEq(actual, expected, msg) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) < 0.02, msg || `${actual} !== ${expected}`);
}

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

  const openingDebit = 50;
  const openingCredit = 0;
  const supplierRes = await mockApi.suppliers.create({
    name: `Enterprise SUP ${Date.now()}`,
    opening_debit: openingDebit,
    opening_credit: openingCredit,
    payment_terms: "Net 30",
    credit_limit: 10000,
    delivery_lead_days: 5,
    status: "Active",
  });
  assert.equal(supplierRes.success, true, supplierRes.error || "supplier create failed");
  const supplierId = supplierRes.id || supplierRes.supplier?.id;

  let suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  let supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  const balanceAtCreate = Number(supplier.balance);
  moneyEq(balanceAtCreate, openingDebit - openingCredit, "opening seeds outstanding");

  const products = await mockApi.products.getAll();
  const product = products.find((p) => p.active !== false) || products[0];
  assert.ok(product, "need a product");
  const stockBefore = Number(product.stock || 0);

  const qty = 5;
  const cost = 40;
  const purchaseTotal = qty * cost;

  // 1) Purchase Request
  const pr = await mockApi.purchaseRequests.create({
    supplier_id: supplierId,
    submit: true,
    notes: "Auto PR for enterprise E2E",
    items: [{ product_id: product.id, qty, estimated_cost: cost, description: product.name }],
  });
  assert.equal(pr.success, true, pr.error || "PR create failed");
  assert.equal(pr.request?.status, "Submitted");
  const requestId = pr.request?.id;
  assert.ok(requestId, "missing request id");

  // PR must not touch stock or AP
  let productsMid = await mockApi.products.getAll();
  moneyEq(productsMid.find((p) => Number(p.id) === Number(product.id)).stock, stockBefore, "PR must not change stock");
  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  moneyEq(supplier.balance, balanceAtCreate, "PR must not change AP");

  // 2) Convert → Purchase Order (Pending)
  const converted = await mockApi.purchaseRequests.convert({ id: requestId });
  assert.equal(converted.success, true, converted.error || "convert failed");
  const purchaseId = converted.purchase_id;
  assert.ok(purchaseId, "missing purchase id");

  productsMid = await mockApi.products.getAll();
  moneyEq(productsMid.find((p) => Number(p.id) === Number(product.id)).stock, stockBefore, "Pending PO must not change stock");
  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  moneyEq(supplier.balance, balanceAtCreate, "Pending PO must not change AP");

  // 3) Approve → Supplier Invoice + AP + Inventory
  const approve = await mockApi.purchases.approve(purchaseId);
  assert.equal(approve.success, true, approve.error || "approve failed");
  assert.equal(approve.status, "Approved");

  productsMid = await mockApi.products.getAll();
  const productAfterApprove = productsMid.find((p) => Number(p.id) === Number(product.id));
  moneyEq(productAfterApprove.stock, stockBefore + qty, "approve must increase stock");

  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  const expectedOutstanding = balanceAtCreate + purchaseTotal;
  moneyEq(supplier.outstanding_balance ?? supplier.balance, expectedOutstanding, "approve must post AP automatically");

  let purchases = await mockApi.purchases.getAll();
  let po = purchases.find((p) => Number(p.id) === Number(purchaseId));
  assert.ok(po.invoice_no, "supplier invoice auto-posted on approve");
  moneyEq(po.balance, purchaseTotal, "invoice balance = total");
  moneyEq(po.amount_paid, 0, "unpaid after approve");

  // 4) GRN (receive after approve) — status only, no double stock
  const receive = await mockApi.purchases.receive(purchaseId);
  assert.equal(receive.success, true, receive.error || "GRN failed");
  purchases = await mockApi.purchases.getAll();
  po = purchases.find((p) => Number(p.id) === Number(purchaseId));
  assert.equal(String(po.status), "Received");
  const productsAfterGrn = await mockApi.products.getAll();
  moneyEq(
    productsAfterGrn.find((p) => Number(p.id) === Number(product.id)).stock,
    stockBefore + qty,
    "GRN must not double-post stock"
  );

  // 5) Partial payment
  const payPartial = 60;
  const paid1 = await mockApi.purchases.addPayment({
    purchase_id: purchaseId,
    amount: payPartial,
    method: "Bank Transfer",
  });
  assert.equal(paid1.success, true, paid1.error || "partial payment failed");
  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  moneyEq(supplier.balance, expectedOutstanding - payPartial, "partial payment reduces AP");

  purchases = await mockApi.purchases.getAll();
  po = purchases.find((p) => Number(p.id) === Number(purchaseId));
  moneyEq(po.amount_paid, payPartial);
  moneyEq(po.balance, purchaseTotal - payPartial);

  const payables = await mockApi.suppliers.getPayables();
  assert.equal(payables.success, true);
  const payableRow = (payables.invoices || []).find((i) => Number(i.id) === Number(purchaseId));
  assert.ok(payableRow, "open payable listed");
  assert.equal(payableRow.payment_status, "partially_paid");

  // 6) Full remaining payment
  const remaining = purchaseTotal - payPartial;
  const paid2 = await mockApi.purchases.addPayment({
    purchase_id: purchaseId,
    amount: remaining,
    method: "Cash",
  });
  assert.equal(paid2.success, true, paid2.error || "final payment failed");
  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  moneyEq(supplier.balance, balanceAtCreate, "full payment clears purchase AP (opening remains)");

  purchases = await mockApi.purchases.getAll();
  po = purchases.find((p) => Number(p.id) === Number(purchaseId));
  moneyEq(po.balance, 0, "PO fully paid");

  // 7) Second PO for return + aging coverage (overdue due date)
  const qty2 = 2;
  const cost2 = 25;
  const total2 = qty2 * cost2;
  const pastDue = new Date();
  pastDue.setUTCDate(pastDue.getUTCDate() - 10);
  const create2 = await mockApi.purchases.create({
    supplier_id: supplierId,
    items: [{ product_id: product.id, qty: qty2, cost: cost2 }],
    status: "Pending",
    due_date: pastDue.toISOString().slice(0, 10),
    invoice_no: `PI-OV-${Date.now()}`,
  });
  const purchaseId2 = create2.id || create2.purchase?.id;
  const approve2 = await mockApi.purchases.approve(purchaseId2);
  assert.equal(approve2.success, true, approve2.error || "approve2 failed");
  await mockApi.purchases.receive(purchaseId2);

  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  moneyEq(supplier.balance, balanceAtCreate + total2, "second approve posts AP");

  const aging = await mockApi.suppliers.getAging();
  assert.equal(aging.success, true);
  assert.ok(aging.overdue_amount >= total2 - 0.01, "aging includes overdue AP");
  const aged = (aging.invoices || []).find((i) => Number(i.id) === Number(purchaseId2));
  assert.ok(aged, "overdue invoice in aging");
  assert.equal(aged.payment_status, "overdue");
  assert.ok(Number(aged.days_overdue) >= 1);

  // 8) Purchase return reduces stock + AP automatically
  const stockBeforeReturn = Number(
    (await mockApi.products.getAll()).find((p) => Number(p.id) === Number(product.id)).stock
  );
  const retQty = 1;
  const ret = await mockApi.purchases.createReturn({
    purchase_id: purchaseId2,
    product_id: product.id,
    qty: retQty,
    cost: cost2,
  });
  assert.equal(ret.success, true, ret.error || "return failed");
  const stockAfterReturn = Number(
    (await mockApi.products.getAll()).find((p) => Number(p.id) === Number(product.id)).stock
  );
  moneyEq(stockAfterReturn, stockBeforeReturn - retQty, "return reduces stock");
  suppliers = await mockApi.suppliers.getAll({ include_archived: true });
  supplier = suppliers.find((s) => Number(s.id) === Number(supplierId));
  moneyEq(supplier.balance, balanceAtCreate + total2 - retQty * cost2, "return credits AP automatically");

  // 9) Statement + insights + dashboard + email
  const statement = await mockApi.suppliers.getStatement(supplierId);
  assert.ok(statement?.summary || statement?.ledger, "statement required");
  assert.ok(Array.isArray(statement.ledger) && statement.ledger.length > 0, "ledger entries required");

  const insights = await mockApi.suppliers.getInsights();
  assert.equal(insights.success, true);
  assert.ok(Array.isArray(insights.most_reliable));

  const dash = await mockApi.suppliers.getEnterpriseDashboard();
  assert.ok(dash.total_suppliers >= 1);
  assert.ok(Number(dash.outstanding_payables) >= 0);

  const emailed = await mockApi.suppliers.emailStatement({ supplier_id: supplierId });
  assert.equal(emailed.success, true, emailed.error || "email statement failed");

  const extended = await mockApi.dashboard.getExtendedStats();
  assert.ok(extended.overdue_payables != null, "dashboard overdue_payables");

  // 10) Audit trail
  const audit = await mockApi.audit.getAll?.({ module: "purchases" }).catch?.(() => null)
    ?? (await mockApi.purchases.getAudit?.())
    ?? [];
  const auditRows = Array.isArray(audit) ? audit : audit?.entries || [];
  const actions = new Set(auditRows.map((a) => a.action));
  assert.ok(
    [...actions].some((a) => /purchase_request_create|approve_purchase|purchase_return/i.test(String(a)))
      || auditRows.length > 0,
    "audit must record workflow events"
  );

  // Guard: never require manual balance write — recompute from ledger inputs
  const recomputed = balanceAtCreate + purchaseTotal - payPartial - remaining + total2 - retQty * cost2;
  moneyEq(supplier.balance, recomputed, "closing balance matches automatic ledger math");

  console.log("enterprise-supplier-e2e: PASS", {
    supplierId,
    requestId,
    purchaseId,
    purchaseId2,
    outstanding: supplier.balance,
    overdue: aging.overdue_amount,
  });
} finally {
  await server.close();
}
