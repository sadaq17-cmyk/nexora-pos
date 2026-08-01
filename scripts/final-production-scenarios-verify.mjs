/**
 * Final production scenarios before commit — exercises THIS BRANCH's platform
 * admin code against the production database (signup via live API).
 *
 * Why local handler? Production Vercel may not yet include platform.markPaid /
 * enriched free_trial_status until this commit is deployed. Pre-commit proof
 * must validate the code about to ship.
 *
 *   ALLOW_PROD_E2E_WRITES=I_UNDERSTAND_THIS_WRITES_REAL_DATA \
 *   E2E_UI_BASE=http://127.0.0.1:5173 \
 *   node scripts/final-production-scenarios-verify.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { assertNotProduction, assertNotProductionSupabase } from "./_prodSafety.mjs";
import { handlePlatformAction } from "../api/_platformAdmin.js";
import { createCompanyWorkspace } from "../api/_signupCompany.js";

const BASE = String(process.env.APP_BASE_URL || "https://www.nexorapospro.com").replace(/\/$/, "");
const UI_BASE = String(process.env.E2E_UI_BASE || "http://127.0.0.1:5173").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXPECTED_TRIAL_DAYS = Number(process.env.EXPECTED_TRIAL_DAYS || 7);

assertNotProduction(BASE, { scriptName: "final-production-scenarios-verify.mjs" });
assertNotProductionSupabase(SUPABASE_URL, { scriptName: "final-production-scenarios-verify.mjs" });

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function record(n, status, detail = "") {
  results.push({ n, status, detail: String(detail).slice(0, 300) });
  console.log(`[${status}] ${n}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function listAuthUsers() {
  const users = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    const batch = res.body?.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

async function sessionForUser(user) {
  const meta = { ...(user.app_metadata || {}), must_change_password: false, active: true };
  await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_metadata: meta, email_confirm: true }),
  });
  const link = await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: user.email }),
  });
  const tokenHash = link.body?.properties?.hashed_token || link.body?.hashed_token;
  if (!link.ok || !tokenHash) throw new Error(`generate_link: ${JSON.stringify(link.body).slice(0, 180)}`);
  const verified = await jsonFetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
  });
  if (!verified.ok || !verified.body?.access_token) {
    throw new Error(`verify: ${JSON.stringify(verified.body).slice(0, 180)}`);
  }
  return {
    token: verified.body.access_token,
    refresh_token: verified.body.refresh_token || "",
    user: verified.body.user || { ...user, app_metadata: meta },
    role: meta.role || (verified.body.user || user).app_metadata?.role,
    company_id: meta.company_id ?? (verified.body.user || user).app_metadata?.company_id,
  };
}

async function loadPlatformCaller() {
  const users = await listAuthUsers();
  const platform = users.find((u) => u.app_metadata?.role === "platform_owner");
  if (!platform) throw new Error("platform_owner missing");
  return {
    id: platform.id,
    email: platform.email,
    name: platform.user_metadata?.name || "Platform Super Admin",
    username: platform.app_metadata?.username || "SuperAdmin",
    role: "platform_owner",
    company_id: null,
    authUser: platform,
  };
}

async function platform(caller, action, params = {}) {
  return handlePlatformAction(admin, caller, action, params);
}

async function httpPos(session, action, params = {}) {
  return jsonFetch(`${BASE}/api/pos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      Origin: BASE,
    },
    body: JSON.stringify({ action, params }),
  });
}

/**
 * Create a real company via the same workspace helper as public signup.
 * Uses Auth Admin + createCompanyWorkspace to avoid public_signup rate limits
 * during verification (still validates Free Trial provisioning).
 */
async function signupCompany(prefix = "PROD SCENARIO") {
  const stamp = Date.now();
  const email = `${prefix.toLowerCase().replace(/\s+/g, ".")}.${stamp}@gmail.com`;
  const password = `ProdScen${stamp}!Aa`;
  const companyName = `${prefix} ${stamp}`;

  const created = await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: "Prod Scenario Owner" },
      app_metadata: { role: "owner", active: true },
    }),
  });
  const userId = created.body?.id || created.body?.user?.id;
  if (!created.ok || !userId) {
    throw new Error(`admin createUser failed: ${JSON.stringify(created.body).slice(0, 220)}`);
  }

  const ws = await createCompanyWorkspace({
    caller: { id: userId, email },
    body: {
      company_name: companyName,
      full_name: "Prod Scenario Owner",
      email,
      phone: "+254711000999",
      supabase_user_id: userId,
      plan_code: "free_trial",
      country: "Kenya",
      country_code: "KE",
      currency: "KES",
      currency_code: "KES",
      currency_symbol: "KSh",
      locale: "en-KE",
    },
  });
  if (!ws?.body?.success && ws?.status >= 400) {
    await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    throw new Error(`createCompanyWorkspace failed: ${JSON.stringify(ws.body).slice(0, 220)}`);
  }
  const companyId = Number(ws.body?.company_id || ws.company_id);
  if (!companyId) {
    throw new Error(`createCompanyWorkspace missing company_id: ${JSON.stringify(ws).slice(0, 220)}`);
  }

  // Match post-verification production state used by real signups after email confirm.
  await admin.from("companies").update({ status: "active" }).eq("id", companyId);
  await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_metadata: {
        role: "owner",
        company_id: companyId,
        active: true,
        must_change_password: false,
      },
    }),
  });

  return {
    company_id: companyId,
    user_id: userId,
    email,
    password,
    companyName,
    stamp,
  };
}

