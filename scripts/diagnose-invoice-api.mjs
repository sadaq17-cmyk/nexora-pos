/**
 * Diagnose production invoice_verifications access. Never prints secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.production.local");
if (!existsSync(envPath)) {
  console.error("Missing .env.production.local — run vercel env pull first");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [line.slice(0, i).trim(), v];
    })
);

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

console.log("url_host=", (() => {
  try {
    return new URL(url).host;
  } catch {
    return "INVALID";
  }
})());
console.log("service_key_len=", service ? service.length : 0);
console.log("anon_key_len=", anon ? anon.length : 0);

if (!url || !service) {
  console.error("CONFIG_MISSING");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const probe = await admin.from("invoice_verifications").select("receipt_no").limit(1);
console.log("select_error=", probe.error ? JSON.stringify({
  message: probe.error.message,
  code: probe.error.code,
  details: probe.error.details,
  hint: probe.error.hint,
}) : null);
console.log("select_rows=", Array.isArray(probe.data) ? probe.data.length : null);

const maybe = await admin.from("invoice_verifications").select("*").eq("receipt_no", "NX-TEST").maybeSingle();
console.log("maybe_error=", maybe.error ? JSON.stringify({
  message: maybe.error.message,
  code: maybe.error.code,
  details: maybe.error.details,
  hint: maybe.error.hint,
}) : null);
console.log("maybe_data=", maybe.data ? "present" : null);

// List tables via OpenAPI if available
try {
  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
    },
  });
  console.log("openapi_status=", r.status);
  if (r.ok) {
    const spec = await r.json();
    const paths = Object.keys(spec.paths || {});
    console.log("has_invoice_verifications_path=", paths.some((p) => p.includes("invoice_verifications")));
    console.log("sample_paths=", paths.filter((p) => p.includes("invoice") || p.includes("profile")).slice(0, 20));
  }
} catch (e) {
  console.log("openapi_error=", e.message);
}
