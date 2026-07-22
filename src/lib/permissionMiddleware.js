import { hasPermission, isOwner, isSuperAdmin } from "./rbac";

/**
 * Maps every API namespace.method to [module, action, denyShape]
 * denyShape: "array" | "null" | "object" | "result" (default { success:false })
 */
export const API_PERMISSION_MAP = {
  "auth.login": null,
  "auth.loginByEmail": null,
  "auth.logout": null,
  "auth.restoreSession": null,
  "auth.heartbeat": null,
  "auth.stopImpersonation": null,
  "auth.listUsers": ["users", "view", "array"],
  "auth.getUser": ["users", "view", "null"],
  "users.getStatus": ["users", "view", "array"],
  "users.getDashboard": ["dashboard", "view", "result"],
  "health.probe": null,

  "products.getAll": ["products", "view", "array"],
  "products.getByBarcode": ["barcode", "view", "null"],
  "products.getCategories": ["categories", "view", "array"],
  "products.create": ["products", "create", "result"],
  "products.update": ["products", "edit", "result"],
  "products.delete": ["products", "delete", "result"],
  "products.archive": ["products", "edit", "result"],
  "products.restore": ["products", "edit", "result"],
  "products.import": ["products", "create", "result"],
  "products.adjustStock": ["inventory", "edit", "result"],

  "categories.getAll": ["categories", "view", "array"],
  "categories.create": ["categories", "create", "result"],
  "categories.update": ["categories", "edit", "result"],
  "categories.delete": ["categories", "delete", "result"],

  "sales.create": ["pos", "create", "result"],
  "sales.hold": ["pos", "create", "result"],
  "sales.getHeld": ["pos", "view", "array"],
  "sales.releaseHeld": ["pos", "edit", "null"],
  "sales.getRecent": ["sales", "view", "array"],
  "sales.getSummary": ["dashboard", "view", "object"],
  "sales.getWeeklyTrend": ["dashboard", "view", "array"],
  "sales.getItems": ["sales", "view", "array"],
  "sales.createReturn": ["returns", "create", "result"],

  "customers.getAll": ["customers", "view", "array"],
  "customers.create": ["customers", "create", "result"],
  "customers.update": ["customers", "edit", "result"],
  "customers.delete": ["customers", "delete", "result"],
  "customers.addPayment": ["customers", "edit", "result"],
  "customers.adjustPoints": ["customers", "edit", "result"],
  "customers.getStatement": ["customers", "view", "object"],
  "customers.getPurchaseHistory": ["customers", "view", "array"],

  "suppliers.getAll": ["suppliers", "view", "array"],
  "suppliers.create": ["suppliers", "create", "result"],
  "suppliers.update": ["suppliers", "edit", "result"],
  "suppliers.archive": ["suppliers", "edit", "result"],
  "suppliers.restore": ["suppliers", "edit", "result"],
  "suppliers.delete": ["suppliers", "delete", "result"],
  "suppliers.addPayment": ["suppliers", "edit", "result"],
  "suppliers.getStatement": ["suppliers", "view", "object"],
  "suppliers.getLedger": ["suppliers", "view", "object"],
  "suppliers.getPurchaseHistory": ["suppliers", "view", "array"],
  "suppliers.getDashboard": ["suppliers", "view", "object"],
  "suppliers.getReports": ["suppliers", "view", "object"],

  "purchases.getAll": ["purchases", "view", "array"],
  "purchases.getItems": ["purchases", "view", "array"],
  "purchases.getReturns": ["returns", "view", "array"],
  "purchases.getPayments": ["purchases", "view", "array"],
  "purchases.getDashboard": ["purchases", "view", "result"],
  "purchases.getReports": ["purchases", "view", "result"],
  "purchases.getAudit": ["purchases", "view", "array"],
  "purchases.getJournal": ["purchases", "view", "array"],
  "purchases.create": ["purchases", "create", "result"],
  "purchases.update": ["purchases", "edit", "result"],
  "purchases.duplicate": ["purchases", "create", "result"],
  /** Receive stock — maps to purchases.approve (not edit). */
  "purchases.receive": ["purchases", "approve", "result"],
  "purchases.addPayment": ["purchases", "edit", "result"],
  "purchases.cancel": ["purchases", "edit", "result"],
  "purchases.updateStatus": ["purchases", "edit", "result"],
  "purchases.createReturn": ["returns", "create", "result"],

  "inventory.getTransfers": ["inventory", "view", "array"],
  "inventory.transferStock": ["inventory", "edit", "result"],
  "inventory.getStats": ["inventory", "view", "object"],
  "inventory.getLowStock": ["inventory", "view", "array"],
  "inventory.getExpiring": ["inventory", "view", "array"],
  "inventory.getMovements": ["inventory", "view", "array"],
  "inventory.getWarehouseStock": ["inventory", "view", "array"],
  "inventory.stockIn": ["inventory", "create", "result"],
  "inventory.stockOut": ["inventory", "edit", "result"],
  "inventory.adjust": ["inventory", "edit", "result"],
  "inventory.getMovementChart": ["inventory", "view", "array"],
  "inventory.getReports": ["inventory", "view", "object"],
  "inventory.getAudit": ["inventory", "view", "array"],
  "inventory.createCount": ["inventory", "create", "result"],
  "inventory.postCount": ["inventory", "approve", "result"],
  "inventory.getCounts": ["inventory", "view", "array"],
  "inventory.getCount": ["inventory", "view", "null"],

  "brands.getAll": ["brands", "view", "array"],
  "brands.create": ["brands", "create", "result"],
  "brands.update": ["brands", "edit", "result"],
  "brands.delete": ["brands", "delete", "result"],

  "units.getAll": ["inventory", "view", "array"],
  "units.create": ["inventory", "create", "result"],
  "units.update": ["inventory", "edit", "result"],
  "units.delete": ["inventory", "delete", "result"],

  "warehouses.getAll": ["inventory", "view", "array"],
  "warehouses.create": ["inventory", "create", "result"],
  "warehouses.update": ["inventory", "edit", "result"],
  "warehouses.delete": ["inventory", "delete", "result"],

  "barcode.generate": ["barcode", "create", "result"],
  "barcode.generateBulk": ["barcode", "create", "result"],
  "barcode.assign": ["barcode", "create", "result"],
  "barcode.search": ["barcode", "view", "array"],
  "barcode.getLabelData": ["barcode", "print", "object"],
  "barcode.listStatus": ["barcode", "view", "object"],

  "expenses.getAll": ["expenses", "view", "array"],
  "expenses.getCategories": ["expenses", "view", "array"],
  "expenses.createCategory": ["expenses", "create", "result"],
  "expenses.create": ["expenses", "create", "result"],
  "expenses.update": ["expenses", "edit", "result"],
  "expenses.delete": ["expenses", "delete", "result"],
  "expenses.attachReceipt": ["expenses", "edit", "result"],
  "expenses.openReceipt": ["expenses", "view", "result"],
  "expenses.getSummary": ["expenses", "view", "object"],

  "reports.getRevenueVsExpenses": ["reports", "view", "array"],
  "reports.getAnalytics": ["reports", "view", "object"],
  "reports.getUserSales": ["reports", "view", "object"],
  "reports.getTopProducts": ["reports", "view", "array"],
  "reports.getCategorySales": ["reports", "view", "array"],
  "reports.getProfitSummary": ["reports", "view", "object"],
  "reports.getSalesReport": ["reports", "view", "object"],
  "reports.getPurchaseReport": ["reports", "view", "object"],
  "reports.getProfitLoss": ["reports", "view", "object"],
  "reports.getExpenseReport": ["reports", "view", "object"],
  "reports.getInventoryReport": ["reports", "view", "object"],
  "reports.getLowStockReport": ["reports", "view", "array"],
  "reports.getCustomerReport": ["reports", "view", "array"],
  "reports.getSupplierReport": ["reports", "view", "array"],

  "settings.getAll": ["settings", "view", "object"],
  "settings.getPublic": null,
  "settings.update": ["settings", "edit", "result"],
  "settings.getPrinters": ["settings", "view", "array"],

  "currency.list": ["currencies", "view", "object"],
  "currency.getActive": null,
  "currency.getHistory": ["currencies", "view", "array"],
  "currency.create": ["currencies", "create", "result"],
  "currency.update": ["currencies", "edit", "result"],
  "currency.setBase": ["currencies", "edit", "result"],
  "currency.setDefault": ["currencies", "edit", "result"],
  "currency.updateRate": ["currencies", "edit", "result"],
  "currency.setPolicy": ["currencies", "edit", "result"],

  "backup.export": ["backup", "export", "result"],
  "backup.restore": ["restore", "create", "result"],
  "backup.getHistory": ["backup", "view", "array"],
  "backup.runNow": ["backup", "create", "result"],

  "notifications.list": ["dashboard", "view", "object"],

  "sync.getStatus": ["settings", "view", "object"],
  "sync.triggerNow": ["settings", "edit", "result"],
  "sync.setAutoSync": ["settings", "edit", "result"],
  "sync.onConnectionRestored": ["settings", "edit", "result"],

  "permissions.getMatrix": ["roles", "view", "object"],
  "permissions.getMine": null,
  "permissions.update": ["roles", "edit", "result"],
  "permissions.createRole": ["roles", "create", "result"],
  "permissions.deleteRole": ["roles", "delete", "result"],
  "permissions.listRoles": ["roles", "view", "array"],
  "permissions.resetDefaults": ["roles", "edit", "result"],

  "audit.getAll": ["audit_logs", "view", "array"],
  "audit.getLoginHistory": ["audit_logs", "view", "array"],

  "auth_admin.createUser": ["users", "create", "result"],
  "auth_admin.updateUser": ["users", "edit", "result"],
  "auth_admin.setUserActive": ["users", "edit", "result"],
  "auth_admin.setUserRole": ["users", "edit", "result"],
  "auth_admin.resetPassword": ["users", "edit", "result"],
  "auth_admin.resetPin": ["users", "edit", "result"],
  "auth_admin.deleteUser": ["users", "delete", "result"],

  "approvals.listTypes": ["platform_approvals", "view", "array"],
  "approvals.list": ["platform_approvals", "view", "array"],
  "approvals.create": ["platform_approvals", "create", "result"],
  "approvals.cancel": ["platform_approvals", "edit", "result"],
  "approvals.decide": ["platform_approvals", "approve", "result"],

  "platformPublic.getPlans": null,
  "platformPublic.getFeatures": null,
  "platformPublic.verifyInvoice": null,
  "platformPublic.contact": null,
  "publicAuth.signupCompany": null,
  "publicAuth.verifyEmail": null,
  "publicAuth.requestPasswordReset": null,
  "publicAuth.resetPassword": null,
  "publicAuth.socialProviderStatus": null,

  "owner.getOverview": ["owner_management", "view", "result"],
  "owner.getPlatformConsole": ["platform_analytics", "view", "result"],
  "owner.createCompanyAccount": ["company_accounts", "create", "result"],
  "owner.updateCompany": ["company_accounts", "edit", "result"],
  "owner.updateSubscription": ["subscriptions", "edit", "result"],
  "owner.savePlan": ["plans", "edit", "result"],
  "owner.addDomain": ["domains", "create", "result"],
  "owner.verifyDomain": ["domains", "edit", "result"],
  "owner.removeDomain": ["domains", "delete", "result"],
  "owner.updatePlatformSettings": ["platform_settings", "edit", "result"],
  "owner.saveFeature": ["feature_management", "edit", "result"],
  "owner.toggleCompanyFeature": ["feature_management", "edit", "result"],
  "owner.verifyCompanyOwnerEmail": ["company_accounts", "edit", "result"],
  "owner.getActivity": ["owner_management", "view", "object"],
  "owner.impersonateUser": ["owner_management", "edit", "result"],
  "owner.recordAudit": ["owner_management", "edit", "result"],

  "branches.getAll": ["branches", "view", "array"],
  "branches.create": ["branches", "create", "result"],
  "branches.update": ["branches", "edit", "result"],
  "branches.delete": ["branches", "delete", "result"],

  "subscription.get": ["subscription", "view", "object"],
  "subscription.update": ["subscription", "edit", "result"],
  /** Same owner-gated activate/renew path as update (server also enforces owner). */
  "subscription.changePlan": ["subscription", "edit", "result"],
  "subscription.requestRenewal": ["subscription", "edit", "result"],
};

