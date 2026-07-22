#!/usr/bin/env node
/**
 * Nexora POS Enterprise — production deploy orchestrator
 *
 * Fail-fast pipeline (no git required):
 *   1) lint  → abort on failure
 *   2) build → abort on failure
 *   3) vercel --prod (skipped with --dry-run)
 *   4) HTTP verify key routes
 *   5) write deployment-report.md + append deployments.log
 *
 * Exit 0 only if lint + build + deploy + verification all succeed.
 * Never prints VERCEL_TOKEN.
 *
 * Usage:
 *   node scripts/deploy.mjs
 *   node scripts/deploy.mjs --dry-run
 *   npm run deploy
 *   npm run deploy -- --dry-run
 */

import { spawn } from "node:child_process";
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IS_WIN = process.platform === "win32";

const CUSTOM_DOMAIN = "https://www.httpsnexorapos.com";
const KEY_ROUTES = [
  "/",
  "/login",
  "/dashboard",
  "/pos",
  "/owner-management",
  "/users",
  "/reports",
  "/settings",
  "/settings/login-security",
  "/verify-email-change",
];

const DRY_RUN = process.argv.includes("--dry-run");
const TIMESTAMP = new Date().toISOString();

/** @type {{ step: string, status: string, detail?: string }} */
const status = {
  lint: { status: "PENDING", detail: "" },
  build: { status: "PENDING", detail: "" },
  deploy: { status: "PENDING", detail: "" },
  verify: { status: "PENDING", detail: "" },
};

let productionUrl = null;
let aliasedDomain = CUSTOM_DOMAIN;
/** @type {{ url: string, status: number|string, ok: boolean, attempts: number }[]} */
let routeChecks = [];

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
}

/**
 * Resolve npm/npx to .cmd on Windows so spawn works without a shell when possible.
 */
function resolveCmd(base) {
  if (IS_WIN) {
    return base === "npm" ? "npm.cmd" : base === "npx" ? "npx.cmd" : `${base}.cmd`;
  }
  return base;
}

/**
 * Run a command, capture combined stdout+stderr, return { code, stdout, stderr }.
 * Uses shell:true on Windows so .cmd resolution is reliable across PATH setups.
 */
function run(command, args, { cwd = ROOT, env = process.env, quiet = false } = {}) {
  return new Promise((resolve) => {
    const cmd = resolveCmd(command);
    if (!quiet) {
      log(`\n▶ ${cmd} ${args.join(" ")}`);
    }

    const child = spawn(cmd, args, {
      cwd,
      env,
      shell: IS_WIN,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf) => {
      const text = buf.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (buf) => {
      const text = buf.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (err) => {
      stderr += String(err);
      resolve({ code: 1, stdout, stderr: stderr || String(err) });
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse Vercel CLI output for Production URL and aliased domain.
 */
function parseVercelOutput(text) {
  const urls = [...text.matchAll(/https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\.vercel\.app/g)].map(
    (m) => m[0]
  );
  // Prefer a production-looking URL (often listed after "Production:")
  let prod = null;
  const prodMatch = text.match(/Production[:\s]+(https:\/\/[^\s]+)/i);
  if (prodMatch) {
    prod = prodMatch[1].replace(/[)\],.]+$/, "");
  }
  if (!prod && urls.length) {
    // Last vercel.app URL is typically the production deployment
    prod = urls[urls.length - 1];
  }

  let alias = null;
  const aliasMatch = text.match(
    /(?:Aliased?|Alias|Domains?)[:\s]+(https?:\/\/[^\s]+)/i
  );
  if (aliasMatch) {
    alias = aliasMatch[1].replace(/[)\],.]+$/, "");
  }
  // Also scan for the known custom domain
  if (text.includes("httpsnexorapos.com")) {
    const custom = text.match(/https?:\/\/(?:www\.)?httpsnexorapos\.com[^\s]*/);
    if (custom) alias = custom[0].replace(/[)\],.]+$/, "");
  }

  return { productionUrl: prod, aliasedDomain: alias };
}

/**
 * HTTP GET with retries for cold starts. Treat 200 as pass.
 */
async function checkUrl(url, { retries = 3, backoffMs = 1500 } = {}) {
  let lastStatus = "ERR";
  let attempts = 0;
  for (let i = 0; i < retries; i++) {
    attempts = i + 1;
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "nexora-deploy-verify/1.0" },
      });
      lastStatus = res.status;
      if (res.status === 200) {
        return { url, status: res.status, ok: true, attempts };
      }
    } catch (err) {
      lastStatus = `ERR:${err?.cause?.code || err?.message || "fetch_failed"}`;
    }
    if (i < retries - 1) await sleep(backoffMs * (i + 1));
  }
  return { url, status: lastStatus, ok: false, attempts };
}

