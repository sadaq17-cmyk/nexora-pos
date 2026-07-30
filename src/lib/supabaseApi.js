/**
 * Production POS data plane — Supabase via authenticated /api/pos.
 * Never uses browser localStorage for retail entities.
 */

import { authFetch } from "./authApi";
import { resolveApiUrl } from "./desktopRuntime";
import { applyPermissionMiddleware } from "./permissionMiddleware";
import { buildDefaultMatrix, ensurePermissionShape, isPlatformOwner, normalizeRole } from "./rbac";
import { validateSalePayment } from "./paymentMethods";
import { getCurrency } from "./currency";
import { CANONICAL_PLANS, PAID_PLAN_CODES } from "./subscriptionPlans";
import {
  cachedRequest,
  cacheKey,
  clearRequestCache,
  invalidateCache,
  LOOKUP_TTL_MS,
  LIST_TTL_MS,
} from "./requestCache";

let currentUser = null;
let permissionMatrixCache = null;

function setAuthContext(user) {
  if (!user) {
    currentUser = null;
    permissionMatrixCache = null;
    clearRequestCache();
    return;
  }
  currentUser = {
    id: user.id,
    name: user.name || "",
    username: user.username || "",
    email: user.email || "",
    role: normalizeRole(user.role),
    company_id: user.company_id ?? null,
    branch_id: user.branch_id ?? null,
    company: user.company || null,
    active: user.active === false || user.active === 0 ? 0 : 1,
  };
}

async function pos(action, params = {}) {
  const result = await authFetch("/api/pos", {
    method: "POST",
    body: { action, params },
  });
  return result;
}

async function posOrEmpty(action, params, empty) {
  const result = await pos(action, params);
  if (result && typeof result === "object" && result.success === false) {
    const code = String(result.code || "");
    // Always settle to empty for transport/auth failures — never leave callers waiting on soft errors.
    if (
      code === "UNAUTHENTICATED" ||
      code === "POS_ERROR" ||
      code === "TIMEOUT" ||
      code === "NETWORK" ||
      code === "ABORTED" ||
      code === "CONFIG" ||
      code === "CSRF_ORIGIN"
    ) {
      if (code === "POS_ERROR") console.error("[supabaseApi]", action, result.error);
      return empty;
    }
  }
  return result;
}

/** Cached POS read with in-flight dedupe. Mutations should invalidate related prefixes. */
function cachedPos(action, params = {}, empty, ttlMs = LIST_TTL_MS) {
  const key = cacheKey(["pos", currentUser?.company_id, action, params]);
  return cachedRequest(key, () => posOrEmpty(action, params, empty), { ttlMs });
}

function invalidateEntityCaches(...prefixes) {
  for (const p of prefixes) invalidateCache(cacheKey(["pos", currentUser?.company_id, p]));
  // Also clear broad list keys for the action name alone
  for (const p of prefixes) invalidateCache(`pos|${currentUser?.company_id ?? ""}|${p}`);
}

async function listCompanyUsersStatus() {
  const listed = await authFetch("/api/admin-list-users", { method: "POST", body: {} }).catch(() => null);
  const users = listed?.users || listed || [];
  if (!Array.isArray(users)) return [];
  return users.map((user) => ({
    id: user.id,
    name: user.name || user.email || "User",
    username: user.username || user.email || "",
    role: user.role,
    branch_name: user.branch_name || "",
    active: user.active !== 0 && user.active !== false,
    online: Boolean(user.online),
    login_at: user.login_at || user.last_sign_in_at || null,
    last_activity_at: user.last_activity_at || null,
    last_sale_at: user.last_sale_at || null,
    sales_today: Number(user.sales_today) || 0,
    sales_month: Number(user.sales_month) || 0,
    transactions_today: Number(user.transactions_today) || 0,
    transactions_month: Number(user.transactions_month) || 0,
    revenue: Number(user.sales_today) || 0,
    transactions: Number(user.transactions_today) || 0,
    profit: Number(user.profit_today) || 0,
  }));
}

async function ensureMatrix() {
  if (permissionMatrixCache) return permissionMatrixCache;
  const remote = await pos("permissions.getMatrix").catch(() => ({}));
  if (remote && typeof remote === "object" && remote.success !== false) {
    const matrix = remote.permission_matrix || remote;
    permissionMatrixCache =
      matrix && typeof matrix === "object" && Object.keys(matrix).length
        ? ensurePermissionShape({ ...buildDefaultMatrix(), ...matrix })
        : buildDefaultMatrix();
  } else {
    permissionMatrixCache = buildDefaultMatrix();
  }
  return permissionMatrixCache;
}

