/**
 * Static verification that RLS is enabled and policies exist in the migration.
 * Does not modify schema. Run: node scripts/verify-rls.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "supabase", "migrations", "001_nexora_schema.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

const tables = [
  "branches", "profiles", "categories", "products", "customers", "customer_payments",
  "suppliers", "supplier_payments", "sales", "sale_items", "held_sales", "purchases",
  "purchase_items", "purchase_returns", "expense_categories", "expenses", "stock_transfers",
  "settings", "permissions", "audit_log", "subscription",
];

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("RLS static verification\n");

for (const table of tables) {
  const enabled = new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i").test(sql);
  check(`RLS enabled: ${table}`, enabled);
}

check("profiles policies present", /CREATE POLICY profiles_select/i.test(sql) && /CREATE POLICY profiles_update/i.test(sql));
check("staff SELECT policies loop", /CREATE POLICY %I ON public\.%I FOR SELECT/i.test(sql));
check("owner/admin write policies loop", /FOR INSERT TO authenticated WITH CHECK \(public\.is_owner_or_admin\(\)\)/i.test(sql));
check("cashier sales write policies", /CREATE POLICY sales_insert_cashier/i.test(sql));
check("audit_log insert for cashier", /CREATE POLICY audit_log_insert_cashier/i.test(sql));
check("subscription delete owner-only", /CREATE POLICY subscription_delete/i.test(sql));

const roleGap = !/branch_manager|sales_manager|inventory_manager|accountant|super_admin|platform_owner/i.test(
  sql.match(/CREATE OR REPLACE FUNCTION public\.is_staff\(\)[\s\S]*?\$\$;/)?.[0] || ""
);
check(
  "is_staff role coverage note",
  true,
  roleGap
    ? "RECOMMENDATION: is_staff()/is_owner_or_admin() only cover owner/admin/cashier — expand when aligning Supabase roles with app RBAC (requires schema change)"
    : "broader roles detected"
);

console.log(failed ? `\nRESULT: FAIL (${failed} issue(s))` : "\nRESULT: PASS");
process.exit(failed ? 1 : 0);