async function verifyRoutes(baseUrl) {
  const checks = [];
  const bases = [baseUrl.replace(/\/$/, "")];
  const customBase = CUSTOM_DOMAIN.replace(/\/$/, "");
  if (!bases.includes(customBase)) {
    // Always verify custom domain /login as required
    // Full route set is verified against the deployment URL;
    // custom domain gets /login specifically (plus we include it in the table).
  }

  for (const route of KEY_ROUTES) {
    const url = `${baseUrl.replace(/\/$/, "")}${route === "/" ? "/" : route}`;
    log(`  Checking ${url} ...`);
    const result = await checkUrl(url);
    checks.push(result);
    log(`    → ${result.status} (${result.attempts} attempt(s)) ${result.ok ? "OK" : "FAIL"}`);
  }

  // Custom domain login check
  const customLogin = `${customBase}/login`;
  log(`  Checking ${customLogin} (custom domain) ...`);
  const customResult = await checkUrl(customLogin);
  checks.push(customResult);
  log(
    `    → ${customResult.status} (${customResult.attempts} attempt(s)) ${customResult.ok ? "OK" : "FAIL"}`
  );

  return checks;
}

function writeReport({ overallPass }) {
  const lines = [
    `# Nexora POS — Deployment Report`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Timestamp (UTC) | ${TIMESTAMP} |`,
    `| Mode | ${DRY_RUN ? "DRY-RUN (no production deploy)" : "PRODUCTION" } |`,
    `| Lint | ${status.lint.status}${status.lint.detail ? ` — ${status.lint.detail}` : ""} |`,
    `| Build | ${status.build.status}${status.build.detail ? ` — ${status.build.detail}` : ""} |`,
    `| Deploy | ${status.deploy.status}${status.deploy.detail ? ` — ${status.deploy.detail}` : ""} |`,
    `| Verify | ${status.verify.status}${status.verify.detail ? ` — ${status.verify.detail}` : ""} |`,
    `| Production URL | ${productionUrl || "—"} |`,
    `| Aliased domain | ${aliasedDomain || "—"} |`,
    `| Overall | **${overallPass ? "PASS" : "FAIL"}** |`,
    ``,
    `## Route verification`,
    ``,
    `| URL | Status | Attempts | Result |`,
    `| --- | --- | --- | --- |`,
  ];

  for (const c of routeChecks) {
    lines.push(
      `| ${c.url} | ${c.status} | ${c.attempts} | ${c.ok ? "PASS" : "FAIL"} |`
    );
  }

  if (routeChecks.length === 0) {
    lines.push(`| — | — | — | skipped |`);
  }

  lines.push(``);
  lines.push(`## Notes`);
  lines.push(``);
  if (DRY_RUN) {
    lines.push(
      `- Dry-run mode: lint + build ran; real \`vercel --prod\` was skipped; live URL was verified instead.`
    );
  }
  lines.push(`- Custom domain: ${CUSTOM_DOMAIN}`);
  lines.push(`- Fail-fast: lint or build failure blocks deploy.`);
  lines.push(``);

  const reportPath = join(ROOT, "deployment-report.md");
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  log(`\n📄 Wrote ${reportPath}`);

  const logLine = [
    TIMESTAMP,
    DRY_RUN ? "dry-run" : "prod",
    status.lint.status,
    status.build.status,
    status.deploy.status,
    status.verify.status,
    overallPass ? "PASS" : "FAIL",
    productionUrl || "-",
    aliasedDomain || "-",
  ].join(" | ");

  const logPath = join(ROOT, "deployments.log");
  appendFileSync(logPath, logLine + "\n", "utf8");
  log(`📜 Appended ${logPath}`);
}

