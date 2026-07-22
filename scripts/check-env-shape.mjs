/**
 * Reports whether env keys look usable — never prints secret values.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [".env.vercel.runtime", ".env.production.local", ".env.local"];

function loadEnv(file) {
  if (!existsSync(file)) return null;
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
    out[key] = val.replace(/^\uFEFF/, "");
  }
  return out;
}

const keys = [
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "PERMANENT_COMPANY_OWNER_PASSWORD",
  "PERMANENT_PLATFORM_ADMIN_PASSWORD",
  "ENSURE_OWNER_SECRET",
];

for (const name of files) {
  const env = loadEnv(join(root, name));
  if (!env) {
    console.log(name, "MISSING");
    continue;
  }
  console.log("---", name);
  for (const k of keys) {
    const v = env[k] || "";
    const redacted = /SENSITIVE|^\[SEN/i.test(v) || v === "[SENSITIVE]";
    console.log(
      k,
      JSON.stringify({
        present: Boolean(v),
        len: v.length,
        redacted,
        http: /^https?:/i.test(v),
        jwt: v.startsWith("eyJ"),
        sb: v.startsWith("sb_"),
      })
    );
  }
}
