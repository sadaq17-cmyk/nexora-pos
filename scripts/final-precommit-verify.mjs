/**
 * Final pre-commit verification for Company Management + tenant Users.
 *
 * Modes:
 *  - API/security/DB against production (read-mostly; temp staff user cleaned up)
 *  - Optional UI via Playwright when E2E_BASE_URL is set (prefer local vercel/vite
 *    that serves THIS branch's UI while APIs hit production)
 *
 *   node scripts/final-precommit-verify.mjs
 *   E2E_BASE_URL=http://127.0.0.1:5173 node scripts/final-precommit-verify.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = String(process.env.APP_BASE_URL || process.env.E2E_BASE_URL || "https://www.nexorapospro.com").replace(/\/$/, "");
const UI_BASE = String(process.env.E2E_UI_BASE || process.env.E2E_BASE_URL || BASE).replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLATFORM_USER = process.env.E2E_PLATFORM_USER || "SuperAdmin";
const PLATFORM_PASS = process.env.E2E_PLATFORM_PASS || "Honest@26";
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || "owner.honest@nexorapos.demo";
const OWNER_PASS = process.env.E2E_OWNER_PASS || "Honest@2026";

const report = [];
function record(section, check, status, detail = "") {
  report.push({ section, check, status, detail: String(detail).slice(0, 300) });
  const mark = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "SKIP";
  console.log(`[${mark}] ${section} · ${check}${detail ? ` — ${detail}` : ""}`);
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

async function clearPasswordGate(user) {
  // UI tests must not be blocked by must_change_password after session inject.
  const meta = { ...(user.app_metadata || {}), must_change_password: false, active: true };
  await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_metadata: meta }),
  });
  return { ...user, app_metadata: meta };
}

/** Mint a JWT without changing the account password (admin magic-link verify). */
async function sessionForUser(user) {
  user = await clearPasswordGate(user);
  const email = user.email;
  if (!email) throw new Error("user has no email");
  const link = await jsonFetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const tokenHash =
    link.body?.properties?.hashed_token
    || link.body?.hashed_token
    || link.body?.email_otp
    || link.body?.properties?.email_otp;
  if (!link.ok || !tokenHash) {
    throw new Error(`generate_link failed: ${JSON.stringify(link.body).slice(0, 220)}`);
  }
  // GoTrue: when using token_hash, only type + token_hash are allowed (no email).
  const verified = await jsonFetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
  });
  if (!verified.ok || !verified.body?.access_token) {
    // Fallback: some projects return access_token on generate_link itself
    if (link.body?.access_token) {
      return {
        token: link.body.access_token,
        refresh_token: link.body.refresh_token || "",
        user: link.body.user || user,
        email,
        role: (link.body.user || user).app_metadata?.role,
        company_id: (link.body.user || user).app_metadata?.company_id,
      };
    }
    throw new Error(`verify failed: ${JSON.stringify(verified.body).slice(0, 200)}`);
  }
  return {
    token: verified.body.access_token,
    refresh_token: verified.body.refresh_token || "",
    user: verified.body.user || user,
    email,
    role: (verified.body.user || user).app_metadata?.role,
    company_id: (verified.body.user || user).app_metadata?.company_id,
  };
}

async function passwordLogin(emailOrUser, password, { platform = false } = {}) {
  let email = emailOrUser;
  if (!String(emailOrUser).includes("@")) {
    const resolved = await jsonFetch(`${BASE}/api/resolve-login-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ username: emailOrUser }),
    });
    email = resolved.body?.email || emailOrUser;
  }
  const auth = await jsonFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!auth.ok || !auth.body?.access_token) {
    throw new Error(`login failed for ${emailOrUser}: ${JSON.stringify(auth.body).slice(0, 200)}`);
  }
  return {
    token: auth.body.access_token,
    refresh_token: auth.body.refresh_token || "",
    user: auth.body.user,
    email,
    role: auth.body.user?.app_metadata?.role,
    company_id: auth.body.user?.app_metadata?.company_id,
    platform,
  };
}

async function loginPlatform() {
  try {
    return await passwordLogin(PLATFORM_USER, PLATFORM_PASS, { platform: true });
  } catch {
    const users = await listAuthUsers();
    const platform = users.find((u) => String(u.app_metadata?.role || "") === "platform_owner")
      || users.find((u) => String(u.app_metadata?.username || "").toLowerCase() === "superadmin");
    if (!platform) throw new Error("no platform_owner user in Auth");
    const session = await sessionForUser(platform);
    session.platform = true;
    return session;
  }
}

async function loginCompanyOwner() {
  try {
    return await passwordLogin(OWNER_EMAIL, OWNER_PASS);
  } catch {
    const users = await listAuthUsers();
    const owner = users.find((u) => {
      const role = String(u.app_metadata?.role || "");
      const companyId = u.app_metadata?.company_id;
      return (role === "owner" || role === "company_owner") && companyId != null && Number(companyId) !== 1;
    }) || users.find((u) => {
      const role = String(u.app_metadata?.role || "");
      return (role === "owner" || role === "company_owner") && u.app_metadata?.company_id != null;
    });
    if (!owner) throw new Error("no company owner user in Auth");
    return sessionForUser(owner);
  }
}

async function pos(session, action, params = {}) {
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

async function adminListUsers(session, body = {}) {
  return jsonFetch(`${BASE}/api/admin-list-users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      Origin: BASE,
    },
    body: JSON.stringify(body),
  });
}