function printSummary({ overallPass }) {
  log("\n════════════════════════════════════════");
  log("  NEXORA POS — DEPLOYMENT SUMMARY");
  log("════════════════════════════════════════");
  log(`  Timestamp : ${TIMESTAMP}`);
  log(`  Mode      : ${DRY_RUN ? "DRY-RUN" : "PRODUCTION"}`);
  log(`  Lint      : ${status.lint.status}`);
  log(`  Build     : ${status.build.status}`);
  log(`  Deploy    : ${status.deploy.status}`);
  log(`  Verify    : ${status.verify.status}`);
  log(`  Prod URL  : ${productionUrl || "—"}`);
  log(`  Alias     : ${aliasedDomain || "—"}`);
  if (routeChecks.length) {
    log("  Routes:");
    for (const c of routeChecks) {
      log(`    [${c.ok ? "OK" : "FAIL"}] ${c.status}  ${c.url}`);
    }
  }
  log(`  Overall   : ${overallPass ? "PASS" : "FAIL"}`);
  log("════════════════════════════════════════\n");
}

/**
 * Resolve the currently-live production URL for dry-run verification.
 * Prefer the known custom domain (always live). Optionally try `vercel ls`
 * briefly when a token is present — never block dry-run on CLI auth.
 */
async function discoverLiveUrl() {
  const fallback = {
    productionUrl: CUSTOM_DOMAIN,
    aliasedDomain: CUSTOM_DOMAIN,
  };

  if (!process.env.VERCEL_TOKEN) {
    log("No VERCEL_TOKEN set — verifying custom domain as live production URL.");
    return fallback;
  }

  try {
    const result = await run(
      "npx",
      ["--yes", "vercel", "ls", "--token", process.env.VERCEL_TOKEN],
      { quiet: false }
    );
    if (result.code === 0) {
      const parsed = parseVercelOutput(`${result.stdout}\n${result.stderr}`);
      if (parsed.productionUrl) {
        return {
          productionUrl: parsed.productionUrl,
          aliasedDomain: parsed.aliasedDomain || CUSTOM_DOMAIN,
        };
      }
    }
  } catch (err) {
    log(`vercel ls skipped (${err?.message || err}); using custom domain.`);
  }

  return fallback;
}

