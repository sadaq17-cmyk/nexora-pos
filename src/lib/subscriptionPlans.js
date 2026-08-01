/** Nexora POS Pro subscription catalog — single source of truth (KES). */

export const DEFAULT_TRIAL_DAYS = 7;
export const BILLING_CURRENCY = "KES";
export const UNLIMITED = -1;

/** Paid plans owners can choose after trial (or upgrade/downgrade anytime). */
export const PAID_PLAN_CODES = Object.freeze(["starter", "business", "professional", "enterprise"]);

export function isUnlimited(value) {
  return value == null || Number(value) < 0 || Number(value) === Infinity;
}

export function formatLimit(value) {
  return isUnlimited(value) ? "Unlimited" : String(Number(value).toLocaleString("en-KE"));
}

export function isContactSalesPlan(plan) {
  return Boolean(plan?.contact_sales) || plan?.pricing_model === "contact";
}

/** Normalize legacy plan codes to the current catalog. */
export function normalizePlanCode(code) {
  const raw = String(code || "").trim().toLowerCase();
  if (!raw) return "free_trial";
  if (raw === "basic" || raw === "monthly" || raw === "yearly") return "starter";
  if (raw === "trial" || raw === "trialing") return "free_trial";
  return raw;
}

export function getPlanByCode(code, plans = CANONICAL_PLANS) {
  const normalized = normalizePlanCode(code);
  const list = Array.isArray(plans) && plans.length ? plans : CANONICAL_PLANS;
  return list.find((plan) => plan.code === normalized)
    || list.find((plan) => plan.code === "enterprise")
    || list[0]
    || null;
}

export function planPriceLabel(plan, { yearly = false } = {}) {
  if (isContactSalesPlan(plan)) return plan.price_label || "Contact Sales";
  const amount = yearly ? Number(plan.price_yearly || 0) : Number(plan.price_monthly || 0);
  if (amount === 0) return "Free";
  const currency = plan.currency || BILLING_CURRENCY;
  return `${currency} ${amount.toLocaleString("en-KE")}`;
}

/** Alias used by some callers / report docs. */
export function formatPlanPriceKes(amount) {
  const n = Number(amount) || 0;
  return `KES ${n.toLocaleString("en-KE")}`;
}

/**
 * Soft limit check. Returns null when allowed, or an error payload when over capacity.
 * Existing data is never deleted — only new creates are blocked.
 */
export function checkPlanLimit(planOrLimits, limitKey, currentCount) {
  const limits = planOrLimits?.limits || planOrLimits || {};
  const cap = limits[limitKey];
  if (isUnlimited(cap)) return null;
  const max = Number(cap);
  if (!Number.isFinite(max)) return null;
  if (Number(currentCount) < max) return null;
  return {
    success: false,
    code: "PLAN_LIMIT",
    error: `Your plan allows up to ${formatLimit(max)} ${limitKey}. Upgrade to add more — existing data is kept.`,
    limit: max,
    current: Number(currentCount),
    limit_key: limitKey,
  };
}

const ENTERPRISE_LIMITS = Object.freeze({
  users: UNLIMITED,
  branches: UNLIMITED,
  products: UNLIMITED,
  warehouses: UNLIMITED,
  inventory: UNLIMITED,
  customers: UNLIMITED,
  suppliers: UNLIMITED,
  transactions: UNLIMITED,
  reports: UNLIMITED,
});

const ENTERPRISE_FEATURES = Object.freeze([
  "AI Business Insights",
  "Full Audit Logs",
  "Advanced Security",
  "White Label Ready",
  "API Access",
  "Custom Integrations",
  "QR Scanner",
  "Camera Barcode",
  "Multiple Barcodes",
  "GS1",
  "Serial Tracking",
  "Batch Tracking",
  "Complete Analytics",
  "Dedicated Support",
  "Unlimited Branches",
  "Unlimited Users",
  "Unlimited Products",
  "Unlimited Warehouses",
]);