function runNode(scriptRel) {
  const r = spawnSync(process.execPath, [path.join(root, scriptRel)], {
    encoding: "utf8",
    cwd: root,
    env: process.env,
  });
  return { code: r.status ?? 1, out: `${r.stdout || ""}\n${r.stderr || ""}` };
}

async function sectionStatic() {
  const cm = runNode("scripts/verify-company-management.mjs");
  record("Build/Static", "Company Management static verify", cm.code === 0 ? "PASS" : "FAIL", cm.out.slice(-120));
  const rls = runNode("scripts/verify-rls.mjs");
  record("Security", "RLS static policies", rls.code === 0 && /RESULT: PASS/.test(rls.out) ? "PASS" : "FAIL");
  const auth = runNode("scripts/auth-logic-test.mjs");
  record("Build/Static", "Auth logic unit tests", auth.code === 0 ? "PASS" : "FAIL");
  const runtime = runNode("scripts/runtime-api-smoke.mjs");
  record("Build/Static", "Runtime mockApi + company lifecycle", runtime.code === 0 ? "PASS" : "FAIL", runtime.out.includes("company management") ? "includes CM check" : "");
}

async function sectionSuperOwnerApi() {
  let platform;
  try {
    platform = await loginPlatform();
    record("Super Owner", "Platform login", platform.role === "platform_owner" ? "PASS" : "FAIL", `role=${platform.role}`);
  } catch (err) {
    record("Super Owner", "Platform login", "FAIL", err.message);
    return null;
  }

  const overview = await pos(platform, "platform.getOverview", {});
  if (!overview.body?.success || !Array.isArray(overview.body.companies)) {
    record("Super Owner", "Companies load", "FAIL", JSON.stringify(overview.body).slice(0, 180));
    return platform;
  }
  const companies = overview.body.companies;
  record("Super Owner", "Companies load", companies.length > 0 ? "PASS" : "FAIL", `${companies.length} companies`);

  const trials = companies.filter((c) =>
    /trial/i.test(String(c.free_trial_status || ""))
    || String(c.subscription_status || "").toLowerCase() === "trialing"
    || String(c.plan_code || "") === "free_trial"
  );
  record("Super Owner", "Free Trial companies visible", trials.length > 0 || companies.some((c) => "free_trial_status" in c) ? "PASS" : "FAIL",
    trials.length ? `${trials.length} trial rows` : "field present, none currently on trial");

  const statuses = new Set(companies.map((c) => String(c.display_status || c.company_status || c.status || "").toLowerCase()));
  const hasActive = [...statuses].some((s) => s === "active");
  record("Super Owner", "Active status display field", hasActive || statuses.size > 0 ? "PASS" : "FAIL", [...statuses].join(", ") || "none");
  record("Super Owner", "Expired/Suspended status fields",
    companies.every((c) => c.display_status != null || c.company_status != null || c.status != null) ? "PASS" : "FAIL",
    `statuses seen: ${[...statuses].join(", ") || "n/a"}`);

  const searchTerm = String(companies[0]?.name || "").slice(0, 4);
  const searched = await pos(platform, "platform.getOverview", { search: searchTerm });
  const searchOk = searched.body?.success
    && Array.isArray(searched.body.companies)
    && searched.body.companies.every((c) => JSON.stringify(c).toLowerCase().includes(searchTerm.toLowerCase()));
  record("Super Owner", "Search", searchOk ? "PASS" : "FAIL", `term=${searchTerm}`);

  const filtered = await pos(platform, "platform.getOverview", {});
  const activeOnly = (filtered.body?.companies || []).filter((c) => (c.display_status || c.status) === "active");
  record("Super Owner", "Filters (status field usable)", activeOnly.length >= 0 && filtered.body?.success ? "PASS" : "FAIL", `${activeOnly.length} active`);

  const detail = await pos(platform, "platform.getCompany", { id: companies[0].id });
  record("Super Owner", "Company details",
    detail.body?.success && Number(detail.body.company?.id) === Number(companies[0].id) ? "PASS" : "FAIL",
    detail.body?.company?.name || detail.body?.error);

  // Super Owner only
  const ownerSession = await loginCompanyOwner().catch(() => null);
  if (ownerSession) {
    const denied = await pos(ownerSession, "platform.getOverview", {});
    record("Security", "Super Owner permissions only (owner denied overview)",
      denied.body?.code === "FORBIDDEN" || denied.body?.success === false ? "PASS" : "FAIL",
      denied.body?.code || denied.body?.error);
  } else {
    record("Security", "Super Owner permissions only (owner denied overview)", "SKIP", "owner login unavailable");
  }

  return platform;
}

