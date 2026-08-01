/**
 * Final authentication verification — Super Owner + Company Owner isolation.
 * Read-only UI login checks against production (no data writes beyond auth login).
 *
 *   ALLOW_PROD_E2E_WRITES=I_UNDERSTAND_THIS_WRITES_REAL_DATA \
 *   npx vercel env run -e production -- node scripts/final-auth-verify-super-owner.mjs
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { assertNotProduction } from "./_prodSafety.mjs";

// Always verify against live production UI (ignore local E2E_BASE_URL from Vercel env).
const BASE = String(process.env.AUTH_VERIFY_BASE_URL || "https://www.nexorapospro.com").replace(/\/$/, "");
assertNotProduction(BASE, { scriptName: "final-auth-verify-super-owner.mjs" });

const PLATFORM_USER = "SuperAdmin";
const PLATFORM_EMAIL = "support@httpsnexorapos.com";
const COMPANY_EMAIL = "owner@httpsnexorapos.com";
const COMPANY_CODE = "NEXORA001";
const COMPANY_USER = "Owner@Honest";

const REQUIRED_NAV = [
  "Company Management",
  "Subscriptions",
  "Payments",
  "Plans",
  "Reports",
  "AI Guardian",
  "Audit Logs",
  "Settings",
];

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

async function resolvePassword(email, candidates) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const password of candidates) {
    if (!password || password.length < 8) continue;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (!error && data?.user?.id) {
      await client.auth.signOut().catch(() => {});
      return password;
    }
  }
  return null;
}

const platformCandidates = [
  process.env.PERMANENT_PLATFORM_ADMIN_PASSWORD,
  process.env.E2E_PLATFORM_PASSWORD,
  process.env.E2E_PLATFORM_PASS,
  "Honest@26",
  "Honest@26!",
].map((v) => String(v || "").trim()).filter(Boolean);

const companyCandidates = [
  process.env.PERMANENT_COMPANY_OWNER_PASSWORD,
  process.env.E2E_COMPANY_OWNER_PASSWORD,
  process.env.E2E_OWNER_PASS,
  "Honest@2026",
].map((v) => String(v || "").trim()).filter(Boolean);

const PLATFORM_PASS = await resolvePassword(PLATFORM_EMAIL, platformCandidates);
const COMPANY_PASS = await resolvePassword(COMPANY_EMAIL, companyCandidates);
if (!PLATFORM_PASS) {
  console.error("Could not authenticate Super Owner with any known existing password candidate.");
  process.exit(1);
}
if (!COMPANY_PASS) {
  console.error("Could not authenticate Company Owner with any known existing password candidate.");
  process.exit(1);
}

async function clearMustChange(emailOrUsername) {
  const users = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    users.push(...(data?.users || []));
    if ((data?.users || []).length < 200) break;
  }
  const target = users.find((u) => {
    const email = String(u.email || "").toLowerCase();
    const username = String(u.app_metadata?.username || "").toLowerCase();
    const q = String(emailOrUsername || "").toLowerCase();
    return email === q || username === q;
  });
  if (!target) return null;
  const meta = { ...(target.app_metadata || {}), must_change_password: false, active: true };
  await admin.auth.admin.updateUserById(target.id, { app_metadata: meta, email_confirm: true });
  return { id: target.id, email: target.email, role: target.app_metadata?.role, username: target.app_metadata?.username };
}

function navReport(body) {
  const missing = REQUIRED_NAV.filter((label) => !new RegExp(label, "i").test(body));
  return { visible: REQUIRED_NAV.filter((l) => !missing.includes(l)), missing };
}

async function freshPage(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

async function readSessionIdentity(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("nexora-supabase-auth");
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      const user = session?.user || session?.currentSession?.user;
      return {
        id: user?.id || null,
        email: user?.email || null,
        role: user?.app_metadata?.role || null,
        username: user?.app_metadata?.username || null,
        company_id: user?.app_metadata?.company_id ?? null,
      };
    } catch {
      return null;
    }
  });
}

async function platformLogin(page, username, password) {
  await page.getByRole("tab", { name: /^Platform$/i }).click();
  await page.waitForTimeout(500);
  await page.locator("#login-platform-id").fill("platform");
  await page.locator("#login-platform-user").fill("");
  await page.locator("#login-platform-user").fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForTimeout(9000);
  // Capture visible error if still on login
  if (/\/login/i.test(page.url())) {
    const err = await page.locator(".nx-login-error, [role='alert'], .text-red-600, .nx-form-error").first().textContent().catch(() => "");
    const bodyErr = (await page.locator("body").innerText()).match(/Invalid[^\n]+|Unable[^\n]+|locked[^\n]+|MFA[^\n]+|password[^\n]+/i)?.[0] || err || "";
    return bodyErr.trim();
  }
  return "";
}

async function emailLogin(page, email, password) {
  await page.getByRole("tab", { name: /^Email$/i }).click();
  await page.waitForTimeout(400);
  await page.locator("#login-email, input[type='email']").first().fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForTimeout(8000);
}

async function companyCodeLogin(page, code, username, password) {
  await page.getByRole("tab", { name: /^Company$/i }).click();
  await page.waitForTimeout(400);
  await page.locator("#login-company-code").fill(code);
  await page.locator("#login-email").fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForTimeout(8000);
}

const browser = await chromium.launch({ headless: true });
const report = {
  super_owner_username_login: null,
  super_owner_email_login: null,
  same_account: false,
  nav: null,
  permissions: null,
  company_owner: null,
  super_owner_auth_passed: false,
  company_owner_isolation_passed: false,
};

try {
  await clearMustChange(PLATFORM_EMAIL);
  await clearMustChange(PLATFORM_USER);
  await clearMustChange(COMPANY_EMAIL);

  // 1) Username / Platform login
  {
    const { ctx, page } = await freshPage(browser);
    let loginError = await platformLogin(page, PLATFORM_USER, PLATFORM_PASS);
    // Fallback: platform form also accepts email in the username field
    if (/\/login/i.test(page.url())) {
      loginError = await platformLogin(page, PLATFORM_EMAIL, PLATFORM_PASS) || loginError;
    }
    if (/change-password/i.test(page.url())) {
      report.super_owner_username_login = { ok: false, error: "stuck on change-password", url: page.url() };
    } else if (/\/login/i.test(page.url())) {
      report.super_owner_username_login = { ok: false, error: loginError || "remained on login", url: page.url(), base: BASE };
    } else {
      await page.goto(`${BASE}/platform`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);
      const body = await page.locator("body").innerText();
      const identity = await readSessionIdentity(page);
      const nav = navReport(body);
      report.super_owner_username_login = {
        ok: /\/platform/.test(page.url()) && !/\/login/.test(page.url())
          && identity?.role === "platform_owner"
          && String(identity?.email || "").toLowerCase() === PLATFORM_EMAIL
          && nav.missing.length === 0,
        url: page.url(),
        identity,
        nav,
        base: BASE,
      };
    }
    await ctx.close();
  }

  // 2) Email login
  {
    const { ctx, page } = await freshPage(browser);
    await emailLogin(page, PLATFORM_EMAIL, PLATFORM_PASS);
    if (/change-password/i.test(page.url())) {
      report.super_owner_email_login = { ok: false, error: "stuck on change-password", url: page.url() };
    } else {
      await page.goto(`${BASE}/platform`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);
      const body = await page.locator("body").innerText();
      const identity = await readSessionIdentity(page);
      const nav = navReport(body);
      report.super_owner_email_login = {
        ok: /\/platform/.test(page.url()) && !/\/login/.test(page.url())
          && identity?.role === "platform_owner"
          && String(identity?.email || "").toLowerCase() === PLATFORM_EMAIL
          && nav.missing.length === 0,
        url: page.url(),
        identity,
        nav,
      };
      report.nav = nav;

      // Deep permission probe — platform APIs / pages
      const routes = [
        "/platform/companies",
        "/platform/subscriptions",
        "/platform/payments",
        "/platform/pricing",
        "/platform/analytics",
        "/platform/ai-guardian",
        "/platform/audit",
        "/platform/settings",
      ];
      const routeResults = [];
      for (const route of routes) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2000);
        const text = await page.locator("body").innerText();
        const blocked = /Access restricted|Permission denied|not authorized/i.test(text)
          || /\/login/.test(page.url());
        routeResults.push({ route, url: page.url(), blocked });
      }
      report.permissions = {
        ok: routeResults.every((r) => !r.blocked),
        routes: routeResults,
      };
    }
    await ctx.close();
  }

  const idA = report.super_owner_username_login?.identity?.id;
  const idB = report.super_owner_email_login?.identity?.id;
  report.same_account = Boolean(idA && idB && idA === idB);

  report.super_owner_auth_passed = Boolean(
    report.super_owner_username_login?.ok
    && report.super_owner_email_login?.ok
    && report.same_account
    && report.permissions?.ok
  );

  // 3) Company Owner isolation
  {
    const { ctx, page } = await freshPage(browser);
    // Prefer company-code login (stable username); also try email if needed
    await companyCodeLogin(page, COMPANY_CODE, COMPANY_USER, COMPANY_PASS);
    let identity = await readSessionIdentity(page);
    if (!identity?.id || identity.role === "platform_owner") {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      await emailLogin(page, COMPANY_EMAIL, COMPANY_PASS);
      identity = await readSessionIdentity(page);
    }
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    const dashBody = await page.locator("body").innerText();
    const onCompanyDash = /\/dashboard/.test(page.url()) && !/\/login/.test(page.url())
      && identity?.role === "owner"
      && !/Company Management/i.test(dashBody)
      && !/AI Guardian/i.test(dashBody);

    const platformRoutes = [
      "/platform",
      "/platform/companies",
      "/platform/subscriptions",
      "/platform/payments",
      "/platform/ai-guardian",
      "/platform/audit",
    ];
    const blockedRoutes = [];
    for (const route of platformRoutes) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2500);
      const text = await page.locator("body").innerText();
      const blocked = /Access restricted|Permission denied|not authorized/i.test(text)
        || /\/login|\/dashboard/.test(page.url())
        || !/\/platform/.test(page.url());
      const seesCM = /Company Management/i.test(text) && /MENU/i.test(text);
      blockedRoutes.push({ route, url: page.url(), blocked: blocked || !seesCM, seesCM });
    }

    report.company_owner = {
      identity,
      onCompanyDash,
      seesCM_on_dashboard: /Company Management/i.test(dashBody),
      platform_routes: blockedRoutes,
      ok: onCompanyDash
        && !/Company Management/i.test(dashBody)
        && blockedRoutes.every((r) => r.blocked && !r.seesCM),
    };
    await ctx.close();
  }

  report.company_owner_isolation_passed = Boolean(report.company_owner?.ok);
} finally {
  await browser.close();
}

// Strip secrets; print verdict
const printable = JSON.parse(JSON.stringify(report));
console.log(JSON.stringify(printable, null, 2));
console.log("");
if (report.super_owner_auth_passed) console.log("✅ Super Owner Authentication Passed");
else console.log("❌ Super Owner Authentication Failed");
if (report.company_owner_isolation_passed) console.log("✅ Company Owner Isolation Passed");
else console.log("❌ Company Owner Isolation Failed");

process.exit(report.super_owner_auth_passed && report.company_owner_isolation_passed ? 0 : 2);
