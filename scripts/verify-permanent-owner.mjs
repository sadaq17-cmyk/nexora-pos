import { chromium } from "playwright";
import { assertNotProduction } from "./_prodSafety.mjs";

const BASE = process.env.E2E_BASE_URL || "https://www.nexorapospro.com";
assertNotProduction(BASE, { scriptName: "verify-permanent-owner.mjs" });
const EMAIL = "owner.honest@nexorapos.demo";
const PASSWORD = "Honest@2026";

const result = { emailLogin: false, companyLogin: false, usersPage: false, url: "", error: "", authError: "" };

function setNative(page, selector, value) {
  return page.$eval(selector, (el, v) => {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    desc.set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("response", async (res) => {
  if (res.url().includes("/auth/v1/token") || res.url().includes("signIn")) {
    try {
      const body = await res.text();
      if (!result.authError && res.status() >= 400) result.authError = `${res.status()}:${body.slice(0, 180)}`;
    } catch { /* ignore */ }
  }
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await page.getByRole("button", { name: /email login/i }).click();
  await page.waitForTimeout(300);
  await setNative(page, 'input[type="email"]', EMAIL);
  await setNative(page, 'input[type="password"]', PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForTimeout(15000);

  result.url = page.url();
  if (result.url.includes("/dashboard")) {
    result.emailLogin = true;
    const body = await page.locator("body").innerText();
    await page.getByRole("link", { name: /^Users$/i }).click();
    await page.waitForTimeout(3000);
    const usersText = await page.locator("body").innerText();
    result.usersPage = /User Management|New User/i.test(usersText) && !/Access restricted/i.test(usersText);
    result.roleHint = /Owner/i.test(body) ? "owner" : "";
  } else {
    result.error = (await page.locator("body").innerText()).match(/Invalid[^\n]+|Verify[^\n]+|subscription[^\n]+/i)?.[0]
      || (await page.locator("body").innerText()).slice(0, 220);
  }

  // Company login fresh page
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /company code/i }).click();
  await page.waitForTimeout(300);
  const inputs = await page.locator("form input:not([type=checkbox])").all();
  if (inputs.length >= 3) {
    await inputs[0].fill("NEXORA001");
    await inputs[1].fill("Owner@Honest");
    await inputs[2].fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForTimeout(15000);
    result.companyLogin = page.url().includes("/dashboard");
  }
} catch (err) {
  result.error = String(err?.message || err);
} finally {
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.emailLogin ? 0 : 1);
