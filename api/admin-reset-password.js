import {
  applySecurityHeaders,
  createAdminClient,
  isAllowedOrigin,
  verifyCallerFromRequest,
  parseBody,
  methodNotAllowed,
  jsonError,
  requireUserManager,
  canManageRole,
  isPlatformOwner,
  normalizeRole,
  sameCompany,
} from "./_authHelpers.js";

async function notifyPasswordChanged(req, { to, name }) {
  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = host ? `${proto}://${host}` : "https://www.httpsnexorapos.com";
    fetch(`${origin}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "password_changed", to, name }),
    }).then(async (response) => {
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error("[admin-reset-password] password_changed email failed:", response.status, text);
      }
    }).catch((err) => {
      console.error("[admin-reset-password] password_changed email error:", err);
    });
  } catch (err) {
    console.error("[admin-reset-password] notify setup failed:", err);
  }
}

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  const verified = await verifyCallerFromRequest(req);
  if (verified.error) return jsonError(res, verified.status, verified.error);
  const { caller } = verified;

  const denied = requireUserManager(caller);
  if (denied) return res.status(403).json(denied);

  const body = parseBody(req);
  const id = String(body.id || "").trim();
  const password = String(body.password || "");
  if (!id) return jsonError(res, 400, "User id is required.");
  if (password.length < 8) return jsonError(res, 400, "Password must be at least 8 characters.");
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return jsonError(
      res,
      400,
      "Password must include upper & lower case letters, a number, and a special character."
    );
  }
  if (String(id) === String(caller.id)) {
    return jsonError(res, 403, "You cannot perform this action on your own account.");
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error || !data?.user) return jsonError(res, 404, "User not found.");

    const target = data.user;
    const targetMeta = target.app_metadata || {};
    const targetRole = normalizeRole(targetMeta.role);
    const allowOwnerPeer = isPlatformOwner(caller.role);

    if (targetRole === "owner" && !isPlatformOwner(caller.role)) {
      return jsonError(
        res,
        403,
        "Admin, Manager, and Cashier cannot change the Company Owner password.",
        "OWNER_CREDENTIALS_LOCKED"
      );
    }
    if (!canManageRole(caller.role, targetRole, { allowOwnerPeer })) {
      return jsonError(res, 403, "You cannot manage an equal or higher protected role.", "FORBIDDEN");
    }
    if (!isPlatformOwner(caller.role) && !sameCompany(targetMeta.company_id, caller.company_id)) {
      return jsonError(res, 403, "Cross-company account access is denied.", "FORBIDDEN");
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(id, {
      password,
      app_metadata: {
        ...targetMeta,
        must_change_password: true,
      },
    });
    if (updateError) {
      console.error("[admin-reset-password]", updateError);
      return jsonError(res, 502, updateError.message || "Unable to reset password.");
    }

    notifyPasswordChanged(req, {
      to: target.email,
      name: targetMeta.name || target.user_metadata?.name || "",
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[admin-reset-password]", err);
    return jsonError(res, 500, "Unable to reset password.");
  }
}
