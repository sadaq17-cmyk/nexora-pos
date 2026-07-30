/** Nexora POS Pro — Role-Based Access Control definitions */

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "print", "export"];

export const MODULES = [
  { id: "dashboard", label: "Dashboard", group: "Overview" },
  { id: "pos", label: "POS Terminal", group: "Sales" },
  { id: "products", label: "Products", group: "Catalog" },
  { id: "categories", label: "Categories", group: "Catalog" },
  { id: "brands", label: "Brands", group: "Catalog" },
  { id: "inventory", label: "Inventory", group: "Stock" },
  { id: "barcode", label: "Barcode", group: "Stock" },
  { id: "purchases", label: "Purchases", group: "Procurement" },
  { id: "suppliers", label: "Suppliers", group: "Procurement" },
  { id: "customers", label: "Customers", group: "Sales" },
  { id: "sales", label: "Sales", group: "Sales" },
  { id: "returns", label: "Returns", group: "Sales" },
  { id: "discounts", label: "Discounts", group: "Sales" },
  { id: "refunds", label: "Refunds", group: "Sales" },
  { id: "expenses", label: "Expenses", group: "Finance" },
  { id: "payroll", label: "Payroll & HR", group: "Finance" },
  { id: "reports", label: "Reports", group: "Finance" },
  { id: "export_reports", label: "Export Reports", group: "Finance" },
  { id: "print_reports", label: "Print Reports", group: "Finance" },
  { id: "settings", label: "Settings", group: "System" },
  { id: "currencies", label: "Currencies", group: "System" },
  { id: "owner_management", label: "Owner Management", group: "System" },
  { id: "company_accounts", label: "Company Management", group: "Platform" },
  { id: "subscriptions", label: "Subscriptions", group: "Platform" },
  { id: "plans", label: "Plans", group: "Platform" },
  { id: "billing", label: "Billing", group: "Platform" },
  { id: "domains", label: "Domains", group: "Platform" },
  { id: "platform_settings", label: "Platform Settings", group: "Platform" },
  { id: "platform_audit", label: "Platform Audit", group: "Platform" },
  { id: "platform_analytics", label: "Platform Analytics", group: "Platform" },
  { id: "feature_management", label: "Feature Management", group: "Platform" },
  { id: "platform_approvals", label: "Approval Requests", group: "Platform" },
  { id: "users", label: "Users", group: "System" },
  { id: "roles", label: "Roles & Permissions", group: "System" },
  { id: "branches", label: "Branches", group: "System" },
  { id: "backup", label: "Backup", group: "System" },
  { id: "restore", label: "Restore", group: "System" },
  { id: "audit_logs", label: "Audit Logs", group: "System" },
  { id: "delete_records", label: "Delete Records", group: "System" },
  { id: "subscription", label: "Subscription", group: "System" },
];

export const MODULE_IDS = MODULES.map((m) => m.id);

export const SYSTEM_ROLES = [
  {
    id: "platform_owner",
    label: "Platform Super Admin",
    description: "Global SaaS administration across all companies, subscriptions, and platform settings.",
    color: "#B45309",
    system: true,
  },
  {
    id: "owner",
    label: "Owner",
    description: "Full administration for one company.",
    color: "#B45309",
    system: true,
  },
  {
    id: "super_admin",
    label: "Super Admin",
    description: "Full platform control including role creation and deletion.",
    color: "#7C3AED",
    system: true,
  },
  {
    id: "admin",
    label: "Admin",
    description: "Manage store operations and edit role permissions (cannot create/delete roles).",
    color: "#2563EB",
    system: true,
  },
  {
    id: "branch_manager",
    label: "Manager",
    description: "Manage Cashiers and Sales staff; oversee day-to-day branch operations.",
    color: "#0D9488",
    system: true,
  },
  {
    id: "sales",
    label: "Sales",
    description: "Sales history and customer accounts only.",
    color: "#DB2777",
    system: true,
  },
  {
    id: "sales_manager",
    label: "Sales Manager",
    description: "Legacy sales leadership role (maps toward Sales for new assignments).",
    color: "#DB2777",
    system: true,
  },
  {
    id: "inventory_manager",
    label: "Inventory Manager",
    description: "Manage stock counts, transfers, adjustments, barcodes, and product catalog.",
    color: "#D97706",
    system: true,
  },
  {
    id: "accountant",
    label: "Accountant",
    description: "Expenses, financial reports, exports, and purchase visibility.",
    color: "#4F46E5",
    system: true,
  },
  {
    id: "cashier",
    label: "Cashier",
    description: "POS checkout only.",
    color: "#059669",
    system: true,
  },
];

