/**
 * Apply 003_invoice_verifications.sql to the linked Supabase project.
 * Uses env from .env.production.local (never prints secrets).
 *
 * Prefers SUPABASE_ACCESS_TOKEN + Management API SQL endpoint when available.
 * Falls back to reporting exact PostgREST error for operators.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.production.local");
const sqlPath = join(root, "supabase", "migrations", "003_invoice_verifications.sql");

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // Vercel sometimes wraps values; strip BOM
    val = val.replace(/^\uFEFF/, "");
    out[key] = val;
  }
  return out;
}

const env = { ...process.env, ...loadEnv(envPath) };
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
const service = env.SUPABASE_SERVICE_ROLE_KEY || "";
const accessToken = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PAT || "";
const sql = readFileSync(sqlPath, "utf8");

let projectRef = env.SUPABASE_PROJECT_REF || "";
try {
  if (url && /^https?:\/\//i.test(url)) {
    projectRef = projectRef || new URL(url).hostname.split(".")[0];
  }
} catch {
  /* ignore */
}

console.log("url_valid=", /^https?:\/\//i.test(url));
console.log("service_present=", Boolean(service && service.length > 40));
console.log("project_ref_len=", projectRef.length);
console.log("access_token_present=", Boolean(accessToken));

async function probe() {
  if (!/^https?:\/\//i.test(url) || !service) {
    return { ok: false, reason: "CONFIG" };
  }
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.from("invoice_verifications").select("receipt_no").limit(1);
  if (!error) return { ok: true };
  return {
    ok: false,
    code: error.code,
    message: error.message,
  };
}

const before = await probe();
console.log("before=", JSON.stringify(before));
if (before.ok) {
  console.log("TABLE_ALREADY_EXISTS");
  process.exit(0);
}

// 1) Management API (requires personal access token)
if (accessToken && projectRef) {
  console.log("Trying Management API SQL…");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  console.log("mgmt_status=", res.status);
  console.log("mgmt_body_len=", text.length);
  if (!res.ok) {
    console.log("mgmt_failed_head=", text.slice(0, 200).replace(/\s+/g, " "));
  }
}

// 2) supabase CLI db query if available and linked
const cli = spawnSync(
  "npx",
  ["--yes", "supabase", "db", "query", "--linked", "-f", sqlPath],
  { cwd: root, encoding: "utf8", shell: true }
);
console.log("cli_status=", cli.status);
if (cli.stdout) console.log("cli_stdout_head=", cli.stdout.slice(0, 300).replace(/\s+/g, " "));
if (cli.stderr) console.log("cli_stderr_head=", cli.stderr.slice(0, 300).replace(/\s+/g, " "));

const after = await probe();
console.log("after=", JSON.stringify(after));

if (!after.ok) {
  // Write a one-shot SQL file operators can paste into Supabase SQL editor
  const out = join(root, "supabase", "APPLY_003_IN_DASHBOARD.sql");
  writeFileSync(out, sql, "utf8");
  console.error("MIGRATION_NOT_APPLIED — open Supabase SQL Editor and run supabase/migrations/003_invoice_verifications.sql");
  process.exit(2);
}

console.log("MIGRATION_APPLIED_OK");
