/**
 * Platform Owner (Super Admin) administration — cross-tenant only.
 * Reuses companies, company_subscriptions, profiles, audit_log, company_settings.
 * Never import from src/.
 */

import { isPlatformOwner, normalizeRole } from "./_authHelpers.js";
import {
  BILLING_CURRENCY,
  CANONICAL_PLANS,
  DEFAULT_TRIAL_DAYS,
  getPlanByCode,
  normalizePlanCode,
} from "./_saasPlans.js";
import { notifySubscriptionConfirmationSms } from "./_smsService.js";

const FORBIDDEN = Object.freeze({
  success: false,
  error: "Only the Platform Owner can perform this action.",
  code: "FORBIDDEN",
});

const COMPANY_STATUSES = new Set(["active", "pending_verification", "suspended", "cancelled"]);
const SUB_STATUSES = new Set(["active", "trialing", "past_due", "cancelled", "inactive"]);

function requirePlatform(caller) {
  return isPlatformOwner(caller?.role) ? null : FORBIDDEN;
}

function isMissingTableError(error) {
  const msg = String(error?.message || error?.details || "");
  const code = String(error?.code || "");
  return code === "42P01" || /relation .* does not exist/i.test(msg) || /Could not find the table/i.test(msg);
}

function isMissingColumnError(error) {
  const msg = String(error?.message || error?.details || "");
  const code = String(error?.code || "");
  return code === "42703" || /column .* does not exist/i.test(msg) || /Could not find the .* column/i.test(msg);
}

async function writeAudit(admin, { companyId, caller, action, module, details }) {
  const payload = {
    user_id: caller?.id || null,
    user_name: caller?.name || caller?.username || "Platform Owner",
    action,
    module: module || "platform_admin",
    details: typeof details === "string" ? details : JSON.stringify(details || {}),
    company_id: companyId ?? null,
  };
  const { error } = await admin.from("audit_log").insert(payload);
  if (error && isMissingColumnError(error)) {
    delete payload.company_id;
    await admin.from("audit_log").insert(payload);
  }
}

async function loadSettings(admin, companyId) {
  const { data, error } = await admin
    .from("company_settings")
    .select("settings")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error && !isMissingTableError(error)) return {};
  return data?.settings && typeof data.settings === "object" ? data.settings : {};
}

async function mergeSettings(admin, companyId, patch = {}) {
  const existing = await loadSettings(admin, companyId);
  const next = { ...existing, ...patch };
  const { error } = await admin
    .from("company_settings")
    .upsert(
      { company_id: companyId, settings: next, updated_at: new Date().toISOString() },
      { onConflict: "company_id" }
    );
  if (error && !isMissingTableError(error)) throw error;
  return next;
}

function mapSubStatusForDb(status) {
  const raw = String(status || "").toLowerCase().trim();
  if (raw === "suspended" || raw === "expired") return "inactive";
  if (SUB_STATUSES.has(raw)) return raw;
  return null;
}

function mapCompanyStatusForDb(status) {
  const raw = String(status || "").toLowerCase().trim();
  if (raw === "inactive" || raw === "disabled") return "cancelled";
  if (raw === "lock" || raw === "locked") return "suspended";
  if (COMPANY_STATUSES.has(raw)) return raw;
  return null;
}

/**
 * Display status for Platform Dashboard:
 * Active | Suspended | Expired | Disabled (+ pending_verification)
 */
export function deriveCompanyDisplayStatus(company, subscription, settings = {}) {
  const locked = settings.platform_locked === true;
  const companyStatus = String(company?.status || "").toLowerCase();
  const subStatus = String(subscription?.status || "").toLowerCase();
  const expiresAt = subscription?.expires_at || subscription?.trial_ends_at || company?.trial_ends_at || null;
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;

  if (companyStatus === "cancelled") return "disabled";
  if (locked || companyStatus === "suspended") return "suspended";
  if (companyStatus === "pending_verification") return "pending_verification";
  if (expired || subStatus === "inactive" || subStatus === "cancelled") return "expired";
  if (["active", "trialing"].includes(subStatus) || companyStatus === "active") return "active";
  return companyStatus || "active";
}

