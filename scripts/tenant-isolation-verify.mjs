/**
 * Two-company tenant isolation verification.
 * Creates (or reuses) two tenants, seeds distinct products, asserts zero cross-leak
 * via /api/pos and direct PostgREST RLS.
 *
 * Usage:
 *   node scripts/tenant-isolation-verify.mjs
 *
 * Requires env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   APP_BASE_URL (default https://www.nexorapospro.com)
 *
 * Refuses production writes unless ALLOW_PROD_E2E_WRITES=I_UNDERSTAND_THIS_WRITES_REAL_DATA
 * (cleanup deletes only the ISO-TEST products / temp tenants it creates).
 */
import { assertNotProduction, assertNotProductionSupabase } from "./_prodSafety.mjs";

const BASE = String(process.env.APP_BASE_URL || "https://www.nexorapospro.com").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function signupTenant(label) {
  const stamp = Date.now();
  const email = `iso.${label}.${stamp}@gmail.com`.toLowerCase();
  const password = `IsoTest${stamp}!A`;
  const companyName = `ISO ${label.toUpperCase()} ${stamp}`;
  const { ok, status, body } = await jsonFetch(`${BASE}/api/bootstrap-company-owner`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({
      action: "public_signup",
      public_signup: true,
      company_name: companyName,
      full_name: `ISO Owner ${label}`,
      email,
      phone: "+254700000001",
      password,
      plan_code: "free_trial",
      country: "Kenya",
      country_code: "KE",
      currency: "KES",
      currency_code: "KES",
      currency_symbol: "KSh",
      locale: "en-KE",
    }),
  });
  if (!ok || !body?.success) {
    throw new Error(`signup ${label} failed (${status}): ${JSON.stringify(body)}`);
  }
  // Confirm email + activate company via service role
  await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${body.supabase_user_id}`, {
    method: "PUT",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email_confirm: true }),
  });
  await jsonFetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${body.company_id}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ status: "active" }),
  });
  const auth = await jsonFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!auth.ok || !auth.body?.access_token) {
    throw new Error(`login ${label} failed: ${JSON.stringify(auth.body)}`);
  }
  return {
    label,
    email,
    password,
    company_id: Number(body.company_id),
    user_id: body.supabase_user_id,
    token: auth.body.access_token,
    jwt_company_id: auth.body.user?.app_metadata?.company_id,
    jwt_role: auth.body.user?.app_metadata?.role,
  };
}

async function pos(token, action, params = {}) {
  return jsonFetch(`${BASE}/api/pos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: BASE,
    },
    body: JSON.stringify({ action, params }),
  });
}

async function seedProduct(companyId, name, sku) {
  const { ok, body } = await jsonFetch(`${SUPABASE_URL}/rest/v1/products`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      company_id: companyId,
      name,
      sku,
      price: 10,
      cost: 5,
      stock: 1,
      barcode: sku,
    }),
  });
  if (!ok) throw new Error(`seed product failed: ${JSON.stringify(body)}`);
  return Array.isArray(body) ? body[0] : body;
}