export const CANONICAL_PLANS = [
  {
    code: "free_trial",
    name: "Free Trial",
    description: "7-day free trial with all Enterprise features. After expiry, only the Company Owner can log in to choose a plan — all company data is preserved.",
    price_monthly: 0,
    price_yearly: 0,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    contact_sales: false,
    pricing_model: "trial",
    price_label: "Free",
    support_tier: "dedicated",
    limits: { ...ENTERPRISE_LIMITS },
    features: [...ENTERPRISE_FEATURES],
    active: true,
    public_visible: false,
    sort_order: 0,
  },
  {
    code: "starter",
    name: "Starter",
    description: "Single-branch retail essentials with barcode tools and email support.",
    price_monthly: 5500,
    price_yearly: 5500 * 12,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    contact_sales: false,
    pricing_model: "standard",
    price_label: null,
    support_tier: "email",
    limits: {
      users: 3,
      branches: 1,
      products: 1000,
      warehouses: 1,
      inventory: 1000,
      customers: UNLIMITED,
      suppliers: UNLIMITED,
      transactions: UNLIMITED,
      reports: UNLIMITED,
    },
    features: [
      "1 Branch",
      "Up to 3 Users",
      "1,000 Products",
      "POS Sales",
      "Customers",
      "Suppliers",
      "Purchases",
      "Basic Inventory",
      "Basic Reports",
      "Barcode Scanner",
      "Barcode Printing",
      "Email Support",
    ],
    active: true,
    public_visible: true,
    sort_order: 1,
  },
  {
    code: "business",
    name: "Business",
    description: "Multi-branch operations with advanced inventory and priority support.",
    price_monthly: 10000,
    price_yearly: 10000 * 12,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    contact_sales: false,
    pricing_model: "standard",
    price_label: null,
    support_tier: "priority",
    limits: {
      users: 10,
      branches: 3,
      products: UNLIMITED,
      warehouses: 3,
      inventory: UNLIMITED,
      customers: UNLIMITED,
      suppliers: UNLIMITED,
      transactions: UNLIMITED,
      reports: UNLIMITED,
    },
    features: [
      "Up to 3 Branches",
      "Up to 10 Users",
      "Unlimited Products",
      "Advanced Inventory",
      "Purchases",
      "Supplier Payments",
      "Customers",
      "Expenses",
      "Reports",
      "Multi Currency",
      "Barcode Scanner",
      "Bluetooth Barcode",
      "Stock Count",
      "Purchase Receiving",
      "Priority Support",
    ],
    active: true,
    public_visible: true,
    sort_order: 2,
  },
  {
    code: "professional",
    name: "Professional",
    description: "Multi-warehouse scale with payroll, audit logs, and API access.",
    price_monthly: 15000,
    price_yearly: 15000 * 12,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    contact_sales: false,
    pricing_model: "standard",
    price_label: null,
    support_tier: "priority",
    limits: {
      users: 50,
      branches: 10,
      products: UNLIMITED,
      warehouses: UNLIMITED,
      inventory: UNLIMITED,
      customers: UNLIMITED,
      suppliers: UNLIMITED,
      transactions: UNLIMITED,
      reports: UNLIMITED,
    },
    features: [
      "Up to 10 Branches",
      "Up to 50 Users",
      "Unlimited Products",
      "Multi Warehouse",
      "Payroll",
      "Expenses",
      "Advanced Reports",
      "Audit Logs",
      "API Access",
      "Multi Currency",
      "QR Code",
      "Batch Tracking",
      "Expiry Tracking",
      "Warehouse Barcode",
      "Stock Transfer",
      "Priority Support",
    ],
    active: true,
    public_visible: true,
    sort_order: 3,
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "Unlimited scale with AI insights, advanced security, and dedicated support.",
    price_monthly: 25000,
    price_yearly: 25000 * 12,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    contact_sales: false,
    pricing_model: "standard",
    price_label: null,
    support_tier: "dedicated",
    limits: { ...ENTERPRISE_LIMITS },
    features: [...ENTERPRISE_FEATURES],
    active: true,
    public_visible: true,
    sort_order: 4,
  },
];