function denyValue(shape) {
  if (shape === "array") return [];
  if (shape === "null") return null;
  if (shape === "object") return {};
  return { success: false, error: "Permission denied.", code: "FORBIDDEN" };
}

/**
 * Wrap an API object so every mapped method checks RBAC before running.
 */
export function applyPermissionMiddleware(api, getContext) {
  const wrapped = {};

  for (const [namespace, methods] of Object.entries(api)) {
    if (methods === null || typeof methods !== "object") {
      wrapped[namespace] = methods;
      continue;
    }

    wrapped[namespace] = {};
    for (const [methodName, fn] of Object.entries(methods)) {
      if (typeof fn !== "function") {
        wrapped[namespace][methodName] = fn;
        continue;
      }

      const key = `${namespace}.${methodName}`;
      const rule = API_PERMISSION_MAP[key];

      if (rule === null || rule === undefined) {
        // Unmapped: allow (auth helpers / flags) unless explicitly mapped
        if (rule === undefined && !key.startsWith("__")) {
          // Still wrap unknown mutating-looking methods behind settings by default? Prefer allow for flags.
        }
        wrapped[namespace][methodName] = fn.bind(methods);
        continue;
      }

      const [module, action, shape = "result"] = rule;
      wrapped[namespace][methodName] = async (...args) => {
        const { role, matrix } = getContext();
        if (key === "settings.update") {
          const updates = args[0] || {};
          const changesCurrency =
            Object.prototype.hasOwnProperty.call(updates, "currency") ||
            Object.prototype.hasOwnProperty.call(updates, "currency_symbol") ||
            Object.prototype.hasOwnProperty.call(updates, "base_currency_code");
          if (changesCurrency && !isSuperAdmin(role) && !isOwner(role)) {
            return {
              success: false,
              error: "Only Owner can change the base currency.",
              code: "FORBIDDEN",
            };
          }
        }
        if (key === "currency.setBase" || key === "currency.setPolicy") {
          if (!isSuperAdmin(role) && !isOwner(role)) {
            return {
              success: false,
              error: "Only Owner can change base currency or currency policy.",
              code: "FORBIDDEN",
            };
          }
        }
        if (!hasPermission(role, module, action, matrix)) {
          return denyValue(shape);
        }
        return fn.apply(methods, args);
      };
    }
  }

  return wrapped;
}
