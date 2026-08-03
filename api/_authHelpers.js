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

function raceTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(message);
      err.code = "TIMEOUT";
      reject(err);
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
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
    const { data, error } = await raceTimeout(
      anon.auth.getUser(token),
      8_000,
      "Session verification timed out."
    );
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
    if (err?.code === "TIMEOUT") return { error: err.message || "Session verification timed out.", status: 504 };
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
  "https://www.nexorapospro.com",
  "https://nexorapospro.com",
  "https://nexora-pos-eight.vercel.app",
  "https://nexora-pos-nexoraposapp.vercel.app",
]);

/** Must match src/lib/desktopRuntime.js + electron/preload.cjs */
export const NEXORA_DESKTOP_ATTESTATION = "nexora-desktop-v1";

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

/**
 * Electron file:// shell sends Origin: "null". Allow only when our desktop
 * attestation header is present (or requested on CORS preflight).
 */
export function isDesktopAttested(req) {
  const origin = String(req.headers?.origin || "").trim();
  const method = String(req.method || "GET").toUpperCase();
  const attestation = String(req.headers?.["x-nexora-desktop"] || "").trim();
  const nullishOrigin = !origin || origin === "null";

  if (attestation === NEXORA_DESKTOP_ATTESTATION && nullishOrigin) return true;

  // Preflight does not include custom headers — only Access-Control-Request-Headers.
  if (method === "OPTIONS" && nullishOrigin) {
    const requested = String(req.headers?.["access-control-request-headers"] || "").toLowerCase();
    if (requested.split(",").some((h) => h.trim() === "x-nexora-desktop")) return true;
  }
  return false;
}