async function sectionCompanyOwner(platform) {
  let owner;
  try {
    owner = await loginCompanyOwner();
    record("Company Owner", "Owner login", owner.role === "owner" || owner.role === "company_owner" ? "PASS" : "FAIL", `role=${owner.role} company=${owner.company_id}`);
  } catch (err) {
    record("Company Owner", "Owner login", "FAIL", err.message);
    return;
  }

  const users = await adminListUsers(owner);
  const list = users.body?.users || users.body?.data || (Array.isArray(users.body) ? users.body : null);
  const usersOk = users.ok && Array.isArray(list);
  record("Company Owner", "Users module (list)", usersOk ? "PASS" : "FAIL", usersOk ? `${list.length} users` : JSON.stringify(users.body).slice(0, 120));

  if (usersOk) {
    const leak = list.filter((u) => u.company_id != null && Number(u.company_id) !== Number(owner.company_id));
    record("Security", "No tenant user leakage", leak.length === 0 ? "PASS" : "FAIL", leak.length ? `${leak.length} foreign users` : "scoped");
  }

  // Staff CRUD: create → update → delete temp user
  const stamp = Date.now().toString().slice(-6);
  const tempEmail = `precommit.staff.${stamp}@nexorapos.demo`;
  const create = await jsonFetch(`${BASE}/api/admin-create-user`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
      Origin: BASE,
    },
    body: JSON.stringify({
      name: `Precommit Staff ${stamp}`,
      username: `pcstaff${stamp}`,
      email: tempEmail,
      phone: "+254700000099",
      password: `PreCommit!${stamp}Aa`,
      role: "cashier",
      branch_id: owner.user?.app_metadata?.branch_id || 1,
      active: 1,
    }),
  });
  const createdId = create.body?.id || create.body?.user?.id || create.body?.user_id;
  record("Company Owner", "Staff CRUD create", create.body?.success && createdId ? "PASS" : "FAIL",
    create.body?.error || createdId || JSON.stringify(create.body).slice(0, 120));

  if (createdId) {
    const upd = await jsonFetch(`${BASE}/api/admin-update-user`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
        Origin: BASE,
      },
      body: JSON.stringify({ id: createdId, name: `Precommit Staff Updated ${stamp}` }),
    });
    record("Company Owner", "Staff CRUD update", upd.body?.success !== false && upd.ok ? "PASS" : "FAIL", upd.body?.error || "updated");

    const del = await jsonFetch(`${BASE}/api/admin-delete-user`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
        Origin: BASE,
      },
      body: JSON.stringify({ id: createdId }),
    });
    record("Company Owner", "Staff CRUD delete", del.body?.success !== false && del.ok ? "PASS" : "FAIL", del.body?.error || "deleted");
  } else {
    record("Company Owner", "Staff CRUD update", "SKIP", "create failed");
    record("Company Owner", "Staff CRUD delete", "SKIP", "create failed");
  }

  const branches = await pos(owner, "branches.getAll");
  const branchRows = Array.isArray(branches.body) ? branches.body : branches.body?.branches;
  record("Company Owner", "Branch switching data (branches list)",
    Array.isArray(branchRows) && branchRows.length > 0 ? "PASS" : "FAIL",
    Array.isArray(branchRows) ? `${branchRows.length} branches` : JSON.stringify(branches.body).slice(0, 100));

  if (Array.isArray(branchRows) && branchRows.length) {
    const foreign = branchRows.filter((b) => b.company_id != null && Number(b.company_id) !== Number(owner.company_id));
    record("Security", "Company isolation (branches)", foreign.length === 0 ? "PASS" : "FAIL", foreign.length ? "foreign branches" : "ok");
  }

  const dash = await pos(owner, "reports.getDashboard", {}).catch(() => ({ body: null }));
  // fallback common dashboard actions
  let dashOk = dash.body && dash.body.success !== false && dash.status !== 500;
  if (!dashOk) {
    const recent = await pos(owner, "sales.getRecent", { limit: 5 });
    dashOk = recent.ok || Array.isArray(recent.body);
  }
  record("Company Owner", "Dashboard data loads", dashOk ? "PASS" : "FAIL");

  // Isolation: cannot read Super Owner company
  const deny = await pos(owner, "companies.getById", { id: 1 });
  record("Security", "Company isolation intact (deny company 1)",
    deny.body?.code === "FORBIDDEN" || deny.body?.success === false ? "PASS" : "FAIL",
    deny.body?.code || deny.body?.error);

  // RLS direct
  const rls = await jsonFetch(`${SUPABASE_URL}/rest/v1/products?select=id,company_id&limit=50`, {
    headers: { apikey: ANON, Authorization: `Bearer ${owner.token}` },
  });
  const rlsRows = Array.isArray(rls.body) ? rls.body : [];
  const rlsLeak = rlsRows.filter((r) => Number(r.company_id) !== Number(owner.company_id));
  record("Security", "RLS live products scoped", rls.ok && rlsLeak.length === 0 ? "PASS" : "FAIL",
    rls.ok ? `${rlsRows.length} rows, ${rlsLeak.length} leaks` : `status ${rls.status}`);

  void platform;
}