const rawApi = {
  __setAuthContext: setAuthContext,
  __isMock: false,
  __dataPlane: "supabase",

  platformPublic: {
    getPlans: async () => (CANONICAL_PLANS || []).filter(
      (p) => p.active !== false && p.public_visible !== false && PAID_PLAN_CODES.includes(p.code)
    ),
    getFeatures: async () => [],
    verifyInvoice: async (invoiceId) => {
      try {
        const res = await fetch(`/api/invoice-public?id=${encodeURIComponent(invoiceId)}`);
        return res.json();
      } catch (err) {
        return { success: false, error: err?.message || "Verify failed." };
      }
    },
    contact: async (payload = {}) => {
      try {
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "contact", ...payload }),
        });
        return res.json();
      } catch (err) {
        return { success: false, error: err?.message || "Contact failed." };
      }
    },
  },

  publicAuth: {
    createCompanyWorkspace: async (payload = {}) => {
      try {
        const data = await authFetch("/api/bootstrap-company-owner", {
          method: "POST",
          body: { ...payload, action: "signup_company", create_company: true },
        });
        if (data && data.success === false) {
          return { success: false, error: data.error || "Unable to create company workspace.", code: data.code };
        }
        return data?.success ? data : { success: true, ...data };
      } catch (err) {
        return { success: false, error: err?.message || "Unable to create company workspace." };
      }
    },
    companyNameTaken: async () => false,
    resolveCompany: async (companyIdentifier) => {
      const code = String(companyIdentifier || "").trim().toUpperCase();
      if (!code || code === "PLATFORM") return null;
      try {
        const res = await fetch(resolveApiUrl("/api/bootstrap-company-owner"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve_company", company_code: code }),
        });
        const data = await res.json().catch(() => null);
        if (!data?.success || !data?.company) return null;
        return data.company;
      } catch {
        return null;
      }
    },
    getCompanyById: async (companyId) => pos("companies.getById", { id: companyId }),
    checkCompanyAccess: async (companyId, options = {}) => pos("companies.checkAccess", {
      company_id: companyId,
      role: options.role,
    }),
    hydrateCompanyWorkspaceFromAuth: async (payload = {}) => pos("companies.hydrate", payload),
    activateCompanyForOwner: async (ownerUserId) => {
      if (!ownerUserId) return { success: false, error: "Missing owner id." };
      return pos("companies.activateForOwner", { owner_user_id: ownerUserId });
    },
    syncOwnerEmailProfile: async () => ({ success: true }),
    signupCompany: async () => ({
      success: false,
      error: "Signup is handled by Supabase Auth + bootstrap-company-owner.",
    }),
    verifyEmail: async () => ({ success: true }),
    requestPasswordReset: async () => ({
      success: true,
      message: "If an account matches, password reset instructions have been queued.",
    }),
    notifyPasswordChanged: async () => ({ success: true }),
    resetPassword: async () => ({
      success: false,
      error: "Use the reset password page with a Supabase recovery session.",
    }),
    socialProviderStatus: async () => ({ google: false, microsoft: false, apple: false }),
  },

  auth: {
    loginByEmail: async () => ({
      success: false,
      error: "Login is handled by AuthContext via Supabase Auth.",
      code: "DEPRECATED",
    }),
    login: async () => ({
      success: false,
      error: "Login is handled by AuthContext via Supabase Auth.",
      code: "DEPRECATED",
    }),
    restoreSession: async () => ({ success: false, error: "Session restore is handled by Supabase Auth." }),
    stopImpersonation: async () => ({ success: false, error: "Use AuthContext.stopImpersonation()." }),
    logout: async () => {
      setAuthContext(null);
      return { success: true };
    },
    heartbeat: async () => ({ success: Boolean(currentUser), at: new Date().toISOString() }),
    listUsers: async () => {
      const listed = await authFetch("/api/admin-list-users", { method: "POST", body: {} });
      // API returns { success, users }; never return the envelope — UI expects an array.
      if (Array.isArray(listed)) return listed;
      if (Array.isArray(listed?.users)) return listed.users;
      return [];
    },
    getUser: async (id) => {
      const listed = await authFetch("/api/admin-list-users", { method: "POST", body: { id } });
      if (listed?.user) return listed.user;
      const users = Array.isArray(listed?.users) ? listed.users : (Array.isArray(listed) ? listed : []);
      return users.find((u) => String(u.id) === String(id)) || null;
    },
  },

  users: {
    getStatus: async () => listCompanyUsersStatus(),
    getDashboard: async () => {
      const status = await listCompanyUsersStatus();
      const ranked = (Array.isArray(status) ? status : [])
        .map((entry) => ({
          ...entry,
          revenue: Number(entry.revenue ?? entry.sales_today) || 0,
          transactions: Number(entry.transactions ?? entry.transactions_today) || 0,
          profit: Number(entry.profit) || 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);
      return {
        success: true,
        users: ranked,
        cashiers: ranked.filter((entry) => normalizeRole(entry.role) === "cashier"),
      };
    },
  },

  health: {
    probe: () => pos("health.probe"),
  },

  products: {
    getAll: (params = {}) => cachedPos("products.getAll", params, [], LIST_TTL_MS),
    getByBarcode: (barcode) => pos("products.getByBarcode", { barcode }),
    getCategories: () => cachedPos("categories.getAll", {}, [], LOOKUP_TTL_MS),
    create: async (product) => {
      const result = await pos("products.create", product);
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    update: async (product) => {
      const result = await pos("products.update", product);
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    archive: async (id) => {
      const result = await pos("products.archive", { id });
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    restore: async (id) => {
      const result = await pos("products.restore", { id });
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    delete: async (id, opts = {}) => {
      const result = await pos("products.delete", { id, ...opts });
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    import: async (rows) => {
      const result = await pos("products.import", { rows });
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    adjustStock: async (id, delta, reason = "Manual adjustment") => {
      const result = await pos("products.adjustStock", { id, delta, reason });
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
  },

  brands: {
    getAll: () => cachedPos("brands.getAll", {}, [], LOOKUP_TTL_MS),
    create: async (payload) => {
      const result = await pos("brands.create", payload);
      invalidateEntityCaches("brands.getAll");
      return result;
    },
    update: async (payload) => {
      const result = await pos("brands.update", payload);
      invalidateEntityCaches("brands.getAll");
      return result;
    },
    delete: async (id) => {
      const result = await pos("brands.delete", { id });
      invalidateEntityCaches("brands.getAll");
      return result;
    },
  },

  units: {
    getAll: () => cachedPos("units.getAll", {}, [], LOOKUP_TTL_MS),
    create: async (payload) => {
      const result = await pos("units.create", payload);
      invalidateEntityCaches("units.getAll");
      return result;
    },
    update: async (payload) => {
      const result = await pos("units.update", payload);
      invalidateEntityCaches("units.getAll");
      return result;
    },
    delete: async (id) => {
      const result = await pos("units.delete", { id });
      invalidateEntityCaches("units.getAll");
      return result;
    },
  },

  warehouses: {
    getAll: () => cachedPos("warehouses.getAll", {}, [], LOOKUP_TTL_MS),
    create: async (payload) => {
      const result = await pos("warehouses.create", payload);
      invalidateEntityCaches("warehouses.getAll");
      return result;
    },
    update: async (payload) => {
      const result = await pos("warehouses.update", payload);
      invalidateEntityCaches("warehouses.getAll");
      return result;
    },
    delete: async (id) => {
      const result = await pos("warehouses.delete", { id });
      invalidateEntityCaches("warehouses.getAll");
      return result;
    },
    setMain: async (id) => {
      const result = await pos("warehouses.setMain", { id });
      invalidateEntityCaches("warehouses.getAll", "inventory.getWarehouseStock", "inventory.getStats");
      return result;
    },
  },

  categories: {
    getAll: () => cachedPos("categories.getAll", {}, [], LOOKUP_TTL_MS),
    create: async (payload) => {
      const result = await pos("categories.create", payload);
      invalidateEntityCaches("categories.getAll", "products.getAll");
      return result;
    },
    update: async (payload) => {
      const result = await pos("categories.update", payload);
      invalidateEntityCaches("categories.getAll", "products.getAll");
      return result;
    },
    delete: async (id) => {
      const result = await pos("categories.delete", { id });
      invalidateEntityCaches("categories.getAll", "products.getAll");
      return result;
    },
  },

  sales: {
    create: async (sale) => {
      if (!currentUser) {
        return { success: false, error: "Authentication is required to complete a sale.", code: "UNAUTHENTICATED" };
      }
      let saleTotal = Number(sale.total);
      if (!Number.isFinite(saleTotal)) {
        const itemsSubtotal = (sale.items || []).reduce(
          (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0),
          0
        );
        saleTotal = Math.max(0, Number((itemsSubtotal - Number(sale.discount || 0) + Number(sale.vat || 0)).toFixed(2)));
      }
      const paid = validateSalePayment({
        payment_method: sale.payment_method,
        total: saleTotal,
        cash_tendered: sale.cash_tendered,
        card_brand: sale.card_brand,
        mpesa_reference: sale.payment_reference,
      });
      if (!paid.success) {
        return { success: false, error: paid.error, code: "PAYMENT_INVALID" };
      }
      const result = await pos("sales.create", {
        ...sale,
        total: saleTotal,
        payment_method: paid.payment_method,
        cash_tendered: paid.cash_tendered,
        change_due: paid.change_due,
        card_brand: paid.card_brand,
        payment_reference: paid.payment_reference,
        split_payments: paid.split_payments,
        company_name: currentUser.company?.name,
        branch_name: currentUser.company?.branch_name || "",
      });
      if (result?.success) {
        invalidateEntityCaches(
          "products.getAll",
          "inventory.getStats",
          "inventory.getLowStock",
          "notifications.list",
          "reports.getAnalytics",
          "sales.getSummary"
        );
      }
      return result;
    },
    hold: (sale) => pos("sales.hold", sale),
    getHeld: () => posOrEmpty("sales.getHeld", {}, []),
    releaseHeld: (id) => pos("sales.releaseHeld", { id }),
    getRecent: (limit = 10) => posOrEmpty("sales.getRecent", { limit }, []),
    getSummary: () => cachedPos("sales.getSummary", {}, {}, LIST_TTL_MS),
    getWeeklyTrend: () => cachedPos("sales.getWeeklyTrend", {}, [], LIST_TTL_MS),
    getItems: (saleId) => posOrEmpty("sales.getItems", { saleId }, []),
    createReturn: async (payload) => {
      const result = await pos("sales.createReturn", payload);
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "reports.getAnalytics");
      return result;
    },
  },

  customers: {
    getAll: (params = {}) => cachedPos("customers.getAll", params, [], LIST_TTL_MS),
    getCount: () => cachedPos("customers.getCount", {}, { success: true, count: 0 }, LIST_TTL_MS),
    create: async (customer) => {
      const result = await pos("customers.create", customer);
      invalidateEntityCaches("customers.getAll", "customers.getCount");
      return result;
    },
    update: async (customer) => {
      const result = await pos("customers.update", customer);
      invalidateEntityCaches("customers.getAll", "customers.getCount");
      return result;
    },
    delete: async (id) => {
      const result = await pos("customers.delete", { id });
      invalidateEntityCaches("customers.getAll", "customers.getCount");
      return result;
    },
    addPayment: (payload) => pos("customers.addPayment", payload),
    adjustPoints: (payload) => pos("customers.adjustPoints", payload),
    getStatement: (id) => pos("customers.getStatement", { id }),
    getPurchaseHistory: (id) => posOrEmpty("customers.getPurchaseHistory", { id }, []),
  },

  suppliers: {
    getAll: (params = {}) => cachedPos("suppliers.getAll", params, [], LIST_TTL_MS),
    getDashboard: (params = {}) => pos("suppliers.getDashboard", params),
    getReports: (params = {}) => pos("suppliers.getReports", params),
    create: async (supplier) => {
      const result = await pos("suppliers.create", supplier);
      invalidateEntityCaches("suppliers.getAll");
      return result;
    },
    update: async (supplier) => {
      const result = await pos("suppliers.update", supplier);
      invalidateEntityCaches("suppliers.getAll");
      return result;
    },
    archive: async (id) => {
      const result = await pos("suppliers.archive", { id });
      invalidateEntityCaches("suppliers.getAll");
      return result;
    },
    restore: async (id) => {
      const result = await pos("suppliers.restore", { id });
      invalidateEntityCaches("suppliers.getAll");
      return result;
    },
    delete: async (id, opts = {}) => {
      const result = await pos("suppliers.delete", typeof id === "object" ? id : { id, ...opts });
      invalidateEntityCaches("suppliers.getAll");
      return result;
    },
    addPayment: async (payload) => {
      const result = await pos("suppliers.addPayment", payload);
      invalidateEntityCaches("suppliers.getAll");
      return result;
    },
    getStatement: (idOrParams) =>
      pos("suppliers.getStatement", typeof idOrParams === "object" ? idOrParams : { id: idOrParams }),
    getLedger: (id) => pos("suppliers.getLedger", { id }),
    getPurchaseHistory: (id) => posOrEmpty("suppliers.getPurchaseHistory", { id }, []),
    addStatementEntry: async (payload) => {
      const result = await pos("suppliers.addStatementEntry", payload);
      invalidateEntityCaches("suppliers.getAll");
      return result;
    },
    deleteStatementEntry: async (id) => {
      const result = await pos("suppliers.deleteStatementEntry", { id });
      invalidateEntityCaches("suppliers.getAll");
      return result;
    },
    emailStatement: async ({ supplier_id, to, pdf_base64, filename, message } = {}) => {
      try {
        return await authFetch("/api/send-email", {
          method: "POST",
          body: { type: "supplier_statement", supplier_id, to, pdf_base64, filename, message },
        });
      } catch (err) {
        return { success: false, error: err?.message || "Could not email statement." };
      }
    },
  },

  purchases: {
    getAll: (params = {}) => cachedPos("purchases.getAll", params, [], LIST_TTL_MS),
    getItems: (id) => posOrEmpty("purchases.getItems", { id }, []),
    getReturns: () => posOrEmpty("purchases.getReturns", {}, []),
    getPayments: (id) => posOrEmpty("purchases.getPayments", { id }, []),
    getDashboard: () => cachedPos("purchases.getDashboard", {}, null, LIST_TTL_MS),
    getReports: () => posOrEmpty("purchases.getReports", {}, {}),
    getAudit: (params = {}) => posOrEmpty("purchases.getAudit", params, []),
    getJournal: (params = {}) => posOrEmpty("purchases.getJournal", params, []),
    create: async (purchase) => {
      const result = await pos("purchases.create", purchase);
      invalidateEntityCaches("purchases.getAll", "purchases.getDashboard", "notifications.list", "suppliers.getAll");
      return result;
    },
    update: async (purchase) => {
      const result = await pos("purchases.update", purchase);
      invalidateEntityCaches("purchases.getAll", "purchases.getDashboard", "notifications.list");
      return result;
    },
    duplicate: async (id) => {
      const result = await pos("purchases.duplicate", { id });
      invalidateEntityCaches("purchases.getAll", "purchases.getDashboard", "notifications.list");
      return result;
    },
    approve: async (id, opts = {}) => {
      const result = await pos("purchases.approve", typeof id === "object" ? id : { id, ...opts });
      invalidateEntityCaches(
        "purchases.getAll",
        "purchases.getDashboard",
        "products.getAll",
        "inventory.getStats",
        "inventory.getLowStock",
        "notifications.list",
        "suppliers.getAll"
      );
      return result;
    },
    receive: async (id, opts = {}) => {
      const result = await pos("purchases.receive", typeof id === "object" ? id : { id, ...opts });
      invalidateEntityCaches(
        "purchases.getAll",
        "purchases.getDashboard",
        "products.getAll",
        "inventory.getStats",
        "inventory.getLowStock",
        "notifications.list",
        "suppliers.getAll"
      );
      return result;
    },
    addPayment: async (payload) => {
      const result = await pos("purchases.addPayment", payload);
      invalidateEntityCaches("purchases.getAll", "purchases.getDashboard", "suppliers.getAll", "notifications.list");
      return result;
    },
    cancel: async (id) => {
      const result = await pos("purchases.cancel", { id });
      invalidateEntityCaches("purchases.getAll", "purchases.getDashboard", "notifications.list");
      return result;
    },
    updateStatus: async (id, status, extra = {}) => {
      const result = await pos("purchases.updateStatus", typeof status === "object" ? { id, ...status } : { id, status, ...extra });
      invalidateEntityCaches("purchases.getAll", "purchases.getDashboard", "notifications.list");
      return result;
    },
    createReturn: async (ret) => {
      const result = await pos("purchases.createReturn", ret);
      invalidateEntityCaches("purchases.getAll", "purchases.getDashboard", "products.getAll", "inventory.getStats", "suppliers.getAll");
      return result;
    },
  },

  inventory: {
    getTransfers: () => posOrEmpty("inventory.getTransfers", {}, []),
    transferStock: async (payload) => {
      const result = await pos("inventory.transferStock", payload);
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "inventory.getMovements");
      return result;
    },
    getStats: () => cachedPos("inventory.getStats", {}, {}, LIST_TTL_MS),
    getLowStock: (params = {}) => cachedPos("inventory.getLowStock", params, [], LIST_TTL_MS),
    getExpiring: (days = 30) => posOrEmpty("inventory.getExpiring", { days }, []),
    getMovements: (filters = {}) => posOrEmpty("inventory.getMovements", filters, []),
    getWarehouseStock: (warehouseId) => posOrEmpty("inventory.getWarehouseStock", { warehouseId }, []),
    getMovementChart: (days = 30) => posOrEmpty("inventory.getMovementChart", { days }, []),
    getReports: () => posOrEmpty("inventory.getReports", {}, {}),
    getAudit: (params = {}) => posOrEmpty("inventory.getAudit", params, []),
    getCounts: () => posOrEmpty("inventory.getCounts", {}, []),
    getCount: (id) => pos("inventory.getCount", { id }),
    createCount: async (payload) => {
      const result = await pos("inventory.createCount", payload);
      return result;
    },
    postCount: async (id) => {
      const result = await pos("inventory.postCount", { id });
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "inventory.getMovements");
      return result;
    },
    stockIn: async (payload) => {
      const result = await pos("inventory.stockIn", payload);
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    stockOut: async (payload) => {
      const result = await pos("inventory.stockOut", payload);
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    adjust: async (payload) => {
      const result = await pos("inventory.adjust", payload);
      invalidateEntityCaches("products.getAll", "inventory.getStats", "inventory.getLowStock", "notifications.list");
      return result;
    },
    listVariantSkus: (params = {}) => posOrEmpty("inventory.listVariantSkus", params, []),
    upsertVariantSku: async (payload) => {
      const result = await pos("inventory.upsertVariantSku", payload);
      invalidateEntityCaches("products.getAll", "inventory.getStats");
      return result;
    },
    listSerials: (params = {}) => posOrEmpty("inventory.listSerials", params, []),
    registerSerials: async (payload) => {
      const result = await pos("inventory.registerSerials", payload);
      invalidateEntityCaches("inventory.getStats");
      return result;
    },
    listOpenLots: (params = {}) => posOrEmpty("inventory.listOpenLots", params, []),
    previewLotPick: (params = {}) => pos("inventory.previewLotPick", params),
  },

  barcode: {
    listStatus: async () => {
      const products = await posOrEmpty("products.getAll", {}, []);
      const withCode = products.filter((p) => p.barcode);
      return { total: products.length, with_barcode: withCode.length, missing: products.length - withCode.length };
    },
    generate: async (productId) => {
      const code = `89${String(productId).padStart(10, "0")}`.slice(0, 12);
      return pos("products.update", { id: productId, barcode: code });
    },
    generateBulk: async (ids = []) => {
      const results = [];
      for (const id of ids) results.push(await rawApi.barcode.generate(id));
      return { success: true, results };
    },
    assign: (productId, code) => pos("products.update", { id: productId, barcode: code }),
    search: async (query) => {
      const products = await posOrEmpty("products.getAll", {}, []);
      const q = String(query || "").toLowerCase();
      return products.filter(
        (p) => String(p.barcode || "").includes(q) || String(p.name || "").toLowerCase().includes(q)
      );
    },
    getLabelData: async (productIds = [], size = "50x25") => {
      const products = await posOrEmpty("products.getAll", {}, []);
      const selected = products.filter((p) => productIds.includes(p.id));
      return { size, products: selected };
    },
  },

  expenses: {
    getAll: (params = {}) => cachedPos("expenses.getAll", params, [], LIST_TTL_MS),
    getCategories: () => cachedPos("expenses.getCategories", {}, [], LOOKUP_TTL_MS),
    createCategory: async (name) => {
      const result = await pos("expenses.createCategory", { name });
      invalidateEntityCaches("expenses.getCategories");
      return result;
    },
    create: async (expense) => {
      const result = await pos("expenses.create", expense);
      invalidateEntityCaches("expenses.getAll", "expenses.getSummary");
      return result;
    },
    update: async (expense) => {
      const result = await pos("expenses.update", expense);
      invalidateEntityCaches("expenses.getAll", "expenses.getSummary");
      return result;
    },
    delete: async (id) => {
      const result = await pos("expenses.delete", { id });
      invalidateEntityCaches("expenses.getAll", "expenses.getSummary");
      return result;
    },
    attachReceipt: async () => ({ success: false, error: "File attachments require a hosted upload service." }),
    openReceipt: async () => ({ success: false, error: "Receipt preview requires a hosted file service." }),
    getSummary: () => cachedPos("expenses.getSummary", {}, {}, LIST_TTL_MS),
  },

  payroll: {
    getSettings: () => pos("payroll.getSettings"),
    updateSettings: (payload) => pos("payroll.updateSettings", payload),
    listEmployees: (params = {}) => posOrEmpty("payroll.listEmployees", params, []),
    getEmployee: (id) => pos("payroll.getEmployee", { id }),
    createEmployee: (payload) => pos("payroll.createEmployee", payload),
    updateEmployee: (payload) => pos("payroll.updateEmployee", payload),
    deleteEmployee: (id) => pos("payroll.deleteEmployee", { id }),
    addDocument: (payload) => pos("payroll.addDocument", payload),
    listAttendance: (params = {}) => posOrEmpty("payroll.listAttendance", params, []),
    checkIn: (payload = {}) => pos("payroll.checkIn", payload),
    checkOut: (payload = {}) => pos("payroll.checkOut", payload),
    recordAttendance: (payload) => pos("payroll.recordAttendance", payload),
    listLeave: (params = {}) => posOrEmpty("payroll.listLeave", params, []),
    requestLeave: (payload) => pos("payroll.requestLeave", payload),
    approveLeave: (id) => pos("payroll.approveLeave", { id }),
    rejectLeave: (id, reason) => pos("payroll.rejectLeave", { id, reason }),
    getLeaveBalances: (params = {}) => posOrEmpty("payroll.getLeaveBalances", params, []),
    listSalaryStructures: (params = {}) => posOrEmpty("payroll.listSalaryStructures", params, []),
    upsertSalaryStructure: (payload) => pos("payroll.upsertSalaryStructure", payload),
    listLoans: (params = {}) => posOrEmpty("payroll.listLoans", params, []),
    createLoan: (payload) => pos("payroll.createLoan", payload),
    listRuns: (params = {}) => posOrEmpty("payroll.listRuns", params, []),
    createRun: (payload) => pos("payroll.createRun", payload),
    previewRun: (id, extras = {}) => pos("payroll.previewRun", { id, ...extras }),
    regenerateRun: (id) => pos("payroll.regenerateRun", { id }),
    approveRun: (id) => pos("payroll.approveRun", { id }),
    lockRun: (id) => pos("payroll.lockRun", { id }),
    unlockRun: (id) => pos("payroll.unlockRun", { id }),
    rollbackRun: (id) => pos("payroll.rollbackRun", { id }),
    listPayslips: (params = {}) => posOrEmpty("payroll.listPayslips", params, []),
    getPayslip: (id) => pos("payroll.getPayslip", { id }),
    bankExport: (runId) => pos("payroll.bankExport", { run_id: runId }),
    getDashboard: () => pos("payroll.getDashboard"),
    getReports: (params = {}) => pos("payroll.getReports", params),
    selfOverview: () => pos("payroll.selfOverview"),
  },

  dashboard: {
    getExtendedStats: () => cachedPos("dashboard.getExtendedStats", {}, null, 15_000),
  },

  reports: {
    getAnalytics: (filters = {}) => cachedPos("reports.getAnalytics", filters, null, 15_000),
    getUserSales: (filters = {}) => pos("reports.getUserSales", filters),
    getRevenueVsExpenses: () => pos("reports.getRevenueVsExpenses"),
    getTopProducts: (limit = 5) => pos("reports.getTopProducts", { limit }),
    getCategorySales: () => pos("reports.getCategorySales"),
    getProfitSummary: () => pos("reports.getProfitSummary"),
    getSalesReport: () => pos("reports.getSalesReport"),
    getPurchaseReport: () => pos("reports.getPurchaseReport"),
    getProfitLoss: () => pos("reports.getProfitLoss"),
    getExpenseReport: () => pos("reports.getExpenseReport"),
    getInventoryReport: () => pos("reports.getInventoryReport"),
    getLowStockReport: () => pos("reports.getLowStockReport"),
    getCustomerReport: () => pos("reports.getCustomerReport"),
    getSupplierReport: () => pos("reports.getSupplierReport"),
  },

  settings: {
    getAll: () => cachedPos("settings.getAll", {}, {}, LOOKUP_TTL_MS),
    getPublic: () =>
      cachedPos(
        "settings.getPublic",
        {},
        {
          store_name: "",
          currency: "KES",
          enable_multi_currency: "true",
          admin_can_edit_rates: "false",
          active_currencies: [],
        },
        LOOKUP_TTL_MS
      ),
    update: async (updates) => {
      const result = await pos("settings.update", updates);
      invalidateEntityCaches("settings.getAll", "settings.getPublic", "currency.list");
      return result;
    },
    getPrinters: async () => posOrEmpty("settings.getPrinters", {}, []),
  },

  currency: {
    list: () => cachedPos("currency.list", {}, { currencies: [], settings: {} }, LOOKUP_TTL_MS),
    getActive: () => cachedPos("currency.getActive", {}, [], LOOKUP_TTL_MS),
    getHistory: (params = {}) => posOrEmpty("currency.getHistory", params, []),
    create: async (payload) => {
      const result = await pos("currency.create", payload);
      invalidateEntityCaches("currency.list", "currency.getActive");
      return result;
    },
    update: async (payload) => {
      const result = await pos("currency.update", payload);
      invalidateEntityCaches("currency.list", "currency.getActive");
      return result;
    },
    setBase: async (code) => {
      const result = await pos("currency.setBase", typeof code === "object" ? code : { code });
      invalidateEntityCaches("currency.list", "currency.getActive", "settings.getAll");
      return result;
    },
    setDefault: async (code) => {
      const result = await pos("currency.setDefault", typeof code === "object" ? code : { code });
      invalidateEntityCaches("currency.list", "currency.getActive", "settings.getAll");
      return result;
    },
    updateRate: async (payload) => {
      const result = await pos("currency.updateRate", payload);
      invalidateEntityCaches("currency.list", "currency.getActive");
      return result;
    },
    setPolicy: async (payload) => {
      const result = await pos("currency.setPolicy", payload);
      invalidateEntityCaches("currency.list", "settings.getAll");
      return result;
    },
  },

  backup: {
    export: async () => {
      const result = await pos("backup.export");
      if (!result?.success || !result.payload) return result;
      try {
        const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName || "nexora-pos-backup.json";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        return { success: true, filePath: result.fileName || "nexora-pos-backup.json" };
      } catch (err) {
        return { success: false, error: err?.message || "Download failed." };
      }
    },
    restore: async () =>
      pos("backup.restore").catch(() => ({
        success: false,
        error: "Restore via Supabase backup tooling.",
      })),
    getHistory: async () => posOrEmpty("backup.getHistory", {}, []),
    runNow: async () => pos("backup.runNow"),
  },

  notifications: {
    list: () => cachedPos("notifications.list", {}, { success: true, items: [], unread: 0 }, 30_000),
  },

  sync: {
    getStatus: async () => {
      try {
        const { getOfflineQueueStats } = await import("./offlineSalesDb");
        const stats = await getOfflineQueueStats();
        return {
          configured: true,
          enabled: true,
          provider: "supabase",
          pendingCount: stats.pending + stats.failed + stats.syncing,
          failedCount: stats.failed,
          last_sync: new Date().toISOString(),
        };
      } catch {
        return { configured: true, enabled: true, provider: "supabase", pendingCount: 0, last_sync: new Date().toISOString() };
      }
    },
    triggerNow: async () => {
      const { syncPendingSales } = await import("./offlineSync");
      return syncPendingSales(rawApi);
    },
    runNow: async () => {
      const { syncPendingSales } = await import("./offlineSync");
      return syncPendingSales(rawApi);
    },
    setAutoSync: async () => ({ success: true }),
    onConnectionRestored: async () => {
      const { syncPendingSales } = await import("./offlineSync");
      return syncPendingSales(rawApi);
    },
  },

  permissions: {
    getMine: async () => {
      const matrix = await ensureMatrix();
      const role = currentUser?.role || "cashier";
      if (isPlatformOwner(role)) return buildDefaultMatrix().platform_owner || matrix.owner || {};
      return matrix[role] || buildDefaultMatrix()[role] || {};
    },
    getMatrix: async () => {
      const { MODULE_IDS, ACTIONS, SYSTEM_ROLES, hasPermission, isOwner, isSuperAdmin, normalizeRole } = await import("./rbac");
      const matrix = await ensureMatrix();
      const role = normalizeRole(currentUser?.role);
      return {
        matrix,
        modules: MODULE_IDS,
        actions: ACTIONS,
        roles: SYSTEM_ROLES.filter((r) => r.id !== "platform_owner" || isPlatformOwner(role)).map((r) => ({
          id: r.id,
          label: r.label,
          description: r.description,
          color: r.color,
          system: true,
        })),
        meta: {
          canCreateRoles: isOwner(role) || isSuperAdmin(role),
          canDeleteRoles: isOwner(role) || isSuperAdmin(role),
          canEditPermissions: hasPermission(role, "roles", "edit", matrix),
        },
      };
    },
    getRoles: async () => Object.keys(await ensureMatrix()),
    update: async ({ role, module, action, allowed }) => {
      const {
        MODULE_IDS,
        ACTIONS,
        hasPermission,
        isOwner,
        isSuperAdmin,
        normalizeRole,
        ensurePermissionShape,
      } = await import("./rbac");
      const actor = normalizeRole(currentUser?.role);
      const roleId = normalizeRole(role);
      if (!hasPermission(actor, "roles", "edit", await ensureMatrix())) {
        return { success: false, error: "Permission denied.", code: "FORBIDDEN" };
      }
      if (roleId === "owner" || (roleId === "super_admin" && !isOwner(actor))) {
        return { success: false, error: "Owner and Super Admin protections cannot be modified by this role." };
      }
      if (!MODULE_IDS.includes(module) || !ACTIONS.includes(action)) {
        return { success: false, error: "Invalid permission target." };
      }
      if (!isOwner(actor) && !isSuperAdmin(actor) && actor !== "admin") {
        return { success: false, error: "Only Admin, Super Admin, or Owner can edit permissions." };
      }
      const matrix = ensurePermissionShape(await ensureMatrix());
      if (!matrix[roleId]) return { success: false, error: "Unknown role." };
      matrix[roleId][module][action] = !!allowed;
      permissionMatrixCache = matrix;
      return pos("permissions.saveMatrix", { matrix });
    },
    save: async (roleId, permissions) => {
      const matrix = await ensureMatrix();
      matrix[roleId] = permissions;
      permissionMatrixCache = matrix;
      return pos("permissions.saveMatrix", { matrix });
    },
    createRole: async () => ({ success: false, error: "Custom roles require additional schema work." }),
    deleteRole: async () => ({ success: false, error: "System roles cannot be deleted." }),
    resetDefaults: async (roleId) => {
      const { buildDefaultMatrix: defaultsFn, isOwner, normalizeRole } = await import("./rbac");
      const actor = normalizeRole(currentUser?.role);
      if (!isOwner(actor) && actor !== "super_admin" && actor !== "admin") {
        return { success: false, error: "Permission denied." };
      }
      const defaults = defaultsFn();
      const matrix = await ensureMatrix();
      if (roleId) {
        if (roleId === "owner" || (roleId === "super_admin" && !isOwner(actor))) {
          return { success: false, error: "Protected role defaults cannot be changed by this account." };
        }
        if (!defaults[roleId]) return { success: false, error: "No defaults for this role." };
        matrix[roleId] = structuredClone(defaults[roleId]);
      } else {
        permissionMatrixCache = defaultsFn();
        return pos("permissions.saveMatrix", { matrix: permissionMatrixCache });
      }
      permissionMatrixCache = matrix;
      return pos("permissions.saveMatrix", { matrix });
    },
  },

  audit: {
    getAll: (opts = {}) => posOrEmpty("audit.getAll", opts, []),
    getLoginHistory: () => posOrEmpty("audit.getLoginHistory", {}, []),
  },

  auth_admin: {
    createUser: (payload) => authFetch("/api/admin-create-user", { method: "POST", body: payload }),
    updateUser: (id, updates) => authFetch("/api/admin-update-user", { method: "POST", body: { id, ...updates } }),
    setUserActive: (id, active) =>
      authFetch("/api/admin-update-user", { method: "POST", body: { id, active: active ? 1 : 0 } }),
    resetPassword: (id, password) =>
      authFetch("/api/admin-reset-password", { method: "POST", body: { id, password } }),
    deleteUser: (id) => authFetch("/api/admin-delete-user", { method: "POST", body: { id } }),
    impersonate: (targetId) => authFetch("/api/admin-impersonate", { method: "POST", body: { target_id: targetId } }),
  },

  approvals: {
    getAll: async () => [],
    decide: async () => ({ success: false, error: "Approvals workflow not migrated to Postgres yet." }),
  },

  owner: {
    /** Company Owner self-service (tenant-scoped hydrate). */
    getCompany: async () => {
      if (!currentUser?.company_id) return null;
      return pos("companies.getById", { id: currentUser.company_id });
    },
    /** @deprecated Prefer platform.updateCompany — kept for Company Owner settings forms. */
    updateCompanySelf: async (updates) => {
      if (!currentUser?.company_id) return { success: false, error: "No company." };
      return pos("companies.hydrate", {
        company_id: currentUser.company_id,
        company_name: updates.name,
        company_code: updates.code,
        currency: updates.currency,
        email: updates.email,
        phone: updates.phone,
        supabase_user_id: currentUser.id,
        email_verified: true,
      });
    },

    // ---- Platform Owner console (platform_owner only; enforced server-side) ----
    getOverview: (filters = {}) => pos("platform.getOverview", filters),
    getPlatformConsole: () => pos("platform.getConsole", {}),
    getCompanyDetail: (id) => pos("platform.getCompany", { id }),
    updateCompany: (id, updates = {}) => pos("platform.updateCompany", { id, ...updates }),
    activateCompany: (id) => pos("platform.activateCompany", { id }),
    deactivateCompany: (id) => pos("platform.deactivateCompany", { id }),
    suspendCompany: (id) => pos("platform.suspendCompany", { id }),
    deleteCompany: (id) => pos("platform.deleteCompany", { id }),
    lockCompany: (id) => pos("platform.lockCompany", { id }),
    unlockCompany: (id) => pos("platform.unlockCompany", { id }),
    updateSubscription: (companyId, updates = {}) =>
      pos("platform.updateSubscription", { company_id: companyId, ...updates }),
    extendSubscription: (companyId, days = 30) =>
      pos("platform.extendSubscription", { company_id: companyId, days }),
    extendTrial: (companyId, days = 7) =>
      pos("platform.extendTrial", { company_id: companyId, days }),
    markPaid: (companyId, payload = {}) =>
      pos("platform.markPaid", { company_id: companyId, ...payload }),
    getCompanyHistory: (companyId) =>
      pos("platform.getCompanyHistory", { company_id: companyId }),
    resetOwnerPassword: (companyId, password) =>
      pos("platform.resetOwnerPassword", { company_id: companyId, password }),
    recordAudit: (action, details = {}) =>
      pos("platform.recordAudit", { action, details, company_id: details.company_id }),
    impersonateUser: (targetId) =>
      authFetch("/api/admin-impersonate", { method: "POST", body: { target_id: targetId } }),

    // Deferred / not provisioned in Postgres (honest stubs)
    savePlan: async () => ({
      success: false,
      error: "Plan catalog is code-defined (CANONICAL_PLANS). Edit via release, not runtime DB.",
      code: "NOT_IMPLEMENTED",
    }),
    saveFeature: async () => ({ success: false, error: "Feature flags table not provisioned.", code: "NOT_IMPLEMENTED" }),
    toggleCompanyFeature: async () => ({ success: false, error: "Feature overrides table not provisioned.", code: "NOT_IMPLEMENTED" }),
    addDomain: async () => ({ success: false, error: "Domains table not provisioned.", code: "NOT_IMPLEMENTED" }),
    verifyDomain: async () => ({ success: false, error: "Domains table not provisioned.", code: "NOT_IMPLEMENTED" }),
    setPrimaryDomain: async () => ({ success: false, error: "Domains table not provisioned.", code: "NOT_IMPLEMENTED" }),
    removeDomain: async () => ({ success: false, error: "Domains table not provisioned.", code: "NOT_IMPLEMENTED" }),
    updatePlatformSettings: async () => ({ success: true, note: "No persistent platform_settings table; acknowledged." }),
    createCompanyAccount: async () => ({
      success: false,
      error: "Create companies via public signup + bootstrap, or seed with ensure-permanent-owner.",
      code: "NOT_IMPLEMENTED",
    }),
    verifyCompanyOwnerEmail: async () => ({ success: false, error: "Use Auth email confirmation flow.", code: "NOT_IMPLEMENTED" }),
    getActivity: async () => ({ success: false, error: "Per-user activity detail not migrated.", code: "NOT_IMPLEMENTED" }),
  },

  branches: {
    getAll: () => cachedPos("branches.getAll", {}, [], LOOKUP_TTL_MS),
    create: async (payload) => {
      const result = await pos("branches.create", payload);
      invalidateEntityCaches("branches.getAll");
      return result;
    },
    update: async (payload) => {
      const result = await pos("branches.update", payload);
      invalidateEntityCaches("branches.getAll");
      return result;
    },
    delete: async (id) => {
      const result = await pos("branches.delete", { id });
      invalidateEntityCaches("branches.getAll");
      return result;
    },
  },

  subscription: {
    get: () => pos("subscription.get"),
    getPlans: async () => (CANONICAL_PLANS || []).filter((p) => p.active !== false),
    changePlan: (payload) => pos("subscription.changePlan", payload),
    requestRenewal: (payload) => pos("subscription.requestRenewal", payload),
    update: (payload) => pos("subscription.update", payload),
  },

  plans: {
    getAll: async () => CANONICAL_PLANS || [],
    listPublic: async () => (CANONICAL_PLANS || []).filter(
      (p) => p.active !== false && p.public_visible !== false && PAID_PLAN_CODES.includes(p.code)
    ),
  },
};

const permissionWrapped = applyPermissionMiddleware(rawApi, () => ({
  role: currentUser?.role,
  matrix: permissionMatrixCache || buildDefaultMatrix(),
}));

permissionWrapped.__setAuthContext = setAuthContext;
permissionWrapped.__isMock = false;
permissionWrapped.__dataPlane = "supabase";

export const supabaseApi = permissionWrapped;
export { getCurrency };
