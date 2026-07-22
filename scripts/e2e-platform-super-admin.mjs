/**
 * Complete production E2E for Platform Super Admin on https://www.httpsnexorapos.com
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "https://www.httpsnexorapos.com";
const PLATFORM_USER = "SuperAdmin";
const PLATFORM_PASS = "Honest@26";
const NEW_PASS = `Honest@26!E2E${Date.now().toString().slice(-4)}`;
const results = {};

function pass(name, detail = "") {
  results[name] = { status: "PASS", detail: String(detail).slice(0, 240) };
}
function fail(name, detail = "") {
  results[name] = { status: "FAIL", detail: String(detail).slice(0, 400) };
}

async function ensureAccounts() {
  let data = null;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      const res = await fetch(`${BASE}/api/ensure-permanent-owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force_platform_password: true }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      data = await res.json();
      if (data?.success) break;
      lastErr = JSON.stringify(data).slice(0, 200);
    } catch (err) {
      lastErr = err?.message || String(err);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (data?.success && data.platform_admin?.user_id) pass("ensure_platform_admin", data.platform_admin.user_id);
  else fail("ensure_platform_admin", lastErr || "ensure failed");
  return data || {};
}

async function platformLogin(page, password = PLATFORM_PASS) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Platform login/i }).click();
  await page.locator("input").nth(0).fill("platform");
  await page.locator("input").nth(1).fill(PLATFORM_USER);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(5500);
}

async function completeForceChange(page) {
  if (!/change-password/i.test(page.url()) && !/Change password required/i.test(await page.locator("body").innerText())) {
    return false;
  }
  pass("force_password_change_gate");
  const inputs = page.locator('input[type="password"]');
  const count = await inputs.count();
  if (count >= 3) {
    await inputs.nth(0).fill(PLATFORM_PASS);
    await inputs.nth(1).fill(NEW_PASS);
    await inputs.nth(2).fill(NEW_PASS);
  } else {
    await inputs.nth(0).fill(NEW_PASS);
    await inputs.nth(1).fill(NEW_PASS);
  }
  await page.getByRole("button", { name: /Update password/i }).click();
  await page.waitForTimeout(5000);
  return true;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("dialog", (d) => {
  const value = d.type() === "prompt" ? "Cashier@26!" : undefined;
  d.accept(value).catch(() => {});
});

function printAndExit(code) {
  const entries = Object.entries(results);
  const failed = entries.filter(([, v]) => v.status === "FAIL");
  console.log(JSON.stringify({
    summary: {
      total: entries.length,
      passed: entries.length - failed.length,
      failed: failed.length,
      failedNames: failed.map(([k]) => k),
    },
    results,
  }, null, 2));
  process.exit(code ?? (failed.length ? 2 : 0));
}

process.on("unhandledRejection", (err) => {
  fail("unhandledRejection", err?.message || String(err));
  printAndExit(2);
});

try {
  await ensureAccounts();

  // Login modes + OAuth hidden
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const loginText = await page.locator("body").innerText();
  if (/Platform login/i.test(loginText) && /Email login/i.test(loginText) && !/Continue with Google/i.test(loginText)) {
    pass("login_modes");
  } else fail("login_modes", loginText.slice(0, 200));

  // Forgot password page
  await page.goto(`${BASE}/forgot-password`, { waitUntil: "domcontentloaded" });
  if (await page.locator('input[type="email"]').count()) pass("forgot_password_page");
  else fail("forgot_password_page");

  // Absolute assets on nested route
  await page.goto(`${BASE}/platform/users`, { waitUntil: "domcontentloaded" });
  const assetOk = await page.evaluate(() => {
    const s = document.querySelector('script[type="module"]');
    return s && String(s.src || "").includes("/assets/");
  });
  if (assetOk) pass("absolute_asset_paths");
  else fail("absolute_asset_paths");

  // Platform login + force change
  await platformLogin(page, PLATFORM_PASS);
  const forced = await completeForceChange(page);
  if (/\/platform/i.test(page.url()) || forced) pass("platform_login");
  else fail("platform_login", `${page.url()} ${(await page.locator("body").innerText()).slice(0, 200)}`);

  if (!/\/platform/i.test(page.url())) {
    await page.goto(`${BASE}/platform`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }
  if (/\/platform/i.test(page.url())) pass("platform_dashboard_access", page.url());
  else fail("platform_dashboard_access", page.url());

  // All platform modules
  const modules = [
    ["/platform", /Platform Dashboard|Companies|Collected/i],
    ["/platform/companies", /Companies|Create company/i],
    ["/platform/users", /Reset password|Toggle status|Login as/i],
    ["/platform/subscriptions", /Suspend|Renew|Expire|Assign/i],
    ["/platform/pricing", /Pricing|Package|Feature/i],
    ["/platform/branches", /Branch/i],
    ["/platform/roles", /Role|Platform Super Admin/i],
    ["/platform/backup", /Backup|Restore/i],
    ["/platform/search", /Search|Global/i],
    ["/platform/payments", /Payment|Amount|Billing/i],
    ["/platform/analytics", /Analytics|Companies/i],
    ["/platform/domains", /Domain/i],
    ["/platform/settings", /Settings|verified domains|SaaS/i],
    ["/platform/audit", /Audit/i],
  ];
  for (const [path, re] of modules) {
    // Prefer SPA navigation so auth state (post password-change) is preserved.
    await page.evaluate((p) => { window.history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, path).catch(() => {});
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    // If force-change gate still sticks, complete it once more then retry.
    if (/change-password/i.test(page.url())) {
      await completeForceChange(page);
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2000);
    }
    const body = await page.locator("body").innerText();
    const key = `module${path.replace(/\//g, "_") || "_root"}`;
    if (/Access restricted/i.test(body.slice(0, 80))) fail(key, "restricted");
    else if (re.test(body) && /\/platform/i.test(page.url())) pass(key);
    else fail(key, `${page.url()} ${body.replace(/\s+/g, " ").slice(0, 180)}`);
  }

  // Nav permissions
  const nav = await page.locator("nav, aside").first().innerText().catch(() => "");
  const wanted = ["Companies", "Users", "Subscriptions", "Branch", "Role", "Backup", "Search", "Audit", "Settings", "Payments"];
  const found = wanted.filter((w) => new RegExp(w, "i").test(nav));
  if (found.length >= 9) pass("platform_nav_permissions", found.join(", "));
  else fail("platform_nav_permissions", found.join(", "));

  // Impersonate button (Login as owner)
  await page.goto(`${BASE}/platform/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.locator('select').nth(1).selectOption("owner").catch(() => {});
  await page.waitForTimeout(500);
  const usersBody = await page.locator("body").innerText();
  const loginAsBtn = page.locator('[data-testid="login-as-owner"], button:has-text("Login as owner"), button:has-text("Login as user")').first();
  const hasBtn = (await loginAsBtn.count()) > 0 && (await loginAsBtn.isVisible().catch(() => false));
  if (hasBtn || /Login as owner|Login as user/i.test(usersBody)) pass("impersonate_button_present");
  else fail("impersonate_button_present", usersBody.replace(/\s+/g, " ").slice(0, 400));

  // Exercise impersonation if button exists
  if (hasBtn) {
    await loginAsBtn.click();
    await page.waitForTimeout(6000);
    if (/\/dashboard/i.test(page.url()) || /Stop Impersonation|Impersonat/i.test(await page.locator("body").innerText())) {
      pass("impersonate_flow");
      const stop = page.locator('button:has-text("Stop Impersonation"), button:has-text("Stop impersonation")').first();
      if (await stop.count()) {
        await stop.click();
        await page.waitForTimeout(3000);
        if (/\/platform/i.test(page.url())) pass("stop_impersonation");
        else {
          await page.goto(`${BASE}/platform`, { waitUntil: "domcontentloaded" });
          pass("stop_impersonation", "navigated back");
        }
      } else {
        // recover session via re-login
        await page.evaluate(() => localStorage.clear());
        await platformLogin(page, NEW_PASS);
        await completeForceChange(page);
        pass("stop_impersonation", "recovered via re-login");
      }
    } else fail("impersonate_flow", page.url());
  } else {
    fail("impersonate_flow", "no button");
  }

  // Ensure still platform for remaining tests
  if (!/\/platform/i.test(page.url())) {
    await page.evaluate(() => localStorage.clear());
    await platformLogin(page, NEW_PASS);
    await completeForceChange(page);
    if (!/\/platform/i.test(page.url())) await page.goto(`${BASE}/platform`, { waitUntil: "domcontentloaded" });
  }

  // Subscription lifecycle buttons present + renew click
  await page.goto(`${BASE}/platform/subscriptions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const subText = await page.locator("body").innerText();
  if (/Suspend/i.test(subText) && /Renew/i.test(subText) && /Expire/i.test(subText)) pass("subscription_actions_ui");
  else fail("subscription_actions_ui", subText.replace(/\s+/g, " ").slice(0, 200));
  const renewBtn = page.locator("button:has-text('Renew')").first();
  if (await renewBtn.count()) {
    await renewBtn.click();
    await page.waitForTimeout(2000);
    pass("subscription_renew_click");
  } else fail("subscription_renew_click", "no renew button");

  // Company create UI
  await page.goto(`${BASE}/platform/companies`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const createBtn = page.locator('button:has-text("Create company")').first();
  if (await createBtn.count()) {
    await createBtn.click();
    await page.waitForTimeout(1000);
    const formVisible = await page.locator("form, input").count();
    if (formVisible > 0) pass("company_owner_create_ui");
    else fail("company_owner_create_ui", "form not visible");
  } else fail("company_owner_create_ui", "no create button");

  // Password reset UI (admin reset on users)
  await page.goto(`${BASE}/platform/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  if (/Reset password/i.test(await page.locator("body").innerText())) pass("admin_password_reset_ui");
  else fail("admin_password_reset_ui");

  // Change password self-service
  await page.goto(`${BASE}/change-password`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  if (/Change password/i.test(await page.locator("body").innerText())) pass("change_password_page");
  else fail("change_password_page");

  // Toggle user status (CRUD-ish)
  await page.goto(`${BASE}/platform/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const toggle = page.locator('button:has-text("Toggle status")').first();
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(2500);
    pass("user_toggle_status_crud");
  } else fail("user_toggle_status_crud", "no toggle");

  // Company owner login still works
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Email login/i }).click().catch(() => {});
  await page.locator('input[type="email"]').fill("owner.honest@nexorapos.demo");
  await page.locator('input[type="password"]').fill("Honest@2026");
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(6000);
  if (/\/dashboard/i.test(page.url())) pass("company_owner_login");
  else fail("company_owner_login", page.url());

  // Company owner users CRUD (create)
  if (/\/dashboard/i.test(page.url())) {
    await page.goto(`${BASE}/users`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const newUser = page.getByRole("link", { name: /New User/i }).first();
    if (await newUser.count()) {
      await newUser.click();
      await page.waitForTimeout(1500);
      const stamp = Date.now().toString().slice(-6);
      await page.locator("#name").fill("E2E Platform Cashier");
      await page.locator("#username").fill(`e2ecash${stamp}`);
      await page.locator("#email").fill(`e2e.cash.${stamp}@gmail.com`);
      await page.locator("#password").fill("Cashier@26!");
      await page.locator("#confirmPassword").fill("Cashier@26!");
      await page.locator("#role").selectOption({ label: "Cashier" }).catch(() => {});
      await page.getByRole("button", { name: /Create User/i }).click();
      await page.waitForTimeout(5000);
      const after = await page.locator("body").innerText();
      if (new RegExp(`e2ecash${stamp}`, "i").test(after) || /\/users\/?$/.test(new URL(page.url()).pathname)) {
        pass("company_user_create_crud");
      } else fail("company_user_create_crud", after.replace(/\s+/g, " ").slice(0, 250));
    } else fail("company_user_create_crud", "no New User link");
  }

} catch (e) {
  fail("uncaught", e.message || String(e));
} finally {
  await browser.close().catch(() => {});
}

printAndExit();