async function main() {
  log(`Nexora POS deploy orchestrator — ${TIMESTAMP}`);
  if (DRY_RUN) {
    log("Mode: DRY-RUN (lint + build + verify live URL; skip vercel --prod)");
  }

  // Ensure scripts dir exists (no-op if present)
  if (!existsSync(join(ROOT, "scripts"))) {
    mkdirSync(join(ROOT, "scripts"), { recursive: true });
  }

  // ─── 1) LINT ───────────────────────────────────────────────
  log("\n═══ Step 1/4: Lint ═══");
  const lint = await run("npm", ["run", "lint"]);
  if (lint.code !== 0) {
    status.lint = { status: "FAIL", detail: `exit ${lint.code}` };
    status.build = { status: "SKIPPED", detail: "blocked by lint" };
    status.deploy = { status: "SKIPPED", detail: "blocked by lint" };
    status.verify = { status: "SKIPPED", detail: "blocked by lint" };
    fail("Lint failed — aborting. Build and deploy were NOT run.");
    writeReport({ overallPass: false });
    printSummary({ overallPass: false });
    process.exit(1);
  }
  status.lint = { status: "PASS", detail: "" };
  log("✓ Lint passed");

  // ─── 2) BUILD ──────────────────────────────────────────────
  log("\n═══ Step 2/4: Production build ═══");
  const build = await run("npm", ["run", "build"]);
  if (build.code !== 0) {
    status.build = { status: "FAIL", detail: `exit ${build.code}` };
    status.deploy = { status: "SKIPPED", detail: "blocked by build" };
    status.verify = { status: "SKIPPED", detail: "blocked by build" };
    fail("Build failed — aborting. Deploy was NOT run.");
    writeReport({ overallPass: false });
    printSummary({ overallPass: false });
    process.exit(1);
  }
  status.build = { status: "PASS", detail: "" };
  log("✓ Build passed");

  // ─── 3) DEPLOY ─────────────────────────────────────────────
  log("\n═══ Step 3/4: Deploy to Vercel Production ═══");
  if (DRY_RUN) {
    log("DRY-RUN: skipping `vercel --prod`. Discovering currently-live URL…");
    const live = await discoverLiveUrl();
    productionUrl = live.productionUrl || CUSTOM_DOMAIN;
    aliasedDomain = live.aliasedDomain || CUSTOM_DOMAIN;
    status.deploy = {
      status: "SKIPPED (dry-run)",
      detail: `verified live URL ${productionUrl}`,
    };
    log(`✓ Dry-run deploy skipped. Live URL: ${productionUrl}`);
  } else {
    const tokenArgs =
      process.env.VERCEL_TOKEN && !String(process.env.VERCEL_TOKEN).includes("\n")
        ? ["--token", process.env.VERCEL_TOKEN]
        : [];
    // Never log the token value
    const displayArgs = ["--yes", "vercel", "--prod", "--yes", ...(tokenArgs.length ? ["--token", "***"] : [])];
    log(`▶ npx ${displayArgs.join(" ")}`);

    const deploy = await run("npx", ["--yes", "vercel", "--prod", "--yes", ...tokenArgs]);
    const combined = `${deploy.stdout}\n${deploy.stderr}`;
    const parsed = parseVercelOutput(combined);
    productionUrl = parsed.productionUrl;
    if (parsed.aliasedDomain) aliasedDomain = parsed.aliasedDomain;

    if (deploy.code !== 0 || !productionUrl) {
      status.deploy = {
        status: "FAIL",
        detail: deploy.code !== 0 ? `exit ${deploy.code}` : "no production URL parsed",
      };
      status.verify = { status: "SKIPPED", detail: "blocked by deploy" };
      fail("Deploy failed — verification skipped.");
      writeReport({ overallPass: false });
      printSummary({ overallPass: false });
      process.exit(1);
    }
    status.deploy = { status: "PASS", detail: productionUrl };
    log(`✓ Deployed: ${productionUrl}`);
    if (aliasedDomain) log(`  Alias: ${aliasedDomain}`);
  }

  // ─── 4) VERIFY ─────────────────────────────────────────────
  log("\n═══ Step 4/4: Verify production URL ═══");
  if (!productionUrl) {
    status.verify = { status: "FAIL", detail: "no URL to verify" };
    fail("No production URL available for verification.");
    writeReport({ overallPass: false });
    printSummary({ overallPass: false });
    process.exit(1);
  }

  routeChecks = await verifyRoutes(productionUrl);
  const allOk = routeChecks.every((c) => c.ok);
  if (!allOk) {
    status.verify = {
      status: "FAIL",
      detail: `${routeChecks.filter((c) => !c.ok).length} route(s) failed`,
    };
    fail("Verification failed — one or more routes did not return HTTP 200.");
    writeReport({ overallPass: false });
    printSummary({ overallPass: false });
    process.exit(1);
  }
  status.verify = { status: "PASS", detail: `${routeChecks.length} checks OK` };
  log("✓ Verification passed");

  writeReport({ overallPass: true });
  printSummary({ overallPass: true });
  process.exit(0);
}

main().catch((err) => {
  fail(`Unexpected error: ${err?.message || err}`);
  status.verify = { status: "FAIL", detail: String(err?.message || err) };
  try {
    writeReport({ overallPass: false });
    printSummary({ overallPass: false });
  } catch {
    /* ignore report write errors during crash */
  }
  process.exit(1);
});