/** Roles Admin may create / manage (Managers + Staff only — never Owner/Admin peers) */
export const ADMIN_MANAGEABLE_ROLES = Object.freeze(["branch_manager", "cashier", "sales", "inventory_manager", "accountant"]);
/** Manager cannot manage users/roles per enterprise matrix */
export const MANAGER_MANAGEABLE_ROLES = Object.freeze([]);
/** Primary roles Company Owner creates for store staff */
export const OWNER_PRIMARY_ROLES = Object.freeze(["admin", "branch_manager", "cashier", "sales"]);
/** Account-status values for enterprise user lifecycle */
export const ACCOUNT_STATUSES = Object.freeze(["active", "inactive", "suspended", "locked"]);

export const SYSTEM_ROLE_IDS = SYSTEM_ROLES.map((r) => r.id);

/** Legacy role ids → current system roles */
export const ROLE_ALIASES = {
  admin: "admin",
  owner: "owner",
  company_owner: "owner",
  companyowner: "owner",
  platform_owner: "platform_owner",
  platformowner: "platform_owner",
  superadmin: "super_admin",
  manager: "branch_manager",
  branchmanager: "branch_manager",
  inventory: "inventory_manager",
  inventory_staff: "inventory_manager",
  inventorystaff: "inventory_manager",
  inventorymanager: "inventory_manager",
  salesmanager: "sales_manager",
  sales: "sales",
  salesperson: "sales",
  sales_staff: "sales",
  salesstaff: "sales",
  cashier: "cashier",
  employee: "cashier",
  staff: "cashier",
  /** Legacy informal labels → cashier (no purchase receive by default) */
  sales_associate: "cashier",
  salesassociate: "cashier",
  accountant: "accountant",
  hr_manager: "admin",
  hrmanager: "admin",
  payroll_officer: "accountant",
  payrollofficer: "accountant",
};

export function normalizeRole(role) {
  if (!role) return "cashier";
  const key = String(role).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (SYSTEM_ROLE_IDS.includes(key)) return key;
  const compact = key.replace(/_/g, "");
  return ROLE_ALIASES[compact] || ROLE_ALIASES[key] || key;
}

export function isSuperAdmin(role) {
  return normalizeRole(role) === "super_admin";
}

export function isOwner(role) {
  return normalizeRole(role) === "owner";
}

export function isPlatformOwner(role) {
  return normalizeRole(role) === "platform_owner";
}

export function isAdmin(role) {
  const r = normalizeRole(role);
  return r === "admin" || r === "super_admin" || r === "owner";
}

export const ROLE_HIERARCHY = Object.freeze([
  "platform_owner",
  "owner",
  "super_admin",
  "admin",
  "branch_manager",
  "sales_manager",
  "inventory_manager",
  "accountant",
  "sales",
  "cashier",
]);

export function roleRank(role) {
  const index = ROLE_HIERARCHY.indexOf(normalizeRole(role));
  return index === -1 ? ROLE_HIERARCHY.length : index;
}

export function isHigherRole(actorRole, targetRole) {
  return roleRank(actorRole) < roleRank(targetRole);
}

export function canManageRole(actorRole, targetRole, { allowOwnerPeer = false } = {}) {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole);
  if (actor === "platform_owner") return target !== "platform_owner";
  if (actor === "owner") return target !== "owner" || allowOwnerPeer;
  if (actor === "super_admin") return !["owner", "super_admin", "platform_owner"].includes(target);
  // Admin cannot create/manage Admin, Owner, or Super Admin — Managers & Staff only.
  if (actor === "admin") return ADMIN_MANAGEABLE_ROLES.includes(target);
  // Manager cannot manage users (enterprise matrix).
  if (actor === "branch_manager") return false;
  return false;
}

