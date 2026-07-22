import {
  applySecurityHeaders,
  consumeRateLimit,
  createAdminClient,
  getClientIp,
  isAllowedOrigin,
  listAllAuthUsers,
  parseBody,
  methodNotAllowed,
  jsonError,
  rateLimitResponse,
} from "./_authHelpers.js";

/**
 * Permanent account bootstrap — passwords MUST come from server env.
 * In production this endpoint also requires ENSURE_OWNER_SECRET.
 */

function requireEnvPassword(name) {
  const value = String(process.env[name] || "").trim();
  if (!value || value.length < 8) {
    const err = new Error(
      `${name} is not configured. Set a strong password in server environment variables.`
    );
    err.code = "CONFIG";
    throw err;
  }
  return value;
}

function isProductionRuntime() {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    String(process.env.ENSURE_OWNER_REQUIRE_SECRET || "").toLowerCase() === "true"
  );
}

function assertEnsureAuthorized(req, body) {
  const secret = String(process.env.ENSURE_OWNER_SECRET || "").trim();
  if (!isProductionRuntime()) {
    // Non-production: allow without secret only when explicitly opted in for local ops.
    if (!secret) return;
  }
  if (!secret || secret.length < 16) {
    const err = new Error(
      "ENSURE_OWNER_SECRET must be set (min 16 chars) before ensuring permanent owners in production."
    );
    err.code = "CONFIG";
    throw err;
  }
  const provided =
    String(req.headers?.["x-ensure-owner-secret"] || "").trim() ||
    String(body?.ensure_secret || "").trim();
  if (!provided || provided !== secret) {
    const err = new Error("Unauthorized ensure-permanent-owner request.");
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }
}

/** Permanent Company Owner: Owner@Honest on NEXORA001 (official Zoho inbox) */
const COMPANY_OWNER = {
  username: "owner@honest",
  displayUsername: "Owner@Honest",
  email: "support@httpsnexorapos.com",
  name: "Honest Company Owner",
  role: "owner",
  company_id: 1,
  company_code: "NEXORA001",
  company_name: "Nexora POS Enterprise",
  branch_id: 1,
  knownId: "3220e336-22c2-4ef6-8a42-198b5059bedb",
};

const LEGACY_OWNER_EMAILS = new Set([
  "owner.honest@nexorapos.demo",
  "companyowner@nexora.demo",
]);

/** Permanent Platform Super Admin — global, no company */
const PLATFORM_ADMIN = {
  username: "SuperAdmin",
  email: "saadaq17@icloud.com",
  name: "Platform Super Admin",
  role: "platform_owner",
};

function companyOwnerMetadata() {
  return {
    role: COMPANY_OWNER.role,
    company_id: COMPANY_OWNER.company_id,
    branch_id: COMPANY_OWNER.branch_id,
    username: COMPANY_OWNER.displayUsername,
    name: COMPANY_OWNER.name,
    phone: "",
    active: true,
    company_code: COMPANY_OWNER.company_code,
    company_name: COMPANY_OWNER.company_name,
    plan_code: "enterprise",
    currency: "KES",
    created_by_name: "Permanent seed",
    permanent: true,
  };
}

function platformAdminMetadata(existingMeta = {}) {
  const next = {
    ...(existingMeta || {}),
    role: PLATFORM_ADMIN.role,
    company_id: null,
    branch_id: null,
    username: PLATFORM_ADMIN.username,
    name: PLATFORM_ADMIN.name,
    phone: "",
    active: true,
    permanent: true,
    platform_super_admin: true,
  };
  if (existingMeta?.must_change_password === false) {
    next.must_change_password = false;
  } else {
    next.must_change_password = true;
  }
  return next;
}

async function ensureCompanyOwner(admin) {
  let existing = null;
  const byId = await admin.auth.admin.getUserById(COMPANY_OWNER.knownId);
  if (byId?.data?.user) existing = byId.data.user;

  if (existing) {
    const meta = existing.app_metadata || {};
    const currentEmail = String(existing.email || "").trim().toLowerCase();
    // CRITICAL: never overwrite email or password for an existing owner after login/ensure.
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      email_confirm: true,
      ban_duration: "none",
      app_metadata: {
        ...meta,
        ...companyOwnerMetadata(),
        email_customized: true,
        email_changed_at: meta.email_changed_at || null,
        password_changed_at: meta.password_changed_at || null,
        pending_email_change: meta.pending_email_change || null,
        must_change_password: meta.must_change_password,
      },
      user_metadata: {
        ...(existing.user_metadata || {}),
        name: meta.name || COMPANY_OWNER.name,
      },
    });
    if (error) throw Object.assign(new Error(error.message || "Company owner update failed"), { code: "UPDATE_FAILED" });
    return {
      user_id: data.user.id,
      created: false,
      email: data.user.email || currentEmail,
      email_preserved: true,
      legacy_demo_email: LEGACY_OWNER_EMAILS.has(currentEmail),
    };
  }

  const password = requireEnvPassword("PERMANENT_COMPANY_OWNER_PASSWORD");
  const { data, error } = await admin.auth.admin.createUser({
    email: COMPANY_OWNER.email,
    password,
    email_confirm: true,
    app_metadata: companyOwnerMetadata(),
    user_metadata: { name: COMPANY_OWNER.name },
  });
  if (error) throw Object.assign(new Error(error.message || "Company owner create failed"), { code: "CREATE_FAILED" });
  return { user_id: data.user.id, created: true, email: data.user.email || COMPANY_OWNER.email };
}

