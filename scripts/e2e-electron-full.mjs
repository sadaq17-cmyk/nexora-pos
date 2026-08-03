/**
 * Packaged Electron E2E: login → dashboard → module routes (CDP).
 * Credentials from env (never printed):
 *   E2E_EMAIL / E2E_PASSWORD  OR  E2E_OWNER_EMAIL / E2E_OWNER_PASS
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionEnv } from "./loadDotEnv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "release", "dist", "win-unpacked", "Nexora POS Pro.exe");
const port = process.env.NEXORA_CDP_PORT || "9250";

const { env: fileEnv } = loadProductionEnv();
const EMAIL = String(
  process.env.E2E_EMAIL || process.env.E2E_OWNER_EMAIL || fileEnv.E2E_EMAIL || fileEnv.E2E_OWNER_EMAIL || ""
).trim();
const PASSWORD = String(
  process.env.E2E_PASSWORD || process.env.E2E_OWNER_PASS || fileEnv.E2E_PASSWORD || fileEnv.E2E_OWNER_PASS || ""
).trim();

const MODULES = [
  { hash: "#/dashboard", expect: /dashboard|sales|revenue|today|overview/i },
  { hash: "#/pos", expect: /pos|cart|checkout|product|sale/i },
  { hash: "#/products", expect: /product/i },
  { hash: "#/inventory", expect: /inventory|stock|warehouse/i },
  { hash: "#/purchases", expect: /purchase/i },
  { hash: "#/suppliers", expect: /supplier/i },
  { hash: "#/customers", expect: /customer/i },
  { hash: "#/reports", expect: /report/i },
  { hash: "#/settings", expect: /setting/i },
  { hash: "#/users", expect: /user|team|role|staff/i },
];

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    }).on("error", reject);
  });
}

async function waitForCdp(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tabs = JSON.parse(await get(`http://127.0.0.1:${port}/json`));
      if (tabs[0]?.webSocketDebuggerUrl) return tabs[0];
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("CDP not ready");
}

function cdpSession(wsUrl) {
  const WS = globalThis.WebSocket;
  let nextId = 1;
  const pending = new Map();
  const ws = new WS(wsUrl);
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP ws error")));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || "CDP error"));
      else resolve(msg.result);
    }
  });
  async function send(method, params = {}) {
    await ready;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "CDP exception");
    }
    return result.result?.value;
  }
  function close() {
    try { ws.close(); } catch { /* ignore */ }
  }
  return { send, evaluate, close };
}

if (!fs.existsSync(exe)) {
  console.error("MISSING", exe);
  process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error("e2e-electron-full: set E2E_EMAIL and E2E_PASSWORD (or E2E_OWNER_EMAIL / E2E_OWNER_PASS)");
  process.exit(1);
}

console.log(JSON.stringify({ emailLen: EMAIL.length, passwordLen: PASSWORD.length, exe: path.basename(exe) }));

