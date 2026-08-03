/**
 * Pull production env from Vercel into .env.local (gitignored).
 * Never prints secret values.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionEnv, requireViteSupabaseEnv } from "./loadDotEnv.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, ".env.local");
const isWin = process.platform === "win32";
const node = process.execPath;

function run(cmd, args) {
  console.log(">", cmd, args.join(" "));
  return spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
    windowsHide: true,
    env: process.env,
  });
}

const existing = requireViteSupabaseEnv(loadProductionEnv().env);
if (existing.ok) {
  console.log("pull-production-env: already have usable VITE_SUPABASE_*", existing.meta);
  process.exit(0);
}

const npx = isWin ? "npx.cmd" : "npx";
const r = run(npx, [
  "vercel",
  "env",
  "pull",
  ".env.local",
  "--environment=production",
  "--yes",
]);

if (r.status !== 0) {
  console.error(
    "pull-production-env: FAILED.\n" +
      "Log in with: npx vercel login\n" +
      "Then: npx vercel env pull .env.local --environment=production --yes"
  );
  process.exit(r.status || 1);
}

if (!existsSync(outFile)) {
  console.error("pull-production-env: .env.local was not created");
  process.exit(1);
}

// Vercel may redact "Sensitive" vars as [SENSITIVE] — recover public URL from linked project.
const resolve = run(node, [join(root, "scripts", "resolve-supabase-public-env.mjs")]);
if (resolve.status !== 0) process.exit(resolve.status || 1);

const checked = requireViteSupabaseEnv(loadProductionEnv().env);
if (!checked.ok) {
  console.error("pull-production-env: .env.local missing required keys:", checked.problems);
  process.exit(1);
}
console.log("pull-production-env: OK", checked.meta);
