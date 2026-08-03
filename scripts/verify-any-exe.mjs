/**
 * Launch any Electron EXE with CDP; assert Login vs 404.
 * Usage: node scripts/verify-any-exe.mjs "path/to/app.exe" [--expect-login|--expect-404]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const exe = path.resolve(process.argv[2] || "");
const expect404 = process.argv.includes("--expect-404");
const expectLogin = process.argv.includes("--expect-login") || !expect404;
const port = process.env.NEXORA_CDP_PORT || "9255";

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
    }, 25000);
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
      else resolve(msg.result?.result?.value);
    });
    ws.addEventListener("error", () => reject(new Error("CDP ws error")));
  });
}

if (!exe || !fs.existsSync(exe)) {
  console.error("MISSING exe", exe);
  process.exit(1);
}

console.log("EXE", exe);
const child = spawn(exe, [`--remote-debugging-port=${port}`], {
  cwd: path.dirname(exe),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  const tab = await waitForCdp();
  console.log("CDP_URL", tab.url);

  let state = null;
  for (let i = 0; i < 70; i++) {
    await new Promise((r) => setTimeout(r, 400));
    state = await cdpEvaluate(tab.webSocketDebuggerUrl, `({
      href: location.href,
      protocol: location.protocol,
      pathname: location.pathname,
      hash: location.hash,
      text: (document.body && document.body.innerText || '').slice(0, 1500),
      forceHash: Boolean(window.__NEXORA_FORCE_HASH__),
      desktopBuild: Boolean(window.__NEXORA_DESKTOP_BUILD__),
      hasDesktop: Boolean(window.nexoraDesktop)
    })`);
    const hasLogin = /Sign in/i.test(state.text) && /Password/i.test(state.text);
    const has404 =
      (/That page does(?: not|n't) exist/i.test(state.text) ||
        (/\b404\b/.test(state.text) && /does(?: not|n't) exist/i.test(state.text))) &&
      !hasLogin;
    if (hasLogin || has404) break;
  }

  const hasLogin = /Sign in/i.test(state.text) && /Password/i.test(state.text);
  const has404 =
    (/That page does(?: not|n't) exist/i.test(state.text) ||
      (/\b404\b/.test(state.text) && /does(?: not|n't) exist/i.test(state.text))) &&
    !hasLogin;

  console.log("STATE", JSON.stringify({
    href: state.href,
    protocol: state.protocol,
    pathname: state.pathname,
    hash: state.hash,
    forceHash: state.forceHash,
    desktopBuild: state.desktopBuild,
    hasDesktop: state.hasDesktop,
    hasLogin,
    has404,
    preview: String(state.text || "").slice(0, 220),
  }));

  if (expect404) {
    if (!has404) throw new Error("Expected 404 page but Login/other shown");
    console.log("verify-any-exe: PASS (confirmed 404 on public build)");
  } else if (expectLogin) {
    if (has404) throw new Error("404 page shown");
    if (!hasLogin) throw new Error("Login UI missing");
    if (!String(state.hash || "").includes("/login")) throw new Error("hash must include /login");
    console.log("verify-any-exe: PASS (Login OK)");
  }
  process.exitCode = 0;
} catch (err) {
  console.error("verify-any-exe: FAIL", err.message || err);
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 800);
}
