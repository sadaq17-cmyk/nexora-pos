import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "https://www.httpsnexorapos.com";
const EMAIL = "owner.honest@nexorapos.demo";
const USERNAME = "Owner@Honest";
const PASSWORD = "Honest@2026";
const COMPANY = "NEXORA001";

async function sessionInfo(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("nexora-supabase-auth");
    if (!raw) return { has: false };
    try {
      const p = JSON.parse(raw);
      const token = p?.access_token || p?.currentSession?.access_token || p?.session?.access_token;
      const user = p?.user || p?.currentSession?.user || p?.session?.user;
      return {
        has: true,
        token: Boolean(token),
        role: user?.app_metadata?.role || null,
        email: user?.email || null,
        username: user?.app_metadata?.username || null,
        company_id: user?.app_metadata?.company_id ?? null,
      };
    } catch {
      return { has: true, parseFail: true };
    }
  });
}

async function loginByEmail(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Email login/i }).click().catch(() => {});
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return {
    url: page.url(),
    error: await page.locator(".bg-red-50, .text-red-700").first().innerText().catch(() => ""),
    session: await sessionInfo(page),
  };
}

async function logout(page) {
  const btn = page.locator('button:has-text("Logout"), a:has-text("Logout"), button:has-text("Log out")').first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(2000);
  } else {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  }
}

async function loginByCompany(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /company code/i }).click();
  await page.locator('input[placeholder*="NEXORA" i], input.form-control').first().fill(COMPANY);
  await page.locator('input[type="text"]').last().fill(USERNAME);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return {
    url: page.url(),
    error: await page.locator(".bg-red-50, .text-red-700").first().innerText().catch(() => ""),
    session: await sessionInfo(page),
  };
}

async function verifyOwnerManagement(page) {
  const result = {
    usersPage: false,
    createVisible: false,
    crud: { created: false, edited: false, deactivated: false },
    modules: [],
    errors: [],
  };

  await page.goto(`${BASE}/users`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  result.usersPage = /\/users/.test(page.url());
  const body = await page.locator("body").innerText();
  result.createVisible = /New User|Add User/i.test(body);

  const navText = await page.locator("nav, aside").first().innerText().catch(() => "");
  const wanted = [
    "Dashboard", "POS", "Inventory", "Products", "Customers", "Suppliers",
    "Purchases", "Expenses", "Reports", "Users", "Roles", "Settings", "Backup", "Audit",
  ];
  result.modules = wanted.filter((w) => new RegExp(w, "i").test(navText));
  result.navSnippet = navText.replace(/\s+/g, " ").slice(0, 400);

  const stamp = Date.now().toString().slice(-6);
  const uname = `omqa${stamp}`;
  const uemail = `om.qa.${stamp}@gmail.com`;

  try {
    const newBtn = page.locator('a[href="/users/new"], a:has-text("New User"), button:has-text("New User"), a:has-text("Add User")').first();
    await newBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1500);

    async function fillFirst(selectors, value) {
      for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (await el.count() && await el.isVisible().catch(() => false)) {
          await el.fill(value);
          return true;
        }
      }
      return false;
    }

    await fillFirst(['input[name="name"]', "input#name"], "OM QA Cashier");
    await fillFirst(['input[name="username"]', "input#username"], uname);
    await fillFirst(['input[name="email"]', "input#email", 'input[type="email"]'], uemail);
    await fillFirst(['input[name="password"]', "input#password", 'input[type="password"]'], "OmQaCashier1!");

    const roleSelect = page.locator('select[name="role"], select#role, select[name="role_id"]').first();
    if (await roleSelect.count()) {
      const options = await roleSelect.locator("option").allTextContents();
      const cashier = options.find((o) => /cashier/i.test(o));
      if (cashier) await roleSelect.selectOption({ label: cashier.trim() });
      else if (options[1]) await roleSelect.selectOption({ index: 1 });
    }

    await page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Save")').first().click();
    await page.waitForTimeout(3500);
    const afterCreate = await page.locator("body").innerText();
    result.crud.created = new RegExp(uname, "i").test(afterCreate) || /success|created|saved/i.test(afterCreate) || /\/users\/?$/.test(new URL(page.url()).pathname);

    if (!/\/users/.test(page.url()) || /new|edit/.test(page.url())) {
      await page.goto(`${BASE}/users`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
    }

    const row = page.locator(`tr:has-text("${uname}"), div:has-text("${uname}")`).first();
    if (await row.count()) {
      const editBtn = row.locator('a:has-text("Edit"), button:has-text("Edit"), a[href*="edit"]').first();
      if (await editBtn.count()) await editBtn.click();
      else await row.locator("a").first().click().catch(() => row.click());
      await page.waitForTimeout(1500);
      const nameInput = page.locator('input[name="name"], input#name').first();
      if (await nameInput.count()) {
        await nameInput.fill("OM QA Cashier Edited");
        await page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Update")').first().click();
        await page.waitForTimeout(2500);
        const editBody = await page.locator("body").innerText();
        result.crud.edited = /OM QA Cashier Edited|success|updated|saved/i.test(editBody);
      }

      await page.goto(`${BASE}/users`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const row2 = page.locator(`tr:has-text("${uname}"), div:has-text("${uname}")`).first();
      if (await row2.count()) {
        page.once("dialog", (d) => d.accept().catch(() => {}));
        const delBtn = row2.locator('button:has-text("Delete"), button:has-text("Deactivate"), a:has-text("Delete")').first();
        if (await delBtn.count()) {
          await delBtn.click();
          await page.waitForTimeout(1500);
          const confirm = page.locator('button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")').last();
          if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
          await page.waitForTimeout(2000);
          const delBody = await page.locator("body").innerText();
          result.crud.deactivated = !new RegExp(uname, "i").test(delBody) || /deactivat|deleted|removed|success/i.test(delBody);
        }
      }
    }
  } catch (e) {
    result.errors.push(String(e.message || e));
  }

  return result;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const out = {
  csp: null,
  emailLogin: null,
  companyLogin: null,
  ownerMgmt: null,
};

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  out.csp = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return meta?.content || null;
  });

  out.emailLogin = await loginByEmail(page);
  if (out.emailLogin.session?.token || /dashboard/i.test(out.emailLogin.url)) {
    out.ownerMgmt = await verifyOwnerManagement(page);
    await logout(page);
  }

  out.companyLogin = await loginByCompany(page);
} catch (e) {
  out.error = String(e.message || e);
} finally {
  await browser.close().catch(() => {});
}

const emailOk = Boolean(out.emailLogin?.session?.token) || /dashboard/i.test(out.emailLogin?.url || "");
const companyOk = Boolean(out.companyLogin?.session?.token) || /dashboard/i.test(out.companyLogin?.url || "");
const mgmtOk = Boolean(out.ownerMgmt?.usersPage && out.ownerMgmt?.createVisible && out.ownerMgmt?.crud?.created);
const cspOk = /connect-src/i.test(out.csp || "") && /supabase/i.test(out.csp || "");

console.log(JSON.stringify({
  summary: {
    csp: cspOk ? "PASS" : "FAIL",
    emailLogin: emailOk ? "PASS" : "FAIL",
    companyLogin: companyOk ? "PASS" : "FAIL",
    ownerManagement: mgmtOk ? "PASS" : "FAIL",
    modulesFound: out.ownerMgmt?.modules || [],
  },
  detail: out,
}, null, 2));

process.exit(emailOk && cspOk && mgmtOk ? 0 : 2);
