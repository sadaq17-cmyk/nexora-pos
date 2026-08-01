import {
  applySecurityHeaders,
  consumeRateLimit,
  createAdminClient,
  ensureUserSynced,
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
import { createCompanyWorkspace, completePublicSignup } from "./_signupCompany.js";

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  const body = parseBody(req) || {};
  const ip = getClientIp(req);

  // Public company code lookup — no Auth session. Used at login so tenants
  // type THEIR company code, never Super Owner NEXORA001 by accident without a match check.
  if (body.action === "resolve_company") {
    if (!consumeRateLimit(`resolve-company:ip:${ip}`, 30, 60_000)) {
      return rateLimitResponse(res, 60);
    }
    const code = sanitizeText(body.company_code || body.company_identifier || body.code, 32).toUpperCase();
    if (!code || code === "PLATFORM") {
      return res.status(200).json({ success: false, error: "Company not found." });
    }
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("companies")
        .select("id,name,code,status")
        .eq("code", code)
        .maybeSingle();
      if (error) {
        console.error("[bootstrap-company-owner] resolve_company", error);
        return jsonError(res, 502, "Unable to resolve company.");
      }
      if (!data || ["deleted", "disabled", "suspended"].includes(String(data.status || "").toLowerCase())) {
        return res.status(200).json({ success: false, error: "Company not found." });
      }
      return res.status(200).json({
        success: true,
        company: {
          id: data.id,
          name: data.name,
          code: data.code,
          status: data.status,
          logo: "",
        },
      });
    } catch (err) {
      console.error("[bootstrap-company-owner] resolve_company", err);
      return jsonError(res, 500, "Unable to resolve company.");
    }
  }

  const publicSignupRequested =
    body.action === "public_signup" || body.public_signup === true;
  if (publicSignupRequested) {
    if (!consumeRateLimit(`public-signup:ip:${ip}`, 5, 60 * 60_000)) {
      return rateLimitResponse(res, 60);
    }
    const emailKey = String(body.email || "").trim().toLowerCase();
    if (emailKey && !consumeRateLimit(`public-signup:email:${emailKey}`, 3, 10 * 60_000)) {
      return rateLimitResponse(res, 60);
    }
    try {
      const result = await completePublicSignup(body, { ip });
      return res.status(result.status || 200).json(result.body);
    } catch (err) {
      if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
      console.error("[bootstrap-company-owner] public_signup", err);
      return jsonError(res, 500, "Unable to complete signup right now. Please try again.");
    }
  }

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

  // Hobby plan: signup company creation shares this route (no extra serverless function).
  const signupRequested =
    body.action === "signup_company" ||
    body.create_company === true ||
    Boolean(body.company_name && body.supabase_user_id && !body.company_id);

  if (signupRequested && (body.action === "signup_company" || body.create_company === true)) {
    if (!consumeRateLimit(`signup-company:${verified.caller.id}:${ip}`, 5, 60000)) {
      return rateLimitResponse(res, 60);
    }
    try {
      const result = await createCompanyWorkspace({ caller: verified.caller, body });
      return res.status(result.status || 200).json(result.body);
    } catch (err) {
      console.error("[bootstrap-company-owner] signup_company", err);
      return jsonError(res, 500, err?.message || "Unable to create company workspace.");
    }
  }

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
      // Already provisioned — only allow metadata enrichment for the caller's own company.
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
        try {
          await ensureUserSynced(admin, {
            id: updated.user.id,
            email: updated.user.email || email,
            name: updated.user.app_metadata?.name || name || updated.user.email,
            role: normalizeRole(updated.user.app_metadata?.role) || "owner",
            company_id: updated.user.app_metadata?.company_id ?? companyId,
            branch_id: updated.user.app_metadata?.branch_id ?? branchId,
            username: updated.user.app_metadata?.username || username,
            active: true,
          });
        } catch (syncErr) {
          console.error("[bootstrap-company-owner] enrich profile sync", syncErr);
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

    // Empty-role claim path: never allow arbitrary company_id takeover.
    // Prefer signup_company (createCompanyWorkspace). Legacy bootstrap is only allowed when
    // the company row exists, has no other owner, and email matches the authenticated user.
    const { data: companyRow, error: companyLookupError } = await admin
      .from("companies")
      .select("id, owner_user_id, email, status")
      .eq("id", companyId)
      .maybeSingle();
    if (companyLookupError && companyLookupError.code !== "PGRST116") {
      console.error("[bootstrap-company-owner] company lookup", companyLookupError);
      return jsonError(res, 502, "Unable to verify company ownership.", "LOOKUP_FAILED");
    }
    if (!companyRow) {
      return jsonError(
        res,
        403,
        "Use company signup to create a new workspace. Arbitrary company_id claims are not allowed.",
        "FORBIDDEN"
      );
    }
    const ownerId = companyRow.owner_user_id;
    if (ownerId && String(ownerId) !== String(supabaseUserId)) {
      return jsonError(res, 403, "This company already has an owner.", "FORBIDDEN");
    }
    const companyEmail = String(companyRow.email || "").toLowerCase();
    if (companyEmail && companyEmail !== email) {
      return jsonError(res, 403, "Company email does not match the authenticated user.", "FORBIDDEN");
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

    try {
      await ensureUserSynced(admin, {
        id: updated.user.id,
        email: updated.user.email || email,
        name,
        role: "owner",
        company_id: companyId,
        branch_id: branchId,
        username,
        active: true,
      });
    } catch (syncErr) {
      console.error("[bootstrap-company-owner] profile sync", syncErr);
      return jsonError(
        res,
        502,
        `Owner provisioned but profile sync failed: ${syncErr?.message || "unknown"}`,
        "PROFILE_SYNC"
      );
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
