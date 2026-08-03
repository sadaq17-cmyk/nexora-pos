/**
 * One-click Credit Sale automation checks (client helpers + payment validation).
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
globalThis.document = {
  createElementNS: () => ({
    querySelectorAll: () => [],
  }),
};

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const { normalizeAutoActions, AUTO_ACTION_DEFAULTS } = await server.ssrLoadModule("/src/lib/autoActions.js");
  const { validateSalePayment } = await server.ssrLoadModule("/src/lib/paymentMethods.js");
  const { mockApi } = await server.ssrLoadModule("/src/lib/mockApi.js");

  const defaults = normalizeAutoActions({});
  for (const [k, v] of Object.entries(AUTO_ACTION_DEFAULTS)) {
    assert.equal(defaults[k], v, `default ${k}`);
  }

  const creditOk = validateSalePayment({
    payment_method: "CREDIT",
    total: 500,
    customer_id: 1,
  });
  assert.equal(creditOk.success, true, creditOk.error);
  assert.equal(creditOk.credit_amount, 500);
  assert.equal(creditOk.cash_amount, 0);

  const creditMissingCustomer = validateSalePayment({
    payment_method: "CREDIT",
    total: 500,
  });
  assert.equal(creditMissingCustomer.success, false);

  if (typeof mockApi.__setAuthContext === "function") {
    mockApi.__setAuthContext({
      id: "u-owner",
      name: "Owner",
      role: "owner",
      company_id: 1,
      branch_id: 1,
      company: { id: 1, name: "Nexora" },
      active: 1,
    });
  }

  const created = await mockApi.customers.create({
    name: `Credit Auto ${Date.now()}`,
    credit_limit: 50000,
    payment_terms_days: 30,
  });
  assert.equal(created.success, true);
  const customerId = created.id;

  const inv = await mockApi.receivables.createInvoice({
    customer_id: customerId,
    payment_type: "credit",
    total: 750,
    notes: "Simulated POS credit automation",
  });
  assert.equal(inv.success, true, inv.error);
  assert.equal(Number(inv.invoice.balance), 750);
  assert.equal(Number(inv.invoice.amount_paid), 0);
  assert.ok(inv.invoice.due_date);

  const account = await mockApi.receivables.getAccount({ customer_id: customerId });
  assert.equal(Number(account.account.current_balance), 750);

  console.log("credit-sale-auto-e2e: PASS", {
    customerId,
    invoice: inv.invoice.invoice_no,
    due_date: inv.invoice.due_date,
    auto_defaults: defaults,
  });
} finally {
  await server.close();
}