export function assignableRoles(actorRole, customRoles = []) {
  const actor = normalizeRole(actorRole);
  if (actor === "platform_owner") return SYSTEM_ROLES.filter((role) => role.id !== "platform_owner");
  if (actor === "owner") {
    const primary = SYSTEM_ROLES.filter((role) => OWNER_PRIMARY_ROLES.includes(role.id));
    const extras = SYSTEM_ROLES.filter((role) =>
      ["super_admin", "inventory_manager", "accountant", "sales_manager"].includes(role.id)
    );
    return [...primary, ...extras, ...customRoles];
  }
  if (actor === "super_admin") {
    return SYSTEM_ROLES.filter((role) => ADMIN_MANAGEABLE_ROLES.includes(role.id)).concat(customRoles);
  }
  if (actor === "admin") {
    return SYSTEM_ROLES.filter((role) => ADMIN_MANAGEABLE_ROLES.includes(role.id)).concat(
      customRoles.filter((role) => ADMIN_MANAGEABLE_ROLES.includes(normalizeRole(role.id || role)))
    );
  }
  if (actor === "branch_manager") {
    return [];
  }
  return [];
}

/** Owner / Admin (and platform) may manage staff accounts — Manager cannot. */
export function isUserManagerRole(role) {
  const normalized = normalizeRole(role);
  return ["platform_owner", "owner", "super_admin", "admin"].includes(normalized);
}

/** Owner-only company governance modules (billing, backup, subscription, etc.) */
export const OWNER_ONLY_MODULES = Object.freeze([
  "subscription",
  "billing",
  "backup",
  "restore",
  "owner_management",
]);

/** Currency governance: set base / deactivate / delete — Owner only */
export function canManageBaseCurrency(role) {
  const r = normalizeRole(role);
  return r === "owner" || r === "platform_owner" || r === "super_admin";
}

/** Currency settings UI access — Owner and Admin */
export function canAccessCurrencySettings(role) {
  const r = normalizeRole(role);
  return r === "owner" || r === "admin" || r === "super_admin" || r === "platform_owner";
}

function emptyPerms(allowed = false) {
  return Object.fromEntries(MODULE_IDS.map((module) => [module, Object.fromEntries(ACTIONS.map((action) => [action, allowed]))]));
}

function grant(perms, modules, actions) {
  const next = structuredClone(perms);
  for (const module of modules) {
    if (!next[module]) continue;
    for (const action of actions) {
      if (action in next[module]) next[module][action] = true;
    }
  }
  return next;
}

function grantAll(perms, modules) {
  return grant(perms, modules, ACTIONS);
}

