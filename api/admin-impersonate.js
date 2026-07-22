import {
  applySecurityHeaders,
  createAdminClient,
  isAllowedOrigin,
  verifyCallerFromRequest,
  parseBody,
  methodNotAllowed,
  jsonError,
  isPlatformOwner,
  isOwner,
  normalizeRole,
  sameCompany,
  safeUserFields,
} from "./_authHelpers.js";

/**
 * Best-effort impersonation: mint a magic-link token for the target user via
 * admin.generateLink. The client consumes the token with verifyOtp.
 *
 * Callers: platform_owner (any non-platform user) or owner (same-company users
 * they can manage). Nested impersonation is rejected client-side.
 */

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  const verified = await verifyCallerFromRequest(req);
  if (verified.error) return jsonError(res, verified.status, verified.error);
  const { caller } = verified;

  if (!isPlatformOwner(caller.role) && !isOwner(caller.role)) {
    return jsonError(res, 403, "Only the Platform Owner or Company Owner can impersonate.", "FORBIDDEN");
  }

  const body = parseBody(req);
  const targetId = String(body.target_id || body.id || "").trim();
  if (!targetId) return jsonError(res, 400, "target_id is required.");
  if (String(targetId) === String(caller.id)) {
    return jsonError(res, 400, "You are already signed in as this user.");
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(targetId);
    if (error || !data?.user) return jsonError(res, 404, "User not found.");

    const target = data.user;
    const targetMeta = target.app_metadata || {};
    const targetRole = normalizeRole(targetMeta.role);

    if (targetMeta.active === false || targetMeta.active === 0) {
      return jsonError(res, 400, "Only active users can be impersonated.");
    }
    if (targetRole === "platform_owner") {
      return jsonError(res, 403, "Platform Owner accounts cannot be impersonated.", "FORBIDDEN");
    }
    if (isOwner(caller.role) && !isPlatformOwner(caller.role)) {
      if (!sameCompany(targetMeta.company_id, caller.company_id)) {
        return jsonError(res, 403, "Cross-company account access is denied.", "FORBIDDEN");
      }
    }

    if (!target.email) {
      return jsonError(res, 400, "Target user has no email address.");
    }

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: target.email,
    });

    if (linkError || !linkData) {
      console.error("[admin-impersonate] generateLink failed:", linkError);
      return jsonError(res, 502, linkError?.message || "Unable to mint impersonation link.");
    }

    const props = linkData.properties || {};
    const hashedToken = props.hashed_token || props.email_otp || null;
    const actionLink = props.action_link || null;

    if (!hashedToken && !actionLink) {
      return jsonError(res, 502, "Impersonation link did not include a usable token.");
    }

    return res.status(200).json({
      success: true,
      hashed_token: hashedToken,
      action_link: actionLink,
      email: target.email,
      user: safeUserFields(target),
      impersonation: {
        owner: { id: caller.id, name: caller.name, email: caller.email, role: caller.role },
        target_id: target.id,
        started_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[admin-impersonate]", err);
    return jsonError(res, 500, "Unable to start impersonation.");
  }
}
