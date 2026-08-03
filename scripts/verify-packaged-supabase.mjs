/**
 * Launch packaged EXE and assert Supabase client is configured (no CONFIG error).
 * Never prints secret values.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionEnv, requireViteSupabaseEnv } from "./loadDotEnv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "release", "dist", "win-unpacked", "Nexora POS Pro.exe");
const unpackedAssets = path.join(
  root,
  "release",
  "dist",
  "win-unpacked",
  "resources",
  "app.asar.unpacked",
  "dist",
  "assets"
);
const port = process.env.NEXORA_CDP_PORT || "9245";

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

function assertPackagedAssetsHaveSupabase() {
  const required = requireViteSupabaseEnv(loadProductionEnv().env);
  if (!required.ok) throw new Error(`env incomplete: ${required.problems.join("; ")}`);
  if (!fs.existsSync(unpackedAssets)) throw new Error(`missing ${unpackedAssets}`);
  const host = required.meta.urlHost;
  const anonPrefix = required.anon.slice(0, 12);
  let foundHost = false;
  let foundAnon = false;
  for (const name of fs.readdirSync(unpackedAssets)) {
    if (!name.endsWith(".js")) continue;
    const text = fs.readFileSync(path.join(unpackedAssets, name), "utf8");
    if (host && text.includes(host)) foundHost = true;
    if (anonPrefix && text.includes(anonPrefix)) foundAnon = true;
    if (foundHost && foundAnon) break;
  }
  console.log("ASSETS", JSON.stringify({ host, foundHost, foundAnon }));
  if (!foundHost || !foundAnon) throw new Error("Packaged assets missing Supabase config");
  return required;
}

if (!fs.existsSync(exe)) {
  console.error("MISSING", exe);
  process.exit(1);
}

assertPackagedAssetsHaveSupabase();

const child = spawn(exe, [`--remote-debugging-port=${port}`], {
  cwd: path.dirname(exe),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => { stderr += String(d); });

try {
  const tab = await waitForCdp();
  let state = null;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 400));
    state = await cdpEvaluate(
      tab.webSocketDebuggerUrl,
      `({
        hash: location.hash,
        text: (document.body && document.body.innerText || '').slice(0, 1500),
        hasLogin: /Sign in/i.test(document.body && document.body.innerText || ''),
        configBlocked: /Supabase is not configured/i.test(document.body && document.body.innerText || '')
      })`
    );
    if (state?.hasLogin || state?.configBlocked) break;
  }

  console.log("UI", JSON.stringify({
    hash: state?.hash,
    hasLogin: state?.hasLogin,
    configBlocked: state?.configBlocked,
    preview: String(state?.text || "").slice(0, 160),
  }));

  if (!state?.hasLogin) throw new Error("Login UI missing");
  if (state.configBlocked) throw new Error("UI still shows Supabase is not configured");

  // Fill invalid credentials and submit — must reach auth layer (not CONFIG).
  const loginProbe = await cdpEvaluate(
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
      setNativeValue(emailInput, 'electron-config-probe@example.com');
      setNativeValue(passInput, 'WrongPassword!12345');
      btn.click();
      let text = '';
      for (let i = 0; i < 20; i++) {
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
  console.log("LOGIN_PROBE", JSON.stringify(loginProbe));
  if (!loginProbe?.ok) throw new Error(`Login form probe failed: ${loginProbe?.reason || "unknown"}`);
  if (loginProbe.configBlocked) throw new Error("Login still blocked by missing Supabase config");

  // Network reachability of project auth endpoint (public)
  const required = requireViteSupabaseEnv(loadProductionEnv().env);
  const baseUrl = required.url.replace(/\/$/, "");
  try {
    const res = await fetch(`${baseUrl}/auth/v1/health`, {
      headers: {
        apikey: required.anon,
        Authorization: `Bearer ${required.anon}`,
      },
    });
    console.log("AUTH_HEALTH", JSON.stringify({ status: res.status, ok: res.status > 0 && res.status < 500 }));
    if (!(res.status > 0 && res.status < 500)) {
      throw new Error(`Supabase auth health unexpected status ${res.status}`);
    }
  } catch (err) {
    const res = await fetch(`${baseUrl}/auth/v1/settings`, {
      headers: {
        apikey: required.anon,
        Authorization: `Bearer ${required.anon}`,
      },
    });
    console.log("AUTH_SETTINGS", JSON.stringify({ status: res.status }));
    if (!(res.status > 0 && res.status < 500)) {
      throw new Error(`Supabase unreachable: ${err.message || err}`);
    }
  }

  console.log("verify-packaged-supabase: PASS");
  process.exitCode = 0;
} catch (err) {
  console.error("verify-packaged-supabase: FAIL", err.message || err);
  if (stderr) console.error(stderr.slice(-1500));
  process.exitCode = 1;
} finally {
  try {
    if (!child.killed) child.kill("SIGTERM");
  } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 1200);
}