export function applyCorsHeaders(req, res) {
  const origin = String(req.headers?.origin || "").trim();
  if (origin && (ALLOWED_ORIGINS.has(origin) || isLocalDevOrigin(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (isDesktopAttested(req)) {
    // Chromium file:// → Origin: null
    res.setHeader("Access-Control-Allow-Origin", "null");
    res.setHeader("Vary", "Origin");
  } else if (origin && origin.endsWith(".vercel.app") && origin.includes("nexora")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Nexora-Desktop"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * Security headers + CORS + OPTIONS + method/origin gate.
 * Returns true when the response was already ended (caller must return).
 */
export function beginApiRequest(req, res, { methods = ["POST"] } = {}) {
  applySecurityHeaders(res);
  applyCorsHeaders(req, res);
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  const allowed = methods.map((m) => String(m).toUpperCase());
  if (!allowed.includes(method)) {
    methodNotAllowed(res, allowed.join(", "));
    return true;
  }
  if (!isAllowedOrigin(req)) {
    jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");
    return true;
  }
  return false;
}

export function isAllowedOrigin(req) {
  if (isDesktopAttested(req)) return true;

  const origin = String(req.headers?.origin || "").trim();
  const referer = String(req.headers?.referer || "").trim();
  if (origin && (ALLOWED_ORIGINS.has(origin) || isLocalDevOrigin(origin))) return true;
  if (referer) {
    try {
      const url = new URL(referer);
      if (ALLOWED_ORIGINS.has(url.origin) || isLocalDevOrigin(url.origin)) return true;
      if (url.hostname.endsWith(".vercel.app") && url.hostname.includes("nexora")) return true;
      if (url.hostname === "nexorapospro.com" || url.hostname.endsWith(".nexorapospro.com")) return true;
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
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  res.setHeader("Cache-Control", "no-store");
  // HSTS is primarily set at the edge (vercel.json); reinforce on API responses.
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
}

/**
 * sales.user_id FK → public.profiles(id) (public app user row; id === auth.users.id).
 * Auth-only accounts (ensure-permanent-owner, signup bootstrap, legacy seeds) may lack
 * a profiles row — sync before any sales insert so the FK never fails.
 */
const PROFILE_ROLE_FALLBACKS = Object.freeze([
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

function profileRoleForSync(role) {
  const normalized = normalizeRole(role);
  if (PROFILE_ROLE_FALLBACKS.includes(normalized)) return normalized;
  if (["owner", "admin", "cashier"].includes(normalized)) return normalized;
  return "cashier";
}

function uniqueProfileEmail(preferred, authUserId) {
  const base = String(preferred || "").trim().toLowerCase();
  if (base && base.includes("@")) return base;
  return `${String(authUserId).replace(/-/g, "").slice(0, 20)}@nexora.local`;
}

/**
 * Ensure auth.users.id has a matching public.profiles row (same UUID).
 * Returns the public profile id to use as sales.user_id / cashier id.
 * Never returns null when caller.id is present — throws instead.
 */
export async function ensureUserSynced(admin, caller, extras = {}) {
  const authUserId = caller?.id ? String(caller.id).trim() : "";
  if (!authUserId) {
    const err = new Error("Cannot sync user: missing auth user id.");
    err.code = "UNAUTHENTICATED";
    throw err;
  }

  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id,name,email,role,company_id,branch_id,username,active")
    .eq("id", authUserId)
    .maybeSingle();

  if (lookupError) {
    const msg = String(lookupError.message || lookupError.code || "");
    // Table missing is a deploy/schema issue — surface clearly.
    if (/relation|does not exist|PGRST205|schema cache/i.test(msg)) {
      const err = new Error("public.profiles is missing; cannot satisfy sales.user_id FK.");
      err.code = "SCHEMA";
      err.cause = lookupError;
      throw err;
    }
    throw lookupError;
  }

  if (existing?.id) {
    return {
      authUserId,
      publicUserId: String(existing.id),
      profile: existing,
      created: false,
    };
  }

  // Prefer live auth record for email/name when available.
  let authUser = null;
  try {
    const { data } = await admin.auth.admin.getUserById(authUserId);
    authUser = data?.user || null;
  } catch {
    authUser = null;
  }

  const meta = authUser?.app_metadata || {};
  const role = profileRoleForSync(caller.role || meta.role);
  const email = uniqueProfileEmail(
    caller.email || authUser?.email || meta.email,
    authUserId
  );
  const name =
    String(caller.name || meta.name || authUser?.user_metadata?.name || email || "User").trim() ||
    "User";
  const companyId =
    extras.company_id != null && extras.company_id !== ""
      ? extras.company_id
      : caller.company_id != null && caller.company_id !== ""
        ? caller.company_id
        : meta.company_id != null && meta.company_id !== ""
          ? meta.company_id
          : null;
  const branchId =
    extras.branch_id != null && extras.branch_id !== ""
      ? extras.branch_id
      : caller.branch_id != null && caller.branch_id !== ""
        ? caller.branch_id
        : meta.branch_id != null && meta.branch_id !== ""
          ? meta.branch_id
          : null;

  const fullPayload = {
    id: authUserId,
    name,
    email,
    role,
    active: caller.active !== false && meta.active !== false && meta.active !== 0,
    branch_id: isPlatformOwner(role) ? null : branchId,
    company_id: isPlatformOwner(role) ? null : companyId,
    username: String(caller.username || meta.username || "").trim() || null,
  };

  let { data: upserted, error: upsertError } = await admin
    .from("profiles")
    .upsert(fullPayload, { onConflict: "id" })
    .select("id,name,email,role,company_id,branch_id,username,active")
    .maybeSingle();

  // Narrow schema / role check / email unique — retry with minimal compatible row.
  if (upsertError) {
    const msg = String(upsertError.message || upsertError.code || "");
    const slimRole = ["owner", "admin", "cashier"].includes(role)
      ? role
      : role === "platform_owner" || role === "super_admin"
        ? "owner"
        : "cashier";
    const slimEmail = /duplicate|unique|email/i.test(msg)
      ? `${String(authUserId).replace(/-/g, "")}@nexora.local`
      : email;
    const slim = {
      id: authUserId,
      name,
      email: slimEmail,
      role: slimRole,
      active: true,
    };
    ({ data: upserted, error: upsertError } = await admin
      .from("profiles")
      .upsert(slim, { onConflict: "id" })
      .select("id,name,email,role,company_id,branch_id,username,active")
      .maybeSingle());
  }

  if (upsertError) {
    console.error("[ensureUserSynced] profiles upsert failed", {
      auth_user_id: authUserId,
      error: upsertError.message || upsertError,
    });
    const err = new Error(
      `Unable to sync public.profiles for sales.user_id: ${upsertError.message || "upsert failed"}`
    );
    err.code = "PROFILE_SYNC";
    err.cause = upsertError;
    throw err;
  }

  // Confirm row exists even if select returned null (some PostgREST configs).
  if (!upserted?.id) {
    const { data: confirmed, error: confirmError } = await admin
      .from("profiles")
      .select("id,name,email,role,company_id,branch_id,username,active")
      .eq("id", authUserId)
      .maybeSingle();
    if (confirmError || !confirmed?.id) {
      const err = new Error("Profile sync did not create a public.profiles row.");
      err.code = "PROFILE_SYNC";
      throw err;
    }
    upserted = confirmed;
  }

  console.info("[ensureUserSynced] created public.profiles row", {
    auth_user_id: authUserId,
    public_user_id: upserted.id,
    company_id: upserted.company_id ?? companyId,
    branch_id: upserted.branch_id ?? branchId,
  });

  return {
    authUserId,
    publicUserId: String(upserted.id),
    profile: upserted,
    created: true,
  };
}

/** Resolve sales.user_id (public.profiles.id). Creates the profile if missing. */
export async function resolvePublicUserId(admin, caller, extras = {}) {
  const synced = await ensureUserSynced(admin, caller, extras);
  return synced.publicUserId;
}

// Keep unused helper referenced for parity with prior exports used by callers.
void roleRank;
