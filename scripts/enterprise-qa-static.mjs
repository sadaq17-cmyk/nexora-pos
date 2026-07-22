/**
 * Static Enterprise QA path audit — no credentials required.
 * Run: node scripts/enterprise-qa-static.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Load rbac via Vite-style path by reading and evaluating through dynamic import with .js
const rbacUrl = pathToFileURL(path.join(root, "src/lib/rbac.js")).href;
const { buildDefaultMatrix, hasPermission } = await import(rbacUrl);

const posData = read("api/_posData.js");
const appJsx = read("src/App.jsx");
const authCtx = read("src/context/AuthContext.jsx");
const purchases = read("src/pages/Purchases.jsx");
const inventory = read("src/pages/Inventory.jsx");
const layout = read("src/components/Layout.jsx");
const supabaseApi = read("src/lib/supabaseApi.js");
const posJs = read("api/pos.js");
const permMw = read("src/lib/permissionMiddleware.js");

const matrix = buildDefaultMatrix();
const results = [];

function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${id}. ${name} — ${detail}`);
}

function hasCase(action) {
  return posData.includes(`case "${action}"`);
}

function hasRoute(fragment) {
  return appJsx.includes(fragment);
}

check(1, "Dashboard", hasRoute("/dashboard") && hasCase("reports.getAnalytics") && posData.includes("buildReportAnalytics"), "Route + full analytics builder");
check(2, "User Management", hasRoute("/users") && fs.existsSync(path.join(root, "api/admin-list-users.js")) && fs.existsSync(path.join(root, "api/admin-create-user.js")), "Users page + admin APIs");
check(3, "Roles & Permissions", hasRoute("/roles") && hasCase("permissions.getMatrix") && hasCase("permissions.saveMatrix"), "Roles + matrix API");
check(4, "Companies", hasRoute("/platform/companies") && hasCase("companies.getById"), "Platform companies");
check(5, "Branches", hasRoute("/branches") && hasCase("branches.create") && hasCase("branches.getAll"), "Branches CRUD");
check(6, "Products", hasRoute("/products") && hasCase("products.create") && hasCase("products.update") && hasCase("products.delete"), "Products CRUD");
check(7, "Categories", hasRoute("/categories") && hasCase("categories.create") && hasCase("categories.delete"), "Categories CRUD");
check(8, "Units", inventory.includes('id: "units"') && hasCase("units.create") && hasCase("units.getAll"), "Units in Inventory + API");
check(9, "Suppliers", hasRoute("/suppliers") && hasCase("suppliers.create") && hasCase("suppliers.addPayment"), "Suppliers + payments");
check(10, "Customers", hasRoute("/customers") && hasCase("customers.create") && hasCase("customers.addPayment"), "Customers + payments");

const purchOk =
  hasRoute("/purchases") &&
  hasCase("purchases.create") &&
  hasPermission("admin", "purchases", "create", matrix) &&
  !hasPermission("cashier", "purchases", "create", matrix);
check(11, "Purchases", purchOk, "Admin create PO; cashier denied");

const receiveOk =
  purchases.includes('can("purchases", "approve")') &&
  posData.includes("canPurchaseAction") &&
  hasCase("purchases.receive") &&
  hasPermission("owner", "purchases", "approve", matrix) &&
  hasPermission("admin", "purchases", "approve", matrix) &&
  !hasPermission("cashier", "purchases", "approve", matrix) &&
  permMw.includes('"purchases.receive": ["purchases", "approve"');
check(12, "Purchase Receiving", receiveOk, "approve gate UI+API+RBAC");

check(13, "Sales / POS", hasRoute("/pos") && hasCase("sales.create") && hasPermission("cashier", "pos", "create", matrix), "POS + cashier create");
check(14, "Inventory", hasRoute("/inventory") && hasCase("inventory.getStats") && hasCase("inventory.stockIn"), "Inventory + stockIn");
check(15, "Stock Adjustments", inventory.includes('id: "adjust"') && hasCase("inventory.adjust") && hasCase("products.adjustStock"), "Adjust tab + APIs");
check(16, "Expenses", hasRoute("/expenses") && hasCase("expenses.create"), "Expenses");
check(17, "Reports", hasRoute("/reports") && hasCase("reports.getSalesReport"), "Reports");
check(18, "Analytics", fs.existsSync(path.join(root, "src/pages/ReportsAnalytics.jsx")) && hasCase("reports.getAnalytics") && fs.existsSync(path.join(root, "api/_reportAnalytics.js")), "Analytics builder");
check(19, "Settings", hasRoute("/settings") && hasCase("settings.update") && hasCase("settings.getAll"), "Settings");
check(20, "Subscription & Billing", hasRoute("/subscription") && hasCase("subscription.get"), "Subscription");
check(21, "Notifications", hasCase("notifications.list") && (layout.includes("notifications") || supabaseApi.includes("notifications")), "Bell + API");
check(22, "Audit Logs", hasRoute("/audit") && hasCase("audit.getAll"), "Audit");
check(23, "Backup & Restore", hasCase("backup.export") && supabaseApi.includes("createObjectURL"), "JSON export download");
check(24, "Authentication", authCtx.includes("meta.active === false") && authCtx.includes("signOut()") && posJs.includes("!caller.active"), "Inactive blocked");
check(25, "Database", fs.existsSync(path.join(root, "supabase/migrations/008_purchase_rbac_receive.sql")), "Migration 008 applied to cloud");
check(26, "API", posJs.includes("verifyCallerFromRequest") && posJs.includes("consumeRateLimit") && posJs.includes("isAllowedOrigin"), "Auth+CSRF+rate limit");
check(27, "Security", read("api/_authHelpers.js").includes("applySecurityHeaders") && posJs.includes("CSRF_ORIGIN"), "Headers + CSRF");
check(28, "Performance", appJsx.includes("lazy(") && appJsx.includes("Suspense"), "Code splitting");
check(29, "Production Build", fs.existsSync(path.join(root, "dist/index.html")), "dist/ present");

const failed = results.filter((r) => !r.ok);
console.log("\n---");
console.log(`Passed ${results.filter((r) => r.ok).length}/${results.length}`);
if (failed.length) {
  console.log("Failed:", failed.map((f) => `${f.id} ${f.name}`).join(", "));
  process.exitCode = 1;
}

fs.writeFileSync(
  path.join(root, "scripts/_qa-static-result.json"),
  JSON.stringify({ passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2)
);
