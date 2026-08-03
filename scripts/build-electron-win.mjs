import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionEnv, requireViteSupabaseEnv } from "./loadDotEnv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

function run(cmd, args, env = {}, { shell = false } = {}) {
  console.log(">", cmd, args.join(" "));
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell,
    windowsHide: true,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}

const node = process.execPath;

// 0) Load production env (.env.local from `vercel env pull`, etc.) — never hardcode secrets
let { env: prodEnv, loadedFrom } = loadProductionEnv();
let supabase = requireViteSupabaseEnv(prodEnv);
if (!supabase.ok) {
  console.log("Supabase env incomplete — trying env:pull / resolve…");
  run(node, [path.join(root, "scripts", "pull-production-env.mjs")]);
  ({ env: prodEnv, loadedFrom } = loadProductionEnv());
  supabase = requireViteSupabaseEnv(prodEnv);
}
console.log("electron env sources:", loadedFrom.length ? loadedFrom.join(", ") : "(process.env only)");
console.log("supabase config:", supabase.meta);
if (!supabase.ok) {
  console.error("FATAL: Electron production build requires Supabase public Vite env.");
  for (const p of supabase.problems) console.error(" -", p);
  console.error("Run: npm run env:pull:production");
  console.error("Or:  npx vercel env pull .env.local --environment=production --yes");
  process.exit(1);
}

const buildEnv = {
  VITE_DESKTOP: "true",
  ELECTRON_BUILD: "1",
  VITE_SUPABASE_URL: supabase.url,
  VITE_SUPABASE_ANON_KEY: supabase.anon,
};

// 1) Desktop Vite build — base "./", VITE_DESKTOP=true, Supabase vars inlined
run(node, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"], buildEnv);

// 2) Strip crossorigin + inject desktop flags into dist/index.html
run(node, [path.join(root, "scripts", "prepare-electron-dist.mjs")]);

// 3) Confirm Supabase URL host was baked into dist (no secret dump)
run(node, [path.join(root, "scripts", "verify-dist-supabase-config.mjs")]);

// 4) Package Windows NSIS + portable
run(node, [
  path.join(root, "node_modules", "electron-builder", "cli.js"),
  "--win",
  "--x64",
]);

console.log("\nbuild-electron-win: DONE");
console.log("  release/dist/Nexora-POS-Setup-1.0.1.exe");
console.log("  release/dist/Nexora-POS-Portable-1.0.1.exe");
console.log("Supabase host baked:", supabase.meta.urlHost);