function trialDaysRemaining(company, subscription) {
  const ends = subscription?.trial_ends_at || company?.trial_ends_at;
  if (!ends) return 0;
  const ms = new Date(ends).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}

async function countByCompany(admin, table, companyId, extra = null) {
  try {
    let q = admin.from(table).select("id", { count: "exact", head: true }).eq("company_id", companyId);
    if (typeof extra === "function") q = extra(q);
    const { count, error } = await q;
    if (error) return 0;
    return Number(count || 0);
  } catch {
    return 0;
  }
}

async function sumSalesTotal(admin, companyId) {
  try {
    const { data, error } = await admin
      .from("sales")
      .select("total")
      .eq("company_id", companyId)
      .limit(5000);
    if (error || !Array.isArray(data)) return 0;
    return data.reduce((sum, row) => sum + Number(row.total || 0), 0);
  } catch {
    return 0;
  }
}

async function listAuthOwners(admin) {
  const owners = [];
  let page = 1;
  const perPage = 200;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const user of data.users) {
      const role = normalizeRole(user.app_metadata?.role);
      if (role === "platform_owner") continue;
      owners.push({
        id: user.id,
        name: user.user_metadata?.name || user.email || "User",
        username: user.user_metadata?.username || user.app_metadata?.username || "",
        email: user.email || "",
        phone: user.phone || user.user_metadata?.phone || "",
        role,
        company_id: user.app_metadata?.company_id ?? null,
        branch_id: user.app_metadata?.branch_id ?? null,
        active: user.app_metadata?.active === false || user.app_metadata?.active === 0 ? 0 : 1,
        account_status: user.app_metadata?.account_status || "active",
        last_login_at: user.last_sign_in_at || null,
        email_verified: !!user.email_confirmed_at,
      });
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return owners;
}

async function enrichCompany(admin, company, subscription, users, settings) {
  const companyId = Number(company.id);
  const owner =
    users.find((u) => String(u.id) === String(company.owner_user_id))
    || users.find((u) => Number(u.company_id) === companyId && normalizeRole(u.role) === "owner")
    || null;
  const plan = getPlanByCode(subscription?.plan_code || company.plan_code || "free_trial");
  const [
    branch_count,
    product_count,
    sales_count,
    profile_user_count,
  ] = await Promise.all([
    countByCompany(admin, "branches", companyId),
    countByCompany(admin, "products", companyId),
    countByCompany(admin, "sales", companyId),
    countByCompany(admin, "profiles", companyId),
  ]);
  const auth_user_count = users.filter((u) => Number(u.company_id) === companyId).length;
  const user_count = Math.max(profile_user_count, auth_user_count);
  const sales_total = await sumSalesTotal(admin, companyId);
  const display_status = deriveCompanyDisplayStatus(company, subscription, settings);

  const trialDays = trialDaysRemaining(company, subscription);
  const subStatus = String(subscription?.status || "").toLowerCase();
  const planCode = normalizePlanCode(subscription?.plan_code || company.plan_code);
  let free_trial_status = "Not on trial";
  if (planCode === "free_trial" || subStatus === "trialing") {
    free_trial_status = trialDays > 0 ? "Active trial" : "Trial ended";
  }

  return {
    ...company,
    owner_name: owner?.name || null,
    owner_email: owner?.email || company.email || null,
    owner_phone: owner?.phone || company.phone || null,
    owner_user_id: company.owner_user_id || owner?.id || null,
    last_login_at: owner?.last_login_at || null,
    registration_date: company.created_at || null,
    subscription_plan: plan?.name || subscription?.plan_code || company.plan_code || "Unassigned",
    plan_code: planCode,
    subscription_status: subscription?.status || null,
    free_trial_status,
    trial_days: trialDays,
    trial_ends_at: subscription?.trial_ends_at || company.trial_ends_at || null,
    paid_until: subscription?.expires_at || null,
    expiry_date: subscription?.expires_at || company.trial_ends_at || null,
    expires_at: subscription?.expires_at || null,
    branch_count,
    user_count,
    active_user_count: users.filter((u) => Number(u.company_id) === companyId && u.active).length,
    products: product_count,
    product_count,
    sales: sales_count,
    sales_count,
    sales_total,
    storage_usage: 0,
    storage_usage_label: "Not metered",
    ai_usage: 0,
    ai_usage_label: "Not metered",
    sms_usage: 0,
    sms_usage_label: "Not metered",
    display_status,
    company_status: display_status,
    status: display_status === "disabled" ? "cancelled" : (display_status === "expired" ? company.status : (display_status === "suspended" ? "suspended" : company.status)),
    platform_locked: settings.platform_locked === true,
    limits: subscription?.limits || plan?.limits || {},
  };
}

