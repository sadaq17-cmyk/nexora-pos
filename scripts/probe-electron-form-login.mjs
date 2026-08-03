/**
 * Diagnose packaged EXE form login.
 * Env: E2E_OWNER_EMAIL / E2E_OWNER_PASS (never printed).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "release", "dist", "win-unpacked", "Nexora POS Pro.exe");
const port = process.env.NEXORA_CDP_PORT || "9252";
const EMAIL = String(process.env.E2E_OWNER_EMAIL || process.env.E2E_EMAIL || "").trim();
const PASSWORD = String(process.env.E2E_OWNER_PASS || process.env.E2E_PASSWORD || "").trim();

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
    ws.addEventListener("open", resolve);
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
          reject(new Error(`CDP timeout ${method}`));
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
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "CDP exception");
    }
    return result.result?.value;
  }
  return { send, evaluate, close: () => { try { ws.close(); } catch { /* ignore */ } } };
}

if (!fs.existsSync(exe) || !EMAIL || !PASSWORD) {
  console.error("Need EXE + E2E_OWNER_EMAIL/PASS");
  process.exit(1);
}

const child = spawn(exe, [`--remote-debugging-port=${port}`], {
  cwd: path.dirname(exe),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  const tab = await waitForCdp();
  const cdp = cdpSession(tab.webSocketDebuggerUrl);
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await new Promise((r) => setTimeout(r, 2500));

  await cdp.evaluate(`location.hash = '#/login'`);
  await new Promise((r) => setTimeout(r, 1000));

  await cdp.evaluate(`(() => {
    const tabBtn = [...document.querySelectorAll('button')].find(b => /^email$/i.test((b.textContent||'').trim()));
    if (tabBtn) tabBtn.click();
    return true;
  })()`);

  const filled = await cdp.evaluate(`(() => {
    const email = ${JSON.stringify(EMAIL)};
    const password = ${JSON.stringify(PASSWORD)};
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const emailInput = document.querySelector('input[type="email"]');
    const passInput = document.querySelector('input[type="password"]');
    setter.call(emailInput, email);
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(passInput, password);
    passInput.dispatchEvent(new Event('input', { bubbles: true }));
    return { e: emailInput.value.length, p: passInput.value.length };
  })()`);
  console.log("FILL", filled);

  await cdp.evaluate(`document.querySelector('form').requestSubmit()`);

  let final = null;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 500));
    final = await cdp.evaluate(`({
      hash: location.hash,
      hasSession: Boolean(localStorage.getItem('nexora-supabase-auth')),
      preview: (document.body.innerText||'').slice(0, 450)
    })`);
    if (/#\/(dashboard|platform|subscription|change-password)/i.test(final.hash)) break;
    if (/Invalid|Unable|Forbidden|CSRF|SMS|authenticator/i.test(final.preview) && i > 6) break;
  }
  console.log("FINAL", JSON.stringify(final));
  const ok = /#\/(dashboard|platform|subscription|change-password)/i.test(final?.hash || "");
  console.log(ok ? "probe-electron-form-login: PASS" : "probe-electron-form-login: FAIL");
  cdp.close();
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.error("FAIL", err.message || err);
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 1000);
}
