/**
 * Desktop routing smoke test (local hash shell).
 * Launches Electron with --local + CDP, asserts Login UI and no SPA 404,
 * then checks key hash routes render without NotFound.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = path.join(root, "dist", "index.html");
const port = process.env.NEXORA_CDP_PORT || "9233";
const electronBin = path.join(
  root,
  "node_modules",
  "electron",
  "cli.js"
);

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
}

async function waitForCdp(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const raw = await get(`http://127.0.0.1:${port}/json`);
      const tabs = JSON.parse(raw);
      if (Array.isArray(tabs) && tabs[0]?.webSocketDebuggerUrl) return tabs[0];
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("CDP not ready");
}

async function cdpEvaluate(wsUrl, expression) {
  const WS = globalThis.WebSocket;
  if (!WS) throw new Error("WebSocket not available in this Node version");
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error("CDP evaluate timeout"));
    }, 15000);
    let id = 0;
    ws.addEventListener("open", () => {
      id += 1;
      ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      );
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (msg.error) reject(new Error(msg.error.message || "CDP error"));
      else resolve(msg.result?.result?.value);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP WebSocket error"));
    });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

if (!fs.existsSync(distIndex)) {
  console.error("dist/index.html missing — run vite build first");
  process.exit(1);
}
if (!fs.existsSync(electronBin)) {
  console.error("electron package missing — run npm install");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    electronBin,
    path.join(root, "electron", "main.cjs"),
    `--remote-debugging-port=${port}`,
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

let stderr = "";
child.stderr.on("data", (d) => {
  stderr += String(d);
});
child.stdout.on("data", (d) => {
  process.stdout.write(d);
});

const ROUTES = [
  "/login",
  "/dashboard",
  "/pos",
  "/purchases",
  "/customers",
  "/suppliers",
  "/inventory",
  "/reports",
  "/settings",
  "/platform",
  "/platform/companies",
];

try {
  const tab = await waitForCdp();
  console.log("CDP URL", tab.url);

  // Wait for React lazy routes on file:// (slower than https).
  let loginState = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    loginState = await cdpEvaluate(
      tab.webSocketDebuggerUrl,
      `({
        href: location.href,
        protocol: location.protocol,
        hash: location.hash,
        text: (document.body && document.body.innerText || '').slice(0, 1200),
        hasDesktop: Boolean(window.nexoraDesktop),
        forceHash: Boolean(window.nexoraDesktop && window.nexoraDesktop.forceHashRouter),
        scriptErrors: window.__nexoraBootError || null
      })`
    );
    if (/Sign in/i.test(loginState.text) && /Password/i.test(loginState.text)) break;
    if (/That page does(?: not|n't) exist/i.test(loginState.text)) break;
  }

  console.log("LOGIN_STATE", JSON.stringify({
    href: loginState.href,
    protocol: loginState.protocol,
    hash: loginState.hash,
    hasDesktop: loginState.hasDesktop,
    forceHash: loginState.forceHash,
    textPreview: String(loginState.text || "").slice(0, 160),
  }));

  assert(
    loginState.protocol === "nexora:" || loginState.protocol === "file:",
    "expected nexora:// or file:// local shell"
  );
  assert(String(loginState.hash || "").includes("/login") || /Sign in/i.test(loginState.text), "expected #/login");
  assert(!/That page does(?: not|n't) exist/i.test(loginState.text), "SPA 404 on login");
  assert(/Sign in/i.test(loginState.text) && /Password/i.test(loginState.text), "Login UI missing — offline shell failed to load modules");
  assert(loginState.hasDesktop === true, "nexoraDesktop bridge missing");
  console.log("PASS login shell (no 404)");

  for (const route of ROUTES) {
    const result = await cdpEvaluate(
      tab.webSocketDebuggerUrl,
      `(async () => {
        location.hash = ${JSON.stringify("#" + route)};
        await new Promise(r => setTimeout(r, 900));
        const text = (document.body && document.body.innerText || '');
        return {
          href: location.href,
          hash: location.hash,
          has404: /That page does(?: not|n't) exist/i.test(text) && !/Sign in/i.test(text),
          snippet: text.slice(0, 180)
        };
      })()`
    );
    console.log("ROUTE", route, result.has404 ? "FAIL_404" : "OK", result.hash);
    assert(!result.has404, `404 on ${route}`);
  }

  console.log("electron-desktop-verify: PASS");
  process.exitCode = 0;
} catch (err) {
  console.error("electron-desktop-verify: FAIL", err.message || err);
  if (stderr) console.error(stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  // Ensure exit
  setTimeout(() => process.exit(process.exitCode || 0), 500);
}