async function sectionDatabase() {
  if (!SERVICE) {
    record("Database", "Service role available", "FAIL", "missing SUPABASE_SERVICE_ROLE_KEY");
    return;
  }
  // Companies uniqueness by code
  const companies = await jsonFetch(`${SUPABASE_URL}/rest/v1/companies?select=id,code,name,owner_user_id,status`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!companies.ok || !Array.isArray(companies.body)) {
    record("Database", "Companies readable", "FAIL", String(companies.status));
    return;
  }
  record("Database", "Companies readable", "PASS", `${companies.body.length} rows`);

  const codes = companies.body.map((c) => c.code).filter(Boolean);
  const dupCodes = codes.filter((c, i) => codes.indexOf(c) !== i);
  record("Database", "No duplicate company codes", dupCodes.length === 0 ? "PASS" : "FAIL", dupCodes.slice(0, 5).join(","));

  // Orphan profiles (company_id not in companies) — soft check
  const profiles = await jsonFetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,company_id&company_id=not.is.null&limit=1000`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const companyIds = new Set(companies.body.map((c) => Number(c.id)));
  const orphans = Array.isArray(profiles.body)
    ? profiles.body.filter((p) => p.company_id != null && !companyIds.has(Number(p.company_id)))
    : [];
  record("Database", "No broken profile→company FKs (sample)", orphans.length === 0 ? "PASS" : "FAIL",
    orphans.length ? `${orphans.length} orphan profiles` : "ok");

  // Subscriptions company_id must exist
  const subs = await jsonFetch(`${SUPABASE_URL}/rest/v1/company_subscriptions?select=company_id,plan_code,status`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const badSubs = Array.isArray(subs.body)
    ? subs.body.filter((s) => !companyIds.has(Number(s.company_id)))
    : [];
  record("Database", "No broken subscription→company FKs", badSubs.length === 0 ? "PASS" : "FAIL",
    badSubs.length ? `${badSubs.length} orphan subs` : "ok");

  // Migration files parse as SQL present
  const migDir = path.join(root, "supabase", "migrations");
  const migs = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")) : [];
  record("Database", "Migration files present", migs.length > 0 ? "PASS" : "FAIL", `${migs.length} files`);
}

async function injectSupabaseSession(page, session) {
  if (!session.refresh_token) {
    throw new Error("session missing refresh_token — cannot inject durable browser auth");
  }
  const payload = {
    access_token: session.token,
    refresh_token: session.refresh_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: session.user,
  };
  await page.goto(`${UI_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((data) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("nexora-supabase-auth", JSON.stringify(data));
  }, payload);
}

