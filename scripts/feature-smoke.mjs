/**
 * Offline feature smoke: import resolution + mockApi module exercises.
 * Run: node scripts/feature-smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const fails = [];
const warns = [];
const passes = [];

function pass(name) { passes.push(name); console.log(`  PASS  ${name}`); }
function warn(name, note) { warns.push(`${name}: ${note}`); console.log(`  WARN  ${name} — ${note}`); }
function fail(name, note) { fails.push(`${name}: ${note}`); console.log(`  FAIL  ${name} — ${note}`); }

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return true;
  const base = path.resolve(path.dirname(fromFile), spec);
  return [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ].some((candidate) => fs.existsSync(candidate));
}

console.log("Import resolution\n");
const files = walk(src);
let bad = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const re = /from\s+["'](\.[^"']+)["']/g;
  let match;
  while ((match = re.exec(text))) {
    if (!resolveImport(file, match[1])) {
      bad += 1;
      fail("broken import", `${path.relative(src, file)} -> ${match[1]}`);
    }
  }
}
if (!bad) pass(`all relative imports resolve (${files.length} files)`);

console.log("\nApp routes vs page modules\n");
const app = fs.readFileSync(path.join(src, "App.jsx"), "utf8");
const routeImports = [
  ...app.matchAll(/import\s+(\w+)\s+from\s+["'](\.\/pages\/[^"']+)["']/g),
  ...app.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["'](\.\/pages\/[^"']+)["']\s*\)/g),
];
for (const [, name, spec] of routeImports) {
  const ok = resolveImport(path.join(src, "App.jsx"), spec);
  if (ok) pass(`route module ${name}`);
  else fail(`route module ${name}`, `missing ${spec}`);
}

console.log("\nmockApi feature surface\n");
// Dynamic import of mockApi via pathToFileURL — may pull browser APIs; use createRequire-like approach by reading namespaces.
const mockText = fs.readFileSync(path.join(src, "lib", "mockApi.js"), "utf8");
const namespaces = [
  "platformPublic", "publicAuth", "auth", "products", "categories", "inventory", "sales",
  "customers", "suppliers", "purchases", "expenses", "reports", "users", "settings",
  "permissions", "owner", "barcode", "backup", "sync", "audit",
];
for (const ns of namespaces) {
  if (new RegExp(`\\b${ns}\\s*:\\s*\\{`).test(mockText)) pass(`api.${ns} namespace`);
  else warn(`api.${ns}`, "namespace not found as object literal (may be aliased)");
}

// Critical methods referenced by pages
const critical = [
  ["products.getAll", /products:\s*\{[\s\S]*?getAll\s*:/],
  ["sales.create", /sales:\s*\{[\s\S]*?create\s*:/],
  ["sales.getHeld", /getHeld\s*:/],
  ["customers.getAll", /customers:\s*\{[\s\S]*?getAll\s*:/],
  ["reports.", /reports:\s*\{/],
  ["owner.", /owner:\s*\{/],
  ["platformPublic.contact", /contact\s*:\s*async/],
  ["platformPublic.getPlans", /getPlans\s*:/],
  ["settings.getAll", /settings:\s*\{[\s\S]*?getAll\s*:/],
  ["permissions.getMine", /getMine\s*:/],
];
for (const [label, re] of critical) {
  if (re.test(mockText)) pass(label);
  else fail(label, "method/namespace missing in mockApi");
}

console.log("\nPublic + auth pages present\n");
for (const rel of [
  "pages/public/Home.jsx", "pages/public/Features.jsx", "pages/public/Pricing.jsx",
  "pages/public/Contact.jsx", "pages/public/Faq.jsx", "pages/public/Help.jsx",
  "pages/public/Support.jsx", "pages/public/Signup.jsx", "pages/public/ForgotPassword.jsx",
  "pages/public/ResetPassword.jsx", "pages/public/VerifyEmail.jsx", "pages/Login.jsx",
  "pages/POS.jsx", "pages/Dashboard.jsx", "pages/Reports.jsx", "pages/OwnerManagement.jsx",
]) {
  if (fs.existsSync(path.join(src, rel))) pass(rel);
  else fail(rel, "missing file");
}

console.log("\nSecurity deploy artifacts\n");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
for (const h of ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options"]) {
  if (vercel.includes(h)) pass(`header ${h}`);
  else fail(`header ${h}`, "missing from vercel.json");
}

console.log(`\nSummary: ${passes.length} PASS · ${warns.length} WARN · ${fails.length} FAIL`);
if (fails.length) process.exit(1);