const child = spawn(exe, [`--remote-debugging-port=${port}`], {
  cwd: path.dirname(exe),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

const results = { ok: false, login: null, modules: [], errors: [] };

try {
  const tab = await waitForCdp();
  const cdp = cdpSession(tab.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await new Promise((r) => setTimeout(r, 2000));

  for (let i = 0; i < 40; i++) {
    const ready = await cdp.evaluate(
      `({ hasLogin: /Sign in/i.test(document.body?.innerText||''), config: /Supabase is not configured/i.test(document.body?.innerText||'') })`
    );
    if (ready.config) throw new Error("Supabase not configured in EXE");
    if (ready.hasLogin) break;
    await new Promise((r) => setTimeout(r, 400));
  }

  // Ensure Email tab
  await cdp.evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find(b => /^email$/i.test((b.textContent||'').trim()));
    if (tab) tab.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  // Fill React controlled inputs with the native value setter + InputEvent
  const filled = await cdp.evaluate(
    `(async () => {
      const email = ${JSON.stringify(EMAIL)};
      const password = ${JSON.stringify(PASSWORD)};
      function fill(el, value) {
        if (!el) return false;
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value === value;
      }
      const emailInput = document.querySelector('#login-email, input[type="email"]')
        || document.querySelector('input[name="email"]');
      const passInput = document.querySelector('#login-password, input[type="password"]');
      const form = document.querySelector('form.nx-login-form, form');
      const okEmail = fill(emailInput, email);
      const okPass = fill(passInput, password);
      if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
      else {
        const btn = [...document.querySelectorAll('button')].find(b => /sign in/i.test(b.textContent||''));
        if (btn) btn.click();
      }
      return {
        okEmail,
        okPass,
        emailValueLen: String(emailInput?.value||'').length,
        passValueLen: String(passInput?.value||'').length
      };
    })()`
  );
  console.log("FILL", JSON.stringify(filled));

  let login = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    login = await cdp.evaluate(`(() => {
      const text = document.body ? document.body.innerText : '';
      const hash = location.hash || '';
      const hasSession = Boolean(localStorage.getItem('nexora-supabase-auth'));
      const errText = (text.match(/Invalid[^\\n]+|Verify[^\\n]+|Forbidden[^\\n]+|CSRF[^\\n]+|configured[^\\n]+|Login failed[^\\n]+|Unable[^\\n]+/i) || [''])[0];
      const onApp = /#\\/(dashboard|platform|change-password|subscription)/i.test(hash);
      return {
        hash,
        hasSession,
        onApp,
        subscriptionLocked: /#\\/subscription/i.test(hash) || /Subscription locked/i.test(text),
        errText: String(errText||'').slice(0, 200),
        preview: text.slice(0, 280),
        configBlocked: /Supabase is not configured/i.test(text),
        csrf: /Forbidden origin|CSRF_ORIGIN/i.test(text)
      };
    })()`);
    if (login.onApp || login.errText || login.configBlocked || login.csrf) break;
  }

  results.login = {
    ok: Boolean(login?.onApp),
    hash: login?.hash,
    hasSession: Boolean(login?.hasSession),
    subscriptionLocked: Boolean(login?.subscriptionLocked),
    errText: login?.errText || null,
    preview: String(login?.preview || "").slice(0, 180),
    via: "form",
  };
  console.log("LOGIN", JSON.stringify(results.login));
  if (!results.login.ok) throw new Error(`Login failed: ${results.login.errText || "timeout"}`);

  for (const mod of MODULES) {
    const r = await cdp.evaluate(
      `(async () => {
        location.hash = ${JSON.stringify(mod.hash)};
        await new Promise(r => setTimeout(r, 1400));
        const text = document.body ? document.body.innerText : '';
        const hash = location.hash;
        const bouncedToLogin = /#\\/login/i.test(hash);
        const configErr = /Supabase is not configured|Forbidden origin|CSRF_ORIGIN/i.test(text);
        const matched = ${mod.expect}.test(text);
        return { hash, bouncedToLogin, configErr, matched, preview: text.slice(0, 120) };
      })()`
    );
    const ok = r && !r.bouncedToLogin && !r.configErr;
    results.modules.push({ route: mod.hash, ok, ...r });
    console.log("MODULE", JSON.stringify({ route: mod.hash, ok, hash: r?.hash, matched: r?.matched, bounced: r?.bouncedToLogin }));
    if (!ok) results.errors.push(`${mod.hash} failed`);
  }

  results.ok = results.login.ok && results.errors.length === 0;
  console.log("e2e-electron-full:", results.ok ? "PASS" : "FAIL", JSON.stringify({
    login: results.login.ok,
    modulesOk: results.modules.filter((m) => m.ok).length,
    modulesTotal: results.modules.length,
    errors: results.errors,
  }));
  cdp.close();
  process.exitCode = results.ok ? 0 : 1;
} catch (err) {
  console.error("e2e-electron-full: FAIL", err.message || err);
  process.exitCode = 1;
} finally {
  try { if (!child.killed) child.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 1200);
}
