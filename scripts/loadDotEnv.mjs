/**
 * Load gitignored dotenv files into process.env (never prints secret values).
 * Used by Electron / desktop production builds so Vite can inline VITE_* vars.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const raw of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf("=");
    if (eq < 1) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    if (/^\[SENSITIVE\]$/i.test(value) || /^SENSITIVE$/i.test(value)) continue;
    out[key] = value;
  }
  return out;
}

/** Merge order: earlier files overridden by later; process.env wins last. */
export function loadProductionEnv(options = {}) {
  const files = options.files || [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
    ".env.vercel.runtime",
  ];
  const merged = {};
  const loadedFrom = [];
  for (const name of files) {
    const full = join(root, name);
    const parsed = parseEnvFile(full);
    if (Object.keys(parsed).length) {
      Object.assign(merged, parsed);
      loadedFrom.push(name);
    }
  }
  const env = { ...merged, ...process.env };
  return { env, loadedFrom, root };
}

export function requireViteSupabaseEnv(env) {
  const url = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").trim();
  const anon = String(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "").trim();
  const problems = [];
  if (!url || !/^https?:\/\//i.test(url)) {
    problems.push("VITE_SUPABASE_URL missing or not an https URL");
  }
  if (!anon || anon.length < 20) {
    problems.push("VITE_SUPABASE_ANON_KEY missing or too short");
  }
  if (/SENSITIVE/i.test(url) || /SENSITIVE/i.test(anon)) {
    problems.push("Supabase env values look redacted — pull real production env");
  }
  return {
    ok: problems.length === 0,
    problems,
    url,
    anon,
    // Safe metadata only
    meta: {
      urlHost: (() => {
        try {
          return new URL(url).host;
        } catch {
          return null;
        }
      })(),
      anonLen: anon.length,
      anonKind: anon.startsWith("eyJ") ? "jwt" : anon.startsWith("sb_") ? "sb" : "other",
    },
  };
}
