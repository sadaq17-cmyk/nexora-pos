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
  listAllAuthUsers,
} from "./_authHelpers.js";

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST" && req.method !== "DELETE") {
    return methodNotAllowed(res, "POST, DELETE");
  }
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  const verified = await verifyCallerFromRequest(req);
  if (verified.error) return jsonError(res, verified.status, verified.error);
  const { caller } = verified;

  const denied = requireUserManager(caller);
  if (denied) return res.status(403).json(denied);

  const body = parseBody(req);
  const id = String(body.id || (req.query && req.query.id) || "").trim();
  if (!id) return jsonError(res, 400, "User id is required.");
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

    if (!canManageRole(caller.role, targetRole, { allowOwnerPeer })) {
      return jsonError(res, 403, "You cannot manage an equal or higher protected role.", "FORBIDDEN");
    }
    if (!isPlatformOwner(caller.role) && !sameCompany(targetMeta.company_id, caller.company_id)) {
      return jsonError(res, 403, "Cross-company account access is denied.", "FORBIDDEN");
    }

    if (targetMeta.active !== false && targetMeta.active !== 0) {
      const all = await listAllAuthUsers(admin);
      const companyUsers = all.filter((user) => user.id !== id
        && String(user.app_metadata?.company_id) === String(targetMeta.company_id)
        && user.app_metadata?.active !== false
        && user.app_metadata?.active !== 0);

      if (targetRole === "owner") {
        const otherOwners = companyUsers.filter((user) => normalizeRole(user.app_metadata?.role) === "owner");
        if (!otherOwners.length) {
          return jsonError(res, 400, "The final active Owner for this company cannot be removed.");
        }
      }
      if (["owner", "super_admin"].includes(targetRole)) {
        const otherLeaders = companyUsers.filter((user) => ["owner", "super_admin"].includes(normalizeRole(user.app_metadata?.role)));
        if (!otherLeaders.length) {
          return jsonError(res, 400, "A company must retain an active Owner or Super Admin.");
        }
      }
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) {
      console.error("[admin-delete-user]", deleteError);
      return jsonError(res, 502, deleteError.message || "Unable to delete user.");
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[admin-delete-user]", err);
    return jsonError(res, 500, "Unable to delete user.");
  }
}