async function ensurePlatformAdmin(admin, { forcePassword = false } = {}) {
  const users = await listAllAuthUsers(admin);
  let existing = users.find(
    (user) => String(user.email || "").toLowerCase() === PLATFORM_ADMIN.email.toLowerCase()
  ) || null;

  if (!existing) {
    existing = users.find((user) => {
      const meta = user.app_metadata || {};
      return String(meta.username || "").toLowerCase() === PLATFORM_ADMIN.username.toLowerCase()
        && String(meta.role || "").toLowerCase() === "platform_owner";
    }) || null;
  }

  if (existing) {
    const meta = existing.app_metadata || {};
    const alreadyChanged = meta.must_change_password === false && !forcePassword;
    const updatePayload = {
      email: PLATFORM_ADMIN.email,
      email_confirm: true,
      ban_duration: "none",
      app_metadata: platformAdminMetadata(forcePassword ? {} : meta),
      user_metadata: { ...(existing.user_metadata || {}), name: PLATFORM_ADMIN.name },
    };
    if (!alreadyChanged || forcePassword) {
      updatePayload.password = requireEnvPassword("PERMANENT_PLATFORM_ADMIN_PASSWORD");
      updatePayload.app_metadata.must_change_password = true;
    } else {
      updatePayload.app_metadata.must_change_password = false;
    }
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, updatePayload);
    if (error) throw Object.assign(new Error(error.message || "Platform admin update failed"), { code: "UPDATE_FAILED" });
    return { user_id: data.user.id, created: false, password_synced: !alreadyChanged || forcePassword };
  }

  const password = requireEnvPassword("PERMANENT_PLATFORM_ADMIN_PASSWORD");
  const { data, error } = await admin.auth.admin.createUser({
    email: PLATFORM_ADMIN.email,
    password,
    email_confirm: true,
    app_metadata: platformAdminMetadata({ must_change_password: true }),
    user_metadata: { name: PLATFORM_ADMIN.name },
  });
  if (error) throw Object.assign(new Error(error.message || "Platform admin create failed"), { code: "CREATE_FAILED" });
  return { user_id: data.user.id, created: true, password_synced: true };
}

export async function ensurePermanentOwnerHandler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");
  const body = parseBody(req) || {};

  const ip = getClientIp(req);
  if (!consumeRateLimit(`ensure-owner:${ip}`, 10, 60000)) {
    return rateLimitResponse(res, 60);
  }

  try {
    assertEnsureAuthorized(req, body);
    const admin = createAdminClient();
    const forcePassword = body.force_platform_password === true;
    const [company, platform] = await Promise.all([
      ensureCompanyOwner(admin),
      ensurePlatformAdmin(admin, { forcePassword }),
    ]);

    return res.status(200).json({
      success: true,
      ensured: true,
      company_owner: {
        created: company.created,
        email: company.email || COMPANY_OWNER.email,
        email_preserved: company.email_preserved === true,
        username: COMPANY_OWNER.displayUsername,
        company_code: COMPANY_OWNER.company_code,
        user_id: company.user_id,
      },
      platform_admin: {
        created: platform.created,
        email: PLATFORM_ADMIN.email,
        username: PLATFORM_ADMIN.username,
        role: PLATFORM_ADMIN.role,
        user_id: platform.user_id,
        password_synced: platform.password_synced,
      },
      created: company.created,
      email: company.email || COMPANY_OWNER.email,
      email_preserved: company.email_preserved === true,
      username: COMPANY_OWNER.displayUsername,
      company_code: COMPANY_OWNER.company_code,
      user_id: company.user_id,
    });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    if (err?.code === "FORBIDDEN") return jsonError(res, err.status || 403, err.message, "FORBIDDEN");
    console.error("[ensure-permanent-owner]", err);
    return jsonError(res, 500, err?.message || "Unable to ensure permanent accounts.");
  }
}

export default ensurePermanentOwnerHandler;