async function cleanup(tenants, productIds) {
  for (const id of productIds) {
    await jsonFetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  }
  for (const t of tenants) {
    await jsonFetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${t.company_id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${t.user_id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  }
}

async function main() {
  if (!SUPABASE_URL || !ANON || !SERVICE) {
    fail("Missing SUPABASE_URL / ANON / SERVICE_ROLE env");
    return;
  }
  assertNotProduction(BASE);
  assertNotProductionSupabase(SUPABASE_URL);

  const tenants = [];
  const productIds = [];
  try {
    const a = await signupTenant("a");
    const b = await signupTenant("b");
    tenants.push(a, b);

    console.log("Tenant A", { company_id: a.company_id, jwt_company_id: a.jwt_company_id, role: a.jwt_role });
    console.log("Tenant B", { company_id: b.company_id, jwt_company_id: b.jwt_company_id, role: b.jwt_role });

    if (String(a.jwt_company_id) !== String(a.company_id)) fail("A JWT company_id mismatch");
    if (String(b.jwt_company_id) !== String(b.company_id)) fail("B JWT company_id mismatch");
    if (a.jwt_role !== "owner" || b.jwt_role !== "owner") fail("signup must create company owner, not platform_owner");
    if (a.company_id === 1 || b.company_id === 1) fail("new signup must not be company_id=1 (Super Owner)");
    if (a.company_id === b.company_id) fail("two signups must create distinct companies");

    const pa = await seedProduct(a.company_id, `ISO-A-ONLY-${a.company_id}`, `ISOA-${a.company_id}`);
    const pb = await seedProduct(b.company_id, `ISO-B-ONLY-${b.company_id}`, `ISOB-${b.company_id}`);
    productIds.push(pa.id, pb.id);

    const listA = await pos(a.token, "products.getAll");
    const listB = await pos(b.token, "products.getAll");
    const rowsA = Array.isArray(listA.body) ? listA.body : [];
    const rowsB = Array.isArray(listB.body) ? listB.body : [];

    const aLeak = rowsA.filter((r) => Number(r.company_id) !== Number(a.company_id));
    const bLeak = rowsB.filter((r) => Number(r.company_id) !== Number(b.company_id));
    if (aLeak.length) fail(`A sees foreign products: ${JSON.stringify(aLeak)}`);
    if (bLeak.length) fail(`B sees foreign products: ${JSON.stringify(bLeak)}`);
    if (!rowsA.some((r) => r.id === pa.id)) fail("A missing own product");
    if (!rowsB.some((r) => r.id === pb.id)) fail("B missing own product");
    if (rowsA.some((r) => r.id === pb.id)) fail("A leaked B product");
    if (rowsB.some((r) => r.id === pa.id)) fail("B leaked A product");

    const denyA = await pos(a.token, "companies.getById", { id: b.company_id });
    const denyB = await pos(b.token, "companies.getById", { id: 1 });
    if (denyA.body?.code !== "FORBIDDEN") fail(`A should be FORBIDDEN on B company: ${JSON.stringify(denyA.body)}`);
    if (denyB.body?.code !== "FORBIDDEN") fail(`B should be FORBIDDEN on Super Owner company 1: ${JSON.stringify(denyB.body)}`);

    const settingsA = await pos(a.token, "settings.getAll");
    const storeName = String(settingsA.body?.store_name || "");
    if (/nexora pos enterprise/i.test(storeName)) fail(`A settings store_name is Super Owner: ${storeName}`);
    if (/nexora pos pro/i.test(storeName) && !/ISO A/i.test(storeName)) {
      fail(`A settings looks like product brand, not tenant: ${storeName}`);
    }

    const salesA = await pos(a.token, "sales.getRecent", { limit: 50 });
    const salesRows = Array.isArray(salesA.body) ? salesA.body : [];
    if (salesRows.some((s) => Number(s.company_id) === 1)) fail("A sees Super Owner sales");

    const rlsA = await jsonFetch(`${SUPABASE_URL}/rest/v1/products?select=id,name,company_id`, {
      headers: { apikey: ANON, Authorization: `Bearer ${a.token}` },
    });
    const rlsRows = Array.isArray(rlsA.body) ? rlsA.body : [];
    if (rlsRows.some((r) => Number(r.company_id) !== Number(a.company_id))) {
      fail(`RLS leak for A: ${JSON.stringify(rlsRows)}`);
    }

    const platform = await pos(a.token, "platform.getOverview");
    if (platform.body?.code !== "FORBIDDEN") fail("Company owner must not access platform overview");

    if (!process.exitCode) {
      console.log("PASS: zero cross-tenant leakage between two companies + Super Owner denied.");
    }
  } finally {
    await cleanup(tenants, productIds).catch((e) => console.warn("cleanup", e.message));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
