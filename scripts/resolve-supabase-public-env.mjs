/**
 * Ensure .env.local has usable public Supabase Vite vars for desktop builds.
 * - Prefers values from vercel env pull / existing dotenv files
 * - If VITE_SUPABASE_URL was redacted by Vercel, derives it from supabase/config.toml project_id
 *   (project URL is public; never writes service-role keys)
 * Never prints secret values.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionEnv, requireViteSupabaseEnv } from "./loadDotEnv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envLocalPath = join(root, ".env.local");
const configToml = join(root, "supabase", "config.toml");

function projectUrlFromToml() {
  if (!existsSync(configToml)) return "";
  const text = readFileSync(configToml, "utf8");
  const m = text.match(/^\s*project_id\s*=\s*["']([^"']+)["']/m);
  if (!m) return "";
  return `https://${m[1]}.supabase.co`;
}

function upsertEnvLocal(updates) {
  const existing = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
  const lines = existing ? existing.replace(/^\uFEFF/, "").split(/\r?\n/) : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return line;
    const cleaned = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eq = cleaned.indexOf("=");
    const key = cleaned.slice(0, eq).trim();
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}="${String(updates[key]).replace(/"/g, '\\"')}"`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key)) continue;
    next.push(`${key}="${String(value).replace(/"/g, '\\"')}"`);
  }
  writeFileSync(envLocalPath, `${next.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").replace(/\n*$/, "\n")}`, "utf8");
}

const { env } = loadProductionEnv();
let url = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").trim();
let anon = String(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "").trim();

if (!url || !/^https?:\/\//i.test(url) || /SENSITIVE/i.test(url)) {
  url = projectUrlFromToml();
}

const updates = {};
if (url && /^https?:\/\//i.test(url)) updates.VITE_SUPABASE_URL = url;
if (anon && anon.length >= 20 && !/SENSITIVE/i.test(anon)) updates.VITE_SUPABASE_ANON_KEY = anon;

if (!updates.VITE_SUPABASE_URL || !updates.VITE_SUPABASE_ANON_KEY) {
  console.error(
    "resolve-supabase-public-env: still missing public Supabase vars.",
    JSON.stringify({
      hasUrl: Boolean(updates.VITE_SUPABASE_URL),
      hasAnon: Boolean(updates.VITE_SUPABASE_ANON_KEY),
      hint: "Run npm run env:pull:production after vercel login",
    })
  );
  process.exit(1);
}

upsertEnvLocal(updates);

const checked = requireViteSupabaseEnv(loadProductionEnv().env);
if (!checked.ok) {
  console.error("resolve-supabase-public-env: FAIL", checked.problems);
  process.exit(1);
}
console.log("resolve-supabase-public-env: OK", checked.meta);
