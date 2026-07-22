import { createClient } from "@supabase/supabase-js";

/**
 * Shared helpers for Vercel serverless auth/admin endpoints.
 * SUPABASE_SERVICE_ROLE_KEY is server-only — never import this module from src/.
 */

const ROLE_HIERARCHY = Object.freeze([
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

const ADMIN_MANAGEABLE_ROLES = Object.freeze(["branch_manager", "cashier", "sales", "inventory_manager", "accountant"]);
const MANAGER_MANAGEABLE_ROLES = Object.freeze([]);

const ROLE_ALIASES = {
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
  accountant: "accountant",
};

export function normalizeRole(role) {
  if (!role) return "cashier";
  const key = String(role).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (ROLE_HIERARCHY.includes(key)) return key;
  const compact = key.replace(/_/g, "");
  return ROLE_ALIASES[compact] || ROLE_ALIASES[key] || key;
}

function roleRank(role) {
  const index = ROLE_HIERARCHY.indexOf(normalizeRole(role));
  return index === -1 ? ROLE_HIERARCHY.length : index;
}

/** Faithful port of src/lib/rbac.js canManageRole */
export function canManageRole(actorRole, targetRole, { allowOwnerPeer = false } = {}) {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole);
  if (actor === "platform_owner") return target !== "platform_owner";
  if (actor === "owner") return target !== "owner" || allowOwnerPeer;
  if (actor === "super_admin") return !["owner", "super_admin", "platform_owner"].includes(target);
  if (actor === "admin") return ADMIN_MANAGEABLE_ROLES.includes(target);
  if (actor === "branch_manager") return false;
  return false;
}

export function isPlatformOwner(role) {
  return normalizeRole(role) === "platform_owner";
}

export function isOwner(role) {
  return normalizeRole(role) === "owner";
}

export function isSuperAdmin(role) {
  return normalizeRole(role) === "super_admin";
}

export function isUserManagerRole(role) {
  const normalized = normalizeRole(role);
  return ["platform_owner", "owner", "super_admin", "admin"].includes(normalized);
}

export function canAssignRole(actorRole, targetRole) {
  return canManageRole(actorRole, targetRole, { allowOwnerPeer: false });
}

export function createAdminClient() {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey || !/^https?:\/\//i.test(url) || serviceKey.length < 20) {
    const err = new Error(
      "Supabase admin is not configured. Set VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY on the server."
    );
    err.code = "CONFIG";
    throw err;
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    const err = new Error(
      "Supabase anon client is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY on the server."
    );
    err.code = "CONFIG";
    throw err;
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function verifyCallerFromRequest(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: "Missing or invalid Authorization header.", status: 401 };

  const token = match[1].trim();
  if (!token) return { error: "Missing access token.", status: 401 };

  try {
    const anon = createAnonClient();
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data?.user) {
      return { error: "Invalid or expired session.", status: 401 };
    }
    const user = data.user;
    const meta = user.app_metadata || {};
    return {
      caller: {
        id: user.id,
        email: user.email || "",
        name: meta.name || user.user_metadata?.name || user.email || "",
        role: normalizeRole(meta.role),
        company_id: meta.company_id == null || meta.company_id === "" ? null : meta.company_id,
        branch_id: meta.branch_id == null || meta.branch_id === "" ? null : meta.branch_id,
        username: meta.username || "",
        active: meta.active !== false && meta.active !== 0,
      },
    };
  } catch (err) {
    if (err?.code === "CONFIG") return { error: err.message, status: 503 };
    console.error("[verifyCallerFromRequest]", err);
    return { error: "Unable to verify session.", status: 500 };
  }
}

export function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  return body && typeof body === "object" ? body : {};
}

export function methodNotAllowed(res, allow = "POST") {
  res.setHeader("Allow", allow);
  return res.status(405).json({ success: false, error: "Method not allowed." });
}

export function jsonError(res, status, error, code) {
  return res.status(status).json({ success: false, error, ...(code ? { code } : {}) });
}

export async function listAllAuthUsers(admin) {
  const perPage = 200;
  let page = 1;
  const all = [];
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    all.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 100) break;
  }
  return all;
}

const ACCOUNT_STATUSES = ["active", "inactive", "suspended", "locked"];

