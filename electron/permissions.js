const { db } = require("./db/database");
const { getCurrentUser } = require("./session");

const MODULES = [
  "dashboard", "pos", "products", "inventory", "sales", "customers",
  "suppliers", "purchases", "expenses", "reports", "settings", "users", "audit",
];
const ACTIONS = ["view", "create", "edit", "delete"];

// Sensible defaults per role. Admin always has everything (enforced in code,
// not just seeded data, so an admin can never accidentally lock themselves out).
const ROLE_DEFAULTS = {
  admin: () => true,
  manager: (module, action) => {
    if (module === "settings" || module === "users") return action === "view";
    if (module === "audit") return action === "view";
    if (action === "delete") return ["sales", "purchases"].includes(module) === false;
    return true;
  },
  cashier: (module, action) => {
    if (["pos", "sales", "customers"].includes(module)) return action === "view" || action === "create";
    if (["dashboard", "products", "inventory"].includes(module)) return action === "view";
    return false;
  },
  accountant: (module, action) => {
    if (["expenses", "purchases", "suppliers", "reports"].includes(module)) return true;
    if (["dashboard", "customers", "products", "inventory", "sales"].includes(module)) return action === "view";
    return false;
  },
};

function seedPermissions() {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO permissions (role, module, action, allowed) VALUES (?, ?, ?, ?)"
  );
  const run = db.transaction(() => {
    Object.entries(ROLE_DEFAULTS).forEach(([role, fn]) => {
      MODULES.forEach((module) => {
        ACTIONS.forEach((action) => {
          const allowed = fn(module, action) ? 1 : 0;
          insert.run(role, module, action, allowed);
        });
      });
    });
  });
  run();
}

function getMatrix() {
  const rows = db.prepare("SELECT role, module, action, allowed FROM permissions").all();
  const matrix = {};
  rows.forEach((r) => {
    matrix[r.role] = matrix[r.role] || {};
    matrix[r.role][r.module] = matrix[r.role][r.module] || {};
    matrix[r.role][r.module][r.action] = !!r.allowed;
  });
  return matrix;
}

function can(role, module, action) {
  if (role === "admin") return true;
  const row = db.prepare(
    "SELECT allowed FROM permissions WHERE role = ? AND module = ? AND action = ?"
  ).get(role, module, action);
  return !!row?.allowed;
}

// Throws if the currently logged-in user (tracked via session.js) lacks the
// given permission — used by mutating IPC handlers as defense-in-depth on
// top of the renderer hiding buttons it doesn't have permission for.
function requirePermission(module, action) {
  const user = getCurrentUser();
  if (!user) throw new Error("Not authenticated.");
  if (!can(user.role, module, action)) {
    throw new Error(`Your role (${user.role}) doesn't have permission to ${action} ${module}.`);
  }
  return user;
}

module.exports = { MODULES, ACTIONS, seedPermissions, getMatrix, can, requirePermission };
