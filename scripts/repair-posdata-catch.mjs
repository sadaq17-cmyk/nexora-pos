import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "api", "_posData.js");
let s = fs.readFileSync(p, "utf8");

const replacements = [
  // comment
  ["`.insert(...)).catch(...)`", "`.insert(...).catch(...)`"],

  // next* helpers wrongly wrapped
  [
    "const code = params.code || (await nextSupplierCode(admin, companyId)).catch(() => `SUP-${Date.now().toString().slice(-5)}`));",
    "const code = params.code || (await nextSupplierCode(admin, companyId).catch(() => `SUP-${Date.now().toString().slice(-5)}`));",
  ],
  [
    "const po_number = params.po_number || (await nextPoNumber(admin, companyId)).catch(() => `PO-${Date.now()}`));",
    "const po_number = params.po_number || (await nextPoNumber(admin, companyId).catch(() => `PO-${Date.now()}`));",
  ],

  // listScoped extra paren
  [
    'const suppliers = await listScoped(admin, "suppliers", { ...caller, company_id: companyId })).catch(() => []);',
    'const suppliers = await listScoped(admin, "suppliers", { ...caller, company_id: companyId }).catch(() => []);',
  ],
  [
    'return listScoped(admin, "purchase_returns", { ...caller, company_id: companyId })).catch(() => []);',
    'return listScoped(admin, "purchase_returns", { ...caller, company_id: companyId }).catch(() => []);',
  ],
  [
    'return listScoped(admin, "expense_categories", caller)).catch(async () => {',
    'return listScoped(admin, "expense_categories", caller).catch(async () => {',
  ],
  [
    'return listScoped(admin, "brands", { ...caller, company_id: companyId })).catch(() => []);',
    'return listScoped(admin, "brands", { ...caller, company_id: companyId }).catch(() => []);',
  ],
  [
    'return listScoped(admin, "units", { ...caller, company_id: companyId })).catch(() => []);',
    'return listScoped(admin, "units", { ...caller, company_id: companyId }).catch(() => []);',
  ],
  [
    'return listScoped(admin, "warehouses", { ...caller, company_id: companyId })).catch(() => []);',
    'return listScoped(admin, "warehouses", { ...caller, company_id: companyId }).catch(() => []);',
  ],
  [
    'listScoped(admin, "sales", { ...caller, company_id: companyId })).catch(() => []),',
    'listScoped(admin, "sales", { ...caller, company_id: companyId }).catch(() => []),',
  ],
  [
    'listScoped(admin, "sale_items", { ...caller, company_id: companyId })).catch(() => []),',
    'listScoped(admin, "sale_items", { ...caller, company_id: companyId }).catch(() => []),',
  ],
  [
    'listScoped(admin, "expenses", { ...caller, company_id: companyId })).catch(() => []),',
    'listScoped(admin, "expenses", { ...caller, company_id: companyId }).catch(() => []),',
  ],
  [
    'listScoped(admin, "branches", { ...caller, company_id: companyId })).catch(() => []),',
    'listScoped(admin, "branches", { ...caller, company_id: companyId }).catch(() => []),',
  ],
];

for (const [a, b] of replacements) {
  if (!s.includes(a)) {
    console.warn("MISSING pattern:", a.slice(0, 80));
  } else {
    s = s.split(a).join(b);
  }
}

// Generic: turn `await admin.from(...).insert({...})).catch(() => null);`
// into quietSb — use a careful non-greedy scan for `})).catch(() => null)`
s = s.replace(
  /await admin\.from\("([^"]+)"\)\.insert\(\{([\s\S]*?)\}\)\)\.catch\(\(\) => null\);/g,
  (_m, table, body) =>
    `await quietSb(admin.from("${table}").insert({${body}}));`
);

// Generic: `await admin.from("x").update(...).eq(...)).catch(async () => {`
s = s.replace(
  /await admin\.from\("([^"]+)"\)\.update\((\{[^}]*\})\)\.eq\("([^"]+)", ([^)]+)\)\)\.catch\(async \(\) => \{/g,
  'await trySb(admin.from("$1").update($2).eq("$3", $4), async () => {'
);

// Multiline sales update broken pattern
s = s.replace(
  /await admin\r?\n\s*\.from\("sales"\)\r?\n\s*\.update\(\{ returned, return_reason: params\.reason \|\| "", status: "Refunded" \}\)\r?\n\s*\.eq\("id", saleId\)\)\r?\n\s*\.catch\(async \(\) => \{\r?\n\s*await Promise\.resolve\(admin\.from\("sales"\)\.update\(\{ returned, return_reason: params\.reason \|\| "" \}\)\.eq\("id", saleId\);\r?\n\s*\}\);/g,
  `await trySb(
        admin
          .from("sales")
          .update({ returned, return_reason: params.reason || "", status: "Refunded" })
          .eq("id", saleId),
        async () => admin.from("sales").update({ returned, return_reason: params.reason || "" }).eq("id", saleId)
      );`
);

fs.writeFileSync(p, s);
const check = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
console.log(check.stderr || check.stdout || "ok");
process.exit(check.status ?? 1);
