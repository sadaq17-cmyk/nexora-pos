/**
 * Ensure the Vite production bundle inlined Supabase public config.
 * Never prints secret values.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionEnv, requireViteSupabaseEnv } from "./loadDotEnv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "dist", "assets");

if (!existsSync(assetsDir)) {
  console.error("verify-dist-supabase-config: dist/assets missing — run vite build first");
  process.exit(1);
}

const { env } = loadProductionEnv();
const required = requireViteSupabaseEnv(env);
if (!required.ok) {
  console.error("verify-dist-supabase-config: env missing", required.problems);
  process.exit(1);
}

let host = required.meta.urlHost;
const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
let foundHost = false;
let foundAnonPrefix = false;
const anonPrefix = required.anon.slice(0, 12);

for (const name of files) {
  const text = readFileSync(join(assetsDir, name), "utf8");
  if (host && text.includes(host)) foundHost = true;
  if (anonPrefix && text.includes(anonPrefix)) foundAnonPrefix = true;
  if (foundHost && foundAnonPrefix) break;
}

console.log(
  "verify-dist-supabase-config:",
  JSON.stringify({ host, foundHost, foundAnonPrefix, filesChecked: files.length })
);

if (!foundHost || !foundAnonPrefix) {
  console.error(
    "FATAL: Supabase config was not baked into dist. Electron login will fail.\n" +
      "Ensure VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set during vite build."
  );
  process.exit(1);
}
console.log("verify-dist-supabase-config: OK");
