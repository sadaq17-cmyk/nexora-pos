/**
 * One-shot patcher: rewires mockApi.js auth namespaces for Supabase Auth migration.
 * Run from repo root: node scripts/_patch-mockapi-auth.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "src", "lib", "mockApi.js");
let src = fs.readFileSync(file, "utf8");

if (src.includes("__setAuthContext")) {
  console.log("mockApi.js already patched (__setAuthContext present). Skipping.");
  process.exit(0);
}

if (!src.includes('import { CANONICAL_PLANS')) {
  console.error("Unexpected mockApi.js shape — aborting.");
  process.exit(1);
}

src = src.replace(
  'import { CANONICAL_PLANS, mergeCanonicalPlans, safePublicPlan } from "./saasPlans";',
  'import { CANONICAL_PLANS, mergeCanonicalPlans, safePublicPlan } from "./saasPlans";\nimport { authFetch } from "./authApi";'
);

src = src.replace(
  `let db = loadDb();
let currentMockUser = null;
let currentSessionId = null;
let impersonationContext = null;
let tenantScopeActive = false;`,
  `let db = loadDb();
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
}`
);

// Insert helper functions after companyScopedUsers
const companyScopedOld = `function companyScopedUsers() {
  if (isPlatformOwner(currentMockUser?.role) && !impersonationContext) return db.users;
  return db.users.filter((user) => Number(user.company_id) === Number(currentMockUser?.company_id));
}`;

const companyScopedNew = `function companyScopedUsers() {
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
}`;

if (!src.includes(companyScopedOld)) {
  console.error("companyScopedUsers block not found — aborting.");
  process.exit(1);
}
src = src.replace(companyScopedOld, companyScopedNew);

// Replace from publicAuth through end of auth block (before users:)
const publicAuthStart = src.indexOf("  publicAuth: {");
const usersStart = src.indexOf("  users: {", publicAuthStart);
if (publicAuthStart < 0 || usersStart < 0) {
  console.error("Could not locate publicAuth/users blocks.");
  process.exit(1);
}

const publicAuthAndAuthReplacement = `  publicAuth: {
    createCompanyWorkspace: (payload = {}) => {
      const companyName = String(payload.company_name || "").trim().replace(/\\s+/g, " ").slice(0, 120);
      const name = String(payload.full_name || "").trim().replace(/\\s+/g, " ").slice(0, 120);
      const email = String(payload.email || "").trim().toLowerCase().slice(0, 160);
      const phone = String(payload.phone || "").trim().slice(0, 30);
      const supabaseUserId = String(payload.supabase_user_id || "").trim();
      if (!consumeRateLimit(\`signup:\${email || "anon"}\`, 3, 60000)) {
        return wait({ success: false, error: "Too many signup attempts. Please wait and try again.", code: "RATE_LIMITED" });
      }
      if (!companyName || !name || !validEmail(email) || !phone || !validPhone(phone) || !supabaseUserId) {
        return wait({ success: false, error: "Please provide valid signup details." });
      }
      if (db.companies.some((company) => company.name.toLowerCase() === companyName.toLowerCase())) {
        return wait({ success: false, error: "A company with that name already exists.", code: "COMPANY_EXISTS" });
      }
      const selectedCode = String(payload.plan_code || "free_trial").trim().toLowerCase();
      const plan = db.plans.find((entry) => entry.active && entry.public_visible !== false && entry.code === selectedCode)
        || db.plans.find((entry) => entry.code === "free_trial");
      if (!plan) return wait({ success: false, error: "Free trial onboarding is unavailable." });
      const companyId = nextId("company");
      const branchId = nextId("branch");
      const timestamp = nowIso();
      const baseUsername = email.split("@")[0].replace(/[^a-z0-9._-]/g, "").slice(0, 24) || "owner";
      let username = baseUsername;
      let suffix = 2;
      while (db.users.some((user) => Number(user.company_id) === companyId && user.username === username)) {
        username = \`\${baseUsername}\${suffix++}\`;
      }
      const companyCode = nextCompanyCode(companyName);
      const trialDays = Math.max(1, Number(plan.trial_days || 14));
      const company = {
        id: companyId, name: companyName, business_type: "Retail", country: "International", code: companyCode,
        currency: "USD", time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        email, phone, address: "", logo: "", status: "pending_verification",
        owner_user_id: supabaseUserId, signup_source: "public", created_at: timestamp, created_by: null,
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
        currency: "USD", currency_symbol: "$", default_branch_id: String(branchId),
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
    checkCompanyAccess: (companyId) => {
      const now = Date.now();
      const company = db.companies.find((entry) => String(entry.id) === String(companyId));
      if (!company || company.status !== "active") {
        return wait({ ok: false, error: "Invalid company identifier or credentials." });
      }
      const subscription = db.subscriptions.find((entry) => Number(entry.company_id) === Number(company.id));
      const subscriptionAllowed = ["active", "trialing"].includes(subscription?.status)
        && (!subscription.expires_at || new Date(subscription.expires_at).getTime() >= now);
      if (!subscriptionAllowed) {
        return wait({ ok: false, error: "This company subscription is inactive or expired.", code: "SUBSCRIPTION_INACTIVE" });
      }
      return wait({ ok: true, company });
    },
    activateCompanyForOwner: (supabaseUserId) => {
      const company = db.companies.find((entry) => String(entry.owner_user_id) === String(supabaseUserId));
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
`;

src = src.slice(0, publicAuthStart) + publicAuthAndAuthReplacement + src.slice(usersStart);

// Replace auth_admin block
const authAdminStart = src.indexOf("  auth_admin: {");
const ownerStart = src.indexOf("  owner: {", authAdminStart);
if (authAdminStart < 0 || ownerStart < 0) {
  console.error("Could not locate auth_admin/owner blocks.");
  process.exit(1);
}

const authAdminReplacement = `  auth_admin: {
    createUser: async ({ name, username, email, phone = "", password, role, branch_id = 1, company_id, active = 1, profile_photo = "" }) => {
      const denied = requireUserManager();
      if (denied) return denied;
      const assignedCompanyId = isPlatformOwner(currentMockUser.role) ? company_id : currentMockUser.company_id;
      if (!assignedCompanyId && normalizeRole(role) !== "platform_owner") {
        return { success: false, error: "A company is required." };
      }
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
        },
      });
      if (result.success && result.id) {
        db.users.push({
          id: result.id, name: String(name || "").trim(), username: String(username || "").trim().toLowerCase(),
          email: String(email || "").trim().toLowerCase(), phone: String(phone || "").trim(),
          role: normalizeRole(role), role_id: normalizeRole(role), active: active ? 1 : 0,
          branch_id: Number(branch_id), company_id: assignedCompanyId, profile_photo: String(profile_photo || ""),
          created_at: nowIso(), created_by: currentMockUser?.id, created_by_name: currentMockUser?.name,
          email_verified: true,
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
`;

src = src.slice(0, authAdminStart) + authAdminReplacement + src.slice(ownerStart);

// Patch impersonateUser
const impersonateOld = `    impersonateUser: (targetId) => {
      const denied = requireOwner();
      if (denied) return wait(denied);
      if (impersonationContext) return wait({ success: false, error: "Nested impersonation is not allowed." });
      const target = db.users.find((entry) => Number(entry.id) === Number(targetId));
      if (!target?.active) return wait({ success: false, error: "Only active users can be impersonated." });
      if (target.id === currentMockUser.id) return wait({ success: false, error: "You are already signed in as this Owner." });
      const owner = currentMockUser;
      const ownerSessionId = currentSessionId;
      const startedAt = nowIso();
      const targetCompany = db.companies.find((company) => Number(company.id) === Number(target.company_id));
      logAudit("impersonation_started", "owner_management", { target_user_id: target.id, target_user_name: target.name, started_at: startedAt });
      const targetSessionId = nextId("session");
      db.sessions.push({ id: targetSessionId, user_id: target.id, role: target.role, company_id: target.company_id, branch_id: target.branch_id, company_code: targetCompany?.code || null, login_at: startedAt, last_activity_at: startedAt, logout_at: null, impersonated_by: owner.id });
      impersonationContext = { owner, ownerSessionId, targetId: target.id, startedAt };
      currentSessionId = targetSessionId;
      currentMockUser = publicUser({ ...target, company: targetCompany ? { id: targetCompany.id, name: targetCompany.name, code: targetCompany.code, status: targetCompany.status, logo: targetCompany.logo || "" } : null }, targetSessionId);
      persist();
      return wait({
        success: true,
        user: currentMockUser,
        impersonation: { owner: { id: owner.id, name: owner.name, session_id: ownerSessionId }, target_id: target.id, started_at: startedAt },
      });
    },`;

const impersonateNew = `    impersonateUser: async (targetId) => {
      const denied = requireOwner();
      if (denied) return denied;
      if (impersonationContext) return { success: false, error: "Nested impersonation is not allowed." };
      return authFetch("/api/admin-impersonate", { method: "POST", body: { target_id: targetId } });
    },`;

if (!src.includes("impersonateUser: (targetId)")) {
  console.warn("Warning: original impersonateUser not found; may already be patched.");
} else {
  src = src.replace(impersonateOld, impersonateNew);
}

// Remove PIN validation from createCompanyAccount (PIN auth is vestigial).
src = src.replace(
  /      if \(!\/\^\\d\{4\}\$\/\.test\(String\(payload\.pin \|\| ""\)\)\) return wait\(\{ success: false, error: "PIN must be exactly 4 digits\." \}\);\r?\n/,
  ""
);

src = src.replace(
  `const rawApi = {
  __isMock: true,`,
  `const rawApi = {
  __isMock: true,
  __setAuthContext: setAuthContext,`
);

src = src.replace(
  `export const mockApi = applyPermissionMiddleware(applyTenantMiddleware(rawApi), () => ({
  role: currentMockUser?.role,
  matrix: currentPermissionMatrix(),
}));`,
  `const permissionWrapped = applyPermissionMiddleware(applyTenantMiddleware(rawApi), () => ({
  role: currentMockUser?.role,
  matrix: currentPermissionMatrix(),
}));

permissionWrapped.__setAuthContext = setAuthContext;
permissionWrapped.__isMock = true;

export const mockApi = permissionWrapped;`
);

fs.writeFileSync(file, src, "utf8");
console.log("Patched mockApi.js successfully.");
console.log("Has __setAuthContext:", src.includes("__setAuthContext"));
console.log("Has authFetch admin-create:", src.includes("/api/admin-create-user"));
console.log("Has createCompanyWorkspace:", src.includes("createCompanyWorkspace"));