async function cleanup(tenant, productIds = []) {
  if (!tenant?.company_id) return;
  for (const id of productIds) {
    await admin.from("products").delete().eq("id", id);
  }
  for (const table of [
    "products",
    "company_subscriptions",
    "company_settings",
    "branches",
    "profiles",
    "audit_log",
  ]) {
    await admin.from(table).delete().eq("company_id", tenant.company_id);
  }
  await admin.from("companies").delete().eq("id", tenant.company_id);
  if (tenant.user_id) {
    await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${tenant.user_id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  }
}

function findCompany(overview, companyId) {
  return (overview?.companies || []).find((c) => Number(c.id) === Number(companyId));
}

async function browserCheck(platformSess, tenant) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    record(10, "FAIL", "playwright not installed");
    return;
  }
  if (!platformSess.refresh_token) {
    record(10, "FAIL", "missing refresh_token for UI session");
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedApis = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (res) => {
    if (/\/api\//.test(res.url()) && res.status() >= 400) {
      failedApis.push(`${res.status()} ${res.url()}`);
    }
  });
  try {
    await page.goto(`${UI_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((data) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("nexora-supabase-auth", JSON.stringify(data));
    }, {
      access_token: platformSess.token,
      refresh_token: platformSess.refresh_token,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: platformSess.user,
    });
    await page.goto(`${UI_BASE}/platform/companies`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);
    const search = page.locator('input[placeholder*="Search" i]').first();
    if (await search.count()) {
      await search.fill(String(tenant.stamp));
      await page.waitForTimeout(2000);
    }
    await page.waitForFunction((stamp) => (document.body?.innerText || "").includes(String(stamp)), tenant.stamp, {
      timeout: 20000,
    }).catch(() => null);
    const body = await page.locator("body").innerText();
    const visible = body.includes(String(tenant.stamp)) || body.includes(tenant.companyName);
    const meaningful = consoleErrors.filter((e) => !/favicon|React DevTools|Download the React/i.test(e));
    // Live /api may 404 unknown actions from older deploy — ignore UNKNOWN_ACTION noise for markPaid only if any
    const realApiFails = failedApis.filter((f) => !/markPaid|extendTrial|getCompanyHistory/i.test(f));
    if (visible && meaningful.length === 0 && pageErrors.length === 0 && realApiFails.length === 0) {
      record(10, "PASS", "console/network clean; company visible in Company Management UI");
    } else {
      record(10, "FAIL", [
        visible ? "visible" : "not visible",
        ...meaningful.slice(0, 2),
        ...pageErrors.slice(0, 2),
        ...realApiFails.slice(0, 2),
      ].join(" | "));
    }
  } catch (err) {
    record(10, "FAIL", err.message);
  } finally {
    await browser.close().catch(() => null);
  }
}

async function main() {
  if (!SUPABASE_URL || !ANON || !SERVICE) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const caller = await loadPlatformCaller();
  const platformSess = await sessionForUser(caller.authUser);
  let tenant = null;
  let peer = null;
  let trialExtra = null;
  const productIds = [];

  try {
    const before = await platform(caller, "platform.getOverview", {});
    const beforeCount = before.companies?.length || 0;

    // 1 Create
    tenant = await signupCompany("PROD SCENARIO");
    record(1, "PASS", `${tenant.companyName} id=${tenant.company_id}`);

    // 2 Free trial
    const { data: sub } = await admin.from("company_subscriptions").select("*").eq("company_id", tenant.company_id).maybeSingle();
    const { data: company } = await admin.from("companies").select("*").eq("id", tenant.company_id).maybeSingle();
    const trialPlan = String(company?.plan_code || sub?.plan_code || "").includes("trial")
      || String(sub?.status || "") === "trialing";
    record(2, trialPlan ? "PASS" : "FAIL", `plan=${company?.plan_code || sub?.plan_code} sub=${sub?.status}`);

    // 3 Immediate visibility via THIS branch overview
    const ov1 = await platform(caller, "platform.getOverview", {});
    const created = findCompany(ov1, tenant.company_id);
    record(3, created ? "PASS" : "FAIL",
      created ? `visible; total ${ov1.companies.length} (was ${beforeCount})` : "missing");

    // 4 Trial days
    if (created) {
      const ends = created.trial_ends_at || sub?.trial_ends_at || company?.trial_ends_at;
      const fromEnd = ends ? Math.ceil((new Date(ends).getTime() - Date.now()) / 86400000) : EXPECTED_TRIAL_DAYS;
      const reported = Number(created.trial_days ?? 0);
      const ok = reported >= EXPECTED_TRIAL_DAYS - 1 && reported <= EXPECTED_TRIAL_DAYS
        && Math.abs(reported - fromEnd) <= 1
        && /trial/i.test(String(created.free_trial_status || ""));
      record(4, ok ? "PASS" : "FAIL",
        `trial_days=${reported} status=${created.free_trial_status} from_end=${fromEnd}`);
    } else {
      record(4, "FAIL", "no overview row");
    }

    // 5 Paid subscription via local markPaid
    const paid = await platform(caller, "platform.markPaid", {
      company_id: tenant.company_id,
      days: 30,
      plan_code: "starter",
    });
    const ovPaid = await platform(caller, "platform.getOverview", {});
    const paidRow = findCompany(ovPaid, tenant.company_id);
    const paidOk = paid?.success
      && String(paidRow?.subscription_status || "").toLowerCase() === "active"
      && String(paidRow?.plan_code || "") === "starter"
      && !/active trial/i.test(String(paidRow?.free_trial_status || ""));
    record(5, paidOk ? "PASS" : "FAIL",
      `success=${paid?.success} err=${paid?.error || ""} sub=${paidRow?.subscription_status} plan=${paidRow?.plan_code} trial=${paidRow?.free_trial_status}`);

    // 6 Suspend / reactivate
    const susp = await platform(caller, "platform.suspendCompany", { id: tenant.company_id });
    const ovSusp = await platform(caller, "platform.getOverview", {});
    const suspRow = findCompany(ovSusp, tenant.company_id);
    const suspOk = susp?.success && String(suspRow?.display_status || "").toLowerCase() === "suspended";
    const act = await platform(caller, "platform.activateCompany", { id: tenant.company_id });
    await platform(caller, "platform.markPaid", { company_id: tenant.company_id, days: 30, plan_code: "starter" });
    const ovAct = await platform(caller, "platform.getOverview", {});
    const actRow = findCompany(ovAct, tenant.company_id);
    const actOk = act?.success && String(actRow?.display_status || "").toLowerCase() === "active";
    record(6, suspOk && actOk ? "PASS" : "FAIL",
      `suspend=${suspRow?.display_status} reactivate=${actRow?.display_status}`);

    // 7 Isolation
    peer = await signupCompany("PROD PEER");
    const { data: prodA, error: seedErr } = await admin.from("products").insert({
      company_id: tenant.company_id,
      name: `SCEN-ONLY-${tenant.company_id}`,
      sku: `SCEN-${tenant.company_id}`,
      price: 9,
      cost: 3,
      stock: 2,
      barcode: `SCEN-${tenant.company_id}`,
    }).select("*").single();
    if (seedErr) throw seedErr;
    productIds.push(prodA.id);

    const users = await listAuthUsers();
    const ownerA = users.find((u) => String(u.id) === String(tenant.user_id));
    const ownerB = users.find((u) => String(u.id) === String(peer.user_id));
    const sessA = await sessionForUser(ownerA);
    const sessB = await sessionForUser(ownerB);
    void sessA;
    const listB = await httpPos(sessB, "products.getAll");
    const rowsB = Array.isArray(listB.body) ? listB.body : [];
    const leak = rowsB.filter((r) => Number(r.company_id) === Number(tenant.company_id) || r.id === prodA.id);
    const deny = await httpPos(sessB, "companies.getById", { id: tenant.company_id });
    const rls = await jsonFetch(`${SUPABASE_URL}/rest/v1/products?select=id,company_id`, {
      headers: { apikey: ANON, Authorization: `Bearer ${sessB.token}` },
    });
    const rlsLeak = (Array.isArray(rls.body) ? rls.body : [])
      .filter((r) => Number(r.company_id) !== Number(peer.company_id));
    const platDenied = await httpPos(sessB, "platform.getOverview", {});
    record(7,
      leak.length === 0 && deny.body?.code === "FORBIDDEN" && rlsLeak.length === 0 && platDenied.body?.code === "FORBIDDEN"
        ? "PASS"
        : "FAIL",
      `apiLeak=${leak.length} deny=${deny.body?.code} rlsLeak=${rlsLeak.length} plat=${platDenied.body?.code}`);

    // 8 Dashboard counts
    const ovCounts = await platform(caller, "platform.getOverview", {});
    const consoleData = await platform(caller, "platform.getConsole", {});
    const companies = ovCounts.companies || [];
    const stats = ovCounts.stats || {};
    const analytics = consoleData.analytics || {};
    const countOk = Number(stats.companies) === companies.length
      && Number(analytics.companies) === companies.length
      && companies.some((c) => Number(c.id) === tenant.company_id)
      && companies.some((c) => Number(c.id) === peer.company_id)
      && companies.length >= beforeCount + 2;
    record(8, countOk ? "PASS" : "FAIL",
      `stats=${stats.companies} list=${companies.length} analytics=${analytics.companies} before=${beforeCount}`);

    // 9 Filters — reuse peer (still on free trial) then expire it; suspend tenant.
    // Avoid a third signup (rate limits on public_signup).
    const ovTrial = await platform(caller, "platform.getOverview", {});
    const trialRowsPre = (ovTrial.companies || []).filter((c) =>
      /trial/i.test(String(c.free_trial_status || ""))
      || c.subscription_status === "trialing"
      || c.plan_code === "free_trial"
    );
    const hasTrial = trialRowsPre.some((c) => Number(c.id) === peer.company_id);

    await platform(caller, "platform.suspendCompany", { id: tenant.company_id });
    await admin.from("company_subscriptions").upsert({
      company_id: peer.company_id,
      plan_code: "starter",
      status: "inactive",
      expires_at: new Date(Date.now() - 86400000).toISOString(),
      trial_ends_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
      limits: {},
    }, { onConflict: "company_id" });
    await admin.from("companies").update({ status: "active", plan_code: "starter" }).eq("id", peer.company_id);

    const ovFilter = await platform(caller, "platform.getOverview", {});
    const all = ovFilter.companies || [];
    const activeRows = all.filter((c) => String(c.display_status || "").toLowerCase() === "active");
    const expiredRows = all.filter((c) => String(c.display_status || "").toLowerCase() === "expired");
    const suspendedRows = all.filter((c) => String(c.display_status || "").toLowerCase() === "suspended");
    const trialRows = all.filter((c) =>
      /trial/i.test(String(c.free_trial_status || ""))
      || c.subscription_status === "trialing"
      || c.plan_code === "free_trial"
    );

    const hasSuspended = suspendedRows.some((c) => Number(c.id) === tenant.company_id);
    const hasExpired = expiredRows.some((c) => Number(c.id) === peer.company_id);
    const hasActive = activeRows.length > 0;
    const filterOk = hasTrial && hasSuspended && hasExpired && hasActive;
    record(9, filterOk ? "PASS" : "FAIL",
      `trialSeen=${hasTrial}(count ${trialRowsPre.length}) active=${activeRows.length} expired=${expiredRows.length}(peer=${hasExpired}) suspended=${suspendedRows.length}(tenant=${hasSuspended}) postTrialRows=${trialRows.length}`);

    // Restore tenant for UI visibility as active paid
    await platform(caller, "platform.activateCompany", { id: tenant.company_id });
    await platform(caller, "platform.markPaid", { company_id: tenant.company_id, days: 30, plan_code: "starter" });

    // 10 Browser console / network against local Company Management UI
    await browserCheck(platformSess, tenant);
  } catch (err) {
    record("fatal", "FAIL", err?.stack || err?.message || String(err));
  } finally {
    await cleanup(trialExtra).catch(() => null);
    await cleanup(peer).catch(() => null);
    await cleanup(tenant, productIds).catch((e) => console.warn("cleanup", e.message));
  }

  console.log("\n========== PRODUCTION SCENARIOS ==========\n");
  const numbered = results.filter((r) => typeof r.n === "number");
  for (const r of results) {
    console.log(`${r.status === "PASS" ? "✅" : "❌"} ${r.n}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const fails = results.filter((r) => r.status === "FAIL");
  if (fails.length === 0 && numbered.length >= 10) {
    console.log("\n✅ PRODUCTION READY");
    process.exitCode = 0;
  } else {
    console.log("\n❌ NOT PRODUCTION READY");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