export function buildDefaultMatrix() {
  const platformOnlyModules = new Set([
    "owner_management", "company_accounts", "subscriptions", "plans", "billing",
    "domains", "platform_settings", "platform_audit", "platform_analytics", "feature_management",
  ]);
  const platformModules = new Set([...platformOnlyModules, "platform_approvals", "users", "branches", "roles", "backup", "restore"]);
  const companyModules = MODULE_IDS.filter((id) => !platformOnlyModules.has(id) && id !== "platform_approvals");
  const platformOwner = grantAll(emptyPerms(false), [...platformModules]);
  const allTrue = grantAll(emptyPerms(false), companyModules);
  // Company Owner submits/cancels requests; Platform Super Admin approves them.
  allTrue.platform_approvals = {
    view: true, create: true, edit: true, delete: false, approve: false, print: false, export: false,
  };
  const superAdmin = emptyPerms(true);
  for (const module of [...platformOnlyModules, "platform_approvals"]) {
    superAdmin[module] = Object.fromEntries(ACTIONS.map((action) => [action, false]));
  }

  // Admin: ops + staff CRUD. Cannot: subscription/billing/backup/restore/owner_management/create roles.
  const adminDenied = new Set([
    "roles", "platform_approvals", "owner_management", "subscription", "billing",
    "backup", "restore", "subscriptions", "plans", "company_accounts",
    "domains", "platform_settings", "platform_audit", "platform_analytics", "feature_management",
  ]);
  const admin = grantAll(emptyPerms(false), companyModules.filter((id) => !adminDenied.has(id)));
  admin.roles = {
    view: true, create: false, edit: true, delete: false, approve: false, print: false, export: false,
  };
  // Admin: view/edit currencies & rates (server blocks base/deactivate). No delete.
  admin.currencies = {
    view: true, create: true, edit: true, delete: false, approve: false, print: false, export: true,
  };
  admin.platform_approvals = emptyPerms(false).platform_approvals;
  admin.subscription = emptyPerms(false).subscription;
  admin.billing = emptyPerms(false).billing;
  admin.backup = emptyPerms(false).backup;
  admin.restore = emptyPerms(false).restore;

  // Manager: catalog, stock, procurement, customers, reports. No users/settings/billing/roles/audit.
  const branchManager = grant(
    emptyPerms(false),
    [
      "dashboard", "pos", "products", "categories", "brands", "inventory", "barcode",
      "purchases", "suppliers", "customers", "sales", "returns", "discounts", "refunds",
      "reports", "export_reports", "print_reports",
    ],
    ["view", "create", "edit", "print", "export"]
  );
  branchManager.products.delete = true;
  branchManager.inventory.delete = false;
  branchManager.purchases.approve = true;
  branchManager.purchases.delete = false;
  branchManager.suppliers.delete = false;
  branchManager.customers.delete = false;
  // HR: view attendance/leave, approve leave; no payroll run lock/delete
  branchManager.payroll = {
    view: true, create: true, edit: true, delete: false, approve: true, print: true, export: false,
  };

  const inventoryManager = grant(
    emptyPerms(false),
    ["dashboard", "products", "categories", "brands", "inventory", "barcode", "suppliers", "purchases"],
    ["view", "create", "edit", "print"]
  );
  inventoryManager.inventory.approve = true;
  // Receive purchases requires purchases.approve — denied by default for inventory staff.
  inventoryManager.purchases.approve = false;
  inventoryManager.reports = { ...emptyPerms(false).reports, view: true, print: true };

  const salesManager = grant(
    emptyPerms(false),
    ["dashboard", "pos", "products", "customers", "sales", "returns", "discounts", "refunds", "reports", "export_reports", "print_reports"],
    ["view", "create", "edit", "approve", "print", "export"]
  );
  salesManager.categories = { ...emptyPerms(false).categories, view: true };
  salesManager.inventory = { ...emptyPerms(false).inventory, view: true };

  // Sales: Sales and Customers only
  const sales = grant(
    emptyPerms(false),
    ["customers", "sales"],
    ["view", "create", "edit"]
  );

  // Cashier: POS + employee self-service (server scopes to linked employee)
  const cashier = grant(emptyPerms(false), ["pos"], ["view", "create"]);
  cashier.products = { ...emptyPerms(false).products, view: true };
  cashier.barcode = { ...emptyPerms(false).barcode, view: true, create: true };
  cashier.discounts = { ...emptyPerms(false).discounts, view: true, create: true };
  cashier.payroll = {
    view: true, create: true, edit: false, delete: false, approve: false, print: true, export: false,
  };

  const accountant = grant(
    emptyPerms(false),
    [
      "dashboard", "purchases", "suppliers", "customers", "sales", "expenses", "payroll",
      "reports", "export_reports", "print_reports", "settings", "audit_logs",
    ],
    ["view", "create", "edit", "print", "export"]
  );
  accountant.expenses.approve = true;
  accountant.purchases.approve = true;
  accountant.payroll.approve = true;
  accountant.settings.edit = true;

  return {
    platform_owner: platformOwner,
    owner: allTrue,
    super_admin: superAdmin,
    admin,
    branch_manager: branchManager,
    inventory_manager: inventoryManager,
    sales_manager: salesManager,
    sales,
    cashier,
    accountant,
  };
}

export function roleLabel(roleId, customRoles = []) {
  const system = SYSTEM_ROLES.find((r) => r.id === roleId);
  if (system) return system.label;
  const list = Array.isArray(customRoles) ? customRoles : [];
  const custom = list.find((r) => r.id === roleId);
  return custom?.label || roleId;
}

export function slugifyRoleId(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

export function ensurePermissionShape(matrix = {}) {
  const defaults = buildDefaultMatrix();
  const shaped = {};
  for (const [role, modules] of Object.entries({ ...defaults, ...matrix })) {
    shaped[role] = emptyPerms(false);
    for (const module of MODULE_IDS) {
      for (const action of ACTIONS) {
        const value = modules?.[module]?.[action];
        shaped[role][module][action] = value === undefined ? !!defaults[role]?.[module]?.[action] : !!value;
      }
    }
  }
  return shaped;
}

export function getPermissionsForRole(role, matrix) {
  const normalized = normalizeRole(role);
  const shaped = ensurePermissionShape(matrix);
  return shaped[normalized] || emptyPerms(false);
}

export function hasPermission(role, module, action, matrix) {
  const normalized = normalizeRole(role);
  const perms = getPermissionsForRole(normalized, matrix);
  return !!perms?.[module]?.[action];
}

/** Map UI modules that still use older route keys */
export const ROUTE_MODULE_ALIASES = {
  roles: "roles",
  audit: "audit_logs",
};
