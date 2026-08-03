/**
 * Static route audit: extract App.jsx routes vs navigate/to/href paths in src + api.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === "dist" || name.name === ".git") continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?|mjs|cjs)$/.test(name.name)) out.push(p);
  }
  return out;
}

const appSrc = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const routePaths = new Set();
for (const m of appSrc.matchAll(/path=["']([^"']+)["']/g)) {
  routePaths.add(m[1]);
}
// Dynamic segments count as patterns
const routePatterns = [...routePaths].map((p) => {
  if (p.includes(":")) {
    const re = new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+").replace(/\*/g, ".*") + "$");
    return { path: p, re };
  }
  return { path: p, re: new RegExp("^" + p.replace(/\*/g, ".*") + "$") };
});

function matchesRoute(pathname) {
  const clean = pathname.split("?")[0].split("#")[0];
  if (routePaths.has(clean)) return true;
  if (clean === "*") return true;
  for (const { re } of routePatterns) {
    if (re.test(clean)) return true;
  }
  // redirects / known aliases handled as registered if exact match above
  return false;
}

const linkRe =
  /(?:navigate|Navigate)\(\s*[`'"](\/[^`'"]*)[`'"]|to=\{?\s*[`'"](\/[^`'"]*)[`'"]|href=[`'"](\/[^`'"]*)[`'"]|href:\s*[`'"](\/[^`'"]*)[`'"]/g;

const files = [
  ...walk(path.join(root, "src")),
  ...walk(path.join(root, "api")),
];

const broken = [];
const ok = [];
const seen = new Set();

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (rel === "src/App.jsx") continue;
  const text = fs.readFileSync(file, "utf8");
  let m;
  const re = new RegExp(linkRe.source, "g");
  while ((m = re.exec(text))) {
    const raw = m[1] || m[2] || m[3] || m[4];
    if (!raw || raw.startsWith("//") || raw.startsWith("/media/") || raw.startsWith("/downloads/") || raw.startsWith("/assets/")) continue;
    // skip template with ${} — check base
    const base = raw.includes("${") ? raw.split("${")[0].replace(/\/$/, "") || raw.match(/^(\/[^`$]*)/)?.[1] : raw;
    const pathname = (base || raw).split("?")[0].split("#")[0];
    if (!pathname || pathname === "/") {
      ok.push({ pathname: pathname || "/", file: rel });
      continue;
    }
    // Incomplete template bases like `/users/` from `/users/${id}/edit`
    let check = pathname;
    if (raw.includes("${")) {
      if (raw.includes("/edit")) check = "/users/:id/edit";
      else if (pathname.endsWith("/")) check = pathname.slice(0, -1);
    }
    const key = `${check}@@${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (matchesRoute(check) || matchesRoute(pathname) || (raw.includes("${") && routePatterns.some((p) => p.path.includes(":")))) {
      ok.push({ pathname: check, file: rel });
    } else {
      broken.push({ pathname: check, raw, file: rel });
    }
  }
}

console.log("Registered routes:", [...routePaths].sort().join(", "));
console.log("\nOK links:", ok.length);
if (broken.length) {
  console.log("\nBROKEN links:");
  for (const b of broken) console.log(`  ${b.pathname}  <=  ${b.raw}  @ ${b.file}`);
} else {
  console.log("\nNo broken static links found.");
}

// Layout nav extract
const layout = fs.readFileSync(path.join(root, "src/components/Layout.jsx"), "utf8");
const navTos = [...layout.matchAll(/to:\s*["']([^"']+)["']/g)].map((x) => x[1]);
const navBroken = navTos.filter((t) => !matchesRoute(t.split("?")[0]));
console.log("\nSidebar/platform nav items:", navTos.length);
if (navBroken.length) {
  console.log("NAV BROKEN:", navBroken);
} else {
  console.log("All nav `to` paths match App routes.");
}
