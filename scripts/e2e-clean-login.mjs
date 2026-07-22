/**
 * Clean-browser login smoke test against production.
 * Usage: node scripts/e2e-clean-login.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "https://www.httpsnexorapos.com";
const EMAIL = process.env.E2E_EMAIL || "qa.signup.0718b@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD || "QaSignup0718!";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const result = { ok: false, url: "", hasAuth: false, error: "", companyHint: "" };

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("textbox").first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForTimeout(12000);

  result.url = page.url();
  result.hasAuth = await page.evaluate(() => {
    const raw = localStorage.getItem("nexora-supabase-auth");
    return Boolean(raw && raw.includes("access_token"));
  });
  result.companyHint = await page.evaluate(() => {
    try {
      const db = JSON.parse(localStorage.getItem("nexora_pos_web_db_v3") || "{}");
      const c = (db.companies || []).find((x) => String(x.id) === "4" || /QAE2ER|CO4/i.test(x.code || ""));
      return c ? `${c.code}:${c.status}` : "missing";
    } catch {
      return "error";
    }
  });
  const body = await page.locator("body").innerText();
  if (result.url.includes("/dashboard") && result.hasAuth) {
    result.ok = true;
  } else {
    result.error = (body.match(/Invalid[^\n]+|Verify[^\n]+|subscription[^\n]+/i) || [body.slice(0, 200)])[0];
  }
} catch (err) {
  result.error = String(err?.message || err);
} finally {
  await browser.close();
}

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