export function safeUserFields(user) {
  const meta = user.app_metadata || {};
  const activeFlag = meta.active === false || meta.active === 0 ? 0 : 1;
  const accountStatus = String(meta.account_status || (activeFlag ? "active" : "inactive")).toLowerCase();
  return {
    id: user.id,
    employee_id: meta.employee_id || "",
    name: meta.name || user.user_metadata?.name || "",
    username: meta.username || "",
    email: user.email || "",
    phone: meta.phone || user.phone || "",
    role: normalizeRole(meta.role),
    department: meta.department || "",
    position: meta.position || "",
    address: meta.address || "",
    national_id: meta.national_id || "",
    branch_id: meta.branch_id == null || meta.branch_id === "" ? null : meta.branch_id,
    company_id: meta.company_id == null || meta.company_id === "" ? null : meta.company_id,
    active: activeFlag,
    account_status: ACCOUNT_STATUSES.includes(accountStatus) ? accountStatus : (activeFlag ? "active" : "inactive"),
    login_enabled: meta.login_enabled === false || meta.login_enabled === 0 ? 0 : 1,
    must_change_password: meta.must_change_password === true,
    force_logout_at: meta.force_logout_at || null,
    created_at: user.created_at || null,
    created_by: meta.created_by || null,
    created_by_name: meta.created_by_name || "",
    last_login_at: user.last_sign_in_at || meta.last_login_at || null,
    last_activity_at: meta.last_activity_at || user.last_sign_in_at || null,
    login_count: Number(meta.login_count || 0) || 0,
    last_ip: meta.last_ip || "",
    last_device: meta.last_device || "",
    last_browser: meta.last_browser || "",
    last_os: meta.last_os || "",
    failed_login_count: Number(meta.failed_login_count || 0) || 0,
    locked_until: meta.locked_until || null,
    profile_photo: meta.profile_photo || "",
    email_verified: !!user.email_confirmed_at,
  };
}

export function requireUserManager(caller) {
  if (isUserManagerRole(caller?.role)) return null;
  return {
    success: false,
    error: "Only Owner, Admin, or Super Admin can manage user accounts.",
    code: "FORBIDDEN",
  };
}

export function sameCompany(a, b) {
  if (a == null && b == null) return true;
  return String(a) === String(b);
}

/** In-memory sliding-window rate limiter (per serverless instance). */
const rateBuckets = new Map();

export function getClientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "";
  const raw = String(forwarded).split(",")[0].trim();
  return raw || req.socket?.remoteAddress || "unknown";
}

export function consumeRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || [];
  const fresh = bucket.filter((ts) => now - ts < windowMs);
  if (fresh.length >= limit) {
    rateBuckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  rateBuckets.set(key, fresh);
  return true;
}

export function rateLimitResponse(res, retryAfterSec = 60) {
  res.setHeader("Retry-After", String(retryAfterSec));
  return res.status(429).json({
    success: false,
    error: "Too many requests. Please wait and try again.",
    code: "RATE_LIMITED",
  });
}

const ALLOWED_ORIGINS = new Set([
  "https://www.httpsnexorapos.com",
  "https://httpsnexorapos.com",
  "https://nexora-pos-eight.vercel.app",
  "https://nexora-pos-nexoraposapp.vercel.app",
]);

function isLocalDevOrigin(origin) {
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

export function isAllowedOrigin(req) {
  const origin = String(req.headers?.origin || "").trim();
  const referer = String(req.headers?.referer || "").trim();
  if (origin && (ALLOWED_ORIGINS.has(origin) || isLocalDevOrigin(origin))) return true;
  if (referer) {
    try {
      const url = new URL(referer);
      if (ALLOWED_ORIGINS.has(url.origin) || isLocalDevOrigin(url.origin)) return true;
      if (url.hostname.endsWith(".vercel.app") && url.hostname.includes("nexora")) return true;
    } catch {
      /* ignore */
    }
  }
  // Allow same-host / server-to-server calls without Origin for safe methods,
  // or when a Bearer token is present (ensure/admin scripts).
  if (!origin && !referer) {
    const method = String(req.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
    const auth = String(req.headers?.authorization || req.headers?.Authorization || "");
    if (/^Bearer\s+\S+/i.test(auth)) return true;
    return false;
  }
  return false;
}

export function sanitizeText(value, maxLen = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, maxLen);
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]
  );
}

export function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", "no-store");
}

// Keep unused helper referenced for parity with prior exports used by callers.
void roleRank;