async function getOverview(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;

  const { data: companies, error } = await admin.from("companies").select("*").order("id", { ascending: true });
  if (error && isMissingTableError(error)) {
    return { success: true, companies: [], users: [], branches: [], audit: [], stats: { companies: 0, active_companies: 0, users: 0, active_users: 0 } };
  }
  if (error) throw error;

  const [{ data: subscriptions }, { data: branches }, users, { data: audit }] = await Promise.all([
    admin.from("company_subscriptions").select("*"),
    admin.from("branches").select("id, company_id, name, code, address, active"),
    listAuthOwners(admin),
    admin.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300),
  ]);

  const subByCompany = new Map((subscriptions || []).map((row) => [Number(row.company_id), row]));
  const settingsByCompany = new Map();
  for (const company of companies || []) {
    settingsByCompany.set(Number(company.id), await loadSettings(admin, company.id));
  }

  const query = String(params.search || "").trim().toLowerCase();
  const companyFilter = params.company_id == null || params.company_id === "" ? null : Number(params.company_id);

  let enriched = [];
  for (const company of companies || []) {
    if (companyFilter != null && Number(company.id) !== companyFilter) continue;
    const row = await enrichCompany(
      admin,
      company,
      subByCompany.get(Number(company.id)),
      users,
      settingsByCompany.get(Number(company.id)) || {}
    );
    if (query) {
      const hay = [row.name, row.code, row.email, row.owner_name, row.owner_email, row.country]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      if (!hay.includes(query)) continue;
    }
    enriched.push(row);
  }

  const filteredUsers = users.filter((user) => {
    if (companyFilter != null && Number(user.company_id) !== companyFilter) return false;
    if (params.role && normalizeRole(user.role) !== normalizeRole(params.role)) return false;
    if (params.status === "active" && !user.active) return false;
    if (params.status === "inactive" && user.active) return false;
    if (query) {
      const hay = [user.name, user.username, user.email].map((v) => String(v || "").toLowerCase()).join(" ");
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const activeCompanies = enriched.filter((c) => c.display_status === "active").length;

  return {
    success: true,
    companies: enriched,
    users: filteredUsers,
    roles: [],
    branches: branches || [],
    audit: (audit || []).filter((entry) =>
      ["owner_management", "platform_admin", "users", "subscriptions", "companies"].includes(String(entry.module || ""))
      || /impersonat|suspend|password|company_/i.test(String(entry.action || ""))
    ).slice(0, 300),
    stats: {
      companies: enriched.length,
      active_companies: activeCompanies,
      users: filteredUsers.length,
      active_users: filteredUsers.filter((u) => u.active).length,
    },
  };
}

async function getPlatformConsole(admin, caller) {
  const denied = requirePlatform(caller);
  if (denied) return denied;

  const overview = await getOverview(admin, caller, {});
  if (!overview.success) return overview;

  const { data: subscriptions } = await admin.from("company_subscriptions").select("*");
  const { data: audit } = await admin.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500);

  const subs = subscriptions || [];
  const statusCounts = Object.fromEntries(
    ["active", "trialing", "suspended", "expired", "cancelled", "inactive", "past_due"].map((status) => [
      status,
      subs.filter((row) => {
        if (status === "suspended") return row.status === "inactive" && overview.companies.some((c) => Number(c.id) === Number(row.company_id) && c.display_status === "suspended");
        if (status === "expired") return overview.companies.some((c) => Number(c.id) === Number(row.company_id) && c.display_status === "expired");
        return String(row.status) === status;
      }).length,
    ])
  );

  const monthlyRevenue = CANONICAL_PLANS
    .filter((p) => p.public_visible !== false && Number(p.price_monthly) > 0)
    .reduce((sum, plan) => {
      const count = subs.filter((s) => normalizePlanCode(s.plan_code) === plan.code && ["active", "trialing"].includes(s.status)).length;
      return sum + count * Number(plan.price_monthly || 0);
    }, 0);

  const totalRevenueEstimate = overview.companies.reduce((sum, c) => sum + Number(c.sales_total || 0), 0);

  return {
    success: true,
    subscriptions: subs.map((row) => {
      const plan = getPlanByCode(row.plan_code);
      return {
        ...row,
        plan_code: normalizePlanCode(row.plan_code),
        plan_name: plan?.name || row.plan_code,
        limits: { ...(plan?.limits || {}), ...(row.limits || {}) },
      };
    }),
    plans: CANONICAL_PLANS.map((plan, index) => ({ id: index + 1, ...plan })),
    domains: [],
    billing: [],
    features: [],
    companyFeatureOverrides: [],
    platformSettings: {
      require_verified_domains: false,
      note: "Domains / billing tables are not provisioned; settings are best-effort.",
    },
    audit: audit || [],
    analytics: {
      companies: overview.stats.companies,
      active_companies: overview.stats.active_companies,
      suspended_companies: overview.companies.filter((c) => c.display_status === "suspended").length,
      users: overview.stats.users,
      active_users: overview.stats.active_users,
      branches: (overview.branches || []).length,
      sales_total: totalRevenueEstimate,
      monthly_revenue: monthlyRevenue,
      total_revenue: totalRevenueEstimate,
      revenue_currency: BILLING_CURRENCY,
      sales_currencies: [...new Set(overview.companies.map((c) => c.currency).filter(Boolean))],
      subscriptions_by_status: statusCounts,
      ai_usage: 0,
      ai_usage_label: "Not metered",
      sms_usage: 0,
      sms_usage_label: "Not metered",
      storage_usage: 0,
      storage_usage_label: "Not metered",
      system_health: "ok",
    },
  };
}

async function updateCompany(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;

  const id = Number(params.id ?? params.company_id);
  if (!id) return { success: false, error: "Company id is required." };

  const { data: existing, error: loadError } = await admin.from("companies").select("*").eq("id", id).maybeSingle();
  if (loadError) throw loadError;
  if (!existing) return { success: false, error: "Company not found." };

  const updates = {};
  if (params.name != null) updates.name = String(params.name).trim().slice(0, 120);
  if (params.business_type != null) updates.business_type = String(params.business_type).trim().slice(0, 80);
  if (params.country != null) updates.country = String(params.country).trim().slice(0, 80);
  if (params.currency != null) updates.currency = String(params.currency).trim().toUpperCase().slice(0, 8);
  if (params.email != null) updates.email = String(params.email).trim().toLowerCase().slice(0, 160);
  if (params.phone != null) updates.phone = String(params.phone).trim().slice(0, 40);
  if (params.address != null) updates.address = String(params.address).trim().slice(0, 240);
  if (params.logo != null) updates.logo = String(params.logo || "");

  if (params.status != null) {
    const mapped = mapCompanyStatusForDb(params.status);
    if (!mapped) return { success: false, error: "Invalid company status." };
    updates.status = mapped;
  }

  if (!Object.keys(updates).length) return { success: false, error: "No updates provided." };

  const { error } = await admin.from("companies").update(updates).eq("id", id);
  if (error) throw error;

  const previous = existing.status;
  const next = updates.status || previous;
  let action = "company_updated";
  if (previous !== next) {
    if (next === "active") action = "company_activated";
    else if (next === "suspended") action = "company_suspended";
    else if (next === "cancelled") action = "company_disabled";
    else action = "company_status_changed";
  }

  await writeAudit(admin, {
    companyId: id,
    caller,
    action,
    module: "platform_admin",
    details: { company_id: id, previous_status: previous, status: next, updates },
  });

  return { success: true };
}

async function setCompanyLifecycle(admin, caller, params = {}, actionName) {
  const denied = requirePlatform(caller);
  if (denied) return denied;
  const id = Number(params.id ?? params.company_id);
  if (!id) return { success: false, error: "Company id is required." };

  const statusMap = {
    activate: "active",
    deactivate: "cancelled",
    suspend: "suspended",
    disable: "cancelled",
    delete: "cancelled",
  };
  const nextStatus = statusMap[actionName];
  if (!nextStatus) return { success: false, error: "Unknown lifecycle action." };

  const { data: existing, error: loadError } = await admin.from("companies").select("*").eq("id", id).maybeSingle();
  if (loadError) throw loadError;
  if (!existing) return { success: false, error: "Company not found." };

  const { error } = await admin.from("companies").update({ status: nextStatus }).eq("id", id);
  if (error) throw error;

  if (["suspend", "deactivate", "disable", "delete"].includes(actionName)) {
    await admin
      .from("company_subscriptions")
      .update({ status: "inactive", updated_at: new Date().toISOString() })
      .eq("company_id", id);
  }
  if (actionName === "activate") {
    await mergeSettings(admin, id, { platform_locked: false });
    const plan = getPlanByCode(existing.plan_code || "starter");
    await admin.from("company_subscriptions").upsert(
      {
        company_id: id,
        plan_code: plan.code,
        status: plan.code === "free_trial" ? "trialing" : "active",
        updated_at: new Date().toISOString(),
        limits: plan.limits,
      },
      { onConflict: "company_id" }
    );
  }
  if (actionName === "delete") {
    await mergeSettings(admin, id, { platform_deleted: true, platform_deleted_at: new Date().toISOString() });
  }

  await writeAudit(admin, {
    companyId: id,
    caller,
    action: `company_${actionName}`,
    module: "platform_admin",
    details: { company_id: id, previous_status: existing.status, status: nextStatus },
  });

  return { success: true, status: nextStatus };
}

async function lockCompany(admin, caller, params = {}, locked) {
  const denied = requirePlatform(caller);
  if (denied) return denied;
  const id = Number(params.id ?? params.company_id);
  if (!id) return { success: false, error: "Company id is required." };

  const { data: existing, error } = await admin.from("companies").select("id, status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!existing) return { success: false, error: "Company not found." };

  await mergeSettings(admin, id, {
    platform_locked: !!locked,
    platform_locked_at: locked ? new Date().toISOString() : null,
    platform_locked_by: locked ? caller.id : null,
  });

  if (locked) {
    await admin.from("companies").update({ status: "suspended" }).eq("id", id);
    await admin
      .from("company_subscriptions")
      .update({ status: "inactive", updated_at: new Date().toISOString() })
      .eq("company_id", id);
  } else if (existing.status === "suspended") {
    await admin.from("companies").update({ status: "active" }).eq("id", id);
  }

  await writeAudit(admin, {
    companyId: id,
    caller,
    action: locked ? "company_locked" : "company_unlocked",
    module: "platform_admin",
    details: { company_id: id, locked: !!locked },
  });

  return { success: true, locked: !!locked };
}

async function updateSubscription(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;

  const companyId = Number(params.company_id ?? params.id);
  if (!companyId) return { success: false, error: "company_id is required." };

  const { data: company, error: companyError } = await admin.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (companyError) throw companyError;
  if (!company) return { success: false, error: "Company not found." };

  const { data: existing } = await admin
    .from("company_subscriptions")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  let planCode = normalizePlanCode(params.plan_code || params.plan || existing?.plan_code || company.plan_code);
  if (params.plan_id != null) {
    const byId = CANONICAL_PLANS[Number(params.plan_id) - 1];
    if (byId) planCode = byId.code;
  }
  const plan = getPlanByCode(planCode);

  let status = mapSubStatusForDb(params.status || existing?.status || "active");
  if (!status) return { success: false, error: "Invalid subscription status." };

  let expiresAt = params.expires_at
    ? new Date(params.expires_at).toISOString()
    : existing?.expires_at || null;
  if (params.extend_days) {
    const base = expiresAt && new Date(expiresAt).getTime() > Date.now()
      ? new Date(expiresAt).getTime()
      : Date.now();
    expiresAt = new Date(base + Number(params.extend_days) * 86400000).toISOString();
    if (status === "inactive") status = "active";
  }
  if (["active", "trialing"].includes(status) && !expiresAt) {
    expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  }

  const row = {
    company_id: companyId,
    plan_code: plan.code,
    status,
    expires_at: expiresAt,
    trial_ends_at: params.trial_ends_at || existing?.trial_ends_at || company.trial_ends_at || null,
    limits: plan.limits,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("company_subscriptions").upsert(row, { onConflict: "company_id" });
  if (error && isMissingTableError(error)) {
    return { success: false, error: "Subscriptions table is unavailable." };
  }
  if (error) throw error;

  try {
    await admin.from("companies").update({ plan_code: plan.code }).eq("id", companyId);
  } catch {
    /* optional */
  }

  await writeAudit(admin, {
    companyId,
    caller,
    action: params.extend_days ? "subscription_extended" : "subscription_updated",
    module: "platform_admin",
    details: { company_id: companyId, plan_code: plan.code, status, expires_at: expiresAt, extend_days: params.extend_days || null },
  });

  // Best-effort subscription confirmation SMS to the company owner.
  if (["active", "trialing"].includes(status)) {
    try {
      let ownerPhone = company.phone || null;
      if (!ownerPhone && company.owner_user_id) {
        const { data: ownerAuth } = await admin.auth.admin.getUserById(company.owner_user_id);
        ownerPhone = ownerAuth?.user?.phone || ownerAuth?.user?.app_metadata?.phone || null;
      }
      if (ownerPhone) {
        await notifySubscriptionConfirmationSms({
          phone: ownerPhone,
          planName: plan.name,
          expiresAt,
          companyId,
          userId: company.owner_user_id || null,
        });
      }
    } catch (smsErr) {
      console.warn("[platformAdmin] subscription confirmation SMS failed", smsErr?.message || smsErr);
    }
  }

  return { success: true, subscription: { ...row, plan: plan.name } };
}

async function resetOwnerPassword(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;

  const companyId = Number(params.company_id);
  const password = String(params.password || "");
  if (!companyId) return { success: false, error: "company_id is required." };
  if (password.length < 8) return { success: false, error: "Password must be at least 8 characters." };
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return {
      success: false,
      error: "Password must include upper & lower case letters, a number, and a special character.",
    };
  }

  const { data: company, error } = await admin.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (error) throw error;
  if (!company) return { success: false, error: "Company not found." };

  let ownerId = company.owner_user_id || params.owner_user_id || null;
  if (!ownerId) {
    const users = await listAuthOwners(admin);
    const owner = users.find((u) => Number(u.company_id) === companyId && normalizeRole(u.role) === "owner");
    ownerId = owner?.id || null;
  }
  if (!ownerId) return { success: false, error: "Company owner account not found." };

  const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(ownerId);
  if (targetError || !targetData?.user) return { success: false, error: "Owner auth user not found." };
  if (normalizeRole(targetData.user.app_metadata?.role) === "platform_owner") {
    return { success: false, error: "Cannot reset Platform Owner password here.", code: "FORBIDDEN" };
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(ownerId, { password });
  if (updateError) throw updateError;

  await writeAudit(admin, {
    companyId,
    caller,
    action: "owner_password_reset",
    module: "platform_admin",
    details: { company_id: companyId, target_user_id: ownerId },
  });

  return { success: true };
}

async function recordAudit(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;
  await writeAudit(admin, {
    companyId: params.company_id ?? null,
    caller,
    action: String(params.action || "platform_action"),
    module: "platform_admin",
    details: params.details || {},
  });
  return { success: true };
}

async function getCompanyDetail(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;
  const id = Number(params.id ?? params.company_id);
  if (!id) return { success: false, error: "Company id is required." };
  const overview = await getOverview(admin, caller, { company_id: id });
  if (!overview.success) return overview;
  const company = overview.companies[0];
  if (!company) return { success: false, error: "Company not found." };
  return {
    success: true,
    company,
    users: overview.users,
    branches: (overview.branches || []).filter((b) => Number(b.company_id) === id),
  };
}

async function extendTrial(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;
  const companyId = Number(params.company_id ?? params.id);
  const days = Math.max(1, Number(params.days || params.extend_days || 7));
  if (!companyId) return { success: false, error: "company_id is required." };

  const { data: company, error } = await admin.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (error) throw error;
  if (!company) return { success: false, error: "Company not found." };

  const { data: existing } = await admin
    .from("company_subscriptions")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  const currentTrial = existing?.trial_ends_at || company.trial_ends_at;
  const base = currentTrial && new Date(currentTrial).getTime() > Date.now()
    ? new Date(currentTrial).getTime()
    : Date.now();
  const trialEndsAt = new Date(base + days * 86400000).toISOString();
  const expiresAt = existing?.expires_at && new Date(existing.expires_at).getTime() > new Date(trialEndsAt).getTime()
    ? existing.expires_at
    : trialEndsAt;

  const result = await updateSubscription(admin, caller, {
    company_id: companyId,
    plan_code: existing?.plan_code || company.plan_code || "free_trial",
    status: "trialing",
    trial_ends_at: trialEndsAt,
    expires_at: expiresAt,
  });
  if (!result?.success) return result;

  await admin.from("companies").update({
    status: "active",
    trial_ends_at: trialEndsAt,
    plan_code: normalizePlanCode(existing?.plan_code || company.plan_code || "free_trial"),
  }).eq("id", companyId);

  await writeAudit(admin, {
    companyId,
    caller,
    action: "trial_extended",
    module: "platform_admin",
    details: { company_id: companyId, days, trial_ends_at: trialEndsAt },
  });

  return { success: true, trial_ends_at: trialEndsAt, days };
}

async function markCompanyPaid(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;
  const companyId = Number(params.company_id ?? params.id);
  if (!companyId) return { success: false, error: "company_id is required." };

  const days = params.days != null ? Number(params.days) : (params.extend_days != null ? Number(params.extend_days) : 30);
  const paidUntil = params.paid_until
    ? new Date(params.paid_until).toISOString()
    : null;

  const activated = await setCompanyLifecycle(admin, caller, { id: companyId }, "activate");
  if (activated && activated.success === false) return activated;

  const subParams = {
    company_id: companyId,
    plan_code: params.plan_code || params.plan || undefined,
    status: "active",
  };
  if (paidUntil) subParams.expires_at = paidUntil;
  else subParams.extend_days = Number.isFinite(days) && days > 0 ? days : 30;

  const result = await updateSubscription(admin, caller, subParams);
  if (!result?.success) return result;

  await writeAudit(admin, {
    companyId,
    caller,
    action: "mark_paid",
    module: "platform_admin",
    details: {
      company_id: companyId,
      paid_until: result.subscription?.expires_at || paidUntil,
      plan_code: result.subscription?.plan_code,
      days: paidUntil ? null : days,
    },
  });

  return {
    success: true,
    paid_until: result.subscription?.expires_at || paidUntil,
    subscription: result.subscription,
  };
}

async function getCompanyHistory(admin, caller, params = {}) {
  const denied = requirePlatform(caller);
  if (denied) return denied;
  const companyId = Number(params.company_id ?? params.id);
  if (!companyId) return { success: false, error: "company_id is required." };

  // Strict tenant boundary: only rows for this company_id.
  const { data: audit, error } = await admin
    .from("audit_log")
    .select("id,action,module,details,user_name,created_at,company_id")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error && !isMissingTableError(error)) throw error;

  const rows = audit || [];
  const paymentHistory = rows.filter((row) =>
    /mark_paid|payment|billing|renew/i.test(String(row.action || ""))
  );
  const subscriptionHistory = rows.filter((row) =>
    /subscription|trial_extended|mark_paid|company_activat|company_suspend|company_deactivat|extend/i.test(
      String(row.action || "")
    )
  );

  const { data: subscription } = await admin
    .from("company_subscriptions")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  return {
    success: true,
    company_id: companyId,
    payment_history: paymentHistory,
    subscription_history: subscriptionHistory,
    current_subscription: subscription || null,
    audit: rows.slice(0, 100),
  };
}

/**
 * Entry point for platform / owner actions from handlePosAction.
 */
export async function handlePlatformAction(admin, caller, action, params = {}) {
  switch (action) {
    case "platform.getOverview":
    case "owner.getOverview":
      return getOverview(admin, caller, params);
    case "platform.getConsole":
    case "owner.getPlatformConsole":
      return getPlatformConsole(admin, caller);
    case "platform.getCompany":
    case "owner.getCompanyDetail":
      return getCompanyDetail(admin, caller, params);
    case "platform.updateCompany":
    case "owner.updateCompany":
      return updateCompany(admin, caller, params);
    case "platform.activateCompany":
      return setCompanyLifecycle(admin, caller, params, "activate");
    case "platform.deactivateCompany":
      return setCompanyLifecycle(admin, caller, params, "deactivate");
    case "platform.suspendCompany":
      return setCompanyLifecycle(admin, caller, params, "suspend");
    case "platform.deleteCompany":
      return setCompanyLifecycle(admin, caller, params, "delete");
    case "platform.lockCompany":
      return lockCompany(admin, caller, params, true);
    case "platform.unlockCompany":
      return lockCompany(admin, caller, params, false);
    case "platform.updateSubscription":
    case "owner.updateSubscription":
      return updateSubscription(admin, caller, params);
    case "platform.extendSubscription":
      return updateSubscription(admin, caller, {
        ...params,
        extend_days: Number(params.days || params.extend_days || 30),
        status: params.status || "active",
      });
    case "platform.extendTrial":
    case "owner.extendTrial":
      return extendTrial(admin, caller, params);
    case "platform.markPaid":
    case "owner.markPaid":
      return markCompanyPaid(admin, caller, params);
    case "platform.getCompanyHistory":
    case "owner.getCompanyHistory":
      return getCompanyHistory(admin, caller, params);
    case "platform.resetOwnerPassword":
      return resetOwnerPassword(admin, caller, params);
    case "platform.recordAudit":
    case "owner.recordAudit":
      return recordAudit(admin, caller, params);
    case "owner.savePlan":
    case "owner.saveFeature":
    case "owner.toggleCompanyFeature":
    case "owner.addDomain":
    case "owner.verifyDomain":
    case "owner.setPrimaryDomain":
    case "owner.removeDomain":
    case "owner.updatePlatformSettings":
    case "owner.createCompanyAccount":
    case "owner.verifyCompanyOwnerEmail":
    case "owner.getActivity":
      return {
        success: false,
        error: "This platform feature is not wired to Postgres yet. Core company/subscription admin is available.",
        code: "NOT_IMPLEMENTED",
      };
    default:
      return null;
  }
}

/**
 * Gate tenant access when company is suspended/cancelled/locked.
 * Called from companies.checkAccess enrichment.
 */
export async function evaluateCompanyAccessGate(admin, companyId) {
  if (companyId == null || companyId === "") return { ok: true };
  try {
    const { data: company } = await admin
      .from("companies")
      .select("id, status")
      .eq("id", companyId)
      .maybeSingle();
    if (!company) return { ok: true };
    const settings = await loadSettings(admin, companyId);
    if (settings.platform_locked === true || company.status === "suspended") {
      return {
        ok: false,
        code: "COMPANY_SUSPENDED",
        error: "This company account is suspended. Contact Nexora support.",
      };
    }
    if (company.status === "cancelled") {
      return {
        ok: false,
        code: "COMPANY_DISABLED",
        error: "This company account is disabled.",
      };
    }
  } catch {
    return { ok: true };
  }
  return { ok: true };
}
