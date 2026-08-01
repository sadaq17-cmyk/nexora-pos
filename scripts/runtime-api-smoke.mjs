/**
 * Runtime smoke of mockApi business flows via Vite SSR loader.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = new Map();

globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  location: { origin: "http://localhost:5173" },
  URL: {
    createObjectURL: () => "blob:mock",
    revokeObjectURL: () => {},
  },
};
globalThis.document = {
  createElement: () => ({ click() {}, set href(_v) {}, set download(_v) {} }),
};
globalThis.localStorage = globalThis.window.localStorage;

const fails = [];
const warns = [];
function pass(n) { console.log(`  PASS  ${n}`); }
function fail(n, e) { fails.push(`${n}: ${e}`); console.log(`  FAIL  ${n} — ${e}`); }
function warn(n, e) { warns.push(`${n}: ${e}`); console.log(`  WARN  ${n} — ${e}`); }

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const mod = await server.ssrLoadModule("/src/lib/mockApi.js");
  const api = mod.mockApi;
  if (!api) throw new Error("mockApi export missing");

  if (api.__setAuthContext) {
    api.__setAuthContext({
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

  async function check(name, fn) {
    try {
      await fn();
      pass(name);
    } catch (err) {
      fail(name, err?.message || String(err));
    }
  }

  console.log("Runtime mockApi smoke\n");

  await check("products.getAll", async () => {
    const rows = await api.products.getAll();
    if (!Array.isArray(rows) || rows.length < 1) throw new Error("expected seeded products");
  });

  await check("categories.getAll", async () => {
    const rows = await api.categories.getAll();
    if (!Array.isArray(rows)) throw new Error("expected array");
  });

  await check("customers.getAll", async () => {
    const rows = await api.customers.getAll();
    if (!Array.isArray(rows)) throw new Error("expected array");
  });

  await check("sales.create (POS checkout)", async () => {
    const products = await api.products.getAll();
    const product = products.find((p) => Number(p.stock) > 0) || products[0];
    if (!product) throw new Error("no product");
    const result = await api.sales.create({
      items: [{ product_id: product.id, qty: 1, price: Number(product.price) || 1 }],
      discount: 0,
      payment_method: "CASH",
      customer_id: null,
      apply_vat: false,
    });
    if (result && result.success === false) throw new Error(result.error || "sale failed");
  });

  await check("sales.getHeld", async () => {
    const held = await api.sales.getHeld();
    if (!Array.isArray(held)) throw new Error("expected array");
  });

  await check("inventory surface", async () => {
    if (api.inventory?.getStock) {
      await api.inventory.getStock();
    } else if (api.inventory?.listMovements) {
      await api.inventory.listMovements();
    } else {
      const keys = Object.keys(api.inventory || {});
      if (!keys.length) throw new Error("empty inventory");
      await api.inventory[keys[0]]();
    }
  });

  await check("purchases list", async () => {
    const fn = api.purchases.getAll || api.purchases.list;
    if (!fn) throw new Error("missing purchases list");
    await fn.call(api.purchases);
  });

  await check("suppliers.getAll", async () => {
    const rows = await api.suppliers.getAll();
    if (!Array.isArray(rows)) throw new Error("expected array");
  });

  await check("expenses.getAll", async () => {
    const rows = await api.expenses.getAll();
    if (!Array.isArray(rows)) throw new Error("expected array");
  });

  await check("reports", async () => {
    const keys = Object.keys(api.reports || {});
    if (!keys.length) throw new Error("empty reports");
    await api.reports[keys[0]]();
  });

  await check("settings.getAll", async () => {
    const s = await api.settings.getAll();
    if (!s || typeof s !== "object") throw new Error("expected settings object");
  });

  await check("permissions.getMine", async () => {
    const p = await api.permissions.getMine();
    if (!p || typeof p !== "object") throw new Error("expected permissions");
  });

  await check("users status / auth.listUsers surface", async () => {
    if (typeof api.users.getStatus === "function") {
      const rows = await api.users.getStatus();
      if (!Array.isArray(rows)) throw new Error("expected user status array");
      return;
    }
    if (typeof api.auth?.listUsers === "function") {
      await api.auth.listUsers();
      return;
    }
    throw new Error("missing users status surface");
  });

  await check("owner namespace", async () => {
    const keys = Object.keys(api.owner || {});
    if (!keys.length) throw new Error("empty owner api");
    const preferred = ["getCompanies", "listCompanies", "getPlans", "getOverview"];
    const key = preferred.find((k) => typeof api.owner[k] === "function") || keys.find((k) => typeof api.owner[k] === "function");
    if (!key) throw new Error("no callable owner method");
    await api.owner[key]();
  });

  await check("company management lifecycle (platform_owner)", async () => {
    if (api.__setAuthContext) {
      api.__setAuthContext({
        id: "u-platform",
        name: "Platform",
        username: "superadmin",
        email: "platform@test.local",
        role: "platform_owner",
        company_id: null,
        active: 1,
      });
    }
    const overview = await api.owner.getOverview();
    if (!overview?.success || !Array.isArray(overview.companies)) {
      throw new Error("getOverview must return companies for Super Owner");
    }
    const company = overview.companies[0];
    if (!company?.id) throw new Error("expected at least one company");
    for (const method of ["markPaid", "extendTrial", "extendSubscription", "getCompanyHistory", "activateCompany", "suspendCompany"]) {
      if (typeof api.owner[method] !== "function") throw new Error(`missing owner.${method}`);
    }
    const history = await api.owner.getCompanyHistory(company.id);
    if (!history?.success || Number(history.company_id) !== Number(company.id)) {
      throw new Error("getCompanyHistory must be scoped to company_id");
    }
    // Restore tenant owner context for remaining checks
    if (api.__setAuthContext) {
      api.__setAuthContext({
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
  });

  await check("platformPublic.getPlans", async () => {
    const plans = await api.platformPublic.getPlans();
    if (!Array.isArray(plans)) throw new Error("expected plans array");
  });

  await check("platformPublic.contact validation", async () => {
    const bad = await api.platformPublic.contact({ name: "", email: "x", message: "hi" });
    if (bad.success) throw new Error("invalid contact should fail");
  });

  await check("barcode namespace", async () => {
    const keys = Object.keys(api.barcode || {});
    if (!keys.length) throw new Error("empty barcode");
  });

  await check("backup/sync namespaces", async () => {
    if (!api.backup || !api.sync) throw new Error("missing backup/sync");
  });

  console.log(`\nSummary: runtime ${fails.length ? "FAIL" : "PASS"} (${warns.length} warnings)`);
  if (fails.length) {
    for (const f of fails) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
} finally {
  await Promise.race([
    server.close(),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  // Vite SSR middleware can keep the event loop alive after close().
  process.exit(fails.length ? 1 : 0);
}
