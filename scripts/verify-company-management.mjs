/**
 * Static + optional runtime checks for Super Owner Company Management.
 * Ensures tenant Users stays staff-scoped and platform menu is company-scoped.
 *
 *   node scripts/verify-company-management.mjs
 *   APP_BASE_URL=https://… node scripts/verify-company-management.mjs  (optional live)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function pass(name, detail = "") {
  results.push({ name, status: "PASS", detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, status: "FAIL", detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function mustInclude(rel, patterns, name) {
  const src = read(rel);
  const missing = patterns.filter((p) => !(typeof p === "string" ? src.includes(p) : p.test(src)));
  if (missing.length) fail(name, `missing in ${rel}: ${missing.map(String).join(", ")}`);
  else pass(name, rel);
}

function mustNotInclude(rel, patterns, name) {
  const src = read(rel);
  const found = patterns.filter((p) => (typeof p === "string" ? src.includes(p) : p.test(src)));
  if (found.length) fail(name, `unexpected in ${rel}: ${found.map(String).join(", ")}`);
  else pass(name, rel);
}

// 1) Super Owner nav: Company Management, no Users menu item
mustInclude(
  "src/components/Layout.jsx",
  [
    'label: "Company Management"',
    'to: "/platform/companies"',
    'module: "company_accounts"',
  ],
  "platform_nav_company_management"
);
mustNotInclude(
  "src/components/Layout.jsx",
  [/PLATFORM_SECTIONS[\s\S]*to:\s*"\/platform\/users"/],
  "platform_nav_no_users_item"
);

// 2) Tenant Users preserved
mustInclude(
  "src/components/Layout.jsx",
  ['to: "/users", label: "Users"', 'module: "users"'],
  "tenant_nav_users_preserved"
);
mustInclude(
  "src/App.jsx",
  [
    'path="/users"',
    "<Users />",
    'path="/users/new"',
    'path="/users/:id/edit"',
  ],
  "tenant_users_routes_preserved"
);

// 3) Platform routes
mustInclude(
  "src/App.jsx",
  [
    'path="/platform/companies"',
    'module="company_accounts"',
    'path="/platform/users" element={<Navigate to="/platform/companies"',
  ],
  "platform_company_routes"
);

// 4) Dedicated panel + OwnerManagement wiring
mustInclude(
  "src/components/CompanyManagementPanel.jsx",
  [
    "Company Management",
    "Mark as Paid",
    "Extend Trial",
    "Login as Company Owner",
    "company_id",
  ],
  "company_management_panel"
);
mustInclude(
  "src/pages/OwnerManagement.jsx",
  ["CompanyManagementPanel", 'module === "companies"', "Company Management"],
  "owner_management_wires_panel"
);
mustNotInclude(
  "src/pages/OwnerManagement.jsx",
  ["PlatformUsers", 'module === "users"'],
  "owner_management_no_platform_users"
);

// 5) RBAC
mustInclude(
  "src/lib/rbac.js",
  [
    '{ id: "company_accounts", label: "Company Management"',
    '{ id: "users", label: "Users"',
  ],
  "rbac_modules_distinct"
);

// 6) APIs
mustInclude(
  "src/lib/supabaseApi.js",
  [
    'pos("platform.getOverview"',
    'pos("platform.markPaid"',
    'pos("platform.extendTrial"',
    'pos("platform.getCompanyHistory"',
    'pos("platform.activateCompany"',
    'pos("platform.suspendCompany"',
  ],
  "client_platform_company_apis"
);
mustInclude(
  "api/_platformAdmin.js",
  [
    "requirePlatform",
    "async function markCompanyPaid",
    "async function extendTrial",
    "async function getCompanyHistory",
    '.eq("company_id", companyId)',
  ],
  "server_platform_admin_isolation"
);
mustInclude(
  "src/lib/permissionMiddleware.js",
  [
    '"owner.markPaid"',
    '"owner.extendTrial"',
    '"owner.getCompanyHistory"',
    '"owner.updateCompany"',
  ],
  "client_permission_matrix"
);

// 7) Mock parity for local/dev
mustInclude(
  "src/lib/mockApi.js",
  ["markPaid:", "extendTrial:", "getCompanyHistory:", "activateCompany:", "suspendCompany:"],
  "mock_api_company_lifecycle_parity"
);

const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\nStatic checks: ${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
