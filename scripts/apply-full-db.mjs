/**
 * Attempt to apply supabase/APPLY_PRODUCTION_DB_FULL.sql to production.
 * Never prints secrets. Exhausts: Management API, supabase CLI, then reports dashboard paste.
 *
 * Usage:
 *   node scripts/apply-full-db.mjs
 *   npx vercel env run -e production -- node scripts/apply-full-db.mjs
 *
 * Optional env:
 *   SUPABASE_ACCESS_TOKEN / SUPABASE_PAT — Management API SQL
 *   VITE_SUPABASE_URL / SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — post-apply probe
 *   SUPABASE_PROJECT_REF — defaults from URL hostname
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = join(root, "supabase", "APPLY_PRODUCTION_DB_FULL.sql");

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim().replace(/^\uFEFF/, "");
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val && val !== "[SENSITIVE]") out[key] = val;
  }
  return out;
}

const fileEnv = {
  ...loadEnvFile(join(root, ".env.local")),
  ...loadEnvFile(join(root, ".env.production.local")),
  ...loadEnvFile(join(root, ".env.vercel.runtime")),
};
const env = { ...fileEnv, ...process.env };

const url = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || "https://ohrpezhlnjwiilojdqbo.supabase.co").trim();
const service = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const accessToken = String(env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PAT || "").trim();
const sql = readFileSync(sqlPath, "utf8");

let projectRef = String(env.SUPABASE_PROJECT_REF || "").trim();
try {
  if (url && /^https?:\/\//i.test(url)) {
    projectRef = projectRef || new URL(url).hostname.split(".")[0];
  }
} catch {
  /* ignore */
}

const TABLES = [
  "products",
  "categories",
  "suppliers",
  "customers",
  "sales",
  "companies",
  "invoice_verifications",
  "stock_movements",
];

async function probe(label) {
  if (!/^https?:\/\//i.test(url) || !service || service.length < 40 || /SENSITIVE/i.test(service)) {
    console.log(label, "SKIP_NO_SERVICE_ROLE");
    return { ok: false, reason: "NO_SERVICE" };
  }
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const checks = {};
  let okCount = 0;
  for (const t of TABLES) {
    const { error } = await admin.from(t).select("*").limit(1);
    const ok = !error;
    if (ok) okCount += 1;
    checks[t] = ok ? "OK" : `${error.code}:${String(error.message || "").slice(0, 80)}`;
  }
  console.log(label, JSON.stringify({ okCount, total: TABLES.length, checks }));
  return { ok: okCount === TABLES.length, okCount, checks };
}

console.log("sql_bytes=", Buffer.byteLength(sql));
console.log("project_ref=", projectRef);
console.log("url_ok=", /^https?:\/\//i.test(url));
console.log("service_ok=", service.length > 40 && !/SENSITIVE/i.test(service));
console.log("access_token_ok=", accessToken.length > 20);

const before = await probe("before");
if (before.ok) {
  console.log("SCHEMA_ALREADY_COMPLETE");
  process.exit(0);
}

let applied = false;

if (accessToken && projectRef) {
  console.log("Trying Management API database/query…");
  // Split into chunks if needed — Management API may reject huge payloads;
  // try full file first.
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  console.log("mgmt_status=", res.status, "body_len=", text.length);
  if (!res.ok) console.log("mgmt_head=", text.slice(0, 240).replace(/\s+/g, " "));
  else applied = true;
}

const cli = spawnSync(
  "npx",
  ["--yes", "supabase", "db", "query", "--linked", "-f", sqlPath],
  { cwd: root, encoding: "utf8", shell: true, timeout: 120000 }
);
console.log("cli_status=", cli.status);
if (cli.stdout) console.log("cli_stdout_head=", cli.stdout.slice(0, 240).replace(/\s+/g, " "));
if (cli.stderr) console.log("cli_stderr_head=", cli.stderr.slice(0, 240).replace(/\s+/g, " "));
if (cli.status === 0) applied = true;

const after = await probe("after");
if (after.ok) {
  console.log("MIGRATION_APPLIED_OK");
  process.exit(0);
}

console.error("MIGRATION_NOT_APPLIED");
console.error("BLOCKER: No usable SUPABASE_ACCESS_TOKEN / linked supabase CLI / service-role DDL path.");
console.error("ACTION: Open Supabase Dashboard → SQL Editor for project", projectRef);
console.error("Paste and run: supabase/APPLY_PRODUCTION_DB_FULL.sql");
process.exit(applied ? 3 : 2);