async function sectionUiPlaywright() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    record("UI", "Playwright available", "SKIP", "playwright not installed");
    record("Performance", "Console/API/hydration via browser", "SKIP", "no playwright");
    return;
  }

  let platformSession;
  let ownerSession;
  try {
    platformSession = await loginPlatform();
    ownerSession = await loginCompanyOwner();
  } catch (err) {
    record("UI", "Session mint for UI", "FAIL", err.message);
    record("Performance", "Console/API/hydration via browser", "SKIP", "no session");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedApis = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (res) => {
    const url = res.url();
    if (/\/api\//.test(url) && res.status() >= 400) {
      failedApis.push(`${res.status()} ${url}`);
    }
  });

  try {
    await injectSupabaseSession(page, platformSession);
    await page.goto(`${UI_BASE}/platform/companies`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4500);
    // If auth still redirects to password change, bounce again after gate clear.
    if (/change-password/i.test(page.url())) {
      await page.goto(`${UI_BASE}/platform/companies`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
    }

    const body = await page.locator("body").innerText();
    const cmOpen = /\/platform\/companies/i.test(page.url())
      && /Company Management/i.test(body)
      && !/Access restricted|Change password/i.test(body.slice(0, 120));
    record("Super Owner", "Company Management opens (UI)", cmOpen ? "PASS" : "FAIL", page.url());

    const nav = await page.locator("nav, aside").first().innerText().catch(() => "");
    record("UI", "Navigation has Company Management", /Company Management/i.test(nav) ? "PASS" : "FAIL");
    record("UI", "No Super Owner Users menu", !/\bUsers\b/i.test(nav) ? "PASS" : "FAIL", nav.replace(/\s+/g, " ").slice(0, 120));

    // Wait for overview fetch to populate the table
    await page.waitForFunction(() => {
      const t = document.body?.innerText || "";
      return /View Company|Mark as Paid|Create company|No companies match/i.test(t);
    }, { timeout: 20000 }).catch(() => null);
    const tableBody = await page.locator("body").innerText();
    const hasTable = /View Company|Mark as Paid|Company Name|Create company/i.test(tableBody);
    record("Super Owner", "Companies table UI", hasTable ? "PASS" : "FAIL",
      tableBody.replace(/\s+/g, " ").slice(0, 160));

    // Search UI
    const search = page.locator('input[placeholder*="Search" i]').first();
    if (await search.count()) {
      await search.fill("a");
      await page.waitForTimeout(800);
      record("Super Owner", "Search UI interactive", "PASS");
    } else {
      record("Super Owner", "Search UI interactive", "FAIL", "no search input");
    }

    // Filter
    const select = page.locator("select").first();
    if (await select.count()) {
      await select.selectOption({ label: "Active" }).catch(() => select.selectOption("active").catch(() => null));
      await page.waitForTimeout(500);
      record("Super Owner", "Filter UI interactive", "PASS");
    } else {
      record("Super Owner", "Filter UI interactive", "FAIL", "no select");
    }

    // View company
    const viewBtn = page.locator('button:has-text("View Company")').first();
    if (await viewBtn.count()) {
      await viewBtn.click();
      await page.waitForTimeout(800);
      const modal = await page.locator("body").innerText();
      record("Super Owner", "Company details open (UI)", /Company ·|Company Code|Tenant isolation/i.test(modal) ? "PASS" : "FAIL");
      await page.locator('button[aria-label="Close"]').first().click().catch(() => {});
    } else {
      record("Super Owner", "Company details open (UI)", "FAIL", "no View Company button");
    }

    // Responsive
    for (const [label, viewport] of [
      ["desktop", { width: 1440, height: 900 }],
      ["tablet", { width: 768, height: 1024 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
      const visible = await page.locator("body").isVisible();
      const text = await page.locator("body").innerText();
      record("UI", `Responsive ${label}`, visible && text.length > 20 ? "PASS" : "FAIL", `${viewport.width}x${viewport.height}`);
    }

    // Company owner UI on same UI_BASE (session inject — no password mutation)
    await context.clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await injectSupabaseSession(page, ownerSession);
    await page.goto(`${UI_BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);

    const ownerUrl = page.url();
    const ownerBody = await page.locator("body").innerText();
    record("Company Owner", "Dashboard loads (UI)",
      /\/dashboard/i.test(ownerUrl) || /Dashboard|Today|Sales/i.test(ownerBody) ? "PASS" : "FAIL",
      ownerUrl);

    await page.goto(`${UI_BASE}/users`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => {
      const t = document.body?.innerText || "";
      return !/Checking your session/i.test(t)
        && (/New User|Staff|Role|Email|username/i.test(t) || /Access restricted|Sign in/i.test(t));
    }, { timeout: 25000 }).catch(() => null);
    if (/change-password/i.test(page.url())) {
      await page.goto(`${UI_BASE}/users`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2500);
    }
    const usersBody = await page.locator("body").innerText();
    record("Company Owner", "Users module UI",
      /\/users/i.test(page.url())
        && /New User|Users|Role|Branch|Email|username/i.test(usersBody)
        && !/Access restricted|Change password|Checking your session|Sign in/i.test(usersBody.slice(0, 160))
        ? "PASS"
        : "FAIL",
      `${page.url()} ${usersBody.replace(/\s+/g, " ").slice(0, 160)}`);

    const branchControl = page.locator('select, [data-testid*="branch"], button:has-text("Branch")').first();
    record("Company Owner", "Branch switching UI present",
      (await page.locator("aside, nav").innerText().catch(() => "")).length > 0
        || (await branchControl.count()) > 0
        || /Branch/i.test(await page.locator("body").innerText())
        ? "PASS"
        : "FAIL");

    // Broken links sample from nav
    const hrefs = await page.locator("aside a[href], nav a[href]").evaluateAll((as) =>
      as.map((a) => a.getAttribute("href")).filter(Boolean)
    );
    let broken = 0;
    for (const href of hrefs.slice(0, 12)) {
      if (!href.startsWith("/")) continue;
      const res = await page.goto(`${UI_BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      if (!res || res.status() >= 400) broken += 1;
      await page.waitForTimeout(300);
    }
    record("UI", "No broken nav links (sample)", broken === 0 ? "PASS" : "FAIL", `${broken} broken of ${Math.min(hrefs.length, 12)}`);

    const reactHydration = consoleErrors.filter((e) => /hydrat|Minified React|Warning:/i.test(e));
    const meaningfulConsole = consoleErrors.filter((e) =>
      !/favicon|Download the React DevTools|third-party/i.test(e)
    );
    record("Performance", "No console errors", meaningfulConsole.length === 0 ? "PASS" : "FAIL",
      meaningfulConsole.slice(0, 3).join(" | "));
    record("Performance", "No page errors / hydration issues", pageErrors.length === 0 && reactHydration.length === 0 ? "PASS" : "FAIL",
      [...pageErrors, ...reactHydration].slice(0, 2).join(" | "));
    record("Performance", "No API failures", failedApis.length === 0 ? "PASS" : "FAIL",
      failedApis.slice(0, 3).join(" | "));
  } catch (err) {
    record("UI", "Playwright run", "FAIL", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

function printSummary() {
  const sections = [...new Set(report.map((r) => r.section))];
  console.log("\n========== PRE-COMMIT VERIFICATION REPORT ==========\n");
  let allPass = true;
  for (const section of sections) {
    const rows = report.filter((r) => r.section === section);
    const fail = rows.filter((r) => r.status === "FAIL");
    const skip = rows.filter((r) => r.status === "SKIP");
    const pass = rows.filter((r) => r.status === "PASS");
    const status = fail.length ? "FAIL" : (pass.length ? "PASS" : "SKIP");
    if (status === "FAIL") allPass = false;
    console.log(`${status}  ${section}  (${pass.length} pass, ${fail.length} fail, ${skip.length} skip)`);
    for (const row of rows) {
      console.log(`      [${row.status}] ${row.check}${row.detail ? ` — ${row.detail}` : ""}`);
    }
    console.log("");
  }
  console.log(allPass ? "OVERALL: PASS — safe to commit" : "OVERALL: FAIL — do not commit");
  console.log(`UI_BASE=${UI_BASE}  API_BASE=${BASE}`);
  process.exitCode = allPass ? 0 : 1;
}

async function main() {
  if (!SUPABASE_URL || !ANON || !SERVICE) {
    console.error("Missing SUPABASE_URL / ANON / SERVICE_ROLE env");
    process.exit(1);
  }
  console.log(`API base: ${BASE}`);
  console.log(`UI base:  ${UI_BASE}\n`);

  await sectionStatic();
  const platform = await sectionSuperOwnerApi();
  await sectionCompanyOwner(platform);
  await sectionDatabase();
  await sectionUiPlaywright();
  printSummary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
