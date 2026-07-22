/**
 * Server-side mirror of src/lib/subscriptionPlans.js (api/ cannot import from src/).
 * Keep in sync when plan prices, limits, or codes change.
 */

export const DEFAULT_TRIAL_DAYS = 7;
export const BILLING_CURRENCY = "KES";
export const UNLIMITED = -1;
export const PAID_PLAN_CODES = Object.freeze(["starter", "business", "professional", "enterprise"]);

export function isUnlimited(value) {
  return value == null || Number(value) < 0 || Number(value) === Infinity;
}

export function formatLimit(value) {
  return isUnlimited(value) ? "Unlimited" : String(Number(value).toLocaleString("en-KE"));
}

export function normalizePlanCode(code) {
  const raw = String(code || "").trim().toLowerCase();
  if (!raw) return "free_trial";
  if (raw === "basic" || raw === "monthly" || raw === "yearly") return "starter";
  if (raw === "trial" || raw === "trialing") return "free_trial";
  return raw;
}

export function getPlanByCode(code, plans = CANONICAL_PLANS) {
  const normalized = normalizePlanCode(code);
  return plans.find((plan) => plan.code === normalized)
    || plans.find((plan) => plan.code === "enterprise")
    || plans[0]
    || null;
}

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
    description: "7-day free trial with all Enterprise features.",
    price_monthly: 0,
    price_yearly: 0,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
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
    price_monthly: 5500,
    price_yearly: 5500 * 12,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    support_tier: "email",
    limits: { users: 3, branches: 1, products: 1000, warehouses: 1 },
    features: [
      "1 Branch", "Up to 3 Users", "1,000 Products", "POS Sales", "Customers", "Suppliers",
      "Purchases", "Basic Inventory", "Basic Reports", "Barcode Scanner", "Barcode Printing", "Email Support",
    ],
    active: true,
    public_visible: true,
    sort_order: 1,
  },
  {
    code: "business",
    name: "Business",
    price_monthly: 10000,
    price_yearly: 10000 * 12,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    support_tier: "priority",
    limits: { users: 10, branches: 3, products: UNLIMITED, warehouses: 3 },
    features: [
      "Up to 3 Branches", "Up to 10 Users", "Unlimited Products", "Advanced Inventory", "Purchases",
      "Supplier Payments", "Customers", "Expenses", "Reports", "Multi Currency", "Barcode Scanner",
      "Bluetooth Barcode", "Stock Count", "Purchase Receiving", "Priority Support",
    ],
    active: true,
    public_visible: true,
    sort_order: 2,
  },
  {
    code: "professional",
    name: "Professional",
    price_monthly: 15000,
    price_yearly: 15000 * 12,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    support_tier: "priority",
    limits: { users: 50, branches: 10, products: UNLIMITED, warehouses: UNLIMITED },
    features: [
      "Up to 10 Branches", "Up to 50 Users", "Unlimited Products", "Multi Warehouse", "Payroll",
      "Expenses", "Advanced Reports", "Audit Logs", "API Access", "Multi Currency", "QR Code",
      "Batch Tracking", "Expiry Tracking", "Warehouse Barcode", "Stock Transfer", "Priority Support",
    ],
    active: true,
    public_visible: true,
    sort_order: 3,
  },
  {
    code: "enterprise",
    name: "Enterprise",
    price_monthly: 25000,
    price_yearly: 25000 * 12,
    currency: BILLING_CURRENCY,
    trial_days: DEFAULT_TRIAL_DAYS,
    support_tier: "dedicated",
    limits: { ...ENTERPRISE_LIMITS },
    features: [...ENTERPRISE_FEATURES],
    active: true,
    public_visible: true,
    sort_order: 4,
  },
];

export async function loadCompanyPlanLimits(admin, companyId) {
  if (companyId == null || companyId === "") {
    return getPlanByCode("enterprise").limits;
  }
  try {
    const { data } = await admin
      .from("company_subscriptions")
      .select("plan_code,limits,status")
      .eq("company_id", companyId)
      .maybeSingle();
    if (data?.limits && typeof data.limits === "object") {
      const plan = getPlanByCode(data.plan_code);
      return { ...plan.limits, ...data.limits };
    }
    return getPlanByCode(data?.plan_code || "enterprise").limits;
  } catch {
    return getPlanByCode("enterprise").limits;
  }
}