/** Plans whose marketing/limit/price fields always sync from canonical. */
const FORCE_SYNC_CODES = new Set(["free_trial", "starter", "business", "professional", "enterprise"]);

export function mergeCanonicalPlans(existing = []) {
  const byCode = new Map(
    existing.map((plan) => [normalizePlanCode(plan.code === "starter" ? "starter" : plan.code), plan])
  );
  // Collapse legacy "basic" into starter slot if present.
  if (byCode.has("basic") && !byCode.has("starter")) {
    byCode.set("starter", byCode.get("basic"));
  }
  const maxId = Math.max(0, ...existing.map((plan) => Number(plan.id) || 0));
  let nextGenerated = maxId;
  const canonical = CANONICAL_PLANS.map((plan, index) => {
    const current = byCode.get(plan.code);
    const id = current?.id || (++nextGenerated);
    const force = FORCE_SYNC_CODES.has(plan.code);
    return {
      ...plan,
      ...(force ? {} : current || {}),
      id,
      code: plan.code,
      name: force ? plan.name : (current?.name || plan.name),
      description: force ? plan.description : (current?.description || plan.description),
      price_monthly: force ? plan.price_monthly : Number(current?.price_monthly ?? current?.price ?? plan.price_monthly),
      price_yearly: force ? plan.price_yearly : Number(current?.price_yearly ?? plan.price_yearly),
      currency: String((force ? plan.currency : current?.currency) || plan.currency || BILLING_CURRENCY).toUpperCase(),
      trial_days: force || plan.code === "free_trial"
        ? Number(plan.trial_days)
        : Number(current?.trial_days ?? plan.trial_days ?? DEFAULT_TRIAL_DAYS),
      contact_sales: force ? plan.contact_sales : Boolean(current?.contact_sales ?? plan.contact_sales),
      pricing_model: force ? plan.pricing_model : (current?.pricing_model || plan.pricing_model || "standard"),
      price_label: force ? plan.price_label : (current?.price_label ?? plan.price_label),
      support_tier: force ? plan.support_tier : (current?.support_tier || plan.support_tier || "email"),
      limits: force ? { ...plan.limits } : { ...plan.limits, ...(current?.limits || {}) },
      features: force
        ? [...plan.features]
        : (Array.isArray(current?.features) && current.features.length ? current.features : plan.features),
      active: current?.active !== false,
      public_visible: force ? plan.public_visible : (current?.public_visible !== false),
      sort_order: Number(force ? plan.sort_order : (current?.sort_order || plan.sort_order || index + 1)),
    };
  });
  const known = new Set(["basic", "monthly", "yearly", "trial", ...CANONICAL_PLANS.map(({ code }) => code)]);
  const extras = existing.filter((plan) => !known.has(normalizePlanCode(plan.code)) && !known.has(plan.code));
  return [...canonical, ...extras];
}

export function safePublicPlan(plan) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    price_monthly: plan.price_monthly,
    price_yearly: plan.price_yearly,
    currency: plan.currency || BILLING_CURRENCY,
    trial_days: plan.trial_days,
    contact_sales: Boolean(plan.contact_sales),
    pricing_model: plan.pricing_model || (plan.contact_sales ? "contact" : "standard"),
    price_label: plan.price_label || (plan.contact_sales ? "Contact Sales" : null),
    support_tier: plan.support_tier || "email",
    limits: plan.limits,
    features: plan.features,
    sort_order: plan.sort_order,
  };
}

export function paidPublicPlans(plans = CANONICAL_PLANS) {
  return plans
    .filter((plan) => plan.active !== false && plan.public_visible !== false && PAID_PLAN_CODES.includes(plan.code))
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
}
