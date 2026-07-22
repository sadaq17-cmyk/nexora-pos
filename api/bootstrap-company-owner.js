import {
  applySecurityHeaders,
  consumeRateLimit,
  createAdminClient,
  getClientIp,
  isAllowedOrigin,
  parseBody,
  methodNotAllowed,
  jsonError,
  normalizeRole,
  rateLimitResponse,
  sanitizeText,
  verifyCallerFromRequest,
} from "./_authHelpers.js";
import { ensurePermanentOwnerHandler } from "./_ensurePermanentOwner.js";

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  const body = parseBody(req) || {};
  const ensureRequested =
    body.ensure_permanent === true ||
    body.action === "ensure_permanent" ||
    String(req.query?.ensure || "") === "1" ||
    String(req.url || "").includes("ensure-permanent-owner");

  // Hobby plan function-count: ensure-permanent-owner is served from this route.
  if (ensureRequested) {
    return ensurePermanentOwnerHandler(req, res);
  }

  const verified = await verifyCallerFromRequest(req);
  if (verified.error) return jsonError(res, verified.status, verified.error);

  const ip = getClientIp(req);
  if (!consumeRateLimit(`bootstrap-owner:${verified.caller.id}:${ip}`, 10, 60000)) {
    return rateLimitResponse(res, 60);
  }

  const supabaseUserId = sanitizeText(body.supabase_user_id, 80);
  const email = sanitizeText(body.email, 160).toLowerCase();
  const companyId = body.company_id;
  const username = sanitizeText(body.username, 64).toLowerCase();
  const name = sanitizeText(body.name, 120);
  const phone = sanitizeText(body.phone, 40);
  const branchId = body.branch_id == null ? null : body.branch_id;
  const companyCode = sanitizeText(body.company_code, 32).toUpperCase();
  const companyName = sanitizeText(body.company_name, 120);
  const planCode = sanitizeText(body.plan_code || "free_trial", 40).toLowerCase();
  const trialEndsAt = sanitizeText(body.trial_ends_at, 64);
  const currency = sanitizeText(body.currency || "USD", 8).toUpperCase() || "USD";

  if (!supabaseUserId || !email || companyId == null || companyId === "" || !username || !name) {
    return jsonError(res, 400, "supabase_user_id, email, company_id, username, and name are required.");
  }

  if (String(verified.caller.id) !== String(supabaseUserId)) {
    return jsonError(res, 403, "You can only bootstrap your own account.", "FORBIDDEN");
  }
  if (String(verified.caller.email || "").toLowerCase() !== email) {
    return jsonError(res, 403, "Email does not match the authenticated session.", "FORBIDDEN");
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(supabaseUserId);
    if (error || !data?.user) {
      return jsonError(res, 404, "User not found.", "NOT_FOUND");
    }
    const user = data.user;
    if (String(user.email || "").toLowerCase() !== email) {
      return jsonError(res, 400, "Email does not match the Supabase user.", "EMAIL_MISMATCH");
    }

    const existingRole = user.app_metadata?.role;
    if (existingRole != null && String(existingRole).trim() !== "") {
      if (String(user.app_metadata?.company_id) === String(companyId) && (companyCode || companyName)) {
        const enriched = {
          ...(user.app_metadata || {}),
          ...(companyCode ? { company_code: companyCode } : {}),
          ...(companyName ? { company_name: companyName } : {}),
          ...(planCode ? { plan_code: planCode } : {}),
          ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
          currency,
        };
        const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(supabaseUserId, {
          app_metadata: enriched,
        });
        if (updateError) {
          return jsonError(res, 502, "Unable to update company metadata.", "UPDATE_FAILED");
        }
        return res.status(200).json({
          success: true,
          enriched: true,
          user: {
            id: updated.user.id,
            email: updated.user.email,
            role: normalizeRole(updated.user.app_metadata?.role),
            company_id: updated.user.app_metadata?.company_id,
            company_code: updated.user.app_metadata?.company_code,
            username: updated.user.app_metadata?.username,
          },
        });
      }
      return jsonError(res, 409, "This account is already provisioned.", "ALREADY_PROVISIONED");
    }

    const app_metadata = {
      ...(user.app_metadata || {}),
      role: "owner",
      company_id: companyId,
      branch_id: branchId,
      username,
      name,
      phone,
      active: true,
      created_by_name: "Public signup",
      ...(companyCode ? { company_code: companyCode } : {}),
      ...(companyName ? { company_name: companyName } : {}),
      plan_code: planCode || "free_trial",
      ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
      currency,
    };

    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(supabaseUserId, {
      app_metadata,
      user_metadata: {
        ...(user.user_metadata || {}),
        name,
      },
    });

    if (updateError) {
      console.error("[bootstrap-company-owner] update failed:", updateError);
      return jsonError(res, 502, "Unable to provision company owner metadata.", "UPDATE_FAILED");
    }

    return res.status(200).json({
      success: true,
      user: {
        id: updated.user.id,
        email: updated.user.email,
        role: normalizeRole(updated.user.app_metadata?.role),
        company_id: updated.user.app_metadata?.company_id,
        username: updated.user.app_metadata?.username,
      },
    });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[bootstrap-company-owner]", err);
    return jsonError(res, 500, "Unable to bootstrap company owner.");
  }
}
