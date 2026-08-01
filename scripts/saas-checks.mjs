/**
 * Focused SaaS checks against mockApi (current AuthContext + createCompanyWorkspace surface).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const memory = new Map();
const storage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};

globalThis.window = {
  localStorage: storage,
  sessionStorage: storage,
  location: { origin: "http://localhost:5173" },
};
globalThis.localStorage = storage;
storage.clear();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const { mockApi } = await server.ssrLoadModule("/src/lib/mockApi.js");

  const plans = await mockApi.platformPublic.getPlans();
  assert(Array.isArray(plans) && plans.length >= 1, "public plans missing");
  assert(plans.every((plan) => plan.price_monthly !== undefined || plan.code), "public plans shape invalid");
  assert(plans.every((plan) => !("password_hash" in plan)), "public plans leaked secrets");

  const stamp = Date.now();
  const email = `owner_${stamp}@example.com`;
  const supabaseUserId = `mock-owner-${stamp}`;
  const signup = await mockApi.publicAuth.createCompanyWorkspace({
    company_name: `Acme Retail ${stamp}`,
    full_name: "Ada Owner",
    email,
    phone: "+254700000001",
    supabase_user_id: supabaseUserId,
    plan_code: "free_trial",
  });
  assert(signup.success, `createCompanyWorkspace failed: ${signup.error}`);
  assert(signup.company_code, "company code missing");
  assert(signup.company_id, "company id missing");

  const conflict = await mockApi.publicAuth.createCompanyWorkspace({
    company_name: `Acme Retail ${stamp}`,
    full_name: "Other Owner",
    email: `other_${stamp}@example.com`,
    phone: "+254700000002",
    supabase_user_id: `mock-owner-b-${stamp}`,
  });
  assert(!conflict.success, "duplicate company name should fail");

  const beforeCount = JSON.parse(storage.getItem("nexora_pos_web_db_v3")).companies.length;
  const badSignup = await mockApi.publicAuth.createCompanyWorkspace({
    company_name: "",
    full_name: "X",
    email: "bad",
    phone: "",
    supabase_user_id: "",
  });
  assert(!badSignup.success, "invalid signup should fail");
  assert(
    JSON.parse(storage.getItem("nexora_pos_web_db_v3")).companies.length === beforeCount,
    "partial write on failed signup"
  );

  const db = JSON.parse(storage.getItem("nexora_pos_web_db_v3"));
  const company = db.companies.find((row) => row.code === signup.company_code);
  const owner = db.users.find((row) => String(row.id) === String(supabaseUserId));
  const subscription = db.subscriptions.find((row) => Number(row.company_id) === Number(company.id));
  assert(company, "company row missing");
  assert(owner?.role === "owner", "public signup must create company owner");
  assert(owner.role !== "platform_owner", "public signup must never create platform_owner");
  assert(subscription?.status === "trialing", "trial subscription missing");

  // Deprecated AuthContext-only methods must not pretend local login still works.
  const deprecatedLogin = await mockApi.auth.loginByEmail(email, "SecurePass123!");
  assert(deprecatedLogin.success === false, "mock loginByEmail must stay deprecated");
  assert(
    deprecatedLogin.code === "DEPRECATED" || /AuthContext|Supabase/i.test(deprecatedLogin.error || ""),
    "loginByEmail should point to AuthContext"
  );

  // Platform console: platform_owner allowed, company owner denied.
  mockApi.__setAuthContext({
    id: "platform-1",
    role: "platform_owner",
    email: "platform.owner@nexora.demo",
    username: "SuperAdmin",
    company_id: null,
    active: 1,
  });
  const overview = await mockApi.owner.getOverview();
  assert(overview && overview.success !== false, "platform owner should access console");

  mockApi.__setAuthContext({
    id: supabaseUserId,
    role: "owner",
    email,
    username: owner.username,
    company_id: company.id,
    branch_id: signup.branch_id,
    company,
    active: 1,
  });
  const forbidden = await mockApi.owner.getOverview();
  assert(!forbidden?.success, "company owner must be denied platform APIs");

  // Tenant module connectivity for the new company owner session.
  const products = await mockApi.products.getAll();
  assert(Array.isArray(products), "products.getAll must return array");
  const customers = await mockApi.customers.getAll();
  assert(Array.isArray(customers), "customers.getAll must return array");
  const suppliers = await mockApi.suppliers.getAll();
  assert(Array.isArray(suppliers), "suppliers.getAll must return array");
  const purchases = await mockApi.purchases.getAll();
  assert(Array.isArray(purchases), "purchases.getAll must return array");
  const settings = await mockApi.settings.getAll();
  assert(settings && typeof settings === "object", "settings.getAll must return object");

  console.log("SaaS checks passed");
} finally {
  await server.close();
}
