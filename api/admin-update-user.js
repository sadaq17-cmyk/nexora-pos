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
  isOwner,
  normalizeRole,
  listAllAuthUsers,
  sameCompany,
} from "./_authHelpers.js";

import { isValidEmailAddress } from "./_mailTransport.js";

const validUsername = (value) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(value);
const validEmail = (value) => isValidEmailAddress(value);
const validPhone = (value) => !value || /^\+?[\d\s().-]{7,20}$/.test(value);

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") {
    return methodNotAllowed(res, "POST, PUT, PATCH");
  }
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  const verified = await verifyCallerFromRequest(req);
  if (verified.error) return jsonError(res, verified.status, verified.error);
  const { caller } = verified;

  const body = parseBody(req);

  // Self-service: clear force-password-change flag after a successful password update.
  if (body.action === "clear_must_change_password") {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.auth.admin.getUserById(caller.id);
      if (error || !data?.user) return jsonError(res, 404, "User not found.");
      const meta = data.user.app_metadata || {};
      const { error: updateError } = await admin.auth.admin.updateUserById(caller.id, {
        app_metadata: {
          ...meta,
          must_change_password: false,
          password_changed_at: new Date().toISOString(),
        },
      });
      if (updateError) return jsonError(res, 502, updateError.message || "Unable to update password flags.");
      await admin.from("profiles").update({
        must_change_password: false,
      }).eq("id", caller.id);
      return res.status(200).json({ success: true, must_change_password: false });
    } catch (err) {
      if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
      console.error("[admin-update-user] clear_must_change_password", err);
      return jsonError(res, 500, "Unable to clear password change flag.");
    }
  }

  // Account lifecycle controls (Owner/Admin)
  const CONTROL_ACTIONS = new Set([
    "activate", "deactivate", "suspend", "unlock", "force_logout",
    "force_password_change", "enable_login", "disable_login",
  ]);
  if (CONTROL_ACTIONS.has(String(body.action || ""))) {
    const denied = requireUserManager(caller);
    if (denied) return res.status(403).json(denied);
    const id = String(body.id || "").trim();
    if (!id) return jsonError(res, 400, "User id is required.");
    if (String(id) === String(caller.id) && ["deactivate", "suspend", "disable_login", "force_logout"].includes(body.action)) {
      return jsonError(res, 403, "You cannot perform this action on your own account.");
    }
    try {
      const admin = createAdminClient();
      const { data: existingData, error: getError } = await admin.auth.admin.getUserById(id);
      if (getError || !existingData?.user) return jsonError(res, 404, "User not found.");
      const target = existingData.user;
      const targetMeta = target.app_metadata || {};
      const targetRole = normalizeRole(targetMeta.role);
      const allowOwnerPeer = isPlatformOwner(caller.role);
      if (String(target.id) !== String(caller.id)) {
        if (!canManageRole(caller.role, targetRole, { allowOwnerPeer })) {
          return jsonError(res, 403, "You cannot manage an equal or higher protected role.", "FORBIDDEN");
        }
        if (!isPlatformOwner(caller.role) && !sameCompany(targetMeta.company_id, caller.company_id)) {
          return jsonError(res, 403, "Cross-company account access is denied.", "FORBIDDEN");
        }
      }
      const next = { ...targetMeta };
      const action = String(body.action);
      if (action === "activate") {
        next.account_status = "active";
        next.active = true;
        next.login_enabled = true;
        next.locked_until = null;
        next.failed_login_count = 0;
      } else if (action === "deactivate") {
        next.account_status = "inactive";
        next.active = false;
      } else if (action === "suspend") {
        next.account_status = "suspended";
        next.active = false;
        next.login_enabled = false;
      } else if (action === "unlock") {
        next.account_status = "active";
        next.active = true;
        next.login_enabled = true;
        next.locked_until = null;
        next.failed_login_count = 0;
      } else if (action === "force_logout") {
        next.force_logout_at = new Date().toISOString();
        next.session_version = Number(next.session_version || 0) + 1;
      } else if (action === "force_password_change") {
        next.must_change_password = true;
      } else if (action === "enable_login") {
        next.login_enabled = true;
        if (next.account_status === "inactive" || next.account_status === "locked") {
          next.account_status = "active";
          next.active = true;
        }
      } else if (action === "disable_login") {
        next.login_enabled = false;
      }
      const { error: updateError } = await admin.auth.admin.updateUserById(id, { app_metadata: next });
      if (updateError) return jsonError(res, 502, updateError.message || "Unable to update account.");
      const profilePatch = {
        account_status: next.account_status,
        active: !!next.active,
        login_enabled: next.login_enabled !== false,
        must_change_password: !!next.must_change_password,
        force_logout_at: next.force_logout_at || null,
        locked_until: next.locked_until || null,
        failed_login_count: Number(next.failed_login_count || 0),
      };
      await admin.from("profiles").update(profilePatch).eq("id", id);
      return res.status(200).json({ success: true, action, account_status: next.account_status });
    } catch (err) {
      if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
      console.error("[admin-update-user] control action", err);
      return jsonError(res, 500, "Unable to update account controls.");
    }
  }

  const denied = requireUserManager(caller);
  if (denied) return res.status(403).json(denied);

  const id = String(body.id || "").trim();
  if (!id) return jsonError(res, 400, "User id is required.");

  try {
    const admin = createAdminClient();
    const { data: existingData, error: getError } = await admin.auth.admin.getUserById(id);
    if (getError || !existingData?.user) return jsonError(res, 404, "User not found.");

    const target = existingData.user;
    const targetMeta = target.app_metadata || {};
    const targetRole = normalizeRole(targetMeta.role);
    const nextRole = body.role !== undefined ? normalizeRole(body.role) : targetRole;
    const nextActive = body.active === undefined
      ? !(targetMeta.active === false || targetMeta.active === 0)
      : !!(body.active === true || body.active === 1);

    if (String(target.id) === String(caller.id)) {
      if (nextRole !== targetRole || !nextActive) {
        return jsonError(res, 403, "You cannot demote or deactivate your own account.");
      }
    } else {
      const allowOwnerPeer = isPlatformOwner(caller.role);
      if (!canManageRole(caller.role, targetRole, { allowOwnerPeer })) {
        return jsonError(res, 403, "You cannot manage an equal or higher protected role.", "FORBIDDEN");
      }
      if (!canManageRole(caller.role, nextRole, { allowOwnerPeer })) {
        return jsonError(res, 403, "You cannot assign that protected role.", "FORBIDDEN");
      }
      if (!isPlatformOwner(caller.role) && !sameCompany(targetMeta.company_id, caller.company_id)) {
        return jsonError(res, 403, "Cross-company account access is denied.", "FORBIDDEN");
      }
    }

    const username = String(body.username ?? targetMeta.username ?? "").trim().toLowerCase();
    const email = String(body.email ?? target.email ?? "").trim().toLowerCase();
    const phone = String(body.phone ?? targetMeta.phone ?? "").trim();
    const name = String(body.name ?? targetMeta.name ?? "").trim();
    const emailChanging = email !== String(target.email || "").toLowerCase();
    const employeeId = body.employee_id !== undefined
      ? String(body.employee_id || "").trim().slice(0, 64)
      : (targetMeta.employee_id || "");
    const department = body.department !== undefined
      ? String(body.department || "").trim().slice(0, 120)
      : (targetMeta.department || "");
    const position = body.position !== undefined
      ? String(body.position || "").trim().slice(0, 120)
      : (targetMeta.position || "");
    const address = body.address !== undefined
      ? String(body.address || "").trim().slice(0, 240)
      : (targetMeta.address || "");
    const nationalId = body.national_id !== undefined
      ? String(body.national_id || "").trim().slice(0, 64)
      : (targetMeta.national_id || "");
    let accountStatus = body.account_status !== undefined
      ? String(body.account_status || "").toLowerCase()
      : String(targetMeta.account_status || (nextActive ? "active" : "inactive")).toLowerCase();
    if (!["active", "inactive", "suspended", "locked"].includes(accountStatus)) {
      accountStatus = nextActive ? "active" : "inactive";
    }
    if (body.active !== undefined) {
      accountStatus = nextActive ? (accountStatus === "suspended" || accountStatus === "locked" ? accountStatus : "active") : "inactive";
      if (nextActive && (accountStatus === "inactive")) accountStatus = "active";
      if (!nextActive && accountStatus === "active") accountStatus = "inactive";
    }
    const loginEnabled = body.login_enabled === undefined
      ? (targetMeta.login_enabled === false || targetMeta.login_enabled === 0 ? false : accountStatus === "active")
      : !!(body.login_enabled === true || body.login_enabled === 1);
    const mustChangePassword = body.must_change_password === undefined
      ? !!targetMeta.must_change_password
      : !!(body.must_change_password === true || body.must_change_password === 1);

    // Company Owner credentials: Admin / Manager / Cashier (and non-owner peers) cannot change them.
    if (
      targetRole === "owner"
      && emailChanging
      && !isPlatformOwner(caller.role)
      && !(isOwner(caller.role) && String(caller.id) === String(target.id))
    ) {
      return jsonError(
        res,
        403,
        "Only the Company Owner can change their own email address.",
        "OWNER_CREDENTIALS_LOCKED"
      );
    }

    if (!name || !validUsername(username)) return jsonError(res, 400, "Enter a valid full name and username.");
    if (!validEmail(email)) return jsonError(res, 400, "Enter a valid email address.");
    if (!validPhone(phone)) return jsonError(res, 400, "Enter a valid phone number.");

    const all = await listAllAuthUsers(admin);
    const companyId = isPlatformOwner(caller.role) && body.company_id !== undefined
      ? body.company_id
      : targetMeta.company_id;

    if (all.some((user) => user.id !== id
      && String(user.app_metadata?.company_id) === String(companyId)
      && String(user.app_metadata?.username || "").toLowerCase() === username)) {
      return jsonError(res, 409, "That username is already in use.");
    }
    if (all.some((user) => user.id !== id && String(user.email || "").toLowerCase() === email)) {
      return jsonError(res, 409, "That email address is already in use.");
    }

    const effectiveActive = accountStatus === "active" && loginEnabled;
    const app_metadata = {
      ...targetMeta,
      role: nextRole,
      username,
      name,
      phone,
      active: effectiveActive,
      account_status: accountStatus,
      login_enabled: loginEnabled,
      must_change_password: mustChangePassword,
      employee_id: employeeId,
      department,
      position,
      address,
      national_id: nationalId,
      branch_id: body.branch_id !== undefined ? body.branch_id : targetMeta.branch_id,
      profile_photo: body.profile_photo !== undefined ? String(body.profile_photo || "") : (targetMeta.profile_photo || ""),
    };

    if (isPlatformOwner(caller.role) && body.company_id !== undefined) {
      app_metadata.company_id = nextRole === "platform_owner" ? null : body.company_id;
    }

    const updates = {
      app_metadata,
      user_metadata: { ...(target.user_metadata || {}), name },
    };
    if (email !== String(target.email || "").toLowerCase()) {
      updates.email = email;
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(id, updates);
    if (updateError) {
      console.error("[admin-update-user]", updateError);
      return jsonError(res, 502, updateError.message || "Unable to update user.");
    }

    const profilePayload = {
      name,
      email,
      role: nextRole,
      active: effectiveActive,
      username,
      phone,
      branch_id: app_metadata.branch_id,
      company_id: app_metadata.company_id,
      profile_photo: app_metadata.profile_photo || "",
      employee_id: employeeId || null,
      department: department || null,
      position: position || null,
      address: address || null,
      national_id: nationalId || null,
      account_status: accountStatus,
      login_enabled: loginEnabled,
      must_change_password: mustChangePassword,
    };
    const { error: profileError } = await admin.from("profiles").update(profilePayload).eq("id", id);
    if (profileError && !/column|PGRST204/i.test(String(profileError.message || profileError.code || ""))) {
      console.error("[admin-update-user] profiles sync", profileError);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[admin-update-user]", err);
    return jsonError(res, 500, "Unable to update user.");
  }
}
