/**
 * Customer Credit Invoice / AR workflow E2E (mockApi data plane).
 *
 * Flow: Create Credit Invoice → Partial Payment → Final Payment → Statement → Aging Report
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
    setTimeout: undefined,
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

  const created = await mockApi.customers.create({
    name: `AR Debtor ${Date.now()}`,
    phone: "0700000099",
    email: "ar.debtor@test.local",
    credit_limit: 10000,
    payment_terms_days: 30,
    opening_balance: 0,
  });
  assert.equal(created.success, true, created.error || "customer create failed");
  const customerId = created.id;
  assert.ok(customerId, "missing customer id");

  // 1) Create credit invoice
  const invoiceTotal = 1000;
  const inv = await mockApi.receivables.createInvoice({
    customer_id: customerId,
    payment_type: "credit",
    total: invoiceTotal,
    notes: "AR e2e credit invoice",
  });
  assert.equal(inv.success, true, inv.error || "createInvoice failed");
  assert.ok(inv.invoice?.invoice_no, "missing invoice_no");
  assert.equal(Number(inv.invoice.balance), invoiceTotal);
  assert.equal(Number(inv.invoice.amount_paid), 0);
  assert.ok(["unpaid", "overdue"].includes(inv.invoice.status), `unexpected status ${inv.invoice.status}`);
  const invoiceId = inv.invoice.id;

  let account = await mockApi.receivables.getAccount({ customer_id: customerId });
  assert.equal(account.success, true);
  assert.equal(Number(account.account.current_balance), invoiceTotal);
  assert.equal(Number(account.account.available_credit), 10000 - invoiceTotal);

  // 2) Partial payment
  const partial = 400;
  const pay1 = await mockApi.receivables.receivePayment({
    customer_id: customerId,
    invoice_id: invoiceId,
    amount: partial,
    method: "Cash",
  });
  assert.equal(pay1.success, true, pay1.error || "partial payment failed");
  assert.ok(pay1.receipt_no, "missing receipt_no");

  let outstanding = await mockApi.receivables.getOutstanding({ customer_id: customerId });
  assert.equal(outstanding.success, true);
  const mid = outstanding.invoices.find((i) => Number(i.id) === Number(invoiceId));
  assert.ok(mid, "invoice missing after partial");
  assert.equal(Number(mid.balance), invoiceTotal - partial);
  assert.ok(["partially_paid", "overdue"].includes(mid.status), `expected partially_paid, got ${mid.status}`);

  // 3) Final payment
  const finalAmt = invoiceTotal - partial;
  const pay2 = await mockApi.receivables.receivePayment({
    customer_id: customerId,
    invoice_id: invoiceId,
    amount: finalAmt,
    method: "M-Pesa",
  });
  assert.equal(pay2.success, true, pay2.error || "final payment failed");

  outstanding = await mockApi.receivables.getOutstanding({ customer_id: customerId, open_only: false });
  const done = outstanding.invoices.find((i) => Number(i.id) === Number(invoiceId));
  assert.ok(done);
  assert.equal(Number(done.balance), 0);
  assert.equal(done.status, "paid");

  account = await mockApi.receivables.getAccount({ customer_id: customerId });
  assert.equal(Number(account.account.current_balance), 0);

  // 4) Customer statement
  const statement = await mockApi.receivables.getStatement({ id: customerId });
  assert.equal(statement.success, true, statement.error || "statement failed");
  assert.ok(Array.isArray(statement.ledger));
  assert.ok(statement.ledger.some((e) => e.entry_type === "invoice"));
  assert.ok(statement.ledger.filter((e) => e.entry_type === "payment").length >= 2);
  assert.equal(Number(statement.summary.total_invoices), invoiceTotal);
  assert.equal(Number(statement.summary.total_payments), invoiceTotal);
  assert.equal(Number(statement.summary.outstanding_balance), 0);
  assert.ok(Math.abs(Number(statement.summary.closing_balance)) < 0.02);

  // 5) Aging report (create a second open overdue invoice for buckets)
  const pastDue = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const overdueInv = await mockApi.receivables.createInvoice({
    customer_id: customerId,
    payment_type: "credit",
    total: 250,
    due_date: pastDue,
    notes: "Overdue aging sample",
  });
  assert.equal(overdueInv.success, true, overdueInv.error || "overdue invoice failed");

  const aging = await mockApi.receivables.getAging();
  assert.equal(aging.success, true);
  assert.ok(Number(aging.total_receivable) >= 250);
  assert.ok(Number(aging.overdue_amount) >= 250);
  assert.ok(Number(aging.buckets.days_31_60) >= 250 || Number(aging.buckets.days_1_30) >= 250
    || Number(aging.buckets.days_61_90) >= 250 || Number(aging.buckets.days_90_plus) >= 250,
    "overdue amount missing from aging buckets");
  assert.ok(aging.customers_with_balance >= 1);
  assert.ok(Array.isArray(aging.top_debtors) && aging.top_debtors.length >= 1);

  const dash = await mockApi.receivables.getDashboard();
  assert.equal(dash.success, true);
  assert.ok(Number(dash.total_accounts_receivable) >= 250);
  assert.ok(Number(dash.customers_with_outstanding) >= 1);

  // Mixed payment invoice
  const mixed = await mockApi.receivables.createInvoice({
    customer_id: customerId,
    payment_type: "mixed",
    total: 300,
    cash_amount: 100,
    credit_amount: 200,
  });
  assert.equal(mixed.success, true, mixed.error || "mixed invoice failed");
  assert.equal(Number(mixed.invoice.cash_amount), 100);
  assert.equal(Number(mixed.invoice.credit_amount), 200);
  assert.equal(Number(mixed.invoice.balance), 200);

  // Credit limit block
  await mockApi.receivables.updatePolicy({ block_sales_over_credit_limit: true, warn_credit_limit: true });
  const limitCheck = await mockApi.receivables.checkCreditLimit({
    customer_id: customerId,
    credit_amount: 999999,
  });
  assert.equal(limitCheck.success, true);
  assert.equal(limitCheck.exceeded, true);
  assert.equal(limitCheck.block, true);

  console.log("customer-receivables-e2e: PASS", {
    customerId,
    invoice: inv.invoice.invoice_no,
    receipts: [pay1.receipt_no, pay2.receipt_no],
    aging_total: aging.total_receivable,
    mixed_invoice: mixed.invoice.invoice_no,
  });
} finally {
  await server.close();
}
