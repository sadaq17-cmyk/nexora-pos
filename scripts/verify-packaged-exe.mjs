/**
 * Launch packaged win-unpacked EXE; assert file:// dist/index.html#/login + Login UI (no 404).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "release", "dist", "win-unpacked", "Nexora POS Pro.exe");
const port = process.env.NEXORA_CDP_PORT || "9244";

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

if (!fs.existsSync(exe)) {
  console.error("MISSING", exe);
  process.exit(1);
}

// Confirm unpacked dist exists
const unpackedIndex = path.join(
  root,
  "release",
  "dist",
  "win-unpacked",
  "resources",
  "app.asar.unpacked",
  "dist",
  "index.html"
);
const asarIndexHint = path.join(root, "release", "dist", "win-unpacked", "resources", "app.asar");
console.log("unpacked dist/index.html", fs.existsSync(unpackedIndex) ? "YES" : "NO");
console.log("app.asar", fs.existsSync(asarIndexHint) ? "YES" : "NO");

const child = spawn(exe, [`--remote-debugging-port=${port}`], {
  cwd: path.dirname(exe),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => { stderr += String(d); });

try {
  const tab = await waitForCdp();
  console.log("PACKAGED_URL", tab.url);

  if (/^https?:/i.test(tab.url)) {
    throw new Error(`EXE loaded HTTP URL (forbidden): ${tab.url}`);
  }
  if (!tab.url.startsWith("file:")) {
    throw new Error(`Expected file:// dist/index.html, got: ${tab.url}`);
  }
  if (!/index\.html/i.test(tab.url)) {
    throw new Error(`Expected dist/index.html in URL, got: ${tab.url}`);
  }
  if (!String(tab.url).includes("#/login") && !String(tab.url).includes("#%2Flogin")) {
    // hash may appear after navigate
    console.log("WARN: initial CDP url missing #/login — will check after paint");
  }

  let state = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 400));
    state = await cdpEvaluate(tab.webSocketDebuggerUrl, `({
      href: location.href,
      protocol: location.protocol,
      hash: location.hash,
      text: (document.body && document.body.innerText || '').slice(0, 1200),
      forceHash: Boolean(window.__NEXORA_FORCE_HASH__),
      desktopBuild: Boolean(window.__NEXORA_DESKTOP_BUILD__),
      hasDesktop: Boolean(window.nexoraDesktop)
    })`);
    if (/Sign in/i.test(state.text) && /Password/i.test(state.text)) break;
    if (/That page does(?: not|n't) exist/i.test(state.text) && !/Sign in/i.test(state.text)) break;
  }

  console.log("STATE", JSON.stringify({
    href: state.href,
    protocol: state.protocol,
    hash: state.hash,
    forceHash: state.forceHash,
    desktopBuild: state.desktopBuild,
    hasDesktop: state.hasDesktop,
    preview: String(state.text || "").slice(0, 180),
  }));

  if (state.protocol !== "file:") throw new Error("protocol must be file:");
  if (!String(state.hash || "").includes("/login")) throw new Error("hash must be #/login");
  if (!state.forceHash && !state.desktopBuild) throw new Error("HashRouter boot flags missing");
  if (!/Sign in/i.test(state.text) || !/Password/i.test(state.text)) throw new Error("Login UI missing");
  if (/That page does(?: not|n't) exist/i.test(state.text) && !/Sign in/i.test(state.text)) {
    throw new Error("404 page shown");
  }

  // Unknown hash must redirect to login, never show 404 chrome
  const unknown = await cdpEvaluate(
    tab.webSocketDebuggerUrl,
    `(async () => {
      location.hash = '#/this-route-does-not-exist-xyz';
      await new Promise(r => setTimeout(r, 900));
      const text = document.body ? document.body.innerText : '';
      return {
        hash: location.hash,
        has404Number: /\\b404\\b/.test(text) && /does(?: not|n't) exist/i.test(text),
        hasLogin: /Sign in/i.test(text) && /Password/i.test(text)
      };
    })()`
  );
  console.log("UNKNOWN_ROUTE", unknown);
  if (unknown.has404Number) throw new Error("Unknown route showed 404 page");
  if (!unknown.hasLogin && !String(unknown.hash || "").includes("/login")) {
    throw new Error("Unknown route did not recover to login");
  }

  console.log("verify-packaged-exe: PASS");
  process.exitCode = 0;
} catch (err) {
  console.error("verify-packaged-exe: FAIL", err.message || err);
  if (stderr) console.error(stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 800);
}
