import {
  applySecurityHeaders,
  createAdminClient,
  beginApiRequest,
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
  escapeHtml,
} from "./_authHelpers.js";
import { sendOutboundEmail } from "./_mailTransport.js";

async function notifyPasswordChanged({ to, name }) {
  try {
    const safeName = escapeHtml(name || "there");
    const support = "support@httpsnexorapos.com";
    await sendOutboundEmail({
      to,
      subject: "Your Nexora POS Pro password was changed",
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0B1C3D">
        <p style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#2563EB;margin:0 0 20px">Nexora POS Pro</p>
        <h1 style="font-size:20px;margin:0 0 16px">Hi ${safeName},</h1>
        <p style="font-size:14px;line-height:22px;margin:0 0 16px">Your Nexora POS Pro password was just changed by an administrator.</p>
        <p style="font-size:14px;line-height:22px;margin:0;font-weight:600">If you did not expect this, contact ${support} immediately.</p>
      </div>`,
      text: [
        `Hi ${name || "there"},`,
        "Your Nexora POS Pro password was just changed by an administrator.",
        `If you did not expect this, contact ${support} immediately.`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("[admin-reset-password] password_changed email error:", err?.message || err);
  }
}

export default async function handler(req, res) {
  if (beginApiRequest(req, res, { methods: ["POST"] })) return;

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

    void notifyPasswordChanged({
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
