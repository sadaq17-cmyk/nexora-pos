/**
 * Verify a silent-installed public EXE has Supabase baked in (no CONFIG banner).
 * Usage: node scripts/verify-public-install-supabase.mjs "path/to/Nexora POS Pro.exe"
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const exe = path.resolve(process.argv[2] || "");
const port = process.env.NEXORA_CDP_PORT || "9266";

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
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("CDP not ready");
}

async function cdpEvaluate(wsUrl, expression) {
  const WS = globalThis.WebSocket;
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error("CDP timeout"));
    }, 30000);
    let id = 0;
    ws.addEventListener("open", () => {
      id += 1;
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (msg.error) reject(new Error(msg.error.message || "CDP error"));
      else if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.text || "CDP exception"));
      } else resolve(msg.result?.result?.value);
    });
    ws.addEventListener("error", () => reject(new Error("CDP ws error")));
  });
}

if (!exe || !fs.existsSync(exe)) {
  console.error("MISSING", exe);
  process.exit(1);
}

const installRoot = path.dirname(exe);
const unpackedAssets = path.join(installRoot, "resources", "app.asar.unpacked", "dist", "assets");
let foundHost = false;
let foundAnon = false;
if (fs.existsSync(unpackedAssets)) {
  for (const name of fs.readdirSync(unpackedAssets)) {
    if (!name.endsWith(".js")) continue;
    const text = fs.readFileSync(path.join(unpackedAssets, name), "utf8");
    if (text.includes("ohrpezhlnjwiilojdqbo.supabase.co")) foundHost = true;
    if (text.includes("sb_publishable_5IumT6CV")) foundAnon = true;
    if (foundHost && foundAnon) break;
  }
}
console.log("ASSETS", JSON.stringify({ foundHost, foundAnon, unpackedAssets: fs.existsSync(unpackedAssets) }));
if (!foundHost || !foundAnon) {
  console.error("FAIL: packaged assets missing Supabase public config");
  process.exit(1);
}

const child = spawn(exe, [`--remote-debugging-port=${port}`], {
  cwd: installRoot,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  const tab = await waitForCdp();
  let state = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 400));
    state = await cdpEvaluate(
      tab.webSocketDebuggerUrl,
      `({
        href: location.href,
        hash: location.hash,
        text: (document.body && document.body.innerText || '').slice(0, 1800),
        hasLogin: /Sign in/i.test(document.body && document.body.innerText || '') && /Password/i.test(document.body && document.body.innerText || ''),
        configBlocked: /Supabase is not configured/i.test(document.body && document.body.innerText || '')
      })`
    );
    if (state?.hasLogin || state?.configBlocked) break;
  }

  console.log("UI", JSON.stringify({
    hash: state?.hash,
    hasLogin: state?.hasLogin,
    configBlocked: state?.configBlocked,
    preview: String(state?.text || "").slice(0, 200),
  }));

  if (state?.configBlocked) throw new Error('UI shows "Supabase is not configured"');
  if (!state?.hasLogin) throw new Error("Login UI missing");
  if (!String(state?.hash || "").includes("/login")) throw new Error("hash missing /login");

  // Wrong-password submit must hit auth, not config error
  const probe = await cdpEvaluate(
    tab.webSocketDebuggerUrl,
    `(async () => {
      function setNativeValue(el, value) {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const emailInput = document.querySelector('input[type="email"], input[name="email"], input[autocomplete="username"]');
      const passInput = document.querySelector('input[type="password"]');
      const btn = [...document.querySelectorAll('button')].find(b => /sign in|log in/i.test(b.textContent || ''));
      if (!emailInput || !passInput || !btn) return { ok: false, reason: 'form-missing' };
      setNativeValue(emailInput, 'public-installer-probe@example.com');
      setNativeValue(passInput, 'WrongPassword!12345');
      btn.click();
      let text = '';
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 400));
        text = document.body ? document.body.innerText : '';
        if (/Supabase is not configured/i.test(text)) break;
        if (/invalid|credentials|wrong|error|failed|not found|confirm|unable|incorrect/i.test(text)) break;
      }
      return {
        ok: true,
        configBlocked: /Supabase is not configured/i.test(text),
        authError: /invalid|credentials|wrong|error|failed|not found|confirm|unable|incorrect/i.test(text)
      };
    })()`
  );
  console.log("LOGIN_PROBE", JSON.stringify(probe));
  if (!probe?.ok) throw new Error(`login probe failed: ${probe?.reason || "unknown"}`);
  if (probe.configBlocked) throw new Error("Login still blocked by missing Supabase config");

  console.log("verify-public-install-supabase: PASS");
  process.exitCode = 0;
} catch (err) {
  console.error("verify-public-install-supabase: FAIL", err.message || err);
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 800);
}
