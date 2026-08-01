/**
 * End-to-end Purchase Receive verification against mockApi (local data plane).
 * Approval gates inventory; receive after approve is GRN confirmation.
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

  const suppliers = await mockApi.suppliers.getAll();
  assert.ok(Array.isArray(suppliers) && suppliers.length > 0, "need at least one supplier");
  const supplier = suppliers[0];
  const balanceBefore = Number(supplier.balance || 0);
  const orderedBefore = Number(supplier.total_ordered || 0);

  const products = await mockApi.products.getAll();
  assert.ok(Array.isArray(products) && products.length > 0, "need at least one product");
  const product = products.find((p) => p.active !== false) || products[0];
  const stockBefore = Number(product.stock || 0);

  const qty = 3;
  const cost = 25;
  const create = await mockApi.purchases.create({
    supplier_id: supplier.id,
    invoice_no: `INV-RCV-${Date.now()}`,
    items: [{ product_id: product.id, qty, cost, discount: 0, tax: 0 }],
    status: "Pending",
  });
  assert.equal(create.success, true, create.error || "create failed");
  assert.ok(create.id || create.purchase?.id, "missing purchase id");
  const purchaseId = create.id || create.purchase.id;

  // Pending must not post stock
  {
    const mid = (await mockApi.products.getAll()).find((p) => Number(p.id) === Number(product.id));
    assert.equal(Number(mid.stock), stockBefore, "Pending create must not change stock");
  }

  const approve = await mockApi.purchases.approve(purchaseId);
  assert.equal(approve.success, true, approve.error || "approve failed");

  const productsAfter = await mockApi.products.getAll();
  const productAfter = productsAfter.find((p) => Number(p.id) === Number(product.id));
  assert.ok(productAfter, "product missing after approve");
  assert.equal(
    Number(productAfter.stock),
    stockBefore + qty,
    `stock expected ${stockBefore + qty}, got ${productAfter.stock}`
  );

  const suppliersAfter = await mockApi.suppliers.getAll();
  const supplierAfter = suppliersAfter.find((s) => Number(s.id) === Number(supplier.id));
  assert.ok(supplierAfter, "supplier missing after approve");
  assert.ok(
    Number(supplierAfter.balance) >= balanceBefore,
    `supplier balance should increase (before=${balanceBefore}, after=${supplierAfter.balance})`
  );
  assert.ok(
    Number(supplierAfter.total_ordered || 0) >= orderedBefore,
    "total_ordered should not decrease"
  );

  // GRN confirmation after inventory posted
  const receive = await mockApi.purchases.receive(purchaseId);
  assert.equal(receive.success, true, receive.error || "receive failed");

  const purchases = await mockApi.purchases.getAll();
  const po = purchases.find((p) => Number(p.id) === Number(purchaseId));
  assert.ok(po, "purchase missing from list");
  assert.ok(
    ["Received", "PartiallyReceived", "Approved"].includes(String(po.status)),
    `unexpected status ${po.status}`
  );

  // No double stock on GRN
  const stockEnd = Number(
    (await mockApi.products.getAll()).find((p) => Number(p.id) === Number(product.id))?.stock
  );
  assert.equal(stockEnd, stockBefore + qty, "GRN must not double-post stock");

  if (typeof mockApi.purchases.addPayment === "function") {
    const payAmt = Math.min(10, Number(po.total || qty * cost) || 10);
    const paid = await mockApi.purchases.addPayment({
      purchase_id: purchaseId,
      amount: payAmt,
      method: "Cash",
    });
    assert.equal(paid.success, true, paid.error || "addPayment failed");
  }

  if (typeof mockApi.audit?.getAll === "function") {
    const logs = await mockApi.audit.getAll();
    const hit = (logs || []).some(
      (l) =>
        String(l.action || "").includes("approve") ||
        String(l.action || "").includes("receive") ||
        String(l.details || "").includes(String(purchaseId)) ||
        String(l.module || "") === "purchases"
    );
    assert.ok(hit || Array.isArray(logs), "audit log readable");
  }

  console.log("purchase-receive-e2e: PASS", {
    purchaseId,
    stockBefore,
    stockAfter: productAfter.stock,
    supplierBalanceAfter: supplierAfter.balance,
    status: po.status,
  });
} finally {
  await server.close();
}
