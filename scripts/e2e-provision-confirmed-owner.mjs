/**
 * Provisions a confirmed Supabase Auth company owner for live E2E when
 * Supabase signup email rate limits block public signup.
 * Reads .env.local (from `vercel env pull`) — never prints secret values.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(path) {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run: npx vercel env pull .env.local --environment=production`);
  const env = {};
  for (const raw of readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf("=");
    if (eq < 1) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Vercel sometimes stores JSON-escaped strings
    value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    env[key] = value;
  }
  return env;
}

const env = {
  ...loadEnvLocal(resolve(process.cwd(), ".env.local")),
  ...process.env,
};
const url = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").trim();
const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
console.error(JSON.stringify({
  debug: {
    urlPresent: Boolean(url),
    urlLooksValid: /^https?:\/\//i.test(url),
    serviceKeyPresent: Boolean(serviceKey),
    serviceKeyLen: serviceKey.length,
  },
}));
if (!url || !serviceKey) {
  console.error(JSON.stringify({ ok: false, error: "Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local" }));
  process.exit(1);
}

const ts = Date.now();
const email = `qa.owner.${ts}@gmail.com`;
const password = `QaLive${String(ts).slice(-8)}!`;
const companyId = 1;
const branchId = 1;
const username = `qaowner${String(ts).slice(-6)}`;

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: {
    role: "owner",
    company_id: companyId,
    branch_id: branchId,
    username,
    name: "QA Live Owner",
    phone: "+254711000222",
    active: true,
    created_by_name: "E2E provision",
  },
  user_metadata: { name: "QA Live Owner" },
});

if (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
}

const out = {
  ok: true,
  email,
  password,
  username,
  company_id: companyId,
  branch_id: branchId,
  user_id: data.user.id,
  company_code_hint: "seed company id 1 (Nexora POS Enterprise) — resolve code from browser localStorage",
};
const outPath = resolve(process.cwd(), "scripts/.e2e-credentials.json");
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, email, username, company_id: companyId, user_id: data.user.id, credentials_file: "scripts/.e2e-credentials.json" }));
