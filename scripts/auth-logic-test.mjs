/**
 * Stubbed lockout + gating tests (no real Supabase credentials required).
 * Run: node scripts/auth-logic-test.mjs
 */
import assert from "node:assert/strict";
import {
  getLockoutStatus,
  recordLoginFailure,
  clearLoginAttempts,
  __resetLoginAttemptTrackerForTests,
} from "../src/lib/loginAttemptTracker.js";
import { validatePassword } from "../src/lib/passwordPolicy.js";

let passed = 0;
function test(name, fn) {
  __resetLoginAttemptTrackerForTests();
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function gateUser({ email_confirmed_at, app_metadata }, { subscriptionOk = true } = {}) {
  if (!email_confirmed_at) {
    return { success: false, error: "Verify your email before signing in.", code: "EMAIL_UNVERIFIED" };
  }
  const meta = app_metadata || {};
  if (meta.active === false || meta.active === 0) {
    return { success: false, error: "Invalid email or password." };
  }
  const role = meta.role || "cashier";
  if (role !== "platform_owner") {
    if (meta.company_id == null || meta.company_id === "") {
      return { success: false, error: "Invalid company identifier or credentials." };
    }
    if (!subscriptionOk) {
      // Locked tenants keep a session but are restricted to renewal/payment pages.
      return {
        success: true,
        subscriptionLocked: true,
        error: "This company subscription is inactive or expired.",
        code: "SUBSCRIPTION_INACTIVE",
        user: { role, company_id: meta.company_id ?? null },
      };
    }
  }
  return { success: true, subscriptionLocked: false, user: { role, company_id: meta.company_id ?? null } };
}

console.log("auth-logic-test\n");

test("lockout triggers after 5 failures", () => {
  const status = getLockoutStatus("acme", "bob");
  let last;
  for (let i = 0; i < 5; i += 1) last = recordLoginFailure(status.key);
  assert.equal(last.locked, true);
  assert.equal(last.code, "LOCKED");
});

test("clearLoginAttempts unlocks", () => {
  const status = getLockoutStatus("plat", "owner");
  for (let i = 0; i < 5; i += 1) recordLoginFailure(status.key);
  clearLoginAttempts(status.key);
  assert.equal(getLockoutStatus("plat", "owner").locked, false);
});

test("gate rejects unverified email", () => {
  const result = gateUser({ email_confirmed_at: null, app_metadata: { role: "owner", company_id: 1, active: true } });
  assert.equal(result.code, "EMAIL_UNVERIFIED");
});

test("gate rejects inactive with generic message", () => {
  const result = gateUser({
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { role: "cashier", company_id: 1, active: false },
  });
  assert.equal(result.error, "Invalid email or password.");
});

test("gate locks bad subscription without signing out", () => {
  const result = gateUser(
    { email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { role: "owner", company_id: 1, active: true } },
    { subscriptionOk: false }
  );
  assert.equal(result.success, true);
  assert.equal(result.subscriptionLocked, true);
  assert.equal(result.code, "SUBSCRIPTION_INACTIVE");
});

test("gate allows platform_owner", () => {
  const result = gateUser({
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { role: "platform_owner", company_id: null, active: true },
  });
  assert.equal(result.success, true);
  assert.equal(result.subscriptionLocked, false);
});

test("password policy accepts strong password", () => {
  const result = validatePassword("Honest@26");
  assert.equal(result.ok, true);
});

test("password policy rejects weak password", () => {
  const result = validatePassword("password");
  assert.equal(result.ok, false);
});

import {
  CANONICAL_PLANS,
  DEFAULT_TRIAL_DAYS,
  formatLimit,
  isContactSalesPlan,
  mergeCanonicalPlans,
  planPriceLabel,
} from "../src/lib/saasPlans.js";
import {
  ADMIN_MANAGEABLE_ROLES,
  MANAGER_MANAGEABLE_ROLES,
  assignableRoles,
  buildDefaultMatrix,
  canManageRole,
  hasPermission,
  isOwner,
  isUserManagerRole,
} from "../src/lib/rbac.js";
import {
  canDecideApproval,
  canSubmitApproval,
  initialApprovalStatus,
  isValidApprovalType,
} from "../src/lib/approvalWorkflow.js";
import {
  ACTIVE_PAYMENT_METHODS,
  isPaymentMethodEnabled,
  normalizePaymentMethod,
  validateSalePayment,
} from "../src/lib/paymentMethods.js";

test("free trial is exactly 7 days", () => {
  assert.equal(DEFAULT_TRIAL_DAYS, 7);
  const trial = CANONICAL_PLANS.find((plan) => plan.code === "free_trial");
  assert.equal(trial.trial_days, 7);
  const merged = mergeCanonicalPlans([{ id: 1, code: "free_trial", trial_days: 14, name: "Free Trial" }]);
  assert.equal(merged.find((plan) => plan.code === "free_trial").trial_days, 7);
});

test("paid KES packages and enterprise pricing", () => {
  const byCode = Object.fromEntries(CANONICAL_PLANS.map((plan) => [plan.code, plan]));
  assert.equal(byCode.starter.price_monthly, 5500);
  assert.equal(byCode.business.price_monthly, 10000);
  assert.equal(byCode.professional.price_monthly, 15000);
  assert.equal(byCode.enterprise.price_monthly, 25000);
  assert.equal(isContactSalesPlan(byCode.enterprise), false);
  assert.equal(planPriceLabel(byCode.enterprise), "KES 25,000");
  assert.equal(formatLimit(byCode.enterprise.limits.users), "Unlimited");
  assert.equal(formatLimit(byCode.enterprise.limits.branches), "Unlimited");
  assert.equal(formatLimit(byCode.enterprise.limits.products), "Unlimited");
  const merged = mergeCanonicalPlans([{ id: 4, code: "enterprise", price_monthly: 199, name: "Old" }]);
  const synced = merged.find((plan) => plan.code === "enterprise");
  assert.equal(synced.price_monthly, 25000);
  assert.equal(synced.contact_sales, false);
  assert.equal(synced.name, "Enterprise");
});

test("admin cannot manage company owner credentials role", () => {
  assert.equal(canManageRole("admin", "owner"), false);
  assert.equal(canManageRole("cashier", "owner"), false);
  assert.equal(canManageRole("branch_manager", "owner"), false);
  assert.equal(canManageRole("owner", "cashier"), true);
});

test("enterprise RBAC hierarchy for Admin and Manager", () => {
  assert.deepEqual([...ADMIN_MANAGEABLE_ROLES], ["branch_manager", "cashier", "sales", "inventory_manager", "accountant"]);
  assert.deepEqual([...MANAGER_MANAGEABLE_ROLES], []);
  assert.equal(canManageRole("admin", "admin"), false);
  assert.equal(canManageRole("admin", "super_admin"), false);
  assert.equal(canManageRole("admin", "branch_manager"), true);
  assert.equal(canManageRole("admin", "cashier"), true);
  assert.equal(canManageRole("admin", "inventory_manager"), true);
  assert.equal(canManageRole("branch_manager", "admin"), false);
  assert.equal(canManageRole("branch_manager", "cashier"), false);
  assert.equal(canManageRole("branch_manager", "sales"), false);
  assert.equal(isUserManagerRole("branch_manager"), false);
  assert.equal(isUserManagerRole("admin"), true);
  assert.equal(isUserManagerRole("cashier"), false);
  const managerRoles = assignableRoles("branch_manager").map((role) => role.id).sort();
  assert.deepEqual(managerRoles, []);
  const adminRoles = assignableRoles("admin").map((role) => role.id);
  assert.ok(adminRoles.includes("branch_manager"));
  assert.ok(adminRoles.includes("inventory_manager"));
  assert.ok(!adminRoles.includes("admin"));
  assert.ok(!adminRoles.includes("owner"));
});

test("cashier and sales permission scopes", () => {
  const matrix = buildDefaultMatrix();
  assert.equal(hasPermission("cashier", "pos", "create", matrix), true);
  assert.equal(hasPermission("cashier", "customers", "view", matrix), false);
  assert.equal(hasPermission("cashier", "sales", "view", matrix), false);
  assert.equal(hasPermission("sales", "customers", "create", matrix), true);
  assert.equal(hasPermission("sales", "sales", "view", matrix), true);
  assert.equal(hasPermission("sales", "pos", "view", matrix), false);
  assert.equal(hasPermission("sales", "dashboard", "view", matrix), false);
  assert.equal(hasPermission("owner", "platform_approvals", "create", matrix), true);
  assert.equal(hasPermission("owner", "platform_approvals", "approve", matrix), false);
  assert.equal(hasPermission("platform_owner", "platform_approvals", "approve", matrix), true);
});

test("owner to platform approval workflow helpers", () => {
  assert.equal(canSubmitApproval("owner"), true);
  assert.equal(canSubmitApproval("company_owner"), true);
  assert.equal(canSubmitApproval("admin"), false);
  assert.equal(canDecideApproval("platform_owner"), true);
  assert.equal(canDecideApproval("owner"), false);
  assert.equal(initialApprovalStatus(), "pending_platform");
  assert.equal(isValidApprovalType("company_suspend"), true);
  assert.equal(isValidApprovalType("not_a_real_type"), false);
});

test("enterprise payment methods include cash card and mpesa only", () => {
  const ids = ACTIVE_PAYMENT_METHODS.map((method) => method.id);
  for (const id of ["CASH", "CARD", "MPESA"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
    assert.equal(isPaymentMethodEnabled(id), true);
  }
  assert.equal(ids.includes("BANK_TRANSFER"), false);
  assert.equal(ids.includes("GIFT_CARD"), false);
  assert.equal(ids.includes("SPLIT"), false);
  assert.equal(normalizePaymentMethod("M-Pesa"), "MPESA");
  assert.equal(normalizePaymentMethod("visa"), "CARD");
  const card = validateSalePayment({ payment_method: "CARD", total: 100, card_brand: "VISA" });
  assert.equal(card.success, true);
  const cash = validateSalePayment({ payment_method: "CASH", total: 50, cash_tendered: 50 });
  assert.equal(cash.success, true);
  const mpesa = validateSalePayment({ payment_method: "MPESA", total: 80, mpesa_reference: "ABC" });
  assert.equal(mpesa.success, true);
  assert.equal(validateSalePayment({ payment_method: "SPLIT", total: 100 }).success, false);
});

test("company_owner alias resolves to owner for login security access", () => {
  assert.equal(isOwner("owner"), true);
  assert.equal(isOwner("company_owner"), true);
  assert.equal(isOwner("Company Owner"), true);
  assert.equal(isOwner("admin"), false);
  assert.equal(isOwner("cashier"), false);
});

import {
  activityTone,
  parseUserAgent,
} from "../src/lib/securityCenter.js";

test("security center parses desktop chrome user agent", () => {
  const parsed = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  assert.equal(parsed.browser, "Chrome");
  assert.equal(parsed.os, "Windows 10/11");
  assert.equal(parsed.device, "Desktop");
});

test("security activity tones map correctly", () => {
  assert.equal(activityTone("login_failed"), "danger");
  assert.equal(activityTone("password_changed"), "warning");
  assert.equal(activityTone("mfa_enabled"), "success");
  assert.equal(activityTone("login"), "success");
});

import { isValidEmail } from "../src/lib/emailValidation.js";

test("accepts official Zoho support email and standard formats", () => {
  assert.equal(isValidEmail("support@httpsnexorapos.com"), true);
  assert.equal(isValidEmail("support@httpsnexorapos.com"), true);
  assert.equal(isValidEmail("owner@example.com"), true);
  assert.equal(isValidEmail("a.b+tag@sub.domain.co"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("missing-domain@"), false);
  assert.equal(isValidEmail("@nodomain.com"), false);
  assert.equal(isValidEmail("spaces emma@example.com"), false);
});

console.log(`\n${passed} tests passed.`);
console.log("Run owner email flow tests with: npm run test:owner-email");
