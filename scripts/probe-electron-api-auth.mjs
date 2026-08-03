/**
 * From packaged EXE renderer: prove desktop attestation reaches production /api
 * without CSRF/CORS failures. Does not require user credentials.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "release", "dist", "win-unpacked", "Nexora POS Pro.exe");
const port = process.env.NEXORA_CDP_PORT || "9251";

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

async function cdpEvaluate(wsUrl, expression) {
  const WS = globalThis.WebSocket;
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error("CDP timeout"));
    }, 60000);
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

if (!fs.existsSync(exe)) {
  console.error("MISSING", exe);
  process.exit(1);
}

const child = spawn(exe, [`--remote-debugging-port=${port}`], {
  cwd: path.dirname(exe),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  const tab = await waitForCdp();
  await new Promise((r) => setTimeout(r, 2000));

  const state = await cdpEvaluate(
    tab.webSocketDebuggerUrl,
    `(async () => {
      const desktop = window.nexoraDesktop || null;
      const attestation = desktop?.desktopAttestation || 'nexora-desktop-v1';
      const origin = desktop?.apiOrigin || 'https://www.nexorapospro.com';
      const headers = {
        'Content-Type': 'application/json',
        'X-Nexora-Desktop': attestation
      };
      async function probe(path, body) {
        try {
          const res = await fetch(origin + path, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
          });
          const text = await res.text();
          let json = null;
          try { json = JSON.parse(text); } catch {}
          return {
            status: res.status,
            code: json?.code || null,
            success: json?.success,
            csrf: json?.code === 'CSRF_ORIGIN' || /Forbidden origin/i.test(text),
            preview: text.slice(0, 160)
          };
        } catch (err) {
          return { status: 0, error: String(err?.message || err), csrf: false };
        }
      }
      const resolveEmail = await probe('/api/resolve-login-email', {
        identifier: 'support@httpsnexorapos.com',
        company_id: 'platform',
        scope: 'platform'
      });
      const resolveCompany = await probe('/api/bootstrap-company-owner', {
        action: 'resolve_company',
        company_code: 'NEXORA001'
      });
      const posPublic = await probe('/api/pos', { action: 'health.probe' });
      // Without attestation — must fail CSRF when Origin is null
      let without = null;
      try {
        const res = await fetch(origin + '/api/resolve-login-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'x@y.com', scope: 'platform', company_id: 'platform' })
        });
        const json = await res.json().catch(() => ({}));
        without = { status: res.status, code: json?.code || null };
      } catch (err) {
        without = { status: 0, error: String(err?.message || err) };
      }
      return {
        protocol: location.protocol,
        hasDesktop: Boolean(desktop),
        attestation,
        resolveEmail,
        resolveCompany,
        posPublic,
        withoutAttestation: without
      };
    })()`
  );

  console.log("PROBE", JSON.stringify(state, null, 2));

  const ok =
    state?.hasDesktop &&
    state?.resolveEmail?.status === 200 &&
    !state?.resolveEmail?.csrf &&
    state?.resolveCompany?.status === 200 &&
    !state?.resolveCompany?.csrf &&
    // pos may return business errors, but must not be CSRF-blocked
    !state?.posPublic?.csrf &&
    state?.withoutAttestation?.code === "CSRF_ORIGIN";

  if (!ok) {
    console.error("probe-electron-api-auth: FAIL");
    process.exitCode = 1;
  } else {
    console.log("probe-electron-api-auth: PASS");
    process.exitCode = 0;
  }
} catch (err) {
  console.error("probe-electron-api-auth: FAIL", err.message || err);
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 1000);
}
