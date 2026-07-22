import {
  ACTIONS,
  MODULE_IDS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_IDS,
  buildDefaultMatrix,
  ensurePermissionShape,
  getPermissionsForRole,
  hasPermission,
  canManageRole,
  isOwner,
  isPlatformOwner,
  isSuperAdmin,
  isUserManagerRole,
  normalizeRole,
  slugifyRoleId,
} from "./rbac";
import {
  APPROVAL_REQUEST_TYPES,
  canDecideApproval,
  canSubmitApproval,
  initialApprovalStatus,
  isValidApprovalType,
} from "./approvalWorkflow";
import { applyPermissionMiddleware } from "./permissionMiddleware";
import {
  CURRENCIES,
  convertToBase,
  formatCurrency,
  getCurrency,
  isSupportedCurrency,
  normalizeCurrencyCode,
} from "./currency";
import {
  applyStockDelta,
  computeInventoryStats,
  ensureInventoryCollections,
  enrichProduct,
  getExpiringLots,
  getLowStockProducts,
  seedBrands,
  seedUnits,
  seedWarehouses,
  seedStockMovements,
  buildWarehouseStock,
} from "./inventoryHelpers";
import { buildReportAnalytics } from "./reportAnalytics";
import bcrypt from "bcryptjs";
import {
  CANONICAL_PLANS,
  DEFAULT_TRIAL_DAYS,
  BILLING_CURRENCY,
  checkPlanLimit,
  getPlanByCode,
  mergeCanonicalPlans,
  normalizePlanCode,
  PAID_PLAN_CODES,
  safePublicPlan,
} from "./subscriptionPlans";
import { authFetch } from "./authApi";
import { isValidEmail as validEmail } from "./emailValidation";
import { validateSalePayment } from "./paymentMethods";
import { deriveInvoiceStatus, formatReceiptNumber, resolveReceiptNumber } from "./receiptCodes";

const STORAGE_KEY = "nexora_pos_web_db_v3";
const LEGACY_STORAGE_KEY = "nexora_pos_web_db_v2";
const DEMO_USERS = [
  { id: 1, name: "Amina Owino", username: "superadmin", email: "superadmin@nexora.demo", password: "SuperAdmin123!", pin: "1111", role: "super_admin", active: 1, branch_id: 1 },
  { id: 2, name: "Jane Mwikali", username: "admin", email: "admin@nexora.demo", password: "NexoraDemo123!", pin: "3333", role: "admin", active: 1, branch_id: 1 },
  { id: 3, name: "Lucy Wambui", username: "manager", email: "manager@nexora.demo", password: "NexoraDemo123!", pin: "4444", role: "branch_manager", active: 1, branch_id: 1 },
  { id: 4, name: "Peter Njoroge", username: "inventory", email: "inventory@nexora.demo", password: "NexoraDemo123!", pin: "5555", role: "inventory_manager", active: 1, branch_id: 1 },
  { id: 5, name: "Grace Achieng", username: "sales", email: "sales@nexora.demo", password: "NexoraDemo123!", pin: "6666", role: "sales_manager", active: 1, branch_id: 2 },
  { id: 6, name: "Sadiq", username: "sadik", email: "sadik@nexora.demo", password: "NexoraDemo123!", pin: "2222", role: "cashier", active: 1, branch_id: 1 },
  { id: 7, name: "David Kamau", username: "accountant", email: "accountant@nexora.demo", password: "NexoraDemo123!", pin: "7777", role: "accountant", active: 1, branch_id: 1 },
  { id: 8, name: "Platform Super Admin", username: "SuperAdmin", email: "saadaq17@icloud.com", password: "Honest@26", pin: "0001", role: "platform_owner", active: 1, branch_id: null, company_id: null },
  { id: 9, name: "Nexora Company Owner", username: "companyowner", email: "companyowner@nexora.demo", password: "CompanyOwner123!", pin: "0002", role: "owner", active: 1, branch_id: 1, company_id: 1 },
  { id: 10, name: "Honest Company Owner", username: "Owner@Honest", email: "support@httpsnexorapos.com", password: "Honest@2026", pin: "8888", role: "owner", active: 1, branch_id: 1, company_id: 1 },
];

const wait = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 80));
const publicRateLimits = new Map();

function siteOrigin() {
  return typeof window !== "undefined" && window.location ? window.location.origin : "";
}

const EMAIL_NOT_SENT_MESSAGE = "We couldn't send the email right now. Please try again later or contact support.";

/**
 * Calls the Vercel serverless function (`/api/send-email`) that talks to Resend for
 * real email delivery. This never fabricates success — if the endpoint 404s (e.g. local
 * `npm run dev` without `vercel dev`), errors, or the provider isn't configured, it
 * reports an honest failure instead of pretending the email was sent.
 */
async function sendTransactionalEmail(payload) {
  try {
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok || !data?.success) {
      return { success: false, error: (data && data.error) || EMAIL_NOT_SENT_MESSAGE };
    }
    return { success: true };
  } catch {
    return { success: false, error: EMAIL_NOT_SENT_MESSAGE };
  }
}

function makeToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `tok_${Date.now()}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function consumeRateLimit(key, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const recent = (publicRateLimits.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  publicRateLimits.set(key, recent);
  return true;
}

function defaultPermissions() {
  return buildDefaultMatrix();
}

function nowIso() {
  return new Date().toISOString();
}

function seedDatabase() {
  const categories = [
    { id: 1, name: "Groceries", color: "#2563EB", image_url: "" },
    { id: 2, name: "Dairy", color: "#38BDF8", image_url: "" },
    { id: 3, name: "Bakery", color: "#F59E0B", image_url: "" },
    { id: 4, name: "Beverages", color: "#8B5CF6", image_url: "" },
  ];

  const branches = [
    { id: 1, name: "Westlands HQ", code: "WES", address: "Waiyaki Way, Nairobi", active: true, company_id: 1 },
    { id: 2, name: "CBD Branch", code: "CBD", address: "Moi Avenue, Nairobi", active: true, company_id: 1 },
  ];

  const createdAt = nowIso();
  const users = DEMO_USERS.map(({ pin, password, ...user }) => ({
    ...user,
    password_hash: bcrypt.hashSync(password, 8),
    pin_hash: bcrypt.hashSync(pin, 8),
    phone: "",
    profile_photo: "",
    created_at: createdAt,
    created_by: user.id === 1 ? 1 : 1,
    created_by_name: "Amina Owino",
    company_id: user.role === "platform_owner" ? null : 1,
  }));

  const products = [
    { id: 1, name: "Sugar 2kg", barcode: "8901030001001", category_id: 1, category: "Groceries", price: 280, cost: 220, stock: 45, reorder_level: 20, unit: "bag", unit_id: 2, branch_id: 1, brand_id: 3, image_url: "", variants: [], track_batches: false },
    { id: 2, name: "Rice 5kg", barcode: "8901030002008", category_id: 1, category: "Groceries", price: 650, cost: 520, stock: 30, reorder_level: 15, unit: "bag", unit_id: 2, branch_id: 1, brand_id: 3, image_url: "", variants: [], track_batches: false },
    { id: 3, name: "Cooking Oil 2L", barcode: "8901030003005", category_id: 1, category: "Groceries", price: 480, cost: 400, stock: 18, reorder_level: 20, unit: "bottle", unit_id: 3, branch_id: 1, brand_id: 3, image_url: "", variants: [], track_batches: false },
    { id: 4, name: "Milk 500ml", barcode: "8901030004002", category_id: 2, category: "Dairy", price: 65, cost: 50, stock: 8, reorder_level: 25, unit: "packet", unit_id: 4, branch_id: 1, brand_id: 2, image_url: "", variants: [], track_batches: true, default_expiry_days: 14 },
    { id: 5, name: "Bread 400g", barcode: null, category_id: 3, category: "Bakery", price: 60, cost: 42, stock: 22, reorder_level: 15, unit: "loaf", unit_id: 5, branch_id: 1, brand_id: 1, image_url: "", variants: [], track_batches: true, default_expiry_days: 5 },
    {
      id: 6,
      name: "Soft Drinks 500ml",
      barcode: null,
      category_id: 4,
      category: "Beverages",
      price: 70,
      cost: 50,
      stock: 60,
      reorder_level: 20,
      unit: "bottle",
      unit_id: 3,
      branch_id: 1,
      brand_id: 4,
      image_url: "",
      track_batches: false,
      variants: [
        { id: 1, name: "Cola", sku: "SD-COLA", barcode: "89010300061", price: 70, cost: 50, stock: 25 },
        { id: 2, name: "Orange", sku: "SD-ORANGE", barcode: "89010300062", price: 70, cost: 50, stock: 20 },
        { id: 3, name: "Lemon", sku: "SD-LEMON", barcode: "89010300063", price: 70, cost: 50, stock: 15 },
      ],
    },
  ];

  const brands = seedBrands();
  const units = seedUnits();
  const warehouses = seedWarehouses(branches);
  const warehouseStock = buildWarehouseStock(products, warehouses);
  const stockMovements = seedStockMovements(products, warehouses);

  const customers = [
    { id: 1, name: "Ahmed Ali", phone: "+254 712 345 678", email: "ahmed.ali@email.com", address: "12 Ring Road, Westlands, Nairobi", points: 245, visits: 18, spent: 24500, credit_limit: 50000, balance: 8500 },
    { id: 2, name: "Fatima Hassan", phone: "+254 723 456 789", email: "fatima.h@email.com", address: "45 Ngong Road, Kilimani, Nairobi", points: 182, visits: 12, spent: 18200, credit_limit: 20000, balance: 0 },
    { id: 3, name: "Mohamed Noor", phone: "+254 733 567 890", email: "m.noor@email.com", address: "8 Haile Selassie Ave, CBD, Nairobi", points: 317, visits: 25, spent: 31750, credit_limit: 0, balance: 0 },
  ];

  const suppliers = [
    { id: 1, name: "Coca-Cola Kenya", contact_person: "James Mwangi", phone: "+254 700 111 222", email: "orders@coca-cola.co.ke", address: "Industrial Area, Nairobi", category: "Beverages", status: "Active", order_count: 1, total_ordered: 62000, balance: 0 },
    { id: 2, name: "Brookside Dairy", contact_person: "Grace Wanjiru", phone: "+254 700 222 333", email: "supply@brookside.co.ke", address: "Ruiru, Kiambu County", category: "Dairy", status: "Active", order_count: 1, total_ordered: 18500, balance: 0 },
    { id: 3, name: "Bidco Africa", contact_person: "Peter Otieno", phone: "+254 700 333 444", email: "trade@bidcoafrica.com", address: "Thika Road, Ruiru", category: "Groceries", status: "Active", order_count: 1, total_ordered: 45000, balance: 4400 },
  ];

  const purchases = [
    { id: 1, po_number: "PO-1042", supplier_id: 3, supplier: "Bidco Africa", invoice_no: "INV-5521", total: 45000, status: "Received", created_at: "2026-07-10", item_count: 3, branch_id: 1 },
    { id: 2, po_number: "PO-1041", supplier_id: 2, supplier: "Brookside Dairy", invoice_no: null, total: 18500, status: "Pending", created_at: "2026-07-09", item_count: 2, branch_id: 1 },
    { id: 3, po_number: "PO-1040", supplier_id: 1, supplier: "Coca-Cola Kenya", invoice_no: null, total: 62000, status: "Ordered", created_at: "2026-07-07", item_count: 5, branch_id: 1 },
  ];

  const sales = [
    {
      id: 1,
      invoice_no: "TXN-8001",
      customer_id: 1,
      total: 8500,
      payment_method: "Credit",
      created_at: "2026-07-12T10:15:00.000Z",
      branch_id: 1,
      items: [{ product_id: 1, name: "Sugar 2kg", qty: 10, price: 280, cost: 220 }, { product_id: 2, name: "Rice 5kg", qty: 8, price: 650, cost: 520 }],
    },
    {
      id: 2,
      invoice_no: "TXN-8002",
      customer_id: 2,
      total: 4200,
      payment_method: "M-Pesa",
      created_at: "2026-07-13T14:30:00.000Z",
      branch_id: 1,
      items: [{ product_id: 4, name: "Milk 500ml", qty: 20, price: 65, cost: 50 }, { product_id: 6, name: "Soft Drinks 500ml", qty: 40, price: 70, cost: 50 }],
    },
    {
      id: 3,
      invoice_no: "TXN-8003",
      customer_id: 3,
      total: 1260,
      payment_method: "Cash",
      created_at: "2026-07-14T09:05:00.000Z",
      branch_id: 1,
      items: [{ product_id: 5, name: "Bread 400g", qty: 21, price: 60, cost: 42 }],
    },
    {
      id: 4,
      invoice_no: "TXN-8004",
      customer_id: 1,
      total: 5600,
      payment_method: "Card",
      created_at: "2026-07-15T16:45:00.000Z",
      branch_id: 1,
      items: [{ product_id: 3, name: "Cooking Oil 2L", qty: 10, price: 480, cost: 400 }, { product_id: 1, name: "Sugar 2kg", qty: 4, price: 280, cost: 220 }],
    },
  ].map((sale) => ({ ...sale, currency_code: "KES", currency_symbol: "KSh" }));

  const customerPayments = [
    { id: 1, customer_id: 1, amount: 2000, method: "M-Pesa", created_at: "2026-07-14T11:00:00.000Z" },
  ];

  const supplierPayments = [
    { id: 1, supplier_id: 3, amount: 40600, method: "Bank Transfer", created_at: "2026-07-11T08:30:00.000Z" },
  ];

  const expenses = [
  { id: 1, name: "Shop Rent", category: "Rent", expense_date: "2026-07-01", amount: 45000, receipt_path: null },
  { id: 2, name: "Electricity Bill", category: "Utilities", expense_date: "2026-07-03", amount: 8200, receipt_path: null },
  { id: 3, name: "Staff Salaries", category: "Payroll", expense_date: "2026-07-05", amount: 120000, receipt_path: null },
];

  const settings = {
    store_name: "Nexora POS Enterprise",
    store_phone: "+254 700 555 123",
    store_address: "Waiyaki Way, Nairobi",
    currency: "KES",
    currency_symbol: "KSh",
    vat_enabled: "false",
    vat_rate: "0",
    tax_pin: "P051234567X",
    payment_cash: "true",
    payment_card: "true",
    payment_mobile: "true",
    payment_split: "true",
    firebase_sync_enabled: "false",
    receipt_header: "Thank you for shopping with Nexora POS Enterprise!",
  receipt_footer: "Goods sold in good condition are exchangeable within 7 days with receipt.",
    barcode_prefix: "89",
    barcode_format: "EAN-13",
    printer_name: "",
    auto_backup_enabled: "false",
    auto_backup_interval_hours: "24",
    theme: "light",
    default_branch_id: "1",
    enable_multi_branch: "true",
    enable_multi_currency: "true",
    admin_can_edit_rates: "false",
    report_currency: "KES",
    base_currency_code: "KES",
  };

  return {
    companies: [{
      id: 1,
      name: "Nexora POS Enterprise",
      business_type: "Retail",
      country: "Kenya",
      currency: "KES",
      code: "NEXORA001",
      time_zone: "Africa/Nairobi",
      email: "company@nexora.demo",
      phone: "+254 700 555 123",
      address: "Waiyaki Way, Nairobi",
      logo: "",
      status: "active",
      owner_user_id: 10,
      created_at: createdAt,
      created_by: 8,
    }],
    companyCurrencies: [
      { id: 1, company_id: 1, code: "KES", name: "Kenyan Shilling", symbol: "KSh", decimal_places: 2, is_active: true, is_base: true, is_default: true, exchange_rate_to_base: 1, auto_update_enabled: false },
      { id: 2, company_id: 1, code: "USD", name: "US Dollar", symbol: "$", decimal_places: 2, is_active: true, is_base: false, is_default: false, exchange_rate_to_base: 0.0077, auto_update_enabled: false },
      { id: 3, company_id: 1, code: "EUR", name: "Euro", symbol: "€", decimal_places: 2, is_active: false, is_base: false, is_default: false, exchange_rate_to_base: 0.0071, auto_update_enabled: false },
    ],
    currencyRateHistory: [],
    users,
    categories,
    branches,
    products,
    customers,
    customerPayments,
    suppliers,
    supplierPayments,
    purchases,
    purchaseReturns: [],
    purchasePayments: [],
    sales,
    heldSales: [],
    stockTransfers: [],
    expenseCategories: [
      { id: 1, name: "Rent" },
      { id: 2, name: "Utilities" },
      { id: 3, name: "Payroll" },
      { id: 4, name: "Logistics" },
      { id: 5, name: "Maintenance" },
      { id: 6, name: "Marketing" },
      { id: 7, name: "Other" },
    ],
    expenses,
    settings,
    companySettings: { 1: settings },
    platformSettings: { default_subscription_grace_days: 0, require_verified_domains: true },
    plans: CANONICAL_PLANS.map((plan, index) => ({ ...structuredClone(plan), id: index + 1 })),
    subscriptions: [{
      id: 1, company_id: 1, plan_id: 4, plan_code: "enterprise", status: "active",
      starts_at: createdAt, expires_at: "2027-08-01",
      limits: { users: 100, branches: 25, products: 100000 }, created_at: createdAt, updated_at: createdAt,
    }],
    companyDomains: [{ id: 1, company_id: 1, domain: "demo.nexora.local", status: "verified", is_primary: true, created_at: createdAt, verified_at: createdAt }],
    roles: SYSTEM_ROLES.filter((role) => role.id !== "platform_owner").map((role, index) => ({
      id: index + 1, company_id: 1, key: role.id, name: role.label, hierarchy_rank: index + 1,
      system: true, permissions: structuredClone(defaultPermissions()[role.id] || {}), created_at: createdAt,
    })),
    permissionMatrices: { 1: defaultPermissions() },
    billingRecords: [],
    subscription: {
      plan: "Enterprise",
      status: "active",
      billingCycle: "monthly",
      renewsAt: "2026-08-01",
      branchesAllowed: 10,
      usersAllowed: 100,
      currenciesAllowed: CURRENCIES.map((currency) => currency.code),
    },
    auditLog: [],
    approvalRequests: [],
    features: [
      { id: 1, code: "multi_branch", name: "Multi-branch", description: "Operate multiple retail locations.", active: true, public_visible: true },
      { id: 2, code: "advanced_reporting", name: "Advanced reporting", description: "Operational and performance analytics.", active: true, public_visible: true },
      { id: 3, code: "rbac", name: "Role-based access", description: "Granular user permissions.", active: true, public_visible: true },
      { id: 4, code: "custom_domains", name: "Custom domains", description: "Verified company domains.", active: true, public_visible: true },
    ],
    companyFeatureOverrides: [],
    contactLeads: [],
    emailVerifications: [],
    passwordResets: [],
    sessions: [],
    loginAttempts: {},
    permissionMatrix: defaultPermissions(),
    customRoles: [],
    brands,
    units,
    warehouses,
    warehouseStock,
    stockMovements,
    invoiceVerifications: [],
    nextIds: {
      user: 10,
      company: 2,
      brand: 5,
      unit: 8,
      warehouse: 3,
      stockMovement: 4,
      variant: 4,
      customRole: 1,
      category: 5,
      branch: 3,
      product: 7,
      customer: 4,
      supplier: 4,
      purchase: 4,
      sale: 5,
      heldSale: 1,
      transfer: 1,
      expenseCategory: 8,
      expense: 4,
      customerPayment: 2,
      supplierPayment: 2,
      purchaseReturn: 1,
      audit: 1,
      approvalRequest: 1,
      session: 1,
      subscription: 2,
      domain: 2,
      role: 9,
      billing: 1,
      feature: 5,
      contactLead: 1,
      verification: 1,
      passwordReset: 1,
      invoiceVerification: 1,
    },
  };
}

function buildInvoiceVerificationPayload(sale) {
  const receiptNo = resolveReceiptNumber(sale);
  const company = db.companies.find((entry) => Number(entry.id) === Number(sale.company_id || currentMockUser?.company_id));
  const customer = sale.customer_id
    ? db.customers.find((entry) => Number(entry.id) === Number(sale.customer_id))?.name
    : null;
  return {
    receipt_no: receiptNo,
    invoice_id: String(sale.id || receiptNo),
    company: company?.name || db.settings?.store_name || "Nexora POS Enterprise",
    company_name: company?.name || db.settings?.store_name || "Nexora POS Enterprise",
    branch: sale.branch_name || "",
    branch_name: sale.branch_name || "",
    customer: customer || sale.customer || "Walk-in",
    customer_name: customer || sale.customer || "Walk-in",
    payment_method: sale.payment_method || "",
    currency_code: sale.currency_code || getCurrency(db.settings.currency).code,
    currency_symbol: sale.currency_symbol || getCurrency(db.settings.currency).symbol,
    total: Number(sale.total || 0),
    status: deriveInvoiceStatus(sale),
    items: (sale.items || []).map((item) => ({
      name: item.name,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
    })),
    date: sale.created_at || nowIso(),
    sale_date: sale.created_at || nowIso(),
    company_id: sale.company_id || currentMockUser?.company_id || null,
  };
}

function upsertLocalInvoiceVerification(sale) {
  const payload = buildInvoiceVerificationPayload(sale);
  db.invoiceVerifications = db.invoiceVerifications || [];
  const index = db.invoiceVerifications.findIndex(
    (row) => String(row.receipt_no) === String(payload.receipt_no)
  );
  const record = {
    id: index >= 0 ? db.invoiceVerifications[index].id : nextId("invoiceVerification"),
    ...payload,
    updated_at: nowIso(),
    created_at: index >= 0 ? db.invoiceVerifications[index].created_at : nowIso(),
  };
  if (index >= 0) db.invoiceVerifications[index] = record;
  else db.invoiceVerifications.unshift(record);
  return record;
}

async function publishInvoiceVerification(sale) {
  const local = upsertLocalInvoiceVerification(sale);
  persist();
  try {
    await authFetch("/api/invoice-public", {
      method: "POST",
      body: local,
    });
  } catch {
    /* Local registry remains authoritative for this browser when API is unavailable. */
  }
  return local;
}

function hydrateDb(data) {
  let dbData = { ...seedDatabase(), ...data };
  const migratedCurrency = getCurrency(normalizeCurrencyCode(data?.settings?.currency));
  dbData.settings = {
    ...seedDatabase().settings,
    ...(data?.settings || {}),
    currency: migratedCurrency.code,
    currency_symbol: migratedCurrency.symbol,
    vat_enabled: data?.settings?.vat_enabled ?? "false",
    vat_rate: data?.settings?.vat_rate ?? "0",
    payment_cash: data?.settings?.payment_cash ?? "true",
    payment_card: data?.settings?.payment_card ?? "true",
    payment_mobile: data?.settings?.payment_mobile ?? "true",
    payment_mpesa: data?.settings?.payment_mpesa ?? data?.settings?.payment_mobile ?? "true",
    payment_bank_transfer: data?.settings?.payment_bank_transfer ?? "true",
    payment_split: data?.settings?.payment_split ?? "true",
  };
  dbData.subscription = {
    ...seedDatabase().subscription,
    ...(data?.subscription || {}),
    currenciesAllowed: CURRENCIES.map((currency) => currency.code),
  };
  if (!Array.isArray(dbData.companyCurrencies) || !dbData.companyCurrencies.length) {
    dbData.companyCurrencies = seedDatabase().companyCurrencies;
  }
  if (!Array.isArray(dbData.currencyRateHistory)) {
    dbData.currencyRateHistory = [];
  }
  dbData.settings = {
    ...dbData.settings,
    enable_multi_currency: dbData.settings.enable_multi_currency ?? "true",
    admin_can_edit_rates: dbData.settings.admin_can_edit_rates ?? "false",
    report_currency: dbData.settings.report_currency || dbData.settings.currency || "KES",
    base_currency_code: dbData.settings.base_currency_code || dbData.settings.currency || "KES",
  };
  dbData.customers = (dbData.customers || []).map((customer) => ({
    address: "",
    email: "",
    phone: "",
    points: 0,
    visits: 0,
    spent: 0,
    credit_limit: 0,
    balance: 0,
    ...customer,
  }));
  dbData.suppliers = (dbData.suppliers || []).map((supplier) => ({
    email: "",
    address: "",
    contact_person: "",
    phone: "",
    category: "",
    status: "Active",
    order_count: 0,
    total_ordered: 0,
    balance: 0,
    ...supplier,
  }));
  dbData.customerPayments = dbData.customerPayments || [];
  dbData.supplierPayments = dbData.supplierPayments || [];
  dbData.invoiceVerifications = Array.isArray(data?.invoiceVerifications) ? data.invoiceVerifications : [];
  dbData.approvalRequests = Array.isArray(data?.approvalRequests) ? data.approvalRequests : (dbData.approvalRequests || []);
  dbData.sales = (dbData.sales || []).map((sale) => {
    const receipt_no = resolveReceiptNumber({
      ...sale,
      receipt_no: sale.receipt_no,
      invoice_no: sale.invoice_no,
      id: sale.id,
      created_at: sale.created_at,
    });
    // Prefer NX receipt numbers for barcode/QR consistency; keep legacy invoice_no if already NX.
    const invoice_no = /^NX-\d{4}-\d+/i.test(String(sale.invoice_no || ""))
      ? String(sale.invoice_no).toUpperCase()
      : receipt_no;
    return {
      ...sale,
      receipt_no,
      invoice_no,
      status: sale.status || (Number(sale.returned || 0) > 0 ? "Refunded" : "Valid"),
    };
  });
  dbData.companies = Array.isArray(data?.companies) && data.companies.length
    ? data.companies
    : seedDatabase().companies;
  const defaultCompanyId = Number(dbData.companies[0]?.id || 1);
  dbData.branches = (dbData.branches || []).map((branch) => ({
    ...branch,
    company_id: Number(branch.company_id || defaultCompanyId),
  }));
  const platformDemo = DEMO_USERS.find((entry) => entry.role === "platform_owner");
  const companyOwnerDemo = DEMO_USERS.find((entry) => entry.role === "owner");
  if (!(dbData.users || []).some((user) => normalizeRole(user.role) === "platform_owner")) {
    const legacyPlatform = (dbData.users || []).find((user) => normalizeRole(user.role) === "owner");
    if (legacyPlatform) {
      legacyPlatform.role = "platform_owner";
      legacyPlatform.company_id = null;
      legacyPlatform.branch_id = null;
      legacyPlatform.username = platformDemo?.username || "SuperAdmin";
    } else {
      dbData.users = [...(dbData.users || []), { ...platformDemo, company_id: null, branch_id: null }];
    }
  }
  if (!(dbData.users || []).some((user) => normalizeRole(user.role) === "owner" && Number(user.company_id) === defaultCompanyId)) {
    const ownerId = (dbData.users || []).some((user) => Number(user.id) === Number(companyOwnerDemo.id))
      ? Math.max(0, ...(dbData.users || []).map((user) => Number(user.id))) + 1
      : companyOwnerDemo.id;
    dbData.users = [...(dbData.users || []), { ...companyOwnerDemo, id: ownerId, company_id: defaultCompanyId }];
  }
  const usedUsernames = new Set();
  const usedEmails = new Set();
  dbData.users = (dbData.users || []).map((user, index) => {
    const demo = DEMO_USERS.find((entry) => entry.id === user.id);
    const base = String(user.username || demo?.username || user.email?.split("@")[0] || user.name || `user${index + 1}`)
      .trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") || `user${index + 1}`;
    let username = base;
    let suffix = 2;
    const normalizedRole = normalizeRole(user.role);
    const normalizedCompanyId = normalizedRole === "platform_owner" ? null : Number(user.company_id || defaultCompanyId);
    const uniquenessScope = normalizedRole === "platform_owner" ? "platform" : normalizedCompanyId;
    while (usedUsernames.has(`${uniquenessScope}:${username}`)) username = `${base}${suffix++}`;
    usedUsernames.add(`${uniquenessScope}:${username}`);
    let email = String(user.email || demo?.email || `${username}@nexora.local`).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = `${username}@nexora.local`;
    const emailParts = email.split("@");
    let emailSuffix = 2;
    while (usedEmails.has(`${uniquenessScope}:${email}`)) email = `${emailParts[0]}${emailSuffix++}@${emailParts[1]}`;
    usedEmails.add(`${uniquenessScope}:${email}`);
    const migrationPin = demo?.pin || String(8000 + (Number(user.id) % 1000)).slice(-4);
    const pin_hash = user.pin_setup_pending ? null : (/^\$2[aby]\$\d{2}\$/.test(String(user.pin_hash || "")) ? user.pin_hash : bcrypt.hashSync(migrationPin, 8));
    const legacyPassword = typeof user.password === "string" && user.password.length >= 8 ? user.password : null;
    const password_hash = /^\$2[aby]\$\d{2}\$/.test(String(user.password_hash || ""))
      ? user.password_hash
      : bcrypt.hashSync(legacyPassword || demo?.password || "NexoraDemo123!", 8);
    const { password: _password, pin: _pin, ...safe } = user;
    const assignedBranch = normalizedRole === "platform_owner"
      ? null
      : dbData.branches.find((branch) => Number(branch.id) === Number(user.branch_id) && Number(branch.company_id) === normalizedCompanyId)
        || dbData.branches.find((branch) => Number(branch.company_id) === normalizedCompanyId);
    return {
      ...safe,
      name: String(user.name || demo?.name || username).trim(),
      username,
      email,
      phone: String(user.phone || "").trim(),
      profile_photo: String(user.profile_photo || ""),
      password_hash,
      pin_hash,
      role: normalizedRole,
      role_id: normalizedRole,
      branch_id: assignedBranch ? Number(assignedBranch.id) : null,
      active: user.active === false || user.active === 0 ? 0 : 1,
      created_at: user.created_at || nowIso(),
      created_by: user.created_by ?? 1,
      created_by_name: user.created_by_name || "System migration",
      company_id: normalizedCompanyId,
      email_verified: user.email_verified !== false,
      email_verified_at: user.email_verified_at || (user.email_verified === false ? null : user.created_at || nowIso()),
    };
  });
  const legacyCompanyDomains = dbData.companies.filter((company) => company.domain).map((company) => ({ company_id: company.id, domain: company.domain }));
  dbData.companies = dbData.companies.map(({ subscription_plan: _legacySubscriptionPlan, domain: _legacyDomain, ...company }) => ({
    ...company,
    code: String(company.code || `NEXORA${String(company.id).padStart(3, "0")}`).trim().toUpperCase(),
    domain: String(company.domain || ""),
    time_zone: company.time_zone || "Africa/Nairobi",
    email: company.email || "",
    phone: company.phone || "",
    address: company.address || "",
    logo: company.logo || "",
    currency: normalizeCurrencyCode(company.currency),
    status: ["inactive", "pending_verification"].includes(company.status) ? company.status : "active",
    owner_user_id: Number(dbData.users.find((user) => Number(user.company_id) === Number(company.id) && normalizeRole(user.role) === "owner")?.id || company.owner_user_id || 9),
  }));
  const tenantCollections = [
    "categories", "products", "customers", "customerPayments", "suppliers", "supplierPayments",
    "purchases", "purchaseReturns", "sales", "heldSales", "stockTransfers", "expenseCategories",
    "expenses", "brands", "units", "warehouses", "warehouseStock", "stockMovements",
  ];
  for (const collection of tenantCollections) {
    dbData[collection] = (dbData[collection] || []).map((record) => ({
      ...record,
      company_id: Number(record.company_id || defaultCompanyId),
    }));
  }
  const legacySettings = dbData.settings || seedDatabase().settings;
  dbData.companySettings = data?.companySettings && typeof data.companySettings === "object"
    ? data.companySettings
    : { [defaultCompanyId]: legacySettings };
  dbData.platformSettings = { ...seedDatabase().platformSettings, ...(dbData.platformSettings || {}) };
  dbData.plans = mergeCanonicalPlans(Array.isArray(dbData.plans) ? dbData.plans : []);
  dbData.subscriptions = (Array.isArray(data?.subscriptions) && data.subscriptions.length
    ? data.subscriptions
    : [{
        id: 1, company_id: defaultCompanyId,
        plan_id: dbData.plans.find((plan) => plan.code === "enterprise" || plan.name === dbData.subscription?.plan)?.id || 5,
        plan_code: normalizePlanCode(dbData.subscription?.plan || "enterprise"),
        status: dbData.subscription?.status || "active", starts_at: nowIso(),
        expires_at: dbData.subscription?.renewsAt || "2027-08-01",
        limits: (() => {
          const plan = getPlanByCode(normalizePlanCode(dbData.subscription?.plan || "enterprise"), dbData.plans);
          return {
            ...(plan?.limits || {}),
            users: dbData.subscription?.usersAllowed ?? plan?.limits?.users,
            branches: dbData.subscription?.branchesAllowed ?? plan?.limits?.branches,
          };
        })(),
        created_at: nowIso(), updated_at: nowIso(),
      }]).map((row) => {
    const planCode = normalizePlanCode(row.plan_code || row.plan);
    const plan = dbData.plans.find((entry) => entry.code === planCode || Number(entry.id) === Number(row.plan_id));
    return {
      ...row,
      plan_code: plan?.code || planCode,
      plan_id: plan?.id || row.plan_id,
      status: row.status || "active",
      limits: { ...(plan?.limits || {}), ...(row.limits || {}) },
    };
  });
  dbData.companyDomains = Array.isArray(data?.companyDomains) ? data.companyDomains : [];
  for (const legacyDomain of legacyCompanyDomains) {
    if (!dbData.companyDomains.some((row) => row.domain === legacyDomain.domain)) {
      dbData.companyDomains.push({ id: dbData.companyDomains.length + 1, ...legacyDomain, status: "verified", is_primary: true, created_at: nowIso(), verified_at: nowIso() });
    }
  }
  if (!dbData.companyDomains.some((row) => Number(row.company_id) === defaultCompanyId)) {
    dbData.companyDomains.push({ id: 1, company_id: defaultCompanyId, domain: "demo.nexora.local", status: "verified", is_primary: true, created_at: nowIso(), verified_at: nowIso() });
  }
  dbData.permissionMatrices = data?.permissionMatrices || { [defaultCompanyId]: dbData.permissionMatrix || defaultPermissions() };
  dbData.roles = Array.isArray(data?.roles) && data.roles.length
    ? data.roles
    : SYSTEM_ROLES.filter((role) => role.id !== "platform_owner").map((role, index) => ({
        id: index + 1, company_id: defaultCompanyId, key: role.id, name: role.label,
        hierarchy_rank: index + 1, system: true,
        permissions: structuredClone(dbData.permissionMatrices[defaultCompanyId]?.[role.id] || {}),
        created_at: nowIso(),
      }));
  dbData.billingRecords = Array.isArray(data?.billingRecords) ? data.billingRecords : [];
  dbData.features = Array.isArray(data?.features) ? data.features : seedDatabase().features;
  dbData.companyFeatureOverrides = Array.isArray(data?.companyFeatureOverrides) ? data.companyFeatureOverrides : [];
  dbData.contactLeads = Array.isArray(data?.contactLeads) ? data.contactLeads : [];
  dbData.emailVerifications = Array.isArray(data?.emailVerifications) ? data.emailVerifications : [];
  dbData.passwordResets = Array.isArray(data?.passwordResets) ? data.passwordResets : [];
  dbData.customRoles = (dbData.customRoles || []).map((role) => ({ ...role, company_id: Number(role.company_id || defaultCompanyId) }));
  dbData.nextIds = { ...seedDatabase().nextIds, ...(dbData.nextIds || {}) };
  dbData.nextIds.user = Math.max(Number(dbData.nextIds.user || 1), ...dbData.users.map((user) => Number(user.id) + 1));
  dbData.nextIds.company = Math.max(Number(dbData.nextIds.company || 1), ...dbData.companies.map((company) => Number(company.id) + 1));
  dbData.nextIds.branch = Math.max(Number(dbData.nextIds.branch || 1), ...dbData.branches.map((branch) => Number(branch.id) + 1));
  dbData.nextIds.subscription = Math.max(Number(dbData.nextIds.subscription || 1), ...dbData.subscriptions.map((row) => Number(row.id) + 1));
  dbData.nextIds.domain = Math.max(Number(dbData.nextIds.domain || 1), ...dbData.companyDomains.map((row) => Number(row.id) + 1));
  dbData.nextIds.role = Math.max(Number(dbData.nextIds.role || 1), ...dbData.roles.map((row) => Number(row.id) + 1));
  if (dbData.permissionMatrix?.inventory_staff && !data?.permissionMatrix?.inventory_manager) {
    dbData.permissionMatrix.inventory_manager = dbData.permissionMatrix.inventory_staff;
  }
  if (dbData.permissionMatrix) delete dbData.permissionMatrix.inventory_staff;
  dbData.sessions = Array.isArray(dbData.sessions) ? dbData.sessions : [];
  dbData.loginAttempts = dbData.loginAttempts && typeof dbData.loginAttempts === "object" ? dbData.loginAttempts : {};
  dbData.sales = (dbData.sales || []).map((sale) => {
    const owner = dbData.users.find((user) => user.id === Number(sale.user_id)) ||
      dbData.users.find((user) => normalizeRole(user.role) === "cashier") || dbData.users[0];
    const branch = dbData.branches.find((entry) => entry.id === Number(sale.branch_id || owner?.branch_id));
    const saleCurrency = getCurrency(sale.currency_code || sale.currency || dbData.settings.currency);
    return {
      ...sale,
      currency_code: saleCurrency.code,
      currency_symbol: saleCurrency.symbol,
      user_id: Number(sale.user_id || owner?.id) || null,
      cashier_name: sale.cashier_name || sale.cashier || owner?.name || "Legacy cashier",
      cashier_username: sale.cashier_username || owner?.username || "legacy",
      branch_id: Number(sale.branch_id || owner?.branch_id || 1),
      branch_name: sale.branch_name || branch?.name || "Unknown branch",
      receipt_no: sale.receipt_no || sale.invoice_no || `SALE-${sale.id}`,
      created_at: sale.created_at || nowIso(),
    };
  });
  dbData = ensureInventoryCollections(dbData);
  return dbData;
}

function loadDb() {
  // Always run hydrateDb so tenant collections receive company_id (required for tenant scoping).
  if (typeof window === "undefined") return hydrateDb(seedDatabase());
  let raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      try {
        const hydrated = hydrateDb(JSON.parse(legacy));
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
        return hydrated;
      } catch {
        /* fall through to seed */
      }
    }
    const hydrated = hydrateDb(seedDatabase());
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
    return hydrated;
  }
  try {
    const parsed = JSON.parse(raw);
    const hydrated = hydrateDb(parsed);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
    return hydrated;
  } catch {
    const hydrated = hydrateDb(seedDatabase());
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
    return hydrated;
  }
}

let db = loadDb();
let currentMockUser = null;
let currentSessionId = null;
let impersonationContext = null;
let tenantScopeActive = false;
/** Cache of Supabase users from the last admin-list-users call. */
let remoteUsersCache = [];

function setAuthContext(data) {
  if (!data) {
    currentMockUser = null;
    currentSessionId = null;
    impersonationContext = null;
    return;
  }
  const role = normalizeRole(data.role);
  currentMockUser = {
    id: data.id,
    name: data.name || "",
    username: data.username || "",
    email: data.email || "",
    role,
    company_id: data.company_id == null || data.company_id === "" ? null : data.company_id,
    branch_id: data.branch_id == null || data.branch_id === "" ? null : data.branch_id,
    active: data.active === false || data.active === 0 ? 0 : 1,
    company: data.company || null,
  };
  currentSessionId = data.id;
}

function persist() {
  if (!tenantScopeActive && typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }
}

function nextId(key) {
  if (!db.nextIds[key]) db.nextIds[key] = 1;
  const value = db.nextIds[key];
  db.nextIds[key] += 1;
  return value;
}

function ensureNextIdAbove(key, usedId) {
  const n = Number(usedId);
  if (!Number.isFinite(n)) return;
  if (!db.nextIds[key] || Number(db.nextIds[key]) <= n) {
    db.nextIds[key] = n + 1;
  }
}

function publicUser(user, sessionId = null) {
  if (!user) return null;
  const { pin_hash: _pinHash, password_hash: _passwordHash, password: _password, pin: _pin, ...safe } = user;
  return { ...safe, role: normalizeRole(user.role), ...(sessionId ? { session_id: sessionId } : {}) };
}

function requireUserManager() {
  return isUserManagerRole(currentMockUser?.role)
    ? null
    : { success: false, error: "Only Owner, Admin, Manager, or Super Admin can manage user accounts.", code: "FORBIDDEN" };
}

function requireOwner() {
  return isPlatformOwner(currentMockUser?.role) && !impersonationContext
    ? null
    : { success: false, error: "Only the Platform Owner can perform this action.", code: "FORBIDDEN" };
}

function companyScopedUsers() {
  const source = remoteUsersCache.length ? remoteUsersCache : db.users;
  if (isPlatformOwner(currentMockUser?.role) && !impersonationContext) return source;
  return source.filter((user) => String(user.company_id) === String(currentMockUser?.company_id));
}

function enrichRemoteUserMetrics(user) {
  const sales = db.sales.filter((sale) => String(sale.user_id) === String(user.id));
  const branch = db.branches.find((entry) => String(entry.id) === String(user.branch_id));
  return {
    ...user,
    role: normalizeRole(user.role),
    branch_name: branch?.name || user.branch_name || "Unknown branch",
    last_login_at: user.last_login_at || null,
    last_activity_at: user.last_activity_at || user.last_login_at || null,
    total_sales: sales.length,
    total_revenue: sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
  };
}

async function fetchRemoteUsers(filterId = null) {
  const result = await authFetch("/api/admin-list-users", {
    method: "POST",
    body: filterId ? { id: filterId } : {},
  });
  if (!result.success) return { success: false, error: result.error, users: [], user: null };
  const users = (result.users || []).map(enrichRemoteUserMetrics);
  if (!filterId) remoteUsersCache = users;
  return {
    success: true,
    users,
    user: filterId ? (users.find((row) => String(row.id) === String(filterId)) || result.user || null) : null,
  };
}

function canManageTarget(target, nextRole = target?.role) {
  if (!target) return { success: false, error: "User not found." };
  const allowOwnerPeer = isPlatformOwner(currentMockUser?.role);
  if (!canManageRole(currentMockUser?.role, target.role, { allowOwnerPeer })) {
    return { success: false, error: "You cannot manage an equal or higher protected role.", code: "FORBIDDEN" };
  }
  if (!canManageRole(currentMockUser?.role, nextRole, { allowOwnerPeer })) {
    return { success: false, error: "You cannot assign that protected role.", code: "FORBIDDEN" };
  }
  if (!isPlatformOwner(currentMockUser?.role) && Number(target.company_id) !== Number(currentMockUser?.company_id)) {
    return { success: false, error: "Cross-company account access is denied.", code: "FORBIDDEN" };
  }
  return null;
}

function applyApprovalEffect(request) {
  const company = db.companies.find((entry) => Number(entry.id) === Number(request.company_id));
  if (!company && request.type.startsWith("company_")) {
    return { success: false, error: "Company not found for this request." };
  }
  const payload = request.payload || {};
  if (request.type === "company_suspend" && company) {
    company.status = "suspended";
    company.active = false;
    company.updated_at = nowIso();
    return { success: true, effect: { status: "suspended" } };
  }
  if (request.type === "company_reactivate" && company) {
    company.status = "active";
    company.active = true;
    company.updated_at = nowIso();
    return { success: true, effect: { status: "active" } };
  }
  if (request.type === "company_delete" && company) {
    company.status = "deleted";
    company.active = false;
    company.deleted_at = nowIso();
    company.updated_at = nowIso();
    return { success: true, effect: { status: "deleted" } };
  }
  if (request.type === "plan_change") {
    const planCode = normalizePlanCode(payload.plan_code || payload.plan || "");
    const plan = getPlanByCode(planCode, db.plans);
    const sub = (db.subscriptions || []).find((entry) => Number(entry.company_id) === Number(request.company_id));
    if (sub && planCode) {
      sub.plan_code = plan?.code || planCode;
      sub.plan_id = plan?.id || sub.plan_id;
      if (plan?.limits) sub.limits = structuredClone(plan.limits);
      sub.updated_at = nowIso();
      if (db.subscription && Number(currentMockUser?.company_id) === Number(request.company_id)) {
        db.subscription.plan = plan?.name || planCode;
      }
    }
    if (company && planCode) {
      company.plan_code = plan?.code || planCode;
      company.updated_at = nowIso();
    }
    return { success: true, effect: { plan_code: plan?.code || planCode || null } };
  }
  // Non-destructive platform review items (feature/domain/export/owner) — mark recorded only.
  return { success: true, effect: { recorded: true, type: request.type } };
}

function canMutateOtherTarget(target, nextRole = target?.role) {
  if (!target) return { success: false, error: "User not found." };
  if (Number(target.id) === Number(currentMockUser?.id)) {
    return { success: false, error: "You cannot perform this action on your own account." };
  }
  return canManageTarget(target, nextRole);
}

function protectedCompanyGuard(target, { active = !!target.active, role = normalizeRole(target.role), deleting = false } = {}) {
  const targetRole = normalizeRole(target.role);
  const companyUsers = db.users.filter((user) => Number(user.company_id) === Number(target.company_id) && user.id !== (deleting ? target.id : -1));
  if (target.active && targetRole === "owner" && (deleting || !active || role !== "owner")) {
    const otherOwners = companyUsers.filter((user) => user.active && normalizeRole(user.role) === "owner");
    if (!otherOwners.length) return { success: false, error: "The final active Owner for this company cannot be removed." };
  }
  if (target.active && ["owner", "super_admin"].includes(targetRole) && (deleting || !active || !["owner", "super_admin"].includes(role))) {
    const otherLeaders = companyUsers.filter((user) => user.active && ["owner", "super_admin"].includes(normalizeRole(user.role)));
    if (!otherLeaders.length) return { success: false, error: "A company must retain an active Owner or Super Admin." };
  }
  return null;
}

function currentCompanyPlanLimits(companyId = currentMockUser?.company_id) {
  const subscription = (db.subscriptions || []).find((row) => Number(row.company_id) === Number(companyId));
  const plan = getPlanByCode(subscription?.plan_code || "enterprise", db.plans);
  return { ...(plan?.limits || {}), ...(subscription?.limits || {}) };
}

function enforceCompanyPlanLimit(limitKey, currentCount, companyId = currentMockUser?.company_id) {
  if (isPlatformOwner(currentMockUser?.role) && !companyId) return null;
  return checkPlanLimit(currentCompanyPlanLimits(companyId), limitKey, currentCount);
}

function touchSession(force = false) {
  if (!currentMockUser || !currentSessionId) return false;
  const account = db.users.find((entry) => entry.id === currentMockUser.id);
  if (!account?.active) return false;
  const session = db.sessions.find((entry) => entry.id === currentSessionId && !entry.logout_at);
  if (!session) return false;
  const now = Date.now();
  if (!force && now - new Date(session.last_activity_at).getTime() < 60000) return true;
  session.last_activity_at = new Date(now).toISOString();
  persist();
  return true;
}

function logAudit(action, module, details) {
  db.auditLog.unshift({
    id: nextId("audit"),
    user_id: currentMockUser?.id ?? null,
    user_name: currentMockUser?.name || "System",
    company_id: details?.company_id ?? currentMockUser?.company_id ?? null,
    actor_user_id: impersonationContext?.owner?.id ?? currentMockUser?.id ?? null,
    actor_role: impersonationContext ? "platform_owner" : currentMockUser?.role ?? null,
    effective_user_id: currentMockUser?.id ?? null,
    impersonating_owner_id: impersonationContext?.owner?.id ?? null,
    action,
    module,
    details: JSON.stringify(details || {}),
    created_at: nowIso(),
  });
  persist();
}

function userMetrics(user) {
  const sales = db.sales.filter((sale) => Number(sale.user_id) === Number(user.id));
  const sessions = db.sessions.filter((session) => Number(session.user_id) === Number(user.id));
  const lastLogin = [...sessions].sort((a, b) => new Date(b.login_at) - new Date(a.login_at))[0];
  const lastActivity = [...sessions].sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at))[0];
  const branch = db.branches.find((entry) => Number(entry.id) === Number(user.branch_id));
  return {
    ...publicUser(user),
    branch_name: branch?.name || "Unknown branch",
    last_login_at: lastLogin?.login_at || null,
    last_activity_at: lastActivity?.last_activity_at || null,
    total_sales: sales.length,
    total_revenue: sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
  };
}

function logUserAudit(action, target, details = {}) {
  logAudit(action, "users", {
    target_user_id: target.id,
    target_user_name: target.name,
    ...details,
  });
}

const validUsername = (value) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(value);
const validPhone = (value) => !value || /^\+?[\d\s().-]{7,20}$/.test(value);

function nextCompanyCode(name) {
  const stem = String(name || "COMPANY").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "COMP";
  let sequence = 1;
  let code = `${stem}${String(sequence).padStart(3, "0")}`;
  while (db.companies.some((company) => String(company.code).toUpperCase() === code)) {
    sequence += 1;
    code = `${stem}${String(sequence).padStart(3, "0")}`;
  }
  return code;
}

function categoryName(categoryId) {
  return db.categories.find((category) => category.id === Number(categoryId))?.name || "Uncategorized";
}

function normalizeProduct(product) {
  const enriched = enrichProduct(product, db.units || []);
  const category = categoryName(enriched.category_id);
  const brand = db.brands?.find((b) => b.id === Number(enriched.brand_id))?.name || null;
  const unitRow = db.units?.find((u) => u.id === Number(enriched.unit_id));
  const branch = db.branches.find((b) => b.id === Number(enriched.branch_id))?.name || null;
  const primaryWh = db.warehouses?.find((w) => w.branch_id === Number(enriched.branch_id)) || db.warehouses?.[0];
  return {
    ...enriched,
    category_id: enriched.category_id ? Number(enriched.category_id) : null,
    category,
    brand,
    brand_id: enriched.brand_id ? Number(enriched.brand_id) : null,
    unit_id: enriched.unit_id ? Number(enriched.unit_id) : null,
    unit: unitRow?.abbreviation || enriched.unit || "unit",
    warehouse: enriched.warehouse || primaryWh?.name || branch || "Main Store",
    barcode: enriched.barcode || null,
    sku: enriched.sku || (Array.isArray(enriched.variants) ? enriched.variants.find((v) => v?.sku)?.sku : "") || "",
    image_url: enriched.image_url || "",
    variants: Array.isArray(enriched.variants) ? enriched.variants : [],
  };
}

function defaultWarehouseId(branchId) {
  const match = (db.warehouses || []).find((w) => w.branch_id === Number(branchId) && w.active !== false);
  return match?.id || db.warehouses?.[0]?.id || 1;
}

function recordStockMovement(payload) {
  const movement = {
    id: nextId("stockMovement"),
    type: payload.type,
    product_id: Number(payload.product_id),
    variant_id: payload.variant_id ? Number(payload.variant_id) : null,
    warehouse_id: Number(payload.warehouse_id),
    qty: Number(payload.qty),
    batch_number: payload.batch_number || null,
    expiry_date: payload.expiry_date || null,
    note: payload.note || "",
    created_at: nowIso(),
    user_id: currentMockUser?.id ?? null,
    user_name: currentMockUser?.name || "System",
  };
  db.stockMovements = db.stockMovements || [];
  db.stockMovements.unshift(movement);
  return movement;
}

function ean13CheckDigit(digits12) {
  const nums = String(digits12).split("").map(Number);
  const sum = nums.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

function generateBarcodeForProduct(productId, format, prefix) {
  const cleanPrefix = String(prefix || "89").replace(/\D/g, "") || "89";
  const idPart = String(productId).padStart(6, "0");

  if (String(format || "EAN-13").toUpperCase().includes("128") || String(format).toUpperCase() === "CODE-128") {
    return `${cleanPrefix}${idPart}`;
  }

  // EAN-13: prefix + zero-pad body to 12 digits, then check digit
  let body = `${cleanPrefix}${idPart}`.replace(/\D/g, "");
  if (body.length > 12) body = body.slice(0, 12);
  body = body.padStart(12, "0").slice(-12);
  return body + ean13CheckDigit(body);
}

function isBarcodeTaken(code, excludeProductId = null) {
  const normalized = String(code || "").trim();
  if (!normalized) return false;
  return db.products.some(
    (product) =>
      product.barcode &&
      String(product.barcode) === normalized &&
      product.id !== excludeProductId
  );
}

function resolveLabelSize(size) {
  const sizes = {
    "50x25": { id: "50x25", label: "50 × 25 mm", widthMm: 50, heightMm: 25, cols: 3 },
    "40x30": { id: "40x30", label: "40 × 30 mm", widthMm: 40, heightMm: 30, cols: 4 },
    "100x50": { id: "100x50", label: "100 × 50 mm", widthMm: 100, heightMm: 50, cols: 2 },
    shelf: { id: "shelf", label: "Shelf talker", widthMm: 70, heightMm: 40, cols: 2 },
  };
  return sizes[size] || sizes["50x25"];
}

function getCurrentBranchId() {
  return Number(db.settings.default_branch_id || 1);
}

function listAllRoles() {
  return [
    ...SYSTEM_ROLES.filter((role) => role.id !== "platform_owner"),
    ...(db.customRoles || []).map((role) => ({ ...role, system: false })),
  ];
}

function ensureMatrix() {
  db.permissionMatrix = ensurePermissionShape({
    ...buildDefaultMatrix(),
    ...db.permissionMatrix,
  });
  return db.permissionMatrix;
}

function currentPermissionMatrix() {
  const companyId = Number(currentMockUser?.company_id);
  if (companyId && db.permissionMatrices?.[companyId]) {
    return ensurePermissionShape({ ...buildDefaultMatrix(), ...db.permissionMatrices[companyId] });
  }
  return ensureMatrix();
}

function reportBounds(filters = {}) {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end = new Date(start.getTime() + 86400000);
  const preset = filters.preset || "today";
  if (preset === "yesterday") {
    end = start;
    start = new Date(start.getTime() - 86400000);
  } else if (preset === "this_week") {
    const day = (start.getDay() + 6) % 7;
    start = new Date(start.getTime() - day * 86400000);
  } else if (preset === "this_month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (preset === "custom" && filters.start_date && filters.end_date) {
    start = new Date(`${filters.start_date}T00:00:00`);
    end = new Date(`${filters.end_date}T23:59:59.999`);
  }
  return { start, end };
}

function salesForRange(filters = {}) {
  const { start, end } = reportBounds(filters);
  return db.sales.filter((sale) => {
    const time = new Date(sale.created_at);
    return time >= start && time <= end;
  });
}

function sessionHours(userId, filters = {}) {
  const { start, end } = reportBounds(filters);
  const now = new Date();
  const milliseconds = db.sessions
    .filter((session) => session.user_id === userId)
    .reduce((total, session) => {
      const from = new Date(Math.max(new Date(session.login_at).getTime(), start.getTime()));
      const rawEnd = session.logout_at || session.last_activity_at || session.login_at;
      const to = new Date(Math.min(new Date(rawEnd).getTime(), end.getTime(), now.getTime()));
      return total + Math.max(0, to - from);
    }, 0);
  return Math.round((milliseconds / 3600000) * 100) / 100;
}

function buildUserSales(filters = {}) {
  const sales = salesForRange(filters);
  return db.users.map((user) => {
    const rows = sales.filter((sale) => Number(sale.user_id) === user.id);
    const gross = rows.reduce((sum, sale) => sum + Number(sale.subtotal ?? sale.total ?? 0), 0);
    const discount = rows.reduce((sum, sale) => sum + Number(sale.discount || 0), 0);
    const revenue = rows.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const cogs = rows.reduce((sum, sale) => sum + (sale.items || []).reduce((itemSum, item) => itemSum + Number(item.cost || 0) * Number(item.qty || 0), 0), 0);
    const last = [...db.sales].filter((sale) => Number(sale.user_id) === user.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    return {
      user_id: user.id,
      name: user.name,
      username: user.username,
      role: normalizeRole(user.role),
      total_transactions: rows.length,
      total_sales: gross,
      total_revenue: revenue,
      total_discount: discount,
      total_profit: revenue - cogs,
      average_sale: rows.length ? revenue / rows.length : 0,
      last_sale_at: last?.created_at || null,
      working_hours: sessionHours(user.id, filters),
    };
  });
}

const TENANT_COLLECTIONS = [
  "users", "branches", "categories", "products", "customers", "customerPayments",
  "suppliers", "supplierPayments", "purchases", "purchaseReturns", "sales", "heldSales",
  "stockTransfers", "expenseCategories", "expenses", "brands", "units", "warehouses",
  "warehouseStock", "stockMovements", "auditLog", "roles", "subscriptions",
  "companyDomains", "billingRecords",
];

function sameCompanyId(a, b) {
  if (a == null || b == null || a === "" || b === "") return false;
  return String(a) === String(b);
}

function invokeInTenantScope(fn, thisArg, args) {
  const companyId = currentMockUser?.company_id;
  if (companyId == null || companyId === "" || (isPlatformOwner(currentMockUser?.role) && !impersonationContext)) {
    return fn.apply(thisArg, args);
  }
  const rootDb = db;
  const payloadWithBranch = args.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg) && arg.branch_id != null);
  if (payloadWithBranch) {
    const branchOk = rootDb.branches.some(
      (branch) => String(branch.id) === String(payloadWithBranch.branch_id) && sameCompanyId(branch.company_id, companyId)
    );
    if (!branchOk) {
      return wait({ success: false, error: "The selected branch does not belong to your company.", code: "TENANT_SCOPE_VIOLATION" });
    }
  }
  const scopedDb = { ...rootDb };
  for (const key of TENANT_COLLECTIONS) {
    scopedDb[key] = (rootDb[key] || []).filter((record) => sameCompanyId(record.company_id, companyId));
  }
  scopedDb.settings = { ...(rootDb.companySettings?.[companyId] || rootDb.companySettings?.[String(companyId)] || rootDb.settings || {}) };
  scopedDb.permissionMatrix = structuredClone(
    rootDb.permissionMatrices?.[companyId]
    || rootDb.permissionMatrices?.[String(companyId)]
    || rootDb.permissionMatrix
    || defaultPermissions()
  );
  scopedDb.customRoles = (rootDb.customRoles || []).filter((role) => sameCompanyId(role.company_id || companyId, companyId));
  tenantScopeActive = true;
  db = scopedDb;
  let result;
  try {
    result = fn.apply(thisArg, args);
    for (const key of TENANT_COLLECTIONS) {
      const otherCompanies = (rootDb[key] || []).filter((record) => !sameCompanyId(record.company_id, companyId));
      const scopedRows = (scopedDb[key] || []).map((record) => ({ ...record, company_id: companyId }));
      rootDb[key] = [...otherCompanies, ...scopedRows];
    }
    rootDb.companySettings = {
      ...(rootDb.companySettings || {}),
      [companyId]: scopedDb.settings,
    };
    rootDb.permissionMatrices = {
      ...(rootDb.permissionMatrices || {}),
      [companyId]: scopedDb.permissionMatrix,
    };
    rootDb.customRoles = [
      ...(rootDb.customRoles || []).filter((role) => !sameCompanyId(role.company_id || companyId, companyId)),
      ...(scopedDb.customRoles || []).map((role) => ({ ...role, company_id: companyId })),
    ];
  } finally {
    db = rootDb;
    tenantScopeActive = false;
    persist();
  }
  return result;
}

function applyTenantMiddleware(api) {
  const wrapped = { ...api };
  const unscopedNamespaces = new Set(["auth", "owner", "platformPublic", "publicAuth"]);
  for (const [namespace, methods] of Object.entries(api)) {
    if (!methods || typeof methods !== "object" || unscopedNamespaces.has(namespace)) continue;
    wrapped[namespace] = {};
    for (const [method, fn] of Object.entries(methods)) {
      wrapped[namespace][method] = typeof fn === "function"
        ? (...args) => invokeInTenantScope(fn, methods, args)
        : fn;
    }
  }
  return wrapped;
}

const rawApi = {
  __isMock: true,
  __setAuthContext: setAuthContext,
  platformPublic: {
    getPlans: () => wait(db.plans.filter((plan) => plan.active && plan.public_visible !== false).sort((a, b) => a.sort_order - b.sort_order).map(safePublicPlan)),
    getFeatures: () => wait(db.features.filter((feature) => feature.active && feature.public_visible !== false).map(({ code, name, description }) => ({ code, name, description }))),
    verifyInvoice: async (invoiceId) => {
      const id = String(invoiceId || "").trim();
      if (!id) return { success: false, error: "Invoice id is required.", code: "NOT_FOUND" };
      // Prefer server registry when available (cross-device QR scans).
      try {
        const remote = await fetch(`/api/invoice-public?id=${encodeURIComponent(id)}`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (remote.ok) {
          const data = await remote.json();
          if (data?.success && data.invoice) return data;
        }
        if (remote.status === 404) {
          // Fall through to local registry for same-browser demos.
        }
      } catch {
        /* offline / API unavailable — use local DB only */
      }
      const local = (db.invoiceVerifications || []).find(
        (row) => String(row.receipt_no) === id || String(row.invoice_id) === id
      );
      if (local) {
        return {
          success: true,
          invoice: {
            receipt_no: local.receipt_no,
            invoice_id: local.invoice_id,
            company: local.company || local.company_name,
            branch: local.branch || local.branch_name,
            customer: local.customer || local.customer_name,
            payment_method: local.payment_method,
            currency_code: local.currency_code,
            currency_symbol: local.currency_symbol,
            total: local.total,
            status: local.status,
            items: local.items || [],
            date: local.date || local.sale_date,
          },
        };
      }
      const sale = db.sales.find(
        (entry) =>
          String(entry.receipt_no) === id
          || String(entry.invoice_no) === id
          || String(entry.id) === id
      );
      if (!sale) {
        return {
          success: false,
          error: "Invoice not found. This receipt is not registered in the system.",
          code: "NOT_FOUND",
        };
      }
      const published = upsertLocalInvoiceVerification(sale);
      persist();
      return {
        success: true,
        invoice: {
          receipt_no: published.receipt_no,
          invoice_id: published.invoice_id,
          company: published.company,
          branch: published.branch,
          customer: published.customer,
          payment_method: published.payment_method,
          currency_code: published.currency_code,
          currency_symbol: published.currency_symbol,
          total: published.total,
          status: published.status,
          items: published.items,
          date: published.date,
        },
      };
    },
    contact: async (payload = {}) => {
      const name = String(payload.name || "").trim().slice(0, 100);
      const email = String(payload.email || "").trim().toLowerCase().slice(0, 160);
      const company = String(payload.company || "").trim().slice(0, 120);
      const phone = String(payload.phone || "").trim().slice(0, 30);
      const message = String(payload.message || "").trim().slice(0, 2000);
      if (payload.website) return { success: true };
      if (!name || !validEmail(email) || message.length < 10) {
        return { success: false, error: "Please provide valid contact details." };
      }
      if (phone && !validPhone(phone)) {
        return { success: false, error: "Please provide a valid phone number or leave it blank." };
      }
      if (!consumeRateLimit(`contact:${email}`, 2, 60000)) {
        return { success: false, error: "Please wait before sending another message.", code: "RATE_LIMITED" };
      }
      const mailed = await sendTransactionalEmail({
        type: "contact",
        to: email,
        name,
        company,
        phone,
        message,
      });
      if (!mailed.success) {
        return { success: false, error: mailed.error || EMAIL_NOT_SENT_MESSAGE };
      }
      db.contactLeads.push({
        id: nextId("contactLead"),
        name,
        email,
        company,
        phone,
        message,
        status: "emailed",
        created_at: nowIso(),
      });
      logAudit("contact_lead_created", "public", { email_domain: email.split("@")[1], emailed: true });
      persist();
      return { success: true };
    },
  },
  publicAuth: {
    createCompanyWorkspace: (payload = {}) => {
      const companyName = String(payload.company_name || "").trim().replace(/\s+/g, " ").slice(0, 120);
      const name = String(payload.full_name || "").trim().replace(/\s+/g, " ").slice(0, 120);
      const email = String(payload.email || "").trim().toLowerCase().slice(0, 160);
      const phone = String(payload.phone || "").trim().slice(0, 30);
      const supabaseUserId = String(payload.supabase_user_id || "").trim();
      if (!consumeRateLimit(`signup:${email || "anon"}`, 3, 60000)) {
        return wait({ success: false, error: "Too many signup attempts. Please wait and try again.", code: "RATE_LIMITED" });
      }
      if (!companyName || !name || !validEmail(email) || !phone || !validPhone(phone) || !supabaseUserId) {
        return wait({ success: false, error: "Please provide valid signup details." });
      }
      if (db.companies.some((company) => company.name.toLowerCase() === companyName.toLowerCase())) {
        return wait({ success: false, error: "A company with that name already exists.", code: "COMPANY_EXISTS" });
      }
      const selectedCode = "free_trial";
      const plan = db.plans.find((entry) => entry.code === selectedCode)
        || getPlanByCode("free_trial", db.plans)
        || db.plans[0];
      if (!plan) return wait({ success: false, error: "Free trial onboarding is unavailable." });
      const companyId = nextId("company");
      const branchId = nextId("branch");
      const timestamp = nowIso();
      const baseUsername = email.split("@")[0].replace(/[^a-z0-9._-]/g, "").slice(0, 24) || "owner";
      let username = baseUsername;
      let suffix = 2;
      while (db.users.some((user) => Number(user.company_id) === companyId && user.username === username)) {
        username = `${baseUsername}${suffix++}`;
      }
      const companyCode = nextCompanyCode(companyName);
      const trialDays = Math.max(1, Number(plan.trial_days || DEFAULT_TRIAL_DAYS));
      const company = {
        id: companyId, name: companyName, business_type: "Retail", country: "Kenya", code: companyCode,
        currency: BILLING_CURRENCY, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Nairobi",
        email, phone, address: "", logo: "", status: "pending_verification",
        owner_user_id: supabaseUserId, signup_source: "public", created_at: timestamp, created_by: null,
        plan_code: plan.code,
      };
      const branch = { id: branchId, company_id: companyId, name: "Main Branch", code: "MAIN", address: "", active: true };
      const userStub = {
        id: supabaseUserId, name, username, email, phone, role: "owner", role_id: "owner", active: 1,
        email_verified: false, branch_id: branchId, company_id: companyId, profile_photo: "",
        signup_source: "public", created_at: timestamp, created_by: null, created_by_name: "Public signup",
      };
      const subscription = {
        id: nextId("subscription"), company_id: companyId, plan_id: plan.id, plan_code: plan.code,
        status: "trialing", starts_at: timestamp, trial_starts_at: timestamp,
        trial_ends_at: new Date(Date.now() + trialDays * 86400000).toISOString(),
        expires_at: new Date(Date.now() + trialDays * 86400000).toISOString(),
        limits: structuredClone(plan.limits), created_at: timestamp, updated_at: timestamp,
      };
      db.companies.push(company);
      db.branches.push(branch);
      db.users.push(userStub);
      db.subscriptions.push(subscription);
      db.roles.push(...SYSTEM_ROLES.filter((entry) => entry.id !== "platform_owner").map((entry, index) => ({
        id: nextId("role"), company_id: companyId, key: entry.id, name: entry.label,
        hierarchy_rank: index + 1, system: true,
        permissions: structuredClone(defaultPermissions()[entry.id] || {}), created_at: timestamp,
      })));
      db.permissionMatrices[companyId] = structuredClone(defaultPermissions());
      db.companySettings[companyId] = {
        ...seedDatabase().settings, store_name: companyName, store_phone: phone,
        currency: BILLING_CURRENCY, currency_symbol: "KSh", default_branch_id: String(branchId),
        base_currency_code: BILLING_CURRENCY, report_currency: BILLING_CURRENCY,
      };
      logAudit("public_company_signup", "public_auth", { company_id: companyId, user_id: supabaseUserId, plan_code: plan.code });
      persist();
      return wait({
        success: true,
        company_id: companyId,
        branch_id: branchId,
        company_code: companyCode,
        email,
        username,
        currency: company.currency,
        plan_code: plan.code,
        trial_ends_at: subscription.trial_ends_at,
      });
    },
    companyNameTaken: (companyName) => {
      const name = String(companyName || "").trim().toLowerCase();
      return wait(db.companies.some((company) => company.name.toLowerCase() === name));
    },
    resolveCompany: (companyIdentifier) => {
      const normalized = String(companyIdentifier || "").trim().toLowerCase();
      if (!normalized) return wait(null);
      const company = db.companies.find((candidate) =>
        candidate.status === "active" && (
          String(candidate.code || "").toLowerCase() === normalized
          || db.companyDomains.some((domain) =>
            Number(domain.company_id) === Number(candidate.id)
            && domain.status === "verified"
            && String(domain.domain).toLowerCase() === normalized)
        )
      );
      return wait(company || null);
    },
    getCompanyById: (companyId) => {
      const company = db.companies.find((entry) => String(entry.id) === String(companyId));
      if (!company) return wait(null);
      return wait({ id: company.id, name: company.name, code: company.code, status: company.status, logo: company.logo || "" });
    },
    checkCompanyAccess: (companyId, options = {}) => {
      const now = Date.now();
      const company = db.companies.find((entry) => String(entry.id) === String(companyId));
      if (!company || company.status !== "active") {
        return wait({ ok: false, error: "Invalid company identifier or credentials." });
      }
      const subscription = db.subscriptions.find((entry) => Number(entry.company_id) === Number(company.id));
      const expiresAt = subscription?.expires_at || subscription?.trial_ends_at;
      const notExpired = !expiresAt || new Date(expiresAt).getTime() >= now;
      const subscriptionAllowed = ["active", "trialing"].includes(String(subscription?.status || "").toLowerCase())
        && notExpired;
      if (!subscriptionAllowed) {
        const role = normalizeRole(options.role);
        return wait({
          ok: false,
          error: "This company subscription is inactive or expired.",
          code: "SUBSCRIPTION_INACTIVE",
          staff_error: role && role !== "owner"
            ? "Your company trial or subscription has expired. Only the Company Owner can log in to choose a plan. Staff access is temporarily disabled."
            : undefined,
        });
      }
      return wait({ ok: true, company });
    },
    /**
     * Rebuild a minimal company workspace in this browser from Supabase app_metadata.
     * Required because operational company rows still live in localStorage while auth is global.
     */
    hydrateCompanyWorkspaceFromAuth: (payload = {}) => {
      const companyId = payload.company_id;
      const supabaseUserId = String(payload.supabase_user_id || "").trim();
      if (companyId == null || companyId === "" || !supabaseUserId) {
        return wait({ success: false, error: "company_id and supabase_user_id are required." });
      }

      const timestamp = nowIso();
      const companyName = String(payload.company_name || payload.name || "Company").trim().slice(0, 120) || "Company";
      const companyCode = String(payload.company_code || `CO${companyId}`).trim().toUpperCase().slice(0, 32) || `CO${companyId}`;
      const email = String(payload.email || "").trim().toLowerCase();
      const phone = String(payload.phone || "").trim();
      const username = String(payload.username || (email ? email.split("@")[0] : "owner")).trim().toLowerCase().slice(0, 30) || "owner";
      const name = String(payload.name || companyName).trim().slice(0, 120) || companyName;
      const branchId = payload.branch_id == null || payload.branch_id === "" ? null : Number(payload.branch_id);
      const planCode = normalizePlanCode(payload.plan_code || "free_trial");
      const plan = db.plans.find((entry) => entry.code === planCode)
        || db.plans.find((entry) => entry.code === "free_trial")
        || db.plans[0];
      const trialEndsAt = payload.trial_ends_at
        || new Date(Date.now() + Math.max(1, Number(plan?.trial_days || DEFAULT_TRIAL_DAYS)) * 86400000).toISOString();
      const emailVerified = payload.email_verified !== false;

      let company = db.companies.find((entry) => String(entry.id) === String(companyId));
      if (!company) {
        company = {
          id: Number(companyId) || companyId,
          name: companyName,
          business_type: "Retail",
          country: "Kenya",
          code: companyCode,
          currency: String(payload.currency || BILLING_CURRENCY),
          time_zone: "UTC",
          email,
          phone,
          address: "",
          logo: "",
          status: emailVerified ? "active" : "pending_verification",
          owner_user_id: supabaseUserId,
          signup_source: "auth_hydrate",
          created_at: timestamp,
          created_by: null,
        };
        db.companies.push(company);
        ensureNextIdAbove("company", company.id);
      } else {
        if (company.status === "pending_verification" && emailVerified) company.status = "active";
        if (!company.owner_user_id) company.owner_user_id = supabaseUserId;
        if (companyCode && !company.code) company.code = companyCode;
        if (companyName && company.name === "Company") company.name = companyName;
      }

      let branch = db.branches.find((entry) =>
        Number(entry.company_id) === Number(company.id)
        && (branchId == null || String(entry.id) === String(branchId))
      );
      if (!branch) {
        const resolvedBranchId = branchId != null && Number.isFinite(Number(branchId))
          ? Number(branchId)
          : nextId("branch");
        branch = {
          id: resolvedBranchId,
          company_id: company.id,
          name: "Main Branch",
          code: "MAIN",
          address: "",
          active: true,
        };
        db.branches.push(branch);
        ensureNextIdAbove("branch", branch.id);
      }

      let subscription = db.subscriptions.find((entry) => Number(entry.company_id) === Number(company.id));
      if (!subscription) {
        subscription = {
          id: nextId("subscription"),
          company_id: company.id,
          plan_id: plan?.id || 1,
          plan_code: plan?.code || planCode,
          status: "trialing",
          starts_at: timestamp,
          trial_starts_at: timestamp,
          trial_ends_at: trialEndsAt,
          expires_at: trialEndsAt,
          limits: structuredClone(plan?.limits || { users: 5, branches: 1 }),
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.subscriptions.push(subscription);
      } else if (!["active", "trialing"].includes(subscription.status) && emailVerified) {
        subscription.status = "trialing";
        subscription.expires_at = trialEndsAt;
        subscription.updated_at = timestamp;
      }

      if (!db.roles.some((entry) => Number(entry.company_id) === Number(company.id))) {
        db.roles.push(...SYSTEM_ROLES.filter((entry) => entry.id !== "platform_owner").map((entry, index) => ({
          id: nextId("role"),
          company_id: company.id,
          key: entry.id,
          name: entry.label,
          hierarchy_rank: index + 1,
          system: true,
          permissions: structuredClone(defaultPermissions()[entry.id] || {}),
          created_at: timestamp,
        })));
      }
      if (!db.permissionMatrices[company.id]) {
        db.permissionMatrices[company.id] = structuredClone(defaultPermissions());
      }
      if (!db.companySettings[company.id]) {
        db.companySettings[company.id] = {
          ...seedDatabase().settings,
          store_name: company.name,
          store_phone: phone,
          currency: company.currency || "USD",
          currency_symbol: "$",
          default_branch_id: String(branch.id),
        };
      }

      let stub = db.users.find((entry) => String(entry.id) === String(supabaseUserId));
      if (!stub) {
        stub = {
          id: supabaseUserId,
          name,
          username,
          email,
          phone,
          role: "owner",
          role_id: "owner",
          active: 1,
          email_verified: emailVerified,
          email_verified_at: emailVerified ? timestamp : null,
          branch_id: branch.id,
          company_id: company.id,
          profile_photo: "",
          signup_source: "auth_hydrate",
          created_at: timestamp,
          created_by: null,
          created_by_name: "Auth hydrate",
        };
        db.users.push(stub);
      } else {
        stub.company_id = company.id;
        stub.branch_id = stub.branch_id || branch.id;
        stub.email_verified = stub.email_verified || emailVerified;
        if (emailVerified && !stub.email_verified_at) stub.email_verified_at = timestamp;
      }

      logAudit("company_workspace_hydrated", "public_auth", {
        company_id: company.id,
        user_id: supabaseUserId,
        code: company.code,
      });
      persist();
      return wait({
        success: true,
        company_id: company.id,
        branch_id: branch.id,
        company_code: company.code,
        hydrated: true,
      });
    },
    activateCompanyForOwner: (supabaseUserId) => {
      let company = db.companies.find((entry) => String(entry.owner_user_id) === String(supabaseUserId));
      if (!company) {
        const stub = db.users.find((entry) => String(entry.id) === String(supabaseUserId));
        if (stub?.company_id != null) {
          company = db.companies.find((entry) => String(entry.id) === String(stub.company_id));
        }
      }
      if (!company) return wait({ success: false, error: "No company found for this account." });
      if (company.status === "pending_verification") company.status = "active";
      const stub = db.users.find((entry) => String(entry.id) === String(supabaseUserId));
      if (stub) {
        stub.email_verified = true;
        stub.email_verified_at = nowIso();
      }
      logAudit("email_verified", "public_auth", { company_id: company.id, user_id: supabaseUserId });
      persist();
      return wait({ success: true, company_code: company.code });
    },
    /** Keep local owner profile + company contact email in sync after Zoho-verified change. */
    syncOwnerEmailProfile: ({ userId, email, companyId } = {}) => {
      const nextEmail = String(email || "").trim().toLowerCase();
      if (!userId || !validEmail(nextEmail)) {
        return wait({ success: false, error: "Enter a valid owner email to sync." });
      }
      const stub = db.users.find((entry) => String(entry.id) === String(userId));
      if (stub) {
        stub.email = nextEmail;
        stub.email_verified = true;
        stub.email_verified_at = nowIso();
      }
      const resolvedCompanyId = companyId != null ? companyId : stub?.company_id;
      const company = db.companies.find((entry) => String(entry.id) === String(resolvedCompanyId));
      if (company) {
        company.email = nextEmail;
        if (String(company.owner_user_id) !== String(userId)) {
          company.owner_user_id = stub?.id ?? company.owner_user_id;
        }
      }
      logAudit("owner_email_synced", "public_auth", {
        user_id: userId,
        company_id: company?.id || null,
        email_domain: nextEmail.split("@")[1] || "",
      });
      persist();
      remoteUsersCache = [];
      return wait({
        success: true,
        email: nextEmail,
        user_synced: Boolean(stub),
        company_synced: Boolean(company),
      });
    },
    signupCompany: async () => wait({
      success: false,
      error: "Use the signup() method from AuthContext (Supabase Auth).",
      code: "DEPRECATED",
    }),
    verifyEmail: () => wait({
      success: false,
      error: "Email verification is handled by Supabase Auth.",
      code: "DEPRECATED",
    }),
    requestPasswordReset: () => wait({
      success: true,
      message: "If an account matches, password reset instructions have been queued.",
    }),
    notifyPasswordChanged: (email, name) => {
      sendTransactionalEmail({ type: "password_changed", to: email, name }).then((result) => {
        if (!result.success) console.error("[mockApi] password_changed notification failed:", result.error);
      });
      return wait({ success: true });
    },
    resetPassword: () => wait({ success: false, error: "Use the reset password page with a Supabase recovery session." }),
    socialProviderStatus: () => wait({
      google: !!import.meta.env?.VITE_GOOGLE_OAUTH_URL,
      microsoft: !!import.meta.env?.VITE_MICROSOFT_OAUTH_URL,
      apple: !!import.meta.env?.VITE_APPLE_OAUTH_URL,
    }),
  },
  auth: {
    loginByEmail: () => wait({ success: false, error: "Login is handled by AuthContext via Supabase Auth.", code: "DEPRECATED" }),
    login: () => wait({ success: false, error: "Login is handled by AuthContext via Supabase Auth.", code: "DEPRECATED" }),
    restoreSession: () => wait({ success: false, error: "Session restore is handled by Supabase Auth." }),
    stopImpersonation: () => wait({ success: false, error: "Use AuthContext.stopImpersonation()." }),
    logout: () => {
      logAudit("logout", "auth", {});
      currentMockUser = null;
      currentSessionId = null;
      impersonationContext = null;
      persist();
      return wait({ success: true });
    },
    heartbeat: () => {
      if (!currentMockUser) return wait({ success: false, at: nowIso() });
      const timestamp = nowIso();
      const existing = db.sessions.find((entry) => String(entry.user_id) === String(currentMockUser.id) && !entry.logout_at);
      if (existing) {
        existing.last_activity_at = timestamp;
      } else {
        db.sessions.push({
          id: nextId("session"),
          user_id: currentMockUser.id,
          role: currentMockUser.role,
          company_id: currentMockUser.company_id,
          branch_id: currentMockUser.branch_id,
          login_at: timestamp,
          last_activity_at: timestamp,
          logout_at: null,
        });
      }
      persist();
      return wait({ success: true, at: timestamp });
    },
    listUsers: async () => {
      const result = await fetchRemoteUsers();
      if (!result.success) return [];
      return result.users;
    },
    getUser: async (id) => {
      const result = await fetchRemoteUsers(id);
      if (!result.success) return null;
      return result.user ? enrichRemoteUserMetrics(result.user) : null;
    },
  },
  users: {
    getStatus: () => {
      const now = Date.now();
      const today = salesForRange({ preset: "today" });
      const month = salesForRange({ preset: "this_month" });
      return wait(companyScopedUsers().map((user) => {
        const sessions = db.sessions.filter((entry) => entry.user_id === user.id).sort((a, b) => new Date(b.login_at) - new Date(a.login_at));
        const latest = sessions[0];
        const userToday = today.filter((sale) => Number(sale.user_id) === user.id);
        const userMonth = month.filter((sale) => Number(sale.user_id) === user.id);
        const lastSale = db.sales.filter((sale) => Number(sale.user_id) === user.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        const branch = db.branches.find((entry) => entry.id === Number(user.branch_id));
        const online = !!latest && !latest.logout_at && now - new Date(latest.last_activity_at).getTime() <= 300000;
        return {
          ...publicUser(user),
          branch_name: branch?.name || "Unknown branch",
          online,
          login_at: latest?.login_at || null,
          logout_at: latest?.logout_at || null,
          last_activity_at: latest?.last_activity_at || null,
          last_sale_at: lastSale?.created_at || null,
          sales_today: userToday.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
          sales_month: userMonth.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
          transactions_today: userToday.length,
          transactions_month: userMonth.length,
        };
      }));
    },
    getDashboard: () => {
      const denied = requireUserManager();
      if (denied) return wait(denied);
      const status = rawApi.users.getStatus();
      return Promise.all([status, wait(buildUserSales({ preset: "today" }))]).then(([users, performance]) => {
        const ranked = users.map((entry) => {
          const metrics = performance.find((row) => row.user_id === entry.id);
          return { ...entry, revenue: metrics?.total_revenue || 0, transactions: metrics?.total_transactions || 0, profit: metrics?.total_profit || 0 };
        }).sort((a, b) => b.revenue - a.revenue);
        return { success: true, users: ranked, cashiers: ranked.filter((entry) => normalizeRole(entry.role) === "cashier") };
      });
    },
  },
  products: {
    getAll: (params = {}) => {
      const includeDeleted = params.include_deleted === true || params.include_deleted === "true";
      const includeArchived = params.include_archived === true || params.include_archived === "true";
      const rows = db.products
        .filter((p) => {
          if (!includeDeleted && p.deleted_at) return false;
          if (!includeArchived && p.archived_at) return false;
          return true;
        })
        .map(normalizeProduct);
      return wait(rows);
    },
    getByBarcode: (barcode) => wait(db.products.map(normalizeProduct).find((product) => product.barcode === barcode && !product.deleted_at) || null),
    getCategories: () => wait(db.categories),
    create: (product) => {
      const companyId = currentMockUser?.company_id;
      const productCount = db.products.filter((row) => Number(row.company_id || companyId) === Number(companyId)).length;
      const limited = enforceCompanyPlanLimit("products", productCount, companyId);
      if (limited) return wait(limited);
      const id = nextId("product");
      const fromPurchase = product.from_purchase === true || product.defer_stock === true;
      const name = String(product.name || "").trim();
      const sku =
        String(product.sku || "").trim() ||
        `${(name || "PRD").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "PRD"}-${Date.now().toString(36).toUpperCase()}`;
      const barcode =
        product.barcode != null && String(product.barcode).trim() !== ""
          ? String(product.barcode).trim()
          : fromPurchase || product.auto_barcode === true
            ? `NX${Date.now()}${Math.floor(Math.random() * 90 + 10)}`
            : null;
      const variants = Array.isArray(product.variants)
        ? product.variants.map((v) => ({
            id: v.id || nextId("variant"),
            name: v.name,
            sku: v.sku || "",
            barcode: v.barcode || null,
            price: Number(v.price) || Number(product.price) || 0,
            cost: Number(v.cost) || Number(product.cost) || 0,
            stock: Number(v.stock) || 0,
          }))
        : [];
      const record = normalizeProduct({
        ...product,
        id,
        name,
        sku,
        barcode,
        tax_rate: Number(product.tax_rate ?? product.tax) || 0,
        wholesale_price: Number(product.wholesale_price) || 0,
        discount_percent: Number(product.discount_percent) || 0,
        tax_inclusive: !!product.tax_inclusive,
        max_stock: Number(product.max_stock) || 0,
        expiry_date: product.expiry_date || null,
        stock_preference: product.stock_preference || "none",
        archived_at: null,
        deleted_at: null,
        branch_id: product.branch_id || getCurrentBranchId(),
        brand_id: product.brand_id ? Number(product.brand_id) : null,
        unit_id: product.unit_id ? Number(product.unit_id) : null,
        image_url: product.image_url || "",
        variants,
        track_batches: !!product.track_batches,
        default_expiry_days: product.default_expiry_days ?? null,
        stock: fromPurchase ? 0 : Number(product.stock) || 0,
      });
      db.products.push(record);
      const whId = Number(product.warehouse_id) || defaultWarehouseId(record.branch_id);
      if (Number(record.stock) > 0) {
        applyStockDelta(db, {
          product_id: id,
          warehouse_id: whId,
          qty: Number(record.stock),
          batch_number: product.batch_number || null,
          expiry_date: product.expiry_date || null,
        });
      }
      logAudit("create_product", "products", { id: record.id, from_purchase: fromPurchase });
      persist();
      return wait({ success: true, id: record.id, product: record });
    },
    update: (product) => {
      db.products = db.products.map((item) => {
        if (item.id !== product.id) return item;
        const variants = Array.isArray(product.variants)
          ? product.variants.map((v) => ({
              id: v.id || nextId("variant"),
              name: v.name,
              sku: v.sku || "",
              barcode: v.barcode || null,
              price: Number(v.price) || 0,
              cost: Number(v.cost) || 0,
              stock: Number(v.stock) || 0,
            }))
          : item.variants || [];
        return normalizeProduct({
          ...item,
          ...product,
          brand_id: product.brand_id !== undefined ? (product.brand_id ? Number(product.brand_id) : null) : item.brand_id,
          unit_id: product.unit_id !== undefined ? (product.unit_id ? Number(product.unit_id) : null) : item.unit_id,
          image_url: product.image_url !== undefined ? product.image_url : item.image_url,
          variants,
          track_batches: product.track_batches !== undefined ? !!product.track_batches : item.track_batches,
        });
      });
      logAudit("update_product", "products", { id: product.id });
      persist();
      return wait({ success: true });
    },
    archive: (id) => {
      const now = new Date().toISOString();
      db.products = db.products.map((p) => (p.id === id ? { ...p, archived_at: now, active: 0 } : p));
      logAudit("archive_product", "products", { id });
      persist();
      return wait({ success: true, product: normalizeProduct(db.products.find((p) => p.id === id)) });
    },
    restore: (id) => {
      db.products = db.products.map((p) =>
        p.id === id ? { ...p, archived_at: null, deleted_at: null, active: 1 } : p
      );
      logAudit("restore_product", "products", { id });
      persist();
      return wait({ success: true, product: normalizeProduct(db.products.find((p) => p.id === id)) });
    },
    delete: (id) => {
      const now = new Date().toISOString();
      db.products = db.products.map((p) =>
        p.id === id ? { ...p, deleted_at: now, archived_at: now, active: 0 } : p
      );
      logAudit("soft_delete_product", "products", { id });
      persist();
      return wait({ success: true, soft: true });
    },
    import: async (params = {}) => {
      const rows = Array.isArray(params) ? params : params.rows || [];
      let created = 0;
      let updated = 0;
      let failed = 0;
      for (const row of rows.slice(0, 500)) {
        try {
          const name = String(row.name || "").trim();
          if (!name) {
            failed += 1;
            continue;
          }
          const existing = row.barcode
            ? db.products.find((p) => String(p.barcode) === String(row.barcode))
            : null;
          if (existing) {
            await rawApi.products.update({ id: existing.id, ...row, name });
            updated += 1;
          } else {
            await rawApi.products.create({ ...row, name, auto_barcode: !row.barcode });
            created += 1;
          }
        } catch {
          failed += 1;
        }
      }
      return wait({ success: true, created, updated, failed, errors: [] });
    },
    adjustStock: (id, delta, reason = "Manual adjustment") => {
      const product = db.products.find((item) => item.id === id);
      if (!product) return wait({ success: false, error: "Product not found." });
      const whId = defaultWarehouseId(product.branch_id);
      const result = applyStockDelta(db, {
        product_id: id,
        warehouse_id: whId,
        qty: Number(delta),
      });
      if (!result.success) return wait(result);
      recordStockMovement({
        type: "adjust",
        product_id: id,
        warehouse_id: whId,
        qty: Number(delta),
        note: reason,
      });
      logAudit("adjust_stock", "inventory", { id, delta, reason });
      persist();
      return wait({ success: true });
    },
  },
  brands: {
    getAll: () => wait(db.brands || []),
    create: ({ name, active = true }) => {
      const trimmed = String(name || "").trim();
      if (!trimmed) return wait({ success: false, error: "Brand name is required." });
      if ((db.brands || []).some((b) => b.name.toLowerCase() === trimmed.toLowerCase())) {
        return wait({ success: false, error: "Brand already exists." });
      }
      const record = { id: nextId("brand"), name: trimmed, active: !!active };
      db.brands.push(record);
      logAudit("create_brand", "brands", { id: record.id });
      persist();
      return wait({ success: true, id: record.id });
    },
    update: ({ id, name, active }) => {
      db.brands = (db.brands || []).map((brand) =>
        brand.id === id
          ? { ...brand, name: name !== undefined ? String(name).trim() : brand.name, active: active !== undefined ? !!active : brand.active }
          : brand
      );
      logAudit("update_brand", "brands", { id });
      persist();
      return wait({ success: true });
    },
    delete: (id) => {
      if ((db.products || []).some((p) => Number(p.brand_id) === Number(id))) {
        return wait({ success: false, error: "Brand is used by products. Reassign first." });
      }
      db.brands = (db.brands || []).filter((brand) => brand.id !== id);
      logAudit("delete_brand", "brands", { id });
      persist();
      return wait({ success: true });
    },
  },
  units: {
    getAll: () => wait(db.units || []),
    create: ({ name, abbreviation, active = true }) => {
      const trimmed = String(name || "").trim();
      const abbr = String(abbreviation || trimmed).trim();
      if (!trimmed) return wait({ success: false, error: "Unit name is required." });
      if ((db.units || []).some((u) => u.name.toLowerCase() === trimmed.toLowerCase())) {
        return wait({ success: false, error: "Unit already exists." });
      }
      const record = { id: nextId("unit"), name: trimmed, abbreviation: abbr, active: !!active };
      db.units.push(record);
      logAudit("create_unit", "inventory", { id: record.id });
      persist();
      return wait({ success: true, id: record.id });
    },
    update: ({ id, name, abbreviation, active }) => {
      db.units = (db.units || []).map((unit) =>
        unit.id === id
          ? {
              ...unit,
              name: name !== undefined ? String(name).trim() : unit.name,
              abbreviation: abbreviation !== undefined ? String(abbreviation).trim() : unit.abbreviation,
              active: active !== undefined ? !!active : unit.active,
            }
          : unit
      );
      logAudit("update_unit", "inventory", { id });
      persist();
      return wait({ success: true });
    },
    delete: (id) => {
      if ((db.products || []).some((p) => Number(p.unit_id) === Number(id))) {
        return wait({ success: false, error: "Unit is used by products. Reassign first." });
      }
      db.units = (db.units || []).filter((unit) => unit.id !== id);
      logAudit("delete_unit", "inventory", { id });
      persist();
      return wait({ success: true });
    },
  },
  warehouses: {
    getAll: () => wait(db.warehouses || []),
    create: ({ name, code, branch_id, address = "", active = true }) => {
      const companyId = currentMockUser?.company_id;
      const warehouseCount = (db.warehouses || []).filter((row) => Number(row.company_id || companyId) === Number(companyId)).length;
      const limited = enforceCompanyPlanLimit("warehouses", warehouseCount, companyId);
      if (limited) return wait(limited);
      const trimmed = String(name || "").trim();
      if (!trimmed) return wait({ success: false, error: "Warehouse name is required." });
      const record = {
        id: nextId("warehouse"),
        name: trimmed,
        code: String(code || `WH${Date.now().toString().slice(-4)}`).trim(),
        branch_id: Number(branch_id) || getCurrentBranchId(),
        address: address || "",
        active: !!active,
      };
      db.warehouses.push(record);
      logAudit("create_warehouse", "inventory", { id: record.id });
      persist();
      return wait({ success: true, id: record.id });
    },
    update: (payload) => {
      db.warehouses = (db.warehouses || []).map((wh) =>
        wh.id === payload.id
          ? {
              ...wh,
              name: payload.name !== undefined ? String(payload.name).trim() : wh.name,
              code: payload.code !== undefined ? String(payload.code).trim() : wh.code,
              branch_id: payload.branch_id !== undefined ? Number(payload.branch_id) : wh.branch_id,
              address: payload.address !== undefined ? payload.address : wh.address,
              active: payload.active !== undefined ? !!payload.active : wh.active,
            }
          : wh
      );
      logAudit("update_warehouse", "inventory", { id: payload.id });
      persist();
      return wait({ success: true });
    },
    delete: (id) => {
      const hasStock = (db.warehouseStock || []).some((row) => row.warehouse_id === id && Number(row.qty) > 0);
      if (hasStock) return wait({ success: false, error: "Warehouse still has stock. Transfer or clear first." });
      db.warehouses = (db.warehouses || []).filter((wh) => wh.id !== id);
      db.warehouseStock = (db.warehouseStock || []).filter((row) => row.warehouse_id !== id);
      logAudit("delete_warehouse", "inventory", { id });
      persist();
      return wait({ success: true });
    },
  },
  categories: {
    getAll: () => wait(db.categories.map((category) => ({
      ...category,
      image_url: category.image_url || category.image || "",
      image: category.image_url || category.image || "",
    }))),
    create: ({ name, color = "#2563EB", image_url = "", image = "" }) => {
      if (db.categories.some((category) => category.name.toLowerCase() === name.trim().toLowerCase())) {
        return wait({ success: false, error: "Category already exists." });
      }
      const resolvedImage = String(image_url || image || "").trim();
      const record = {
        id: nextId("category"),
        name: name.trim(),
        color,
        image_url: resolvedImage,
        image: resolvedImage,
      };
      db.categories.push(record);
      logAudit("create_category", "categories", { id: record.id });
      persist();
      return wait({ success: true, id: record.id });
    },
    update: ({ id, name, color, image_url, image }) => {
      const resolvedImage = image_url !== undefined || image !== undefined
        ? String(image_url ?? image ?? "").trim()
        : undefined;
      db.categories = db.categories.map((category) => {
        if (category.id !== id) return category;
        return {
          ...category,
          name: name.trim(),
          color,
          ...(resolvedImage !== undefined
            ? { image_url: resolvedImage, image: resolvedImage }
            : {}),
        };
      });
      db.products = db.products.map((product) => (product.category_id === id ? { ...product, category: name.trim() } : product));
      logAudit("update_category", "categories", { id });
      persist();
      return wait({ success: true });
    },
    delete: (id) => {
      db.categories = db.categories.filter((category) => category.id !== id);
      db.products = db.products.map((product) => (product.category_id === id ? { ...product, category_id: null, category: "Uncategorized" } : product));
      logAudit("delete_category", "categories", { id });
      persist();
      return wait({ success: true });
    },
  },
  sales: {
    create: async (sale) => {
      if (!currentMockUser) {
        return wait({ success: false, error: "Authentication is required to complete a sale.", code: "UNAUTHENTICATED" });
      }
      if (!Array.isArray(sale.items) || sale.items.length === 0) {
        return wait({ success: false, error: "A sale must contain at least one item." });
      }
      // Prefer client total (POS); fall back to line items so payment validation never sees NaN.
      let saleTotal = Number(sale.total);
      if (!Number.isFinite(saleTotal)) {
        const itemsSubtotal = sale.items.reduce(
          (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0),
          0
        );
        const discount = Number(sale.discount || 0) || 0;
        const vat = Number(sale.vat || 0) || 0;
        saleTotal = Math.max(0, Number((itemsSubtotal - discount + vat).toFixed(2)));
      }
      const paid = validateSalePayment({
        payment_method: sale.payment_method,
        total: saleTotal,
        cash_tendered: sale.cash_tendered,
        card_brand: sale.card_brand,
        split_payments: sale.split_payments,
        mpesa_reference: sale.payment_reference,
        bank_reference: sale.payment_reference,
        gift_card_code: sale.payment_reference,
      });
      if (!paid.success) {
        return wait({ success: false, error: paid.error, code: "PAYMENT_INVALID" });
      }
      if (sale.client_reference) {
        const existing = db.sales.find((entry) => entry.client_reference === sale.client_reference);
        if (existing) {
          return wait({ success: true, id: existing.id, invoice_no: existing.invoice_no, duplicate: true });
        }
      }
      for (const item of sale.items) {
        const product = db.products.find((entry) => entry.id === Number(item.product_id));
        const qty = Number(item.qty);
        if (!product || !Number.isFinite(qty) || qty <= 0 || qty > Number(product.stock)) {
          return wait({ success: false, error: `Insufficient stock for ${item.name || "an item"}.` });
        }
      }
      const vatRate = Number(sale.vat_rate || 0);
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
        return wait({ success: false, error: "VAT rate must be between 0 and 100." });
      }
      const id = nextId("sale");
      const created_at = nowIso();
      const receipt_no = formatReceiptNumber(id, created_at);
      const invoice_no = receipt_no;
      const branch = db.branches.find((entry) => entry.id === Number(currentMockUser.branch_id));
      const { user_id: _ignoredUserId, cashier_name: _ignoredName, cashier_username: _ignoredUsername, branch_id: _ignoredBranch, ...saleData } = sale;
      const record = {
        id,
        invoice_no,
        receipt_no,
        ...saleData,
        total: saleTotal,
        payment_method: paid.payment_method,
        cash_tendered: paid.cash_tendered,
        change_due: paid.change_due,
        card_brand: paid.card_brand,
        payment_reference: paid.payment_reference,
        split_payments: paid.split_payments,
        status: "Valid",
        company_id: currentMockUser.company_id,
        user_id: currentMockUser.id,
        cashier_name: currentMockUser.name,
        cashier_username: currentMockUser.username,
        branch_id: Number(currentMockUser.branch_id),
        branch_name: branch?.name || "Unknown branch",
        currency_code: getCurrency(db.settings.currency).code,
        currency_symbol: getCurrency(db.settings.currency).symbol,
        created_at,
      };
      db.sales.unshift(record);
      sale.items.forEach((item) => {
        const product = db.products.find((p) => p.id === item.product_id);
        const whId = defaultWarehouseId(product?.branch_id || getCurrentBranchId());
        applyStockDelta(db, {
          product_id: item.product_id,
          warehouse_id: whId,
          qty: -Number(item.qty),
        });
        recordStockMovement({
          type: "out",
          product_id: item.product_id,
          warehouse_id: whId,
          qty: Number(item.qty),
          note: `POS sale ${invoice_no}`,
        });
      });
      if (sale.customer_id) {
        db.customers = db.customers.map((customer) =>
          customer.id === Number(sale.customer_id)
            ? {
                ...customer,
                points: customer.points + Math.floor(saleTotal / 100),
                visits: customer.visits + 1,
                spent: customer.spent + saleTotal,
                balance: sale.payment_method === "Credit" ? customer.balance + saleTotal : customer.balance,
              }
            : customer
        );
      }
      logAudit("create_sale", "sales", { invoice_no, receipt_no, total: saleTotal });
      persist();
      touchSession(true);
      await publishInvoiceVerification(record);
      return wait({
        success: true,
        id,
        invoice_no,
        receipt_no,
        sale: { ...record, items: record.items.map((item) => ({ ...item })) },
      });
    },
    hold: (sale) => {
      const id = nextId("heldSale");
      db.heldSales.unshift({ id, ...sale, held_at: nowIso() });
      logAudit("hold_sale", "sales", { id });
      persist();
      return wait({ success: true, id });
    },
    getHeld: () => wait(db.heldSales),
    releaseHeld: (id) => {
      const held = db.heldSales.find((sale) => sale.id === id) || null;
      db.heldSales = db.heldSales.filter((sale) => sale.id !== id);
      persist();
      return wait(held);
    },
    getRecent: (limit = 10) =>
      wait(
        db.sales.slice(0, limit).map((sale) => ({
          id: sale.id,
          invoice_no: sale.invoice_no,
          total: sale.total,
          payment_method: sale.payment_method,
          created_at: sale.created_at,
          cashier_name: sale.cashier_name,
          cashier_username: sale.cashier_username,
          branch_name: sale.branch_name,
          currency_code: sale.currency_code,
          currency_symbol: sale.currency_symbol,
          customer: db.customers.find((customer) => customer.id === Number(sale.customer_id))?.name || "Walk-in",
          item_count: sale.items?.length || 0,
        }))
      ),
    getSummary: () => {
      const todayStr = new Date().toDateString();
      const monthPrefix = new Date().toISOString().slice(0, 7);
      const todaySales = db.sales.filter((sale) => new Date(sale.created_at).toDateString() === todayStr);
      const monthSales = db.sales.filter((sale) => String(sale.created_at).slice(0, 7) === monthPrefix);
      return wait({
        today: todaySales.reduce((sum, sale) => sum + sale.total, 0),
        todayCount: todaySales.length,
        monthRevenue: monthSales.reduce((sum, sale) => sum + sale.total, 0),
      });
    },
    getWeeklyTrend: () => {
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const totals = days.map((day) => ({ day, sales: 0 }));
      db.sales.forEach((sale) => {
        const index = (new Date(sale.created_at).getDay() + 6) % 7;
        totals[index].sales += sale.total;
      });
      return wait(totals);
    },
    getItems: (saleId) => wait(db.sales.find((sale) => sale.id === saleId)?.items || []),
    createReturn: ({ sale_id, items, reason }) => {
      const sale = db.sales.find((entry) => entry.id === Number(sale_id));
      if (!sale) return wait({ success: false, error: "Sale not found." });
      items.forEach((item) => {
        db.products = db.products.map((product) =>
          product.id === item.product_id ? { ...product, stock: product.stock + Number(item.qty) } : product
        );
      });
      const refund = items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
      sale.returned = (sale.returned || 0) + refund;
      sale.return_reason = reason || "";
      sale.status = "Refunded";
      logAudit("sale_return", "sales", { sale_id, refund, reason });
      persist();
      publishInvoiceVerification(sale);
      return wait({ success: true, refund });
    },
  },
  customers: {
    getAll: () => wait(db.customers),
    getCount: () => wait({ success: true, count: (db.customers || []).length }),
    create: (customer) => {
      const record = {
        ...customer,
        id: nextId("customer"),
        points: Number(customer.points || 0),
        visits: 0,
        spent: 0,
        balance: 0,
        credit_limit: Number(customer.credit_limit || 0),
        address: customer.address || "",
        email: customer.email || "",
        phone: customer.phone || "",
      };
      db.customers.push(record);
      logAudit("create_customer", "customers", { id: record.id });
      persist();
      return wait({ success: true, id: record.id });
    },
    update: (customer) => {
      db.customers = db.customers.map((item) =>
        item.id === customer.id
          ? {
              ...item,
              ...customer,
              credit_limit: Number(customer.credit_limit ?? item.credit_limit ?? 0),
              points: Number(customer.points ?? item.points ?? 0),
            }
          : item
      );
      persist();
      return wait({ success: true });
    },
    delete: (id) => {
      db.customers = db.customers.filter((item) => item.id !== id);
      persist();
      return wait({ success: true });
    },
    addPayment: ({ customer_id, amount, method }) => {
      const payment = { id: nextId("customerPayment"), customer_id, amount: Number(amount), method, created_at: nowIso() };
      db.customerPayments.unshift(payment);
      db.customers = db.customers.map((customer) => (customer.id === Number(customer_id) ? { ...customer, balance: Math.max(0, customer.balance - Number(amount)) } : customer));
      logAudit("customer_payment", "customers", { customer_id, amount });
      persist();
      return wait({ success: true });
    },
    adjustPoints: ({ customer_id, delta, note }) => {
      const customer = db.customers.find((item) => item.id === Number(customer_id));
      if (!customer) return wait({ success: false, error: "Customer not found" });
      const nextPoints = Math.max(0, Number(customer.points || 0) + Number(delta));
      db.customers = db.customers.map((item) => (item.id === Number(customer_id) ? { ...item, points: nextPoints } : item));
      logAudit("adjust_loyalty_points", "customers", { customer_id, delta, note, points: nextPoints });
      persist();
      return wait({ success: true, points: nextPoints });
    },
    getStatement: (id) =>
      wait({
        customer: db.customers.find((customer) => customer.id === id),
        sales: db.sales
          .filter((sale) => Number(sale.customer_id) === id)
          .map((sale) => ({
            id: sale.id,
            invoice_no: sale.invoice_no,
            total: sale.total,
            payment_method: sale.payment_method,
            created_at: sale.created_at,
            item_count: sale.items?.length || 0,
            currency_code: sale.currency_code,
            currency_symbol: sale.currency_symbol,
          })),
        payments: db.customerPayments.filter((payment) => Number(payment.customer_id) === id),
      }),
    getPurchaseHistory: (id) =>
      wait(
        db.sales
          .filter((sale) => Number(sale.customer_id) === id)
          .map((sale) => ({
            id: sale.id,
            invoice_no: sale.invoice_no,
            total: sale.total,
            payment_method: sale.payment_method,
            created_at: sale.created_at,
            items: sale.items || [],
            currency_code: sale.currency_code,
            currency_symbol: sale.currency_symbol,
          }))
      ),
  },
  suppliers: {
    getAll: (params = {}) => {
      const includeDeleted = params.include_deleted === true;
      const includeArchived = params.include_archived !== false;
      return wait(
        db.suppliers.filter((s) => {
          if (!includeDeleted && s.deleted_at) return false;
          if (!includeArchived && (s.archived_at || s.status === "Archived")) return false;
          return true;
        })
      );
    },
    getDashboard: () => {
      const list = db.suppliers.filter((s) => !s.deleted_at);
      const active = list.filter((s) => (s.status || "Active") === "Active" && !s.archived_at);
      const recent = [
        ...db.purchases.slice(0, 8).map((p) => ({
          id: `po-${p.id}`,
          kind: "purchase",
          date: p.created_at,
          reference: p.po_number,
          supplier_id: p.supplier_id,
          supplier: db.suppliers.find((s) => s.id === Number(p.supplier_id))?.name || "—",
          status: p.status,
          amount: Number(p.total) || 0,
        })),
        ...db.supplierPayments.slice(0, 8).map((p) => ({
          id: `pay-${p.id}`,
          kind: "payment",
          date: p.created_at,
          reference: p.reference || p.method,
          supplier_id: p.supplier_id,
          supplier: db.suppliers.find((s) => s.id === Number(p.supplier_id))?.name || "—",
          status: p.method,
          amount: Number(p.base_amount ?? p.amount) || 0,
        })),
      ]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 10);
      return wait({
        total_suppliers: list.length,
        active_suppliers: active.length,
        outstanding_balance: list.reduce((sum, s) => sum + Number(s.balance || 0), 0),
        total_purchases: list.reduce((sum, s) => sum + Number(s.total_ordered || 0), 0),
        total_payments: list.reduce((sum, s) => sum + Number(s.total_paid || 0), 0),
        outstanding_count: list.filter((s) => Number(s.balance) > 0).length,
        recent_transactions: recent,
      });
    },
    getReports: () => {
      const list = db.suppliers.filter((s) => !s.deleted_at);
      return wait({
        outstanding: list
          .filter((s) => Number(s.balance) > 0)
          .sort((a, b) => Number(b.balance) - Number(a.balance))
          .map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            balance: Number(s.balance) || 0,
            credit_limit: Number(s.credit_limit) || 0,
            payment_terms: s.payment_terms,
            last_purchase_at: s.last_purchase_at,
            last_payment_at: s.last_payment_at,
          })),
        purchase_history: db.purchases.map((p) => ({
          id: p.id,
          po_number: p.po_number,
          invoice_no: p.invoice_no,
          supplier_id: p.supplier_id,
          supplier: db.suppliers.find((s) => s.id === Number(p.supplier_id))?.name || "—",
          status: p.status,
          total: Number(p.total) || 0,
          amount_paid: Number(p.amount_paid) || 0,
          balance: Number(p.balance) || 0,
          created_at: p.created_at,
        })),
        payment_history: db.supplierPayments.map((p) => ({
          id: p.id,
          supplier_id: p.supplier_id,
          supplier: db.suppliers.find((s) => s.id === Number(p.supplier_id))?.name || "—",
          amount: Number(p.amount) || 0,
          method: p.method,
          reference: p.reference,
          payment_currency: p.payment_currency,
          original_amount: p.original_amount,
          base_amount: p.base_amount,
          created_at: p.created_at || p.payment_date,
        })),
        top_suppliers: [...list]
          .sort((a, b) => Number(b.total_ordered || 0) - Number(a.total_ordered || 0))
          .slice(0, 20)
          .map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            total_ordered: Number(s.total_ordered) || 0,
            total_paid: Number(s.total_paid) || 0,
            balance: Number(s.balance) || 0,
            order_count: Number(s.order_count) || 0,
          })),
      });
    },
    create: (supplier) => {
      const maxCode = db.suppliers.reduce((m, s) => {
        const n = Number(String(s.code || "").replace(/\D/g, "")) || 0;
        return Math.max(m, n);
      }, 0);
      const opening = Number(supplier.opening_balance) || 0;
      const record = {
        ...supplier,
        id: nextId("supplier"),
        code: supplier.code || `SUP-${String(maxCode + 1).padStart(5, "0")}`,
        order_count: 0,
        total_ordered: 0,
        total_paid: 0,
        opening_balance: opening,
        balance: supplier.balance != null ? Number(supplier.balance) : opening,
        credit_limit: Number(supplier.credit_limit) || 0,
        payment_terms: supplier.payment_terms || "",
        status: supplier.status || "Active",
        email: supplier.email || "",
        address: supplier.address || "",
        contact_person: supplier.contact_person || "",
        phone: supplier.phone || "",
        tax_number: supplier.tax_number || "",
        notes: supplier.notes || "",
        category: supplier.category || "",
        last_purchase_at: null,
        last_payment_at: null,
        archived_at: null,
        deleted_at: null,
      };
      db.suppliers.push(record);
      logAudit("create_supplier", "suppliers", { id: record.id });
      persist();
      return wait({ success: true, id: record.id, supplier: record });
    },
    update: (supplier) => {
      db.suppliers = db.suppliers.map((item) => (item.id === supplier.id ? { ...item, ...supplier } : item));
      const updated = db.suppliers.find((s) => s.id === supplier.id);
      logAudit("update_supplier", "suppliers", { id: supplier.id, name: updated?.name });
      persist();
      return wait({ success: true, supplier: updated });
    },
    archive: (id) => {
      const now = nowIso();
      db.suppliers = db.suppliers.map((s) =>
        s.id === Number(id) ? { ...s, status: "Archived", archived_at: now } : s
      );
      logAudit("archive_supplier", "suppliers", { id });
      persist();
      return wait({ success: true, supplier: db.suppliers.find((s) => s.id === Number(id)) });
    },
    restore: (id) => {
      db.suppliers = db.suppliers.map((s) =>
        s.id === Number(id) ? { ...s, status: "Active", archived_at: null, deleted_at: null } : s
      );
      logAudit("restore_supplier", "suppliers", { id });
      persist();
      return wait({ success: true, supplier: db.suppliers.find((s) => s.id === Number(id)) });
    },
    delete: (id, opts = {}) => {
      const hard = opts?.hard === true;
      if (hard) {
        db.suppliers = db.suppliers.filter((item) => item.id !== Number(id));
        logAudit("delete_supplier", "suppliers", { id, mode: "hard" });
        persist();
        return wait({ success: true, hard: true });
      }
      const now = nowIso();
      db.suppliers = db.suppliers.map((s) =>
        s.id === Number(id) ? { ...s, status: "Inactive", deleted_at: now, archived_at: now } : s
      );
      logAudit("soft_delete_supplier", "suppliers", { id });
      persist();
      return wait({ success: true, soft: true, supplier: db.suppliers.find((s) => s.id === Number(id)) });
    },
    addPayment: (payload) => {
      const splits = Array.isArray(payload?.splits) && payload.splits.length
        ? payload.splits
        : [{ amount: payload?.amount, method: payload?.method, reference: payload?.reference, notes: payload?.notes }];
      const recorded = [];
      let totalBase = 0;
      for (const split of splits) {
        const amt = Number(split.original_amount ?? split.amount ?? payload?.original_amount ?? payload?.amount);
        if (!(amt > 0)) continue;
        const rate = Number(split.exchange_rate ?? payload?.exchange_rate) || 1;
        const baseAmount = convertToBase(amt, rate);
        totalBase += baseAmount;
        const payCurrency = normalizeCurrencyCode(
          split.payment_currency || payload?.payment_currency || db.settings.currency || "KES"
        );
        const row = {
          id: nextId("supplierPayment"),
          supplier_id: payload.supplier_id,
          amount: amt,
          method: split.method || payload?.method || "Cash",
          reference: split.reference || payload?.reference || null,
          notes: split.notes || payload?.notes || null,
          payment_currency: payCurrency,
          exchange_rate: rate,
          original_amount: amt,
          base_amount: baseAmount,
          converted_amount: baseAmount,
          payment_date: split.payment_date || payload?.payment_date || nowIso().slice(0, 10),
          created_at: nowIso(),
        };
        db.supplierPayments.unshift(row);
        recorded.push(row);
      }
      if (!recorded.length) return wait({ success: false, error: "Payment amount must be positive." });
      db.suppliers = db.suppliers.map((supplier) =>
        supplier.id === Number(payload.supplier_id)
          ? {
              ...supplier,
              balance: Math.max(0, Number(supplier.balance) - totalBase),
              total_paid: Number(supplier.total_paid || 0) + totalBase,
              last_payment_at: nowIso(),
            }
          : supplier
      );
      logAudit("supplier_payment", "suppliers", {
        supplier_id: payload.supplier_id,
        total_base: totalBase,
        splits: recorded.map((p) => ({ id: p.id, amount: p.amount, method: p.method })),
      });
      persist();
      return wait({ success: true, payments: recorded, payment: recorded[0] });
    },
    getStatement: (id) => {
      const supplier = db.suppliers.find((s) => s.id === id);
      const purchases = db.purchases.filter((p) => Number(p.supplier_id) === id);
      const payments = db.supplierPayments.filter((p) => Number(p.supplier_id) === id);
      const ledger = [
        ...purchases
          .filter((p) => !["Cancelled", "Draft"].includes(p.status))
          .map((p) => ({
            entry_date: p.created_at,
            entry_type: "purchase",
            reference: p.po_number,
            description: `Purchase ${p.po_number} (${p.status})`,
            debit: Number(p.total) || 0,
            credit: 0,
          })),
        ...payments.map((p) => ({
          entry_date: p.created_at,
          entry_type: "supplier_payment",
          reference: p.method,
          description: `Payment via ${p.method}`,
          debit: 0,
          credit: Number(p.amount) || 0,
        })),
      ].sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)));
      return wait({
        supplier,
        purchases,
        payments,
        ledger,
        totals: {
          total_purchases: Number(supplier?.total_ordered) || 0,
          total_paid: Number(supplier?.total_paid) || 0,
          outstanding: Number(supplier?.balance) || 0,
          last_purchase_at: supplier?.last_purchase_at || null,
          last_payment_at: supplier?.last_payment_at || null,
        },
      });
    },
    getLedger: (id) => {
      const supplier = db.suppliers.find((s) => s.id === id);
      const purchases = db.purchases.filter((p) => Number(p.supplier_id) === id);
      const payments = db.supplierPayments.filter((p) => Number(p.supplier_id) === id);
      const ledger = [
        ...purchases
          .filter((p) => !["Cancelled", "Draft"].includes(p.status))
          .map((p) => ({
            entry_date: p.created_at,
            entry_type: "purchase",
            reference: p.po_number,
            description: `Purchase ${p.po_number} (${p.status})`,
            debit: Number(p.total) || 0,
            credit: 0,
          })),
        ...payments.map((p) => ({
          entry_date: p.created_at,
          entry_type: "supplier_payment",
          reference: p.method,
          description: `Payment via ${p.method}`,
          debit: 0,
          credit: Number(p.amount) || 0,
        })),
      ].sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)));
      return wait({ supplier, purchases, payments, ledger });
    },
    getPurchaseHistory: (id) => wait(db.purchases.filter((purchase) => Number(purchase.supplier_id) === id)),
  },
  purchases: {
    getAll: () =>
      wait(
        db.purchases.map((po) => ({
          ...po,
          amount_paid: Number(po.amount_paid) || 0,
          balance: po.balance != null ? Number(po.balance) : Math.max(0, Number(po.total) - Number(po.amount_paid || 0)),
        }))
      ),
    getItems: (id) => {
      const purchase = db.purchases.find((item) => item.id === Number(id));
      const items = purchase?.items || [];
      return wait(
        items.map((item, index) => ({
          id: item.id || `${id}-${index}`,
          purchase_id: Number(id),
          product_id: item.product_id,
          product_name: db.products.find((p) => p.id === Number(item.product_id))?.name || `Product #${item.product_id}`,
          qty: Number(item.qty) || 0,
          qty_ordered: Number(item.qty_ordered ?? item.qty) || 0,
          qty_received: Number(item.qty_received) || 0,
          cost: Number(item.cost) || 0,
          discount: Number(item.discount) || 0,
          tax: Number(item.tax) || 0,
        }))
      );
    },
    getReturns: () => wait(db.purchaseReturns),
    getPayments: (id) =>
      wait((db.purchasePayments || []).filter((p) => Number(p.purchase_id) === Number(id))),
    getDashboard: () => {
      const list = db.purchases || [];
      const today = new Date().toISOString().slice(0, 10);
      const monthlyMap = new Map();
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        monthlyMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
      }
      let outstanding = 0;
      let todayValue = 0;
      let pending = 0;
      let received = 0;
      for (const po of list) {
        if (["Cancelled", "Rejected"].includes(po.status)) continue;
        outstanding += Math.max(0, Number(po.balance) || Math.max(0, Number(po.total) - Number(po.amount_paid || 0)));
        if (["Draft", "Pending", "Ordered"].includes(po.status)) pending += 1;
        if (["Received", "PartiallyReceived"].includes(po.status)) received += 1;
        if (String(po.created_at || "").slice(0, 10) === today) todayValue += Number(po.total) || 0;
        const mk = String(po.created_at || "").slice(0, 7);
        if (monthlyMap.has(mk)) monthlyMap.set(mk, monthlyMap.get(mk) + (Number(po.total) || 0));
      }
      return wait({
        total_purchases: list.filter((p) => !["Cancelled", "Rejected"].includes(p.status)).length,
        pending_pos: pending,
        received_orders: received,
        outstanding_balance: outstanding,
        purchase_value_today: todayValue,
        monthly: [...monthlyMap.entries()].map(([month, total]) => ({ month, total })),
      });
    },
    getReports: () =>
      wait({
        by_supplier: [],
        by_branch: [],
        outstanding: (db.purchases || [])
          .filter((p) => Number(p.balance || 0) > 0)
          .map((p) => ({ ...p, balance: Number(p.balance) || 0 })),
        returns: db.purchaseReturns || [],
        payments: db.purchasePayments || [],
        vat: (db.purchases || []).map((p) => ({
          id: p.id,
          po_number: p.po_number,
          supplier: p.supplier,
          tax_total: Number(p.tax_total) || 0,
          total: Number(p.total) || 0,
        })),
        accounting: db.journalEntries || [],
        purchase_history: db.purchases || [],
      }),
    getAudit: () => wait((db.auditLog || []).filter((a) => a.module === "purchases")),
    getJournal: () => wait(db.journalEntries || []),
    duplicate: async (id) => {
      const source = db.purchases.find((p) => p.id === Number(id));
      if (!source) return wait({ success: false, error: "Purchase not found." });
      return rawApi.purchases.create({
        supplier_id: source.supplier_id,
        items: (source.items || []).map((it) => ({
          product_id: it.product_id,
          qty: it.qty_ordered ?? it.qty,
          cost: it.cost,
          discount: it.discount,
          tax: it.tax,
        })),
        status: "Draft",
        notes: `Copy of ${source.po_number}`,
        amount_paid: 0,
      });
    },
    create: (purchase) => {
      const id = nextId("purchase");
      const invoiceNo = purchase.invoice_no ? String(purchase.invoice_no).trim() : null;
      if (invoiceNo) {
        const dup = db.purchases.find(
          (p) =>
            Number(p.supplier_id) === Number(purchase.supplier_id) &&
            p.invoice_no === invoiceNo &&
            p.status !== "Cancelled"
        );
        if (dup) {
          return wait({
            success: false,
            error: `Duplicate invoice: ${invoiceNo} already used on ${dup.po_number}.`,
            code: "DUPLICATE_INVOICE",
          });
        }
      }
      if (purchase.client_reference) {
        const dupRef = db.purchases.find(
          (p) => p.client_reference === purchase.client_reference && p.status !== "Cancelled"
        );
        if (dupRef) {
          return wait({ success: false, error: "Duplicate client reference.", code: "DUPLICATE_REFERENCE" });
        }
      }
      const items = (purchase.items || []).map((item) => {
        const qty = Number(item.qty) || 0;
        const cost = Number(item.cost) || 0;
        const discount = Number(item.discount) || 0;
        const tax = Number(item.tax ?? item.tax_rate) || 0;
        const base = Math.max(0, qty * cost - discount);
        const line_total = base + base * (tax / 100);
        return {
          product_id: Number(item.product_id),
          qty,
          qty_ordered: qty,
          qty_received: 0,
          cost,
          discount,
          tax,
          line_total,
        };
      });
      const total = items.reduce((sum, item) => sum + item.line_total, 0);
      const amount_paid = Math.max(0, Number(purchase.amount_paid) || 0);
      const supplierRow = db.suppliers.find((item) => item.id === Number(purchase.supplier_id));
      const supplier = supplierRow?.name || "Unknown";
      const payment_terms = purchase.payment_terms || supplierRow?.payment_terms || "Net 30";
      const daysMatch = String(payment_terms).match(/(\d+)/);
      const termDays = /cod|cash/i.test(payment_terms) ? 0 : Number(daysMatch?.[1] || 30);
      const dueBase = new Date();
      dueBase.setUTCDate(dueBase.getUTCDate() + termDays);
      const due_date = purchase.due_date || dueBase.toISOString().slice(0, 10);
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const seq = db.purchases.filter((p) => String(p.po_number || "").includes(day)).length + 1;
      const po_number = purchase.po_number || `PO-${day}-${String(seq).padStart(4, "0")}`;
      const status = purchase.status || "Pending";
      const record = {
        id,
        po_number,
        supplier_id: purchase.supplier_id,
        supplier,
        invoice_no: invoiceNo,
        total,
        amount_paid,
        balance: Math.max(0, total - amount_paid),
        status,
        notes: purchase.notes || null,
        attachment_url: purchase.attachment_url || null,
        client_reference: purchase.client_reference || null,
        payment_terms,
        due_date,
        created_at: new Date().toISOString().slice(0, 10),
        item_count: items.length,
        items,
      };
      db.purchases.unshift(record);
      if (amount_paid > 0) {
        (db.purchasePayments || (db.purchasePayments = [])).unshift({
          id: nextId("purchasePayment"),
          purchase_id: id,
          supplier_id: purchase.supplier_id,
          amount: amount_paid,
          method: purchase.payment_method || "Cash",
          created_at: nowIso(),
        });
      }
      items.forEach((item) => {
        db.products = db.products.map((product) =>
          product.id === item.product_id ? { ...product, cost: item.cost } : product
        );
      });
      logAudit("create_purchase", "purchases", { po_number });
      persist();
      return wait({ success: true, id, po_number, total, purchase: record });
    },
    update: (payload) => {
      const purchase = db.purchases.find((p) => p.id === Number(payload.id));
      if (!purchase) return wait({ success: false, error: "Purchase not found." });
      Object.assign(purchase, {
        notes: payload.notes !== undefined ? payload.notes : purchase.notes,
        attachment_url: payload.attachment_url !== undefined ? payload.attachment_url : purchase.attachment_url,
        invoice_no: payload.invoice_no !== undefined ? payload.invoice_no : purchase.invoice_no,
        status: payload.status || purchase.status,
      });
      persist();
      return wait({ success: true, purchase });
    },
    receive: (idOrOpts, maybeOpts) => {
      const opts = typeof idOrOpts === "object" ? idOrOpts : { id: idOrOpts, ...(maybeOpts || {}) };
      const id = Number(opts.id);
      const purchase = db.purchases.find((item) => item.id === id);
      if (!purchase) return wait({ success: false, error: "Purchase not found." });
      if (purchase.status === "Received") return wait({ success: false, error: "Purchase already fully received." });
      if (purchase.status === "Cancelled") return wait({ success: false, error: "Cancelled purchases cannot be received." });
      if (purchase.status === "Draft") return wait({ success: false, error: "Draft purchases must be submitted before receiving." });

      const items = (purchase.items || []).map((item) => ({
        ...item,
        qty_ordered: Number(item.qty_ordered ?? item.qty) || 0,
        qty_received: Number(item.qty_received) || 0,
      }));
      const lineOverrides = Array.isArray(opts.lines) ? opts.lines : null;
      const receiveAll = opts.receive_all !== false && !lineOverrides;
      let stockedQty = 0;
      const wasFirst = !["Received", "PartiallyReceived"].includes(purchase.status);

      items.forEach((item, i) => {
        const ordered = item.qty_ordered;
        const already = item.qty_received;
        let toReceive = 0;
        if (lineOverrides) {
          const match = lineOverrides.find(
            (l) => Number(l.product_id) === Number(item.product_id) || Number(l.index) === i
          );
          toReceive = match ? Number(match.qty_received ?? match.qty) || 0 : 0;
        } else if (receiveAll) {
          toReceive = Math.max(0, ordered - already);
        }
        if (toReceive <= 0) return;
        db.products = db.products.map((product) =>
          product.id === item.product_id
            ? { ...product, stock: product.stock + toReceive, cost: item.cost != null ? item.cost : product.cost }
            : product
        );
        (db.stockMovements || (db.stockMovements = [])).unshift({
          id: nextId("stockMovement"),
          product_id: item.product_id,
          type: "in",
          qty: toReceive,
          note: `Purchase receive ${purchase.po_number}`,
          created_at: nowIso(),
        });
        item.qty_received = already + toReceive;
        stockedQty += toReceive;
      });

      if (stockedQty <= 0) return wait({ success: false, error: "No quantities to receive." });

      const allReceived = items.every((it) => it.qty_received >= it.qty_ordered);
      const nextStatus = allReceived ? "Received" : "PartiallyReceived";
      purchase.items = items;
      purchase.status = nextStatus;
      purchase.received_at = nowIso();

      if (wasFirst && purchase.supplier_id) {
        db.suppliers = db.suppliers.map((supplier) =>
          supplier.id === Number(purchase.supplier_id)
            ? {
                ...supplier,
                balance: Number(supplier.balance) + Number(purchase.total) - Number(purchase.amount_paid || 0),
                order_count: (supplier.order_count || 0) + 1,
                total_ordered: (supplier.total_ordered || 0) + Number(purchase.total),
                last_purchase_at: nowIso(),
              }
            : supplier
        );
      }
      logAudit("receive_purchase", "purchases", { id, status: nextStatus });
      persist();
      return wait({ success: true, status: nextStatus, qty_received: stockedQty });
    },
    addPayment: (payload) => {
      const {
        purchase_id, amount, method, reference, notes,
        payment_currency, exchange_rate, original_amount, payment_date, invoice_currency,
      } = payload || {};
      const purchase = db.purchases.find((p) => p.id === Number(purchase_id));
      if (!purchase) return wait({ success: false, error: "Purchase not found." });
      const amt = Number(original_amount ?? amount);
      const rate = Number(exchange_rate) || 1;
      const baseAmount = convertToBase(amt, rate);
      const payCurrency = normalizeCurrencyCode(payment_currency || purchase.currency_code || db.settings.currency || "KES");
      const outstanding = Math.max(0, Number(purchase.total) - Number(purchase.amount_paid || 0));
      if (amt <= 0 || baseAmount > outstanding + 0.001) {
        return wait({ success: false, error: `Payment exceeds outstanding balance (${outstanding}).` });
      }
      purchase.amount_paid = Number(purchase.amount_paid || 0) + baseAmount;
      purchase.balance = Math.max(0, Number(purchase.total) - purchase.amount_paid);
      (db.purchasePayments || (db.purchasePayments = [])).unshift({
        id: nextId("purchasePayment"),
        purchase_id: purchase.id,
        supplier_id: purchase.supplier_id,
        amount: amt,
        method: method || "Cash",
        reference: reference || null,
        notes: notes || null,
        payment_currency: payCurrency,
        exchange_rate: rate,
        original_amount: amt,
        base_amount: baseAmount,
        converted_amount: baseAmount,
        invoice_currency: invoice_currency || purchase.currency_code || null,
        payment_date: payment_date || nowIso().slice(0, 10),
        created_at: nowIso(),
      });
      if (["Received", "PartiallyReceived"].includes(purchase.status) && purchase.supplier_id) {
        db.suppliers = db.suppliers.map((supplier) =>
          supplier.id === Number(purchase.supplier_id)
            ? {
                ...supplier,
                balance: Math.max(0, Number(supplier.balance) - baseAmount),
                total_paid: Number(supplier.total_paid || 0) + baseAmount,
                last_payment_at: nowIso(),
              }
            : supplier
        );
        db.supplierPayments.unshift({
          id: nextId("supplierPayment"),
          supplier_id: purchase.supplier_id,
          amount: amt,
          method: method || "Cash",
          purchase_id: purchase.id,
          payment_currency: payCurrency,
          exchange_rate: rate,
          original_amount: amt,
          base_amount: baseAmount,
          created_at: nowIso(),
        });
      }
      logAudit("purchase_payment", "purchases", { purchase_id, amount: amt, base_amount: baseAmount, payment_currency: payCurrency });
      persist();
      return wait({ success: true, amount_paid: purchase.amount_paid, balance: purchase.balance });
    },
    cancel: (id) => {
      const purchase = db.purchases.find((p) => p.id === Number(id));
      if (!purchase) return wait({ success: false, error: "Purchase not found." });
      if (["Received", "PartiallyReceived"].includes(purchase.status)) {
        return wait({ success: false, error: "Received purchases cannot be cancelled — use returns." });
      }
      purchase.status = "Cancelled";
      purchase.cancelled_at = nowIso();
      persist();
      return wait({ success: true });
    },
    updateStatus: (id, status, extra = {}) => {
      if (status === "Cancelled") {
        const purchase = db.purchases.find((p) => p.id === Number(id));
        if (!purchase) return wait({ success: false, error: "Purchase not found." });
        if (["Received", "PartiallyReceived"].includes(purchase.status)) {
          return wait({ success: false, error: "Received purchases cannot be cancelled — use returns." });
        }
        purchase.status = "Cancelled";
        purchase.cancelled_at = nowIso();
        persist();
        return wait({ success: true });
      }
      if (status === "Rejected") {
        const purchase = db.purchases.find((p) => p.id === Number(id));
        if (!purchase) return wait({ success: false, error: "Purchase not found." });
        purchase.status = "Rejected";
        purchase.rejected_at = nowIso();
        purchase.rejection_reason = extra.rejection_reason || extra.reason || "Rejected";
        persist();
        return wait({ success: true, status: "Rejected" });
      }
      db.purchases = db.purchases.map((item) =>
        item.id === Number(id)
          ? {
              ...item,
              status,
              ...(status === "Ordered"
                ? { ordered_at: nowIso(), approved_at: nowIso() }
                : {}),
            }
          : item
      );
      persist();
      return wait({ success: true, status });
    },
    createReturn: (ret) => {
      const id = nextId("purchaseReturn");
      const purchase = db.purchases.find((item) => item.id === ret.purchase_id);
      if (!purchase || !["Received", "PartiallyReceived"].includes(purchase.status)) {
        return wait({ success: false, error: "Only received purchases can be returned." });
      }
      db.purchaseReturns.unshift({ id, ...ret, created_at: nowIso() });
      db.products = db.products.map((product) =>
        product.id === ret.product_id ? { ...product, stock: Math.max(0, product.stock - ret.qty) } : product
      );
      if (purchase?.supplier_id) {
        db.suppliers = db.suppliers.map((supplier) =>
          supplier.id === Number(purchase.supplier_id)
            ? { ...supplier, balance: Math.max(0, supplier.balance - ret.qty * ret.cost) }
            : supplier
        );
      }
      logAudit("purchase_return", "purchases", { id });
      persist();
      return wait({ success: true, id });
    },
  },
  inventory: {
    getTransfers: () => wait(db.stockTransfers),
    transferStock: ({ product_id, from_branch_id, to_branch_id, qty, note, from_warehouse_id, to_warehouse_id, batch_number, expiry_date, variant_id }) => {
      const fromWh =
        Number(from_warehouse_id) ||
        (db.warehouses || []).find((w) => w.branch_id === Number(from_branch_id))?.id ||
        defaultWarehouseId(from_branch_id);
      const toWh =
        Number(to_warehouse_id) ||
        (db.warehouses || []).find((w) => w.branch_id === Number(to_branch_id))?.id ||
        defaultWarehouseId(to_branch_id);
      if (fromWh === toWh) return wait({ success: false, error: "Source and destination warehouses must differ." });
      const amount = Number(qty);
      if (amount <= 0) return wait({ success: false, error: "Quantity must be positive." });

      const available = (db.warehouseStock || [])
        .filter(
          (row) =>
            row.warehouse_id === fromWh &&
            row.product_id === Number(product_id) &&
            (row.variant_id || null) === (variant_id ? Number(variant_id) : null)
        )
        .reduce((sum, row) => sum + Number(row.qty), 0);
      if (available < amount) return wait({ success: false, error: "Insufficient stock in source warehouse." });

      applyStockDelta(db, {
        product_id,
        variant_id,
        warehouse_id: fromWh,
        qty: -amount,
        batch_number,
        expiry_date,
      });
      applyStockDelta(db, {
        product_id,
        variant_id,
        warehouse_id: toWh,
        qty: amount,
        batch_number,
        expiry_date,
      });

      const id = nextId("transfer");
      db.stockTransfers.unshift({
        id,
        product_id: Number(product_id),
        from_branch_id: Number(from_branch_id) || null,
        to_branch_id: Number(to_branch_id) || null,
        from_warehouse_id: fromWh,
        to_warehouse_id: toWh,
        qty: amount,
        note,
        created_at: nowIso(),
      });
      recordStockMovement({
        type: "out",
        product_id,
        variant_id,
        warehouse_id: fromWh,
        qty: amount,
        batch_number,
        expiry_date,
        note: note || `Transfer to warehouse ${toWh}`,
      });
      recordStockMovement({
        type: "in",
        product_id,
        variant_id,
        warehouse_id: toWh,
        qty: amount,
        batch_number,
        expiry_date,
        note: note || `Transfer from warehouse ${fromWh}`,
      });
      logAudit("stock_transfer", "inventory", { id, product_id, qty: amount });
      persist();
      return wait({ success: true, id });
    },
    getStats: () => wait(computeInventoryStats(db)),
    getLowStock: () => wait(getLowStockProducts(db).map(normalizeProduct)),
    getExpiring: (days = 30) => wait(getExpiringLots(db, days)),
    getMovements: (filters = {}) => {
      let rows = [...(db.stockMovements || [])];
      if (filters.type) rows = rows.filter((m) => m.type === filters.type);
      if (filters.warehouse_id) rows = rows.filter((m) => m.warehouse_id === Number(filters.warehouse_id));
      if (filters.product_id) rows = rows.filter((m) => m.product_id === Number(filters.product_id));
      return wait(
        rows.map((m) => ({
          ...m,
          product_name: db.products.find((p) => p.id === m.product_id)?.name || "Unknown",
          warehouse_name: db.warehouses?.find((w) => w.id === m.warehouse_id)?.name || "Unknown",
        }))
      );
    },
    getWarehouseStock: (warehouseId) => {
      const rows = (db.warehouseStock || []).filter((row) =>
        warehouseId ? row.warehouse_id === Number(warehouseId) : true
      );
      return wait(
        rows.map((row) => {
          const product = db.products.find((p) => p.id === row.product_id);
          const warehouse = db.warehouses?.find((w) => w.id === row.warehouse_id);
          return {
            ...row,
            product_name: product?.name || "Unknown",
            warehouse_name: warehouse?.name || "Unknown",
            cost: product?.cost || 0,
            value: Number(row.qty) * Number(product?.cost || 0),
          };
        })
      );
    },
    stockIn: ({ product_id, variant_id, warehouse_id, qty, batch_number, expiry_date, note }) => {
      const amount = Number(qty);
      if (!product_id || !warehouse_id || !(amount > 0)) {
        return wait({ success: false, error: "Product, warehouse, and positive quantity are required." });
      }
      applyStockDelta(db, { product_id, variant_id, warehouse_id, qty: amount, batch_number, expiry_date });
      const movement = recordStockMovement({
        type: "in",
        product_id,
        variant_id,
        warehouse_id,
        qty: amount,
        batch_number,
        expiry_date,
        note,
      });
      logAudit("stock_in", "inventory", { id: movement.id, product_id, qty: amount });
      persist();
      return wait({ success: true, id: movement.id });
    },
    stockOut: ({ product_id, variant_id, warehouse_id, qty, batch_number, expiry_date, note }) => {
      const amount = Number(qty);
      if (!product_id || !warehouse_id || !(amount > 0)) {
        return wait({ success: false, error: "Product, warehouse, and positive quantity are required." });
      }
      const available = (db.warehouseStock || [])
        .filter(
          (row) =>
            row.warehouse_id === Number(warehouse_id) &&
            row.product_id === Number(product_id) &&
            (row.variant_id || null) === (variant_id ? Number(variant_id) : null)
        )
        .reduce((sum, row) => sum + Number(row.qty), 0);
      if (available < amount) return wait({ success: false, error: "Insufficient warehouse stock." });
      applyStockDelta(db, { product_id, variant_id, warehouse_id, qty: -amount, batch_number, expiry_date });
      const movement = recordStockMovement({
        type: "out",
        product_id,
        variant_id,
        warehouse_id,
        qty: amount,
        batch_number,
        expiry_date,
        note,
      });
      logAudit("stock_out", "inventory", { id: movement.id, product_id, qty: amount });
      persist();
      return wait({ success: true, id: movement.id });
    },
    adjust: ({ product_id, variant_id, warehouse_id, qty, batch_number, expiry_date, note }) => {
      const amount = Number(qty);
      if (!product_id || !warehouse_id || !amount) {
        return wait({ success: false, error: "Product, warehouse, and non-zero quantity are required." });
      }
      if (amount < 0) {
        const available = (db.warehouseStock || [])
          .filter(
            (row) =>
              row.warehouse_id === Number(warehouse_id) &&
              row.product_id === Number(product_id) &&
              (row.variant_id || null) === (variant_id ? Number(variant_id) : null)
          )
          .reduce((sum, row) => sum + Number(row.qty), 0);
        if (available < Math.abs(amount)) return wait({ success: false, error: "Insufficient warehouse stock." });
      }
      applyStockDelta(db, { product_id, variant_id, warehouse_id, qty: amount, batch_number, expiry_date });
      const movement = recordStockMovement({
        type: "adjust",
        product_id,
        variant_id,
        warehouse_id,
        qty: amount,
        batch_number,
        expiry_date,
        note,
      });
      logAudit("stock_adjust", "inventory", { id: movement.id, product_id, qty: amount });
      persist();
      return wait({ success: true, id: movement.id });
    },
    getMovementChart: (days = 30) => {
      const since = new Date();
      since.setDate(since.getDate() - Number(days || 30));
      const buckets = new Map();
      for (let i = 0; i <= Number(days || 30); i += 1) {
        const d = new Date(since);
        d.setDate(since.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, { date: key, in: 0, out: 0, adjust: 0 });
      }
      for (const m of db.stockMovements || []) {
        const key = String(m.created_at || "").slice(0, 10);
        if (!buckets.has(key)) continue;
        const b = buckets.get(key);
        const t = String(m.type || "").toLowerCase();
        const qty = Math.abs(Number(m.qty) || 0);
        if (t === "in" || t.includes("transfer_in")) b.in += qty;
        else if (t === "out" || t.includes("transfer_out")) b.out += qty;
        else b.adjust += qty;
      }
      return wait([...buckets.values()]);
    },
    getReports: () => {
      const products = db.products.filter((p) => !p.deleted_at && !p.archived_at).map(normalizeProduct);
      const movements = db.stockMovements || [];
      const today = new Date().toISOString().slice(0, 10);
      return wait({
        valuation: products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          stock: p.stock,
          cost: p.cost,
          price: p.price,
          stock_value: Number(p.stock) * Number(p.cost || 0),
        })),
        movements,
        dead_stock: products.filter((p) => Number(p.stock) > 0),
        fast_moving: [],
        expired: products.filter((p) => p.expiry_date && String(p.expiry_date).slice(0, 10) < today && Number(p.stock) > 0),
        low_stock: products.filter((p) => Number(p.stock) <= Number(p.reorder_level || 0)),
        overstock: products.filter((p) => Number(p.max_stock) > 0 && Number(p.stock) >= Number(p.max_stock)),
        adjustments: movements.filter((m) => String(m.type || "").includes("adjust")),
      });
    },
    getAudit: () =>
      wait(
        (db.auditLog || [])
          .filter((a) => ["inventory", "products", "barcode"].includes(a.module))
          .slice()
          .reverse()
          .slice(0, 80)
      ),
    getCounts: () => wait(db.stockCounts || []),
    getCount: (params = {}) => {
      const id = Number(params.id ?? params);
      return wait((db.stockCounts || []).find((c) => c.id === id) || null);
    },
    createCount: ({ warehouse_id, notes, lines = [] } = {}) => {
      db.stockCounts = db.stockCounts || [];
      const id = nextId("stockCount");
      const count = {
        id,
        warehouse_id: warehouse_id || null,
        notes: notes || null,
        status: "draft",
        counted_at: new Date().toISOString(),
        lines: lines.map((l) => ({ ...l })),
      };
      db.stockCounts.unshift(count);
      persist();
      return wait({ success: true, count });
    },
    postCount: (params = {}) => {
      const id = Number(params.id ?? params);
      const count = (db.stockCounts || []).find((c) => c.id === id);
      if (!count) return wait({ success: false, error: "Count not found." });
      if (count.status === "posted") return wait({ success: false, error: "Already posted." });
      for (const line of count.lines || []) {
        const variance = Number(line.counted_qty) - Number(line.system_qty);
        if (!variance) continue;
        const product = db.products.find((p) => p.id === Number(line.product_id));
        if (!product) continue;
        const whId = count.warehouse_id || defaultWarehouseId(product.branch_id);
        applyStockDelta(db, { product_id: product.id, warehouse_id: whId, qty: variance });
        recordStockMovement({
          type: "count",
          product_id: product.id,
          warehouse_id: whId,
          qty: variance,
          note: `Physical count #${count.id}`,
        });
      }
      count.status = "posted";
      count.posted_at = new Date().toISOString();
      persist();
      return wait({ success: true });
    },
  },
  barcode: {
    listStatus: () => {
      const products = db.products.map(normalizeProduct);
      const withBarcode = products.filter((p) => p.barcode);
      const missing = products.filter((p) => !p.barcode);
      return wait({
        products,
        total: products.length,
        withBarcode: withBarcode.length,
        missing: missing.length,
        format: db.settings.barcode_format || "EAN-13",
        prefix: db.settings.barcode_prefix || "89",
      });
    },
    generate: (productId) => {
      const product = db.products.find((p) => p.id === Number(productId));
      if (!product) return wait({ success: false, error: "Product not found." });
      if (product.barcode) {
        return wait({ success: true, barcode: product.barcode, reused: true, product: normalizeProduct(product) });
      }
      const format = db.settings.barcode_format || "EAN-13";
      const prefix = db.settings.barcode_prefix || "89";
      let code = generateBarcodeForProduct(product.id, format, prefix);
      let attempt = 0;
      while (isBarcodeTaken(code, product.id) && attempt < 50) {
        attempt += 1;
        code = generateBarcodeForProduct(product.id * 100 + attempt, format, prefix);
      }
      if (isBarcodeTaken(code, product.id)) {
        return wait({ success: false, error: "Could not generate a unique barcode." });
      }
      product.barcode = code;
      logAudit("generate_barcode", "barcode", { product_id: product.id, barcode: code });
      persist();
      return wait({ success: true, barcode: code, product: normalizeProduct(product) });
    },
    generateBulk: (ids = []) => {
      const targetIds = Array.isArray(ids) && ids.length
        ? ids.map(Number)
        : db.products.filter((p) => !p.barcode).map((p) => p.id);
      const generated = [];
      const skipped = [];
      const errors = [];
      const format = db.settings.barcode_format || "EAN-13";
      const prefix = db.settings.barcode_prefix || "89";

      for (const id of targetIds) {
        const product = db.products.find((p) => p.id === id);
        if (!product) {
          errors.push({ id, error: "Not found" });
          continue;
        }
        if (product.barcode) {
          skipped.push({ id, barcode: product.barcode });
          continue;
        }
        let code = generateBarcodeForProduct(product.id, format, prefix);
        let attempt = 0;
        while (isBarcodeTaken(code, product.id) && attempt < 50) {
          attempt += 1;
          code = generateBarcodeForProduct(product.id * 100 + attempt, format, prefix);
        }
        if (isBarcodeTaken(code, product.id)) {
          errors.push({ id, error: "Collision" });
          continue;
        }
        product.barcode = code;
        generated.push({ id, barcode: code, name: product.name });
      }
      if (generated.length) {
        logAudit("generate_barcode_bulk", "barcode", { count: generated.length });
        persist();
      }
      return wait({ success: errors.length === 0, generated, skipped, errors });
    },
    assign: (productId, code) => {
      const product = db.products.find((p) => p.id === Number(productId));
      if (!product) return wait({ success: false, error: "Product not found." });
      const barcode = String(code || "").trim();
      if (!barcode) return wait({ success: false, error: "Barcode is required." });
      if (isBarcodeTaken(barcode, product.id)) {
        return wait({ success: false, error: "Barcode already assigned to another product." });
      }
      product.barcode = barcode;
      logAudit("assign_barcode", "barcode", { product_id: product.id, barcode });
      persist();
      return wait({ success: true, product: normalizeProduct(product) });
    },
    search: (query) => {
      const q = String(query || "").trim().toLowerCase();
      if (!q) return wait([]);
      const rows = db.products
        .map(normalizeProduct)
        .filter(
          (product) =>
            (product.barcode && String(product.barcode).toLowerCase().includes(q)) ||
            product.name.toLowerCase().includes(q)
        );
      return wait(rows);
    },
    getLabelData: (productIds = [], size = "50x25") => {
      const ids = (Array.isArray(productIds) ? productIds : [productIds]).map(Number).filter(Boolean);
      const labelSize = resolveLabelSize(size);
      const format = db.settings.barcode_format || "EAN-13";
      const currency = getCurrency(db.settings.currency || "KES");
      const storeName = db.settings.store_name || "Nexora POS";
      const labels = ids
        .map((id) => {
          const product = db.products.find((p) => p.id === id);
          if (!product || !product.barcode) return null;
          const normalized = normalizeProduct(product);
          return {
            product_id: normalized.id,
            name: normalized.name,
            barcode: normalized.barcode,
            price: normalized.price,
            price_label: formatCurrency(normalized.price, currency.code),
            warehouse: normalized.warehouse,
            brand: normalized.brand,
            category: normalized.category,
            unit: normalized.unit,
            store_name: storeName,
            format,
          };
        })
        .filter(Boolean);

      return wait({
        size: labelSize,
        format,
        store_name: storeName,
        currency_symbol: currency.symbol,
        labels,
        count: labels.length,
      });
    },
  },
  expenses: {
    getAll: () => wait(db.expenses),
    getCategories: () => wait(db.expenseCategories),
    createCategory: (name) => {
      if (db.expenseCategories.some((category) => category.name.toLowerCase() === name.trim().toLowerCase())) {
        return wait({ success: false, error: "That category already exists." });
      }
      const record = { id: nextId("expenseCategory"), name: name.trim() };
      db.expenseCategories.push(record);
      persist();
      return wait({ success: true, id: record.id });
    },
    create: (expense) => {
      const record = { ...expense, id: nextId("expense"), amount: Number(expense.amount) };
      db.expenses.unshift(record);
      logAudit("create_expense", "expenses", { id: record.id });
      persist();
      return wait({ success: true, id: record.id });
    },
    update: (expense) => {
      db.expenses = db.expenses.map((item) => (item.id === expense.id ? { ...item, ...expense, amount: Number(expense.amount) } : item));
      persist();
      return wait({ success: true });
    },
    delete: (id) => {
      db.expenses = db.expenses.filter((item) => item.id !== id);
      persist();
      return wait({ success: true });
    },
    attachReceipt: async () => wait({ success: false, error: "File attachments require a real backend upload service." }),
    openReceipt: async () => wait({ success: false, error: "Receipt preview requires a hosted file service." }),
    getSummary: () => {
      const monthTotal = db.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
      const byCategory = Object.entries(
        db.expenses.reduce((acc, expense) => {
          acc[expense.category] = (acc[expense.category] || 0) + Number(expense.amount);
          return acc;
        }, {})
      ).map(([category, total]) => ({ category, total }));
      return wait({ monthTotal, byCategory });
    },
  },
  reports: {
    getAnalytics: (filters = {}) => wait(buildReportAnalytics(db, filters)),
    getUserSales: (filters = {}) => wait({ rows: buildUserSales(filters), range: reportBounds(filters) }),
    getRevenueVsExpenses: () =>
      wait([
      { month: "2026-05", revenue: 1050000, expenses: 650000 },
      { month: "2026-06", revenue: 1245300, expenses: 715000 },
        { month: "2026-07", revenue: db.sales.reduce((sum, sale) => sum + sale.total, 0), expenses: db.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0) },
      ]),
    getTopProducts: (limit = 5) => wait(db.products.slice(0, limit).map((product) => ({ name: product.name, revenue: product.price * 40, units: 40 }))),
    getCategorySales: () => wait(db.categories.map((category) => ({ name: category.name, value: 15000 + category.id * 5000 }))),
    getProfitSummary: () => {
      const revenue = db.sales.reduce((sum, sale) => sum + sale.total, 0);
      const cost = db.sales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.cost * item.qty, 0), 0);
      return wait({ revenue, cost, profit: revenue - cost });
    },
    getSalesReport: () =>
      wait({
        rows: db.sales.map((sale) => ({
          id: sale.id,
          invoice_no: sale.invoice_no,
          total: sale.total,
          payment_method: sale.payment_method,
          created_at: sale.created_at,
          customer: db.customers.find((customer) => customer.id === Number(sale.customer_id))?.name || "Walk-in",
        })),
        totals: { total: db.sales.reduce((sum, sale) => sum + sale.total, 0) },
      }),
    getPurchaseReport: () => wait({ rows: db.purchases, total: db.purchases.reduce((sum, purchase) => sum + purchase.total, 0) }),
    getProfitLoss: () => {
      const revenue = db.sales.reduce((sum, sale) => sum + sale.total, 0);
      const cogs = db.sales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.cost * item.qty, 0), 0);
      const expenses = db.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
      return wait({
        month: new Date().toISOString().slice(0, 7),
        revenue,
        cogs,
        grossProfit: revenue - cogs,
        expenses,
        netProfit: revenue - cogs - expenses,
      });
    },
    getExpenseReport: () => wait({ rows: db.expenses, total: db.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0) }),
    getInventoryReport: () => wait({ rows: db.products.map((product) => ({ ...normalizeProduct(product), stock_value: product.stock * product.cost })), totalValue: db.products.reduce((sum, product) => sum + product.stock * product.cost, 0) }),
    getLowStockReport: () => wait(db.products.map(normalizeProduct).filter((product) => product.stock <= product.reorder_level)),
    getCustomerReport: () => wait(db.customers),
    getSupplierReport: () => wait(db.suppliers),
  },
  settings: {
    getAll: () => wait(db.settings),
    getPublic: () =>
      wait({
        currency: db.settings.currency || "KES",
        currency_symbol: getCurrency(db.settings.currency).symbol,
        vat_enabled: db.settings.vat_enabled || "false",
        vat_rate: db.settings.vat_rate || "0",
        store_name: db.settings.store_name || "Nexora POS Enterprise",
        store_address: db.settings.store_address || "",
        store_phone: db.settings.store_phone || "",
        tax_pin: db.settings.tax_pin || "",
        receipt_header: db.settings.receipt_header || "",
        receipt_footer: db.settings.receipt_footer || "",
        enable_multi_currency: db.settings.enable_multi_currency || "true",
        admin_can_edit_rates: db.settings.admin_can_edit_rates || "false",
        report_currency: db.settings.report_currency || db.settings.currency || "KES",
        base_currency_code: db.settings.base_currency_code || db.settings.currency || "KES",
        active_currencies: (db.companyCurrencies || []).filter((c) => c.is_active !== false),
      }),
    update: (updates) => {
      const protectedKeys = ["currency", "currency_symbol", "vat_enabled", "vat_rate"];
      if (protectedKeys.some((key) => Object.prototype.hasOwnProperty.call(updates, key)) && !isSuperAdmin(currentMockUser?.role) && !isOwner(currentMockUser?.role)) {
        return wait({ success: false, error: "Only Super Admin can change currency or VAT settings.", code: "FORBIDDEN" });
      }
      if (Object.prototype.hasOwnProperty.call(updates, "vat_rate")) {
        const rate = Number(updates.vat_rate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
          return wait({ success: false, error: "VAT rate must be between 0 and 100." });
        }
      }
      if (Object.prototype.hasOwnProperty.call(updates, "currency") && !isSupportedCurrency(updates.currency)) {
        return wait({ success: false, error: "Unsupported currency." });
      }
      const sanitizedUpdates = { ...updates };
      delete sanitizedUpdates.currency_symbol;
      if (Object.prototype.hasOwnProperty.call(sanitizedUpdates, "currency")) {
        sanitizedUpdates.currency = normalizeCurrencyCode(sanitizedUpdates.currency);
      }
      db.settings = { ...db.settings, ...Object.fromEntries(Object.entries(sanitizedUpdates).map(([key, value]) => [key, String(value)])) };
      db.settings.currency_symbol = getCurrency(db.settings.currency).symbol;
      // Keep cash always available; other tender types are controlled by payment registry defaults.
      db.settings.payment_cash = "true";
      logAudit("update_settings", "settings", { keys: Object.keys(updates) });
      persist();
      return wait({ success: true });
    },
    getPrinters: async () => {
      // Prefer native/desktop printer enumeration when available.
      try {
        if (typeof window !== "undefined" && typeof window.api?.getPrinters === "function") {
          const list = await window.api.getPrinters();
          return Array.isArray(list) ? list : [];
        }
      } catch {
        /* ignore — never surface printer errors to checkout */
      }
      // Browser web: no silent receipt printer — digital receipt only.
      return [];
    },
  },
  currency: {
    list: () =>
      wait({
        currencies: db.companyCurrencies || [],
        settings: {
          enable_multi_currency: db.settings.enable_multi_currency || "true",
          admin_can_edit_rates: db.settings.admin_can_edit_rates || "false",
          report_currency: db.settings.report_currency || db.settings.currency || "KES",
          base_currency_code: db.settings.base_currency_code || db.settings.currency || "KES",
        },
      }),
    getActive: () => wait((db.companyCurrencies || []).filter((c) => c.is_active !== false)),
    getHistory: ({ code, limit = 100 } = {}) => {
      let rows = [...(db.currencyRateHistory || [])];
      if (code) rows = rows.filter((r) => r.currency_code === normalizeCurrencyCode(code));
      return wait(rows.slice(0, limit));
    },
    create: (payload) => {
      const code = normalizeCurrencyCode(payload.code);
      if ((db.companyCurrencies || []).some((c) => c.code === code)) {
        return wait({ success: false, error: "Currency already exists for this company." });
      }
      const row = {
        id: nextId("companyCurrency"),
        company_id: 1,
        code,
        name: payload.name || getCurrency(code).name,
        symbol: payload.symbol || getCurrency(code).symbol,
        decimal_places: payload.decimal_places ?? getCurrency(code).decimals,
        is_active: payload.is_active !== false,
        is_base: false,
        is_default: false,
        exchange_rate_to_base: Number(payload.exchange_rate_to_base) || 1,
        auto_update_enabled: !!payload.auto_update_enabled,
      };
      db.companyCurrencies = [...(db.companyCurrencies || []), row];
      (db.currencyRateHistory || (db.currencyRateHistory = [])).unshift({
        id: nextId("currencyRateHistory"),
        currency_code: code,
        old_rate: null,
        new_rate: row.exchange_rate_to_base,
        reason: payload.reason || "Currency created",
        changed_by_name: currentMockUser?.name || "System",
        created_at: nowIso(),
      });
      logAudit("currency_create", "currencies", { code });
      persist();
      return wait({ success: true, currency: row });
    },
    update: (payload) => {
      const id = Number(payload.id);
      const existing = (db.companyCurrencies || []).find((c) => c.id === id);
      if (!existing) return wait({ success: false, error: "Currency not found." });
      if (payload.is_active === false && existing.is_base) {
        return wait({ success: false, error: "Cannot deactivate the base currency." });
      }
      if (payload.is_active === false && !isOwner(currentMockUser?.role) && !isSuperAdmin(currentMockUser?.role)) {
        return wait({ success: false, error: "Only Owner can deactivate currencies.", code: "FORBIDDEN" });
      }
      const updates = { ...payload };
      delete updates.id;
      if (updates.exchange_rate_to_base != null && existing.is_base) updates.exchange_rate_to_base = 1;
      db.companyCurrencies = db.companyCurrencies.map((c) => (c.id === id ? { ...c, ...updates } : c));
      if (updates.exchange_rate_to_base != null && Number(updates.exchange_rate_to_base) !== Number(existing.exchange_rate_to_base)) {
        (db.currencyRateHistory || (db.currencyRateHistory = [])).unshift({
          id: nextId("currencyRateHistory"),
          currency_code: existing.code,
          old_rate: existing.exchange_rate_to_base,
          new_rate: Number(updates.exchange_rate_to_base),
          reason: payload.reason || "Manual rate update",
          changed_by_name: currentMockUser?.name || "System",
          created_at: nowIso(),
        });
      }
      logAudit("currency_update", "currencies", { id, code: existing.code });
      persist();
      return wait({ success: true, currency: db.companyCurrencies.find((c) => c.id === id) });
    },
    setBase: (codeOrPayload) => {
      if (!isOwner(currentMockUser?.role) && !isSuperAdmin(currentMockUser?.role)) {
        return wait({ success: false, error: "Only Owner can set the base currency.", code: "FORBIDDEN" });
      }
      const code = normalizeCurrencyCode(typeof codeOrPayload === "object" ? codeOrPayload.code : codeOrPayload);
      const target = (db.companyCurrencies || []).find((c) => c.code === code);
      if (!target) return wait({ success: false, error: "Currency not found. Add it first." });
      db.companyCurrencies = db.companyCurrencies.map((c) => ({
        ...c,
        is_base: c.code === code,
        exchange_rate_to_base: c.code === code ? 1 : c.exchange_rate_to_base,
        is_active: c.code === code ? true : c.is_active,
      }));
      db.settings.currency = code;
      db.settings.currency_symbol = getCurrency(code).symbol;
      db.settings.base_currency_code = code;
      logAudit("currency_set_base", "currencies", { code });
      persist();
      return wait({ success: true, currency: db.companyCurrencies.find((c) => c.code === code) });
    },
    setDefault: (codeOrPayload) => {
      const code = normalizeCurrencyCode(typeof codeOrPayload === "object" ? codeOrPayload.code : codeOrPayload);
      const target = (db.companyCurrencies || []).find((c) => c.code === code);
      if (!target) return wait({ success: false, error: "Currency not found." });
      if (!target.is_active) return wait({ success: false, error: "Activate the currency before setting it as default." });
      db.companyCurrencies = db.companyCurrencies.map((c) => ({ ...c, is_default: c.code === code }));
      persist();
      return wait({ success: true, currency: db.companyCurrencies.find((c) => c.code === code) });
    },
    updateRate: (payload) => {
      const code = normalizeCurrencyCode(payload.code);
      const adminAllowed = db.settings.admin_can_edit_rates === "true";
      if (!isOwner(currentMockUser?.role) && !isSuperAdmin(currentMockUser?.role) && !adminAllowed) {
        return wait({ success: false, error: "Owner has not allowed Admins to edit exchange rates.", code: "FORBIDDEN" });
      }
      const target = (db.companyCurrencies || []).find((c) => c.code === code);
      if (!target) return wait({ success: false, error: "Currency not found." });
      if (target.is_base) return wait({ success: false, error: "Base currency rate is always 1." });
      const newRate = Number(payload.exchange_rate_to_base ?? payload.rate);
      if (!Number.isFinite(newRate) || newRate <= 0) return wait({ success: false, error: "A positive exchange rate is required." });
      const oldRate = target.exchange_rate_to_base;
      db.companyCurrencies = db.companyCurrencies.map((c) =>
        c.code === code ? { ...c, exchange_rate_to_base: newRate } : c
      );
      (db.currencyRateHistory || (db.currencyRateHistory = [])).unshift({
        id: nextId("currencyRateHistory"),
        currency_code: code,
        old_rate: oldRate,
        new_rate: newRate,
        reason: payload.reason || "Manual rate update",
        changed_by_name: currentMockUser?.name || "System",
        created_at: nowIso(),
      });
      logAudit("currency_rate_change", "currencies", { code, old_rate: oldRate, new_rate: newRate });
      persist();
      return wait({ success: true, currency: db.companyCurrencies.find((c) => c.code === code) });
    },
    setPolicy: (payload) => {
      if (!isOwner(currentMockUser?.role) && !isSuperAdmin(currentMockUser?.role)) {
        return wait({ success: false, error: "Only Owner can change currency policy settings.", code: "FORBIDDEN" });
      }
      const patch = {};
      if (payload.enable_multi_currency != null) {
        patch.enable_multi_currency = payload.enable_multi_currency === true || payload.enable_multi_currency === "true" ? "true" : "false";
      }
      if (payload.admin_can_edit_rates != null) {
        patch.admin_can_edit_rates = payload.admin_can_edit_rates === true || payload.admin_can_edit_rates === "true" ? "true" : "false";
      }
      if (payload.report_currency != null) patch.report_currency = normalizeCurrencyCode(payload.report_currency);
      db.settings = { ...db.settings, ...patch };
      logAudit("currency_policy_update", "currencies", patch);
      persist();
      return wait({ success: true, settings: { ...db.settings } });
    },
  },
  backup: {
    export: () => {
      const safeDb = {
        ...db,
        users: db.users.map(({ password_hash: _passwordHash, pin_hash: _pinHash, ...user }) => user),
        loginAttempts: {},
      };
      const json = JSON.stringify(safeDb, null, 2);
      if (typeof window === "undefined") return wait({ success: false, error: "Unavailable" });
      const blob = new Blob([json], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "nexora-pos-backup.json";
      anchor.click();
      window.URL.revokeObjectURL(url);
      return wait({ success: true, filePath: "nexora-pos-backup.json" });
    },
    restore: () => wait({ success: false, error: "Restore requires an import UI in the browser version." }),
    getHistory: () => wait([]),
    runNow: () => wait({ ran: true }),
  },
  health: {
    probe: () =>
      wait({
        success: true,
        checks: {
          products: { ok: true },
          sales: { ok: true },
          customers: { ok: true },
          companies: { ok: true },
          company_settings: { ok: true },
        },
      }),
  },
  sync: {
    getStatus: async () => {
      try {
        const { getOfflineQueueStats } = await import("./offlineSalesDb");
        const stats = await getOfflineQueueStats();
        return {
          configured: true,
          pendingCount: stats.pending + stats.failed + stats.syncing,
          failedCount: stats.failed,
        };
      } catch {
        return wait({ configured: false, pendingCount: 0 });
      }
    },
    triggerNow: async () => {
      const { syncPendingSales } = await import("./offlineSync");
      return syncPendingSales(mockApi);
    },
    setAutoSync: () => wait({ success: true }),
    onConnectionRestored: async () => {
      const { syncPendingSales } = await import("./offlineSync");
      return syncPendingSales(mockApi);
    },
  },
  permissions: {
    getMatrix: () => {
      const matrix = ensureMatrix();
      return wait({
        matrix,
        modules: MODULE_IDS,
        actions: ACTIONS,
        roles: listAllRoles(),
        meta: {
          canCreateRoles: isOwner(currentMockUser?.role) || isSuperAdmin(currentMockUser?.role),
          canDeleteRoles: isOwner(currentMockUser?.role) || isSuperAdmin(currentMockUser?.role),
          canEditPermissions: hasPermission(currentMockUser?.role, "roles", "edit", matrix),
        },
      });
    },
    getMine: () => wait(currentMockUser ? getPermissionsForRole(currentMockUser.role, currentPermissionMatrix()) : {}),
    listRoles: () => wait(listAllRoles()),
    update: ({ role, module, action, allowed }) => {
      const roleId = normalizeRole(role);
      const matrix = ensureMatrix();
      const actor = normalizeRole(currentMockUser?.role);

      if (!matrix[roleId]) return wait({ success: false, error: "Unknown role." });
      if (!MODULE_IDS.includes(module) || !ACTIONS.includes(action)) {
        return wait({ success: false, error: "Invalid permission target." });
      }

      if (roleId === "owner" || (roleId === "super_admin" && !isOwner(actor))) {
        return wait({ success: false, error: "Owner and Super Admin protections cannot be modified by this role." });
      }
      if (module === "owner_management" && !isOwner(actor)) {
        return wait({ success: false, error: "Owner Management permissions are immutable." });
      }
      if (!isOwner(actor) && !isSuperAdmin(actor) && actor !== "admin") {
        return wait({ success: false, error: "Only Admin, Super Admin, or Owner can edit permissions." });
      }

      matrix[roleId][module][action] = !!allowed;
      db.permissionMatrix = matrix;
      const roleRecord = db.roles?.find((entry) => entry.key === roleId);
      if (roleRecord) roleRecord.permissions = structuredClone(matrix[roleId]);
      logAudit("update_permission", "roles", { role: roleId, module, action, allowed: !!allowed });
      persist();
      return wait({ success: true });
    },
    createRole: ({ label, description = "", cloneFrom = "cashier" }) => {
      if (!isOwner(currentMockUser?.role) && !isSuperAdmin(currentMockUser?.role)) {
        return wait({ success: false, error: "Only Owner or Super Admin can create roles." });
      }
      const id = slugifyRoleId(label);
      if (!id) return wait({ success: false, error: "Role name is required." });
      if (SYSTEM_ROLE_IDS.includes(id) || (db.customRoles || []).some((role) => role.id === id) || ensureMatrix()[id]) {
        return wait({ success: false, error: "A role with that name already exists." });
      }
      const matrix = ensureMatrix();
      const source = matrix[normalizeRole(cloneFrom)] || matrix.cashier;
      matrix[id] = structuredClone(source);
      db.customRoles = [
        ...(db.customRoles || []),
        { id, label: label.trim(), description: description.trim(), color: "#64748B", system: false, company_id: currentMockUser.company_id },
      ];
      db.roles.push({ id: nextId("role"), company_id: currentMockUser.company_id, key: id, name: label.trim(), hierarchy_rank: 99, system: false, permissions: structuredClone(matrix[id]), created_at: nowIso() });
      db.permissionMatrix = matrix;
      logAudit("create_role", "roles", { id, label });
      persist();
      return wait({ success: true, id });
    },
    deleteRole: (roleId) => {
      if (!isOwner(currentMockUser?.role) && !isSuperAdmin(currentMockUser?.role)) {
        return wait({ success: false, error: "Only Owner or Super Admin can delete roles." });
      }
      if (SYSTEM_ROLE_IDS.includes(roleId)) {
        return wait({ success: false, error: "System roles cannot be deleted." });
      }
      if (db.users.some((user) => normalizeRole(user.role) === roleId)) {
        return wait({ success: false, error: "Reassign users before deleting this role." });
      }
      db.customRoles = (db.customRoles || []).filter((role) => role.id !== roleId);
      db.roles = (db.roles || []).filter((role) => role.key !== roleId);
      const matrix = ensureMatrix();
      delete matrix[roleId];
      db.permissionMatrix = matrix;
      logAudit("delete_role", "roles", { roleId });
      persist();
      return wait({ success: true });
    },
    resetDefaults: (roleId) => {
      if (!isOwner(currentMockUser?.role) && !isSuperAdmin(currentMockUser?.role) && normalizeRole(currentMockUser?.role) !== "admin") {
        return wait({ success: false, error: "Permission denied." });
      }
      const defaults = buildDefaultMatrix();
      const matrix = ensureMatrix();
      if (roleId) {
        if (roleId === "owner" || (roleId === "super_admin" && !isOwner(currentMockUser?.role))) {
          return wait({ success: false, error: "Protected role defaults cannot be changed by this account." });
        }
        if (!defaults[roleId]) return wait({ success: false, error: "No defaults for this role." });
        matrix[roleId] = structuredClone(defaults[roleId]);
        const roleRecord = db.roles?.find((entry) => entry.key === roleId);
        if (roleRecord) roleRecord.permissions = structuredClone(matrix[roleId]);
      } else {
        Object.assign(matrix, structuredClone(defaults));
      }
      db.permissionMatrix = matrix;
      persist();
      return wait({ success: true });
    },
  },
  audit: {
    getAll: ({ module } = {}) => wait(module ? db.auditLog.filter((entry) => entry.module === module) : db.auditLog),
    getLoginHistory: () => wait(db.auditLog.filter((entry) => entry.module === "auth")),
  },
  notifications: {
    list: async () => {
      const items = [];
      const low = db.products.filter((p) => Number(p.stock) <= Number(p.reorder_level || 0));
      for (const p of low.slice(0, 8)) {
        items.push({
          id: `low-${p.id}`,
          type: "low_stock",
          title: "Low stock",
          body: `${p.name} — ${p.stock} left (reorder ${p.reorder_level || 0})`,
          created_at: nowIso(),
          href: "/inventory",
        });
      }
      const openPo = (db.purchases || []).filter((p) => ["draft", "ordered", "partial", "pending"].includes(String(p.status || "").toLowerCase()));
      for (const p of openPo.slice(0, 5)) {
        items.push({
          id: `po-${p.id}`,
          type: "purchase",
          title: "Open purchase order",
          body: `${p.po_number || `PO-${p.id}`} · ${p.status}`,
          created_at: p.updated_at || p.created_at || nowIso(),
          href: "/purchases",
        });
      }
      const failed = (db.auditLog || []).filter((row) => String(row.action || "").includes("fail")).slice(0, 5);
      for (const row of failed) {
        items.push({
          id: `auth-${row.id}`,
          type: "login_failed",
          title: "Failed login",
          body: `${row.user_name || "Unknown"} · ${row.action}`,
          created_at: row.created_at || nowIso(),
          href: "/audit",
        });
      }
      const sub = db.subscriptions?.find((row) => Number(row.company_id) === Number(currentMockUser?.company_id)) || db.subscription;
      const expires = sub?.expires_at || sub?.renewsAt;
      if (expires) {
        const days = Math.ceil((new Date(expires).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        if (days <= 14) {
          items.push({
            id: "sub-expiry",
            type: "subscription",
            title: days < 0 ? "Subscription expired" : "Subscription expiring soon",
            body: `Renews/expires in ${days} day(s).`,
            created_at: nowIso(),
            href: "/subscription",
          });
        }
      }
      return wait({ success: true, items, unread: items.length });
    },
  },
  auth_admin: {
    createUser: async ({
      name, username, email, phone = "", password, role, branch_id = 1, company_id, active = 1, profile_photo = "",
      employee_id = "", department = "", position = "", address = "", national_id = "",
      account_status = "active", login_enabled = 1, must_change_password = 0,
    }) => {
      const denied = requireUserManager();
      if (denied) return denied;
      if (!canManageRole(currentMockUser.role, role)) {
        return { success: false, error: "You cannot assign that protected role.", code: "FORBIDDEN" };
      }
      const assignedCompanyId = isPlatformOwner(currentMockUser.role) ? company_id : currentMockUser.company_id;
      if (!assignedCompanyId && normalizeRole(role) !== "platform_owner") {
        return { success: false, error: "A company is required." };
      }
      const userCount = db.users.filter((row) => Number(row.company_id) === Number(assignedCompanyId)).length;
      const limited = enforceCompanyPlanLimit("users", userCount, assignedCompanyId);
      if (limited) return limited;
      const branch = db.branches.find((entry) =>
        Number(entry.id) === Number(branch_id) && String(entry.company_id) === String(assignedCompanyId));
      if (!branch && normalizeRole(role) !== "platform_owner") {
        return { success: false, error: "Select a branch in the assigned company." };
      }
      const result = await authFetch("/api/admin-create-user", {
        method: "POST",
        body: {
          name, username, email, phone, password, role,
          branch_id, company_id: assignedCompanyId, active, profile_photo,
          employee_id, department, position, address, national_id,
          account_status, login_enabled, must_change_password,
        },
      });
      if (result.success && result.id) {
        db.users.push({
          id: result.id, name: String(name || "").trim(), username: String(username || "").trim().toLowerCase(),
          email: String(email || "").trim().toLowerCase(), phone: String(phone || "").trim(),
          role: normalizeRole(role), role_id: normalizeRole(role), active: active ? 1 : 0,
          branch_id: Number(branch_id), company_id: assignedCompanyId, profile_photo: String(profile_photo || ""),
          employee_id, department, position, address, national_id,
          account_status: account_status || (active ? "active" : "inactive"),
          login_enabled: login_enabled ? 1 : 0,
          must_change_password: must_change_password ? 1 : 0,
          created_at: nowIso(), created_by: currentMockUser?.id, created_by_name: currentMockUser?.name,
          email_verified: true, login_count: 0,
        });
        persist();
        remoteUsersCache = [];
        logUserAudit("user_created", { id: result.id, name, username }, { role: normalizeRole(role), email });
      }
      return result;
    },
    updateUser: async (id, updates) => {
      const denied = requireUserManager();
      if (denied) return denied;
      if (updates?.action) {
        return authFetch("/api/admin-update-user", {
          method: "POST",
          body: { id, action: updates.action },
        }).then((result) => {
          if (result.success) remoteUsersCache = [];
          return result;
        });
      }
      const listed = await fetchRemoteUsers(id);
      const target = listed.user || db.users.find((row) => String(row.id) === String(id));
      if (target && normalizeRole(target.role) === "owner") {
        const actor = normalizeRole(currentMockUser?.role);
        const emailChanging = updates.email != null
          && String(updates.email).trim().toLowerCase() !== String(target.email || "").toLowerCase();
        if (emailChanging && actor !== "platform_owner" && !(actor === "owner" && String(currentMockUser?.id) === String(id))) {
          return {
            success: false,
            error: "Only the Company Owner can change their own email address.",
            code: "OWNER_CREDENTIALS_LOCKED",
          };
        }
      }
      const result = await authFetch("/api/admin-update-user", {
        method: "POST",
        body: { id, ...updates },
      });
      if (result.success) {
        const stub = db.users.find((user) => String(user.id) === String(id));
        if (stub) {
          Object.assign(stub, {
            name: updates.name ?? stub.name,
            username: updates.username ?? stub.username,
            email: updates.email ?? stub.email,
            phone: updates.phone ?? stub.phone,
            role: updates.role !== undefined ? normalizeRole(updates.role) : stub.role,
            role_id: updates.role !== undefined ? normalizeRole(updates.role) : stub.role_id,
            branch_id: updates.branch_id ?? stub.branch_id,
            active: updates.active === undefined ? stub.active : (updates.active ? 1 : 0),
            profile_photo: updates.profile_photo ?? stub.profile_photo,
            employee_id: updates.employee_id ?? stub.employee_id,
            department: updates.department ?? stub.department,
            position: updates.position ?? stub.position,
            address: updates.address ?? stub.address,
            national_id: updates.national_id ?? stub.national_id,
            account_status: updates.account_status ?? stub.account_status,
            login_enabled: updates.login_enabled === undefined ? stub.login_enabled : (updates.login_enabled ? 1 : 0),
            must_change_password: updates.must_change_password === undefined ? stub.must_change_password : (updates.must_change_password ? 1 : 0),
          });
          persist();
        }
        remoteUsersCache = [];
      }
      return result;
    },
    setUserActive: async (id, active) => {
      const denied = requireUserManager();
      if (denied) return denied;
      return rawApi.auth_admin.updateUser(id, { active: active ? 1 : 0 });
    },
    setUserRole: async (id, role) => {
      const denied = requireUserManager();
      if (denied) return denied;
      return rawApi.auth_admin.updateUser(id, { role });
    },
    resetPassword: async (id, password) => {
      const denied = requireUserManager();
      if (denied) return denied;
      if (String(password || "").length < 8) return { success: false, error: "Password must be at least 8 characters." };
      const listed = await fetchRemoteUsers(id);
      const target = listed.user || db.users.find((row) => String(row.id) === String(id));
      if (target && normalizeRole(target.role) === "owner" && !isPlatformOwner(currentMockUser?.role)) {
        return {
          success: false,
          error: "Admin, Manager, and Cashier cannot change the Company Owner password.",
          code: "OWNER_CREDENTIALS_LOCKED",
        };
      }
      return authFetch("/api/admin-reset-password", { method: "POST", body: { id, password } });
    },
    resetPin: async () => ({
      success: true,
      deprecated: true,
      message: "PIN auth is no longer used; passwords are managed via Supabase Auth.",
    }),
    deleteUser: async (id) => {
      const denied = requireUserManager();
      if (denied) return denied;
      const result = await authFetch("/api/admin-delete-user", { method: "POST", body: { id } });
      if (result.success) {
        db.users = db.users.filter((user) => String(user.id) !== String(id));
        remoteUsersCache = [];
        persist();
      }
      return result;
    },
  },
  approvals: {
    listTypes: async () => APPROVAL_REQUEST_TYPES.map(({ id, label, description }) => ({ id, label, description })),
    list: async (filters = {}) => {
      const rows = [...(db.approvalRequests || [])];
      const status = String(filters.status || "").trim();
      const type = String(filters.type || "").trim();
      const scoped = isPlatformOwner(currentMockUser?.role)
        ? rows
        : rows.filter((row) => Number(row.company_id) === Number(currentMockUser?.company_id));
      return scoped
        .filter((row) => (!status || row.status === status) && (!type || row.type === type))
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    },
    create: async ({ type, reason = "", payload = {} } = {}) => {
      if (!canSubmitApproval(currentMockUser?.role)) {
        return { success: false, error: "Only Company Owners can submit platform approval requests.", code: "FORBIDDEN" };
      }
      if (!isValidApprovalType(type)) {
        return { success: false, error: "Unknown approval request type." };
      }
      const companyId = currentMockUser.company_id;
      if (companyId == null || companyId === "") {
        return { success: false, error: "A company is required for approval requests." };
      }
      const company = db.companies.find((entry) => Number(entry.id) === Number(companyId));
      const openDuplicate = (db.approvalRequests || []).find(
        (row) =>
          Number(row.company_id) === Number(companyId)
          && row.type === type
          && (row.status === "pending_platform" || row.status === "pending_owner")
      );
      if (openDuplicate) {
        return { success: false, error: "An open request of this type already exists for your company." };
      }
      const record = {
        id: nextId("approvalRequest"),
        type,
        status: initialApprovalStatus(),
        company_id: companyId,
        company_name: company?.name || "",
        reason: String(reason || "").trim(),
        payload: payload && typeof payload === "object" ? payload : {},
        requested_by: currentMockUser.id,
        requested_by_name: currentMockUser.name,
        requested_by_role: normalizeRole(currentMockUser.role),
        created_at: nowIso(),
        updated_at: nowIso(),
        decided_at: null,
        decided_by: null,
        decided_by_name: null,
        decision_note: "",
      };
      db.approvalRequests = db.approvalRequests || [];
      db.approvalRequests.unshift(record);
      persist();
      logUserAudit("approval_requested", { id: record.id, name: type }, { company_id: companyId, type, status: record.status });
      return { success: true, request: record };
    },
    cancel: async (id) => {
      const request = (db.approvalRequests || []).find((row) => String(row.id) === String(id));
      if (!request) return { success: false, error: "Approval request not found." };
      const isRequester = String(request.requested_by) === String(currentMockUser?.id);
      const isCompanyOwner = canSubmitApproval(currentMockUser?.role)
        && Number(request.company_id) === Number(currentMockUser?.company_id);
      if (!isRequester && !isCompanyOwner && !isPlatformOwner(currentMockUser?.role)) {
        return { success: false, error: "You cannot cancel this request.", code: "FORBIDDEN" };
      }
      if (request.status !== "pending_platform" && request.status !== "pending_owner") {
        return { success: false, error: "Only open requests can be cancelled." };
      }
      request.status = "cancelled";
      request.updated_at = nowIso();
      request.decision_note = "Cancelled by requester.";
      persist();
      return { success: true, request };
    },
    decide: async (id, { decision, note = "" } = {}) => {
      if (!canDecideApproval(currentMockUser?.role)) {
        return { success: false, error: "Only the Platform Super Admin can approve or reject these requests.", code: "FORBIDDEN" };
      }
      const request = (db.approvalRequests || []).find((row) => String(row.id) === String(id));
      if (!request) return { success: false, error: "Approval request not found." };
      if (request.status !== "pending_platform" && request.status !== "pending_owner") {
        return { success: false, error: "This request is already closed." };
      }
      const accepted = decision === "approve" || decision === "approved";
      const rejected = decision === "reject" || decision === "rejected";
      if (!accepted && !rejected) {
        return { success: false, error: "Decision must be approve or reject." };
      }
      request.status = accepted ? "approved" : "rejected";
      request.updated_at = nowIso();
      request.decided_at = nowIso();
      request.decided_by = currentMockUser.id;
      request.decided_by_name = currentMockUser.name;
      request.decision_note = String(note || "").trim();
      if (accepted) {
        const effect = applyApprovalEffect(request);
        if (!effect.success) {
          request.status = "pending_platform";
          request.decided_at = null;
          request.decided_by = null;
          request.decided_by_name = null;
          return effect;
        }
        request.effect = effect.effect || null;
      }
      persist();
      logUserAudit(accepted ? "approval_approved" : "approval_rejected", { id: request.id, name: request.type }, {
        company_id: request.company_id,
        note: request.decision_note,
      });
      return { success: true, request };
    },
  },
  owner: {
    getOverview: async (filters = {}) => {
      const denied = requireOwner();
      if (denied) return denied;
      // Prefer live Supabase Auth users so impersonation has real UUIDs.
      await fetchRemoteUsers();
      const query = String(filters.search || "").trim().toLowerCase();
      const companyId = filters.company_id == null || filters.company_id === "" ? null : filters.company_id;
      const role = filters.role ? normalizeRole(filters.role) : "";
      const status = filters.status || "";
      const localUsers = db.users
        .filter((user) => !isPlatformOwner(user.role))
        .map(userMetrics);
      const remoteUsers = (remoteUsersCache || [])
        .filter((user) => !isPlatformOwner(user.role))
        .map(enrichRemoteUserMetrics);
      // Merge by email — remote UUID rows win for impersonation/reset.
      const byEmail = new Map();
      for (const user of localUsers) {
        const key = String(user.email || "").toLowerCase() || `local:${user.id}`;
        byEmail.set(key, user);
      }
      for (const user of remoteUsers) {
        const key = String(user.email || "").toLowerCase() || `remote:${user.id}`;
        const prior = byEmail.get(key);
        byEmail.set(key, prior ? { ...prior, ...user, id: user.id } : user);
      }
      const users = [...byEmail.values()]
        .filter((user) => companyId == null || String(user.company_id) === String(companyId))
        .filter((user) => !role || normalizeRole(user.role) === role)
        .filter((user) => !status || (status === "active") === !!user.active)
        .filter((user) => !query || [user.name, user.username, user.email].some((value) => String(value || "").toLowerCase().includes(query)));
      const companies = db.companies
        .filter((company) => companyId == null || String(company.id) === String(companyId))
        .map((company) => {
          const members = users.filter((user) => String(user.company_id) === String(company.id));
          const localMembers = db.users.filter((user) => Number(user.company_id) === Number(company.id));
          return {
            ...company,
            subscription_plan: db.plans.find((plan) => plan.id === db.subscriptions.find((row) => Number(row.company_id) === Number(company.id))?.plan_id)?.name || "Unassigned",
            user_count: Math.max(members.length, localMembers.length),
            active_user_count: Math.max(
              members.filter((user) => user.active).length,
              localMembers.filter((user) => user.active).length
            ),
            branch_count: db.branches.filter((branch) => Number(branch.company_id) === Number(company.id)).length,
          };
        });
      return {
        success: true,
        companies,
        users,
        roles: listAllRoles(),
        branches: db.branches,
        audit: db.auditLog.filter((entry) => entry.module === "owner_management" || entry.module === "users").slice(0, 300),
        stats: {
          companies: db.companies.length,
          active_companies: db.companies.filter((company) => company.status === "active").length,
          users: users.length,
          active_users: users.filter((user) => user.active).length,
        },
      };
    },
    getPlatformConsole: () => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const salesTotal = db.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
      return wait({
        success: true,
        subscriptions: db.subscriptions,
        plans: db.plans,
        domains: db.companyDomains,
        billing: db.billingRecords,
        features: db.features,
        companyFeatureOverrides: db.companyFeatureOverrides,
        platformSettings: db.platformSettings,
        audit: db.auditLog.slice(0, 500),
        analytics: {
          companies: db.companies.length,
          active_companies: db.companies.filter((company) => company.status === "active").length,
          suspended_companies: db.companies.filter((company) => company.status !== "active").length,
          users: db.users.filter((user) => !isPlatformOwner(user.role)).length,
          branches: db.branches.length,
          sales_total: salesTotal,
          sales_currencies: [...new Set(db.sales.map((sale) => sale.currency_code).filter(Boolean))],
          subscriptions_by_status: Object.fromEntries(["active", "trialing", "suspended", "expired", "cancelled"].map((status) => [status, db.subscriptions.filter((row) => row.status === status).length])),
        },
      });
    },
    updateSubscription: (companyId, updates = {}) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const subscription = db.subscriptions.find((row) => Number(row.company_id) === Number(companyId));
      const plan = db.plans.find((row) => Number(row.id) === Number(updates.plan_id || subscription?.plan_id));
      if (!subscription || !plan) return wait({ success: false, error: "Subscription or plan not found." });
      const status = updates.status || subscription.status;
      if (!["active", "trialing", "suspended", "expired", "cancelled"].includes(status)) return wait({ success: false, error: "Invalid subscription status." });
      let expiresAt = updates.expires_at ? new Date(updates.expires_at).toISOString() : subscription.expires_at;
      if (["active", "trialing"].includes(status) && !expiresAt) {
        expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      }
      Object.assign(subscription, {
        plan_id: plan.id, plan_code: plan.code, status,
        expires_at: expiresAt,
        limits: structuredClone(plan.limits), updated_at: nowIso(),
      });
      logAudit("subscription_updated", "subscriptions", { company_id: Number(companyId), plan: plan.code, status });
      persist();
      return wait({ success: true });
    },
    savePlan: (payload = {}) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const code = String(payload.code || payload.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      if (!code || !String(payload.name || "").trim()) return wait({ success: false, error: "Plan code and name are required." });
      const existing = db.plans.find((plan) => Number(plan.id) === Number(payload.id) || plan.code === code);
      const record = {
        id: existing?.id || Math.max(0, ...db.plans.map((plan) => Number(plan.id))) + 1,
        code, name: String(payload.name).trim(), description: String(payload.description || existing?.description || "").trim(),
        price_monthly: Math.max(0, Number(payload.price_monthly ?? payload.price ?? existing?.price_monthly ?? 0)),
        price_yearly: Math.max(0, Number(payload.price_yearly ?? existing?.price_yearly ?? 0)),
        currency: String(payload.currency || BILLING_CURRENCY).toUpperCase(),
        trial_days: Math.max(0, Number(payload.trial_days ?? existing?.trial_days ?? DEFAULT_TRIAL_DAYS)),
        contact_sales: payload.contact_sales === true,
        pricing_model: payload.contact_sales === true ? "contact" : (payload.pricing_model || existing?.pricing_model || "standard"),
        price_label: payload.contact_sales === true
          ? "Contact Sales"
          : (payload.price_label || existing?.price_label || null),
        support_tier: payload.support_tier || existing?.support_tier || "email",
        limits: {
          users: Number(payload.limits?.users ?? existing?.limits?.users ?? 1),
          branches: Number(payload.limits?.branches ?? existing?.limits?.branches ?? 1),
          products: Number(payload.limits?.products ?? existing?.limits?.products ?? 500),
          warehouses: Number(payload.limits?.warehouses ?? existing?.limits?.warehouses ?? 1),
          inventory: Number(payload.limits?.inventory ?? existing?.limits?.inventory ?? payload.limits?.products ?? 500),
          customers: Number(payload.limits?.customers ?? existing?.limits?.customers ?? 500),
          suppliers: Number(payload.limits?.suppliers ?? existing?.limits?.suppliers ?? 100),
          transactions: Number(payload.limits?.transactions ?? existing?.limits?.transactions ?? 2000),
          reports: Number(payload.limits?.reports ?? existing?.limits?.reports ?? 20),
        },
        features: Array.isArray(payload.features) ? payload.features.map((item) => String(item).slice(0, 100)).slice(0, 30) : existing?.features || [],
        active: payload.active !== false,
        public_visible: payload.public_visible !== false,
        sort_order: Math.max(1, Number(payload.sort_order || existing?.sort_order || db.plans.length + 1)),
      };
      if (record.contact_sales) {
        record.price_monthly = 0;
        record.price_yearly = 0;
        record.price_label = "Contact Sales";
      }
      if (existing) Object.assign(existing, record); else db.plans.push(record);
      logAudit(existing ? "plan_updated" : "plan_created", "plans", { plan_id: record.id, code });
      persist();
      return wait({ success: true, id: record.id });
    },
    saveFeature: (payload = {}) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const code = String(payload.code || payload.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const name = String(payload.name || "").trim().slice(0, 100);
      if (!code || !name) return wait({ success: false, error: "Feature code and name are required." });
      const existing = db.features.find((feature) => feature.id === Number(payload.id) || feature.code === code);
      const record = { id: existing?.id || nextId("feature"), code, name, description: String(payload.description || "").trim().slice(0, 300), active: payload.active !== false, public_visible: payload.public_visible !== false };
      if (existing) Object.assign(existing, record); else db.features.push(record);
      logAudit(existing ? "feature_updated" : "feature_created", "feature_management", { feature_id: record.id, code });
      persist();
      return wait({ success: true, id: record.id });
    },
    toggleCompanyFeature: (companyId, featureCode, enabled) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      if (!db.companies.some((company) => company.id === Number(companyId)) || !db.features.some((feature) => feature.code === featureCode)) return wait({ success: false, error: "Company or feature not found." });
      const existing = db.companyFeatureOverrides.find((row) => row.company_id === Number(companyId) && row.feature_code === featureCode);
      if (existing) existing.enabled = !!enabled;
      else db.companyFeatureOverrides.push({ company_id: Number(companyId), feature_code: featureCode, enabled: !!enabled, updated_at: nowIso() });
      persist();
      return wait({ success: true });
    },
    verifyCompanyOwnerEmail: (userId) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const target = db.users.find((user) => Number(user.id) === Number(userId) && normalizeRole(user.role) === "owner");
      if (!target) return wait({ success: false, error: "Company owner not found." });
      target.email_verified = true;
      target.email_verified_at = nowIso();
      const company = db.companies.find((entry) => Number(entry.id) === Number(target.company_id));
      if (company?.status === "pending_verification") company.status = "active";
      logAudit("owner_email_verified_by_platform", "public_auth", { company_id: target.company_id, user_id: target.id });
      persist();
      return wait({ success: true });
    },
    addDomain: (companyId, domainValue) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const domain = String(domainValue || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
      if (!db.companies.some((company) => Number(company.id) === Number(companyId)) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return wait({ success: false, error: "Select a company and enter a valid domain." });
      if (db.companyDomains.some((row) => row.domain === domain)) return wait({ success: false, error: "Domain is already registered." });
      const record = { id: nextId("domain"), company_id: Number(companyId), domain, status: "pending", is_primary: false, created_at: nowIso(), verified_at: null };
      db.companyDomains.push(record);
      logAudit("domain_added", "domains", { company_id: Number(companyId), domain });
      persist();
      return wait({ success: true, id: record.id });
    },
    verifyDomain: (id) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const domain = db.companyDomains.find((row) => Number(row.id) === Number(id));
      if (!domain) return wait({ success: false, error: "Domain not found." });
      domain.status = "verified";
      domain.verified_at = nowIso();
      logAudit("domain_verified_local", "domains", { company_id: domain.company_id, domain: domain.domain });
      persist();
      return wait({ success: true });
    },
    setPrimaryDomain: (id) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const domain = db.companyDomains.find((row) => Number(row.id) === Number(id));
      if (!domain || domain.status !== "verified") return wait({ success: false, error: "Only a verified domain can be primary." });
      db.companyDomains
        .filter((row) => Number(row.company_id) === Number(domain.company_id))
        .forEach((row) => { row.is_primary = row.id === domain.id; });
      logAudit("primary_domain_updated", "domains", { company_id: domain.company_id, domain: domain.domain });
      persist();
      return wait({ success: true });
    },
    removeDomain: (id) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const domain = db.companyDomains.find((row) => Number(row.id) === Number(id));
      if (!domain) return wait({ success: false, error: "Domain not found." });
      db.companyDomains = db.companyDomains.filter((row) => row.id !== domain.id);
      logAudit("domain_removed", "domains", { company_id: domain.company_id, domain: domain.domain });
      persist();
      return wait({ success: true });
    },
    updatePlatformSettings: (updates = {}) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      db.platformSettings = { ...db.platformSettings, ...updates };
      logAudit("platform_settings_updated", "platform_settings", { keys: Object.keys(updates) });
      persist();
      return wait({ success: true });
    },
    createCompanyAccount: (payload = {}) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const companyName = String(payload.company_name || "").trim();
      const businessType = String(payload.business_type || "").trim();
      const country = String(payload.country || "").trim();
      const currency = String(payload.currency || "").trim().toUpperCase();
      const plan = String(payload.subscription_plan || "").trim();
      const timeZone = String(payload.time_zone || "").trim();
      const companyEmail = String(payload.company_email || "").trim().toLowerCase();
      const companyPhone = String(payload.company_phone || "").trim();
      const companyAddress = String(payload.company_address || "").trim();
      const expiresAt = String(payload.subscription_expiry || "").trim();
      const name = String(payload.name || "").trim();
      const username = String(payload.username || "").trim().toLowerCase();
      const email = String(payload.email || "").trim().toLowerCase();
      const phone = String(payload.phone || "").trim();
      const role = "owner";
      const status = payload.status === "inactive" ? "inactive" : "active";
      const branchName = String(payload.branch_name || "Main Branch").trim();
      if (!companyName || !businessType || !country || !plan || !timeZone || !companyEmail || !companyPhone || !companyAddress || !expiresAt || !name || !branchName || !phone) return wait({ success: false, error: "Complete all required company and Owner fields." });
      if (!isSupportedCurrency(currency)) return wait({ success: false, error: "Select a supported currency." });
      if (!validEmail(companyEmail) || !validPhone(companyPhone) || Number.isNaN(new Date(expiresAt).getTime())) return wait({ success: false, error: "Enter valid company contact and subscription fields." });
      if (!validUsername(username) || !validEmail(email) || !validPhone(phone)) return wait({ success: false, error: "Enter a valid username, email, and phone number." });
      if (String(payload.password || "").length < 8 || payload.password !== payload.confirm_password) return wait({ success: false, error: "Passwords must match and contain at least 8 characters." });
      if (db.companies.some((company) => company.name.trim().toLowerCase() === companyName.toLowerCase())) return wait({ success: false, error: "A company with that name already exists." });
      const planRecord = db.plans.find((entry) => entry.active && (entry.name.toLowerCase() === plan.toLowerCase() || entry.code === plan.toLowerCase()));
      if (!planRecord) return wait({ success: false, error: "Select an active subscription plan." });
      const companyId = nextId("company");
      const branchId = nextId("branch");
      const timestamp = nowIso();
      const companyCode = nextCompanyCode(companyName);
      const company = {
        id: companyId, name: companyName, business_type: businessType, country,
        code: companyCode, currency, time_zone: timeZone, email: companyEmail,
        phone: companyPhone, address: companyAddress, logo: String(payload.company_logo || ""),
        status,
        owner_user_id: null,
        created_at: timestamp, created_by: currentMockUser.id,
      };
      const branch = {
        id: branchId, company_id: companyId, name: branchName,
        code: String(payload.branch_code || companyName.slice(0, 3)).trim().toUpperCase(),
        address: String(payload.branch_address || ""), active: status === "active",
      };
      db.companies.push(company);
      db.branches.push(branch);
      const roleRows = SYSTEM_ROLES.filter((entry) => entry.id !== "platform_owner").map((entry, index) => ({
        id: nextId("role"), company_id: companyId, key: entry.id, name: entry.label,
        hierarchy_rank: index + 1, system: true,
        permissions: structuredClone(defaultPermissions()[entry.id] || {}), created_at: timestamp,
      }));
      db.roles.push(...roleRows);
      db.permissionMatrices[companyId] = structuredClone(defaultPermissions());
      db.companySettings[companyId] = {
        ...seedDatabase().settings, store_name: companyName, store_address: companyAddress,
        store_phone: companyPhone, currency, currency_symbol: getCurrency(currency).symbol,
        default_branch_id: String(branchId),
      };
      db.subscriptions.push({
        id: nextId("subscription"), company_id: companyId, plan_id: planRecord.id,
        plan_code: planRecord.code, status: status === "active" ? "active" : "suspended",
        starts_at: timestamp, expires_at: new Date(expiresAt).toISOString(),
        limits: structuredClone(planRecord.limits), created_at: timestamp, updated_at: timestamp,
      });
      persist();
      return rawApi.auth_admin.createUser({
        name, username, email, phone,
        password: payload.password,
        role,
        branch_id: branchId,
        company_id: companyId,
        active: status === "active" ? 1 : 0,
        profile_photo: String(payload.profile_photo || ""),
      }).then((created) => {
        if (!created.success) {
          db.companies = db.companies.filter((entry) => entry.id !== companyId);
          db.branches = db.branches.filter((entry) => entry.id !== branchId);
          db.roles = db.roles.filter((entry) => Number(entry.company_id) !== companyId);
          db.subscriptions = db.subscriptions.filter((entry) => Number(entry.company_id) !== companyId);
          delete db.permissionMatrices[companyId];
          delete db.companySettings[companyId];
          persist();
          return { success: false, error: created.error || "Unable to create company owner account." };
        }
        company.owner_user_id = created.id;
        logAudit("company_created", "owner_management", {
          company_id: companyId, company_name: companyName, company_code: companyCode,
          initial_owner_user_id: created.id,
        });
        persist();
        return {
          success: true,
          company_id: companyId,
          owner_user_id: created.id,
          user_id: created.id,
          company_code: companyCode,
        };
      });
    },
    updateCompany: (id, updates = {}) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const company = db.companies.find((entry) => Number(entry.id) === Number(id));
      if (!company) return wait({ success: false, error: "Company not found." });
      const name = String(updates.name ?? company.name).trim();
      const currency = String(updates.currency ?? company.currency).toUpperCase();
      const email = String(updates.email ?? company.email ?? "").trim().toLowerCase();
      const phone = String(updates.phone ?? company.phone ?? "").trim();
      if (!name || !isSupportedCurrency(currency) || email && !validEmail(email) || !validPhone(phone)) return wait({ success: false, error: "Enter valid company details." });
      if (db.companies.some((entry) => entry.id !== company.id && entry.name.toLowerCase() === name.toLowerCase())) return wait({ success: false, error: "Company name already exists." });
      const previousStatus = company.status;
      Object.assign(company, {
        name,
        business_type: String(updates.business_type ?? company.business_type).trim(),
        country: String(updates.country ?? company.country).trim(),
        currency,
        email,
        phone,
        address: String(updates.address ?? company.address ?? "").trim(),
        time_zone: String(updates.time_zone ?? company.time_zone ?? "UTC").trim(),
        logo: String(updates.logo ?? company.logo ?? ""),
        status: updates.status === "inactive" ? "inactive" : "active",
      });
      const action = previousStatus !== company.status ? `company_${company.status === "active" ? "activated" : "deactivated"}` : "company_updated";
      logAudit(action, "owner_management", { company_id: company.id, status: company.status });
      persist();
      return wait({ success: true });
    },
    getActivity: (userId) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      const target = db.users.find((entry) => Number(entry.id) === Number(userId));
      if (!target) return wait({ success: false, error: "User not found." });
      return wait({
        success: true,
        user: userMetrics(target),
        sessions: db.sessions.filter((entry) => entry.user_id === target.id).slice(-50).reverse(),
        audit: db.auditLog.filter((entry) => entry.user_id === target.id || String(entry.details).includes(`"target_user_id":${target.id}`)).slice(0, 100),
      });
    },
    impersonateUser: async (targetId) => {
      const denied = requireOwner();
      if (denied) return denied;
      if (impersonationContext) return { success: false, error: "Nested impersonation is not allowed." };
      return authFetch("/api/admin-impersonate", { method: "POST", body: { target_id: targetId } });
    },
    recordAudit: (action, details = {}) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      logAudit(String(action || "platform_action"), "owner_management", details);
      persist();
      return wait({ success: true });
    },
  },
  branches: {
    getAll: () => {
      if (isPlatformOwner(currentMockUser?.role) && !impersonationContext) return wait(db.branches);
      const companyId = currentMockUser?.company_id;
      if (companyId == null || companyId === "") return wait([]);
      return wait(db.branches.filter((branch) => String(branch.company_id) === String(companyId)));
    },
    create: ({ name, code, address = "", active = true, company_id } = {}) => {
      const targetCompanyId = isPlatformOwner(currentMockUser?.role) ? (company_id || currentMockUser?.company_id) : currentMockUser?.company_id;
      if (targetCompanyId == null || targetCompanyId === "") {
        return wait({ success: false, error: "Company context required.", code: "NO_COMPANY" });
      }
      const branchCount = db.branches.filter((row) => Number(row.company_id) === Number(targetCompanyId)).length;
      const limited = enforceCompanyPlanLimit("branches", branchCount, targetCompanyId);
      if (limited) return wait(limited);
      const trimmed = String(name || "").trim();
      if (!trimmed) return wait({ success: false, error: "Branch name is required." });
      const record = {
        id: nextId("branch"),
        company_id: Number(targetCompanyId),
        name: trimmed,
        code: String(code || trimmed.slice(0, 3) || "BR").trim().toUpperCase().slice(0, 16),
        address: address || "",
        active: active !== false,
      };
      db.branches.push(record);
      logAudit("create_branch", "branches", { id: record.id });
      persist();
      return wait({ success: true, branch: record });
    },
  },
  subscription: {
    get: () => {
      const companyId = currentMockUser?.company_id;
      if (companyId == null || companyId === "") return wait(null);
      return wait(db.subscriptions.find((row) => Number(row.company_id) === Number(companyId)) || null);
    },
    getPlans: () => wait(db.plans.filter((plan) => plan.active !== false)),
    update: (payload = {}) => {
      if (!isOwner(currentMockUser?.role) && !isPlatformOwner(currentMockUser?.role)) {
        return wait({ success: false, error: "Only the Company Owner can update the subscription.", code: "FORBIDDEN" });
      }
      return rawApi.subscription.changePlan(payload);
    },
    changePlan: ({ plan_code, billing_cycle, auto_renewal, payment_reference } = {}) => {
      const companyId = currentMockUser?.company_id;
      if (companyId == null || companyId === "") return wait({ success: false, error: "Company context required." });
      if (isPlatformOwner(currentMockUser?.role) && !companyId) {
        return wait({ success: false, error: "Use the platform console to manage subscriptions." });
      }
      if (!isOwner(currentMockUser?.role) && !isPlatformOwner(currentMockUser?.role)) {
        return wait({ success: false, error: "Only the Company Owner can change the plan.", code: "FORBIDDEN" });
      }
      const subscription = db.subscriptions.find((row) => Number(row.company_id) === Number(companyId));
      if (!subscription) return wait({ success: false, error: "Subscription not found." });
      const requested = normalizePlanCode(plan_code || subscription.plan_code);
      const plan = PAID_PLAN_CODES.includes(requested)
        ? getPlanByCode(requested, db.plans)
        : getPlanByCode(requested === "free_trial" ? "starter" : requested, db.plans);
      if (!plan || !PAID_PLAN_CODES.includes(plan.code)) {
        return wait({ success: false, error: "Choose Starter, Business, Professional, or Enterprise." });
      }
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      Object.assign(subscription, {
        plan_id: plan.id,
        plan_code: plan.code,
        status: "active",
        billing_cycle: billing_cycle || subscription.billing_cycle || "monthly",
        auto_renewal: auto_renewal ?? subscription.auto_renewal ?? true,
        expires_at: expiresAt,
        trial_ends_at: subscription.trial_ends_at || null,
        limits: structuredClone(plan.limits),
        updated_at: nowIso(),
      });
      const company = db.companies.find((entry) => Number(entry.id) === Number(companyId));
      if (company) {
        company.plan_code = plan.code;
        company.updated_at = nowIso();
      }
      if (db.subscription && Number(currentMockUser?.company_id) === Number(companyId)) {
        db.subscription = {
          ...db.subscription,
          plan: plan.name,
          plan_code: plan.code,
          status: "active",
          renewsAt: expiresAt,
          branchesAllowed: plan.limits.branches,
          usersAllowed: plan.limits.users,
        };
      }
      const amount = Number(plan.price_monthly || 0);
      db.billingRecords.push({
        id: nextId("billing"),
        company_id: Number(companyId),
        plan_code: plan.code,
        amount,
        currency: plan.currency || BILLING_CURRENCY,
        status: "paid",
        reference: String(payment_reference || `PLAN-${Date.now()}`).slice(0, 64),
        paid_at: nowIso(),
        created_at: nowIso(),
      });
      logAudit("subscription_plan_changed", "subscription", {
        company_id: Number(companyId),
        plan_code: plan.code,
        payment_reference: payment_reference || null,
      });
      persist();
      return wait({
        success: true,
        message: `${plan.name} plan activated. All company data is preserved.`,
        subscription,
      });
    },
    requestRenewal: ({ plan_code, payment_reference } = {}) => rawApi.subscription.changePlan({ plan_code, payment_reference }),
  },
};

const permissionWrapped = applyPermissionMiddleware(applyTenantMiddleware(rawApi), () => ({
  role: currentMockUser?.role,
  matrix: currentPermissionMatrix(),
}));

permissionWrapped.__setAuthContext = setAuthContext;
permissionWrapped.__isMock = true;

export const mockApi = permissionWrapped;
