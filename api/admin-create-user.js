import {
  applySecurityHeaders,
  createAdminClient,
  isAllowedOrigin,
  verifyCallerFromRequest,
  parseBody,
  methodNotAllowed,
  jsonError,
  requireUserManager,
  canAssignRole,
  isPlatformOwner,
  normalizeRole,
  listAllAuthUsers,
} from "./_authHelpers.js";
import { isValidEmailAddress } from "./_mailTransport.js";
import { checkPlanLimit, loadCompanyPlanLimits } from "./_saasPlans.js";

const validUsername = (value) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(value);
const validEmail = (value) => isValidEmailAddress(value);
const validPhone = (value) => !value || /^\+?[\d\s().-]{7,20}$/.test(value);

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
  const name = String(body.name || "").trim();
  const username = String(body.username || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");
  const role = normalizeRole(body.role);
  const branchId = body.branch_id == null ? null : body.branch_id;
  const active = body.active === undefined ? true : !!(body.active === true || body.active === 1);
  const profilePhoto = String(body.profile_photo || "");
  const employeeId = String(body.employee_id || "").trim().slice(0, 64);
  const department = String(body.department || "").trim().slice(0, 120);
  const position = String(body.position || "").trim().slice(0, 120);
  const address = String(body.address || "").trim().slice(0, 240);
  const nationalId = String(body.national_id || "").trim().slice(0, 64);
  const accountStatusRaw = String(body.account_status || (active ? "active" : "inactive")).toLowerCase();
  const accountStatus = ["active", "inactive", "suspended", "locked"].includes(accountStatusRaw)
    ? accountStatusRaw
    : (active ? "active" : "inactive");
  const loginEnabled = body.login_enabled === undefined
    ? accountStatus === "active"
    : !!(body.login_enabled === true || body.login_enabled === 1);
  const mustChangePassword = body.must_change_password === true || body.must_change_password === 1;

  if (!name || !validUsername(username)) {
    return jsonError(res, 400, "Enter a full name and a username of 3–30 letters, numbers, dots, underscores, or hyphens.");
  }
  if (!validEmail(email)) return jsonError(res, 400, "Enter a valid email address.");
  if (!validPhone(phone)) return jsonError(res, 400, "Enter a valid phone number.");
  if (password.length < 8) return jsonError(res, 400, "Password must be at least 8 characters.");
  if (!canAssignRole(caller.role, role)) {
    return jsonError(res, 403, "You cannot assign that protected role.", "FORBIDDEN");
  }

  const assignedCompanyId = isPlatformOwner(caller.role)
    ? (body.company_id == null || body.company_id === "" ? null : body.company_id)
    : caller.company_id;

  if (!isPlatformOwner(role) && (assignedCompanyId == null || assignedCompanyId === "")) {
    return jsonError(res, 400, "A company is required.");
  }

  try {
    const admin = createAdminClient();

    // A branch must exist, belong to the SAME company as the new user, and
    // be active — otherwise a user can be created scoped to another
    // tenant's branch (or a nonexistent one).
    if (branchId != null && branchId !== "" && !isPlatformOwner(role)) {
      const { data: branchRow, error: branchLookupError } = await admin
        .from("branches")
        .select("id, company_id, active")
        .eq("id", branchId)
        .maybeSingle();
      if (branchLookupError) {
        console.error("[admin-create-user] branch lookup failed", branchLookupError);
        return jsonError(res, 502, "Unable to verify the selected branch. Please try again.", "BRANCH_LOOKUP_FAILED");
      }
      if (!branchRow) {
        return jsonError(res, 400, "The selected branch does not exist.", "BRANCH_NOT_FOUND");
      }
      if (String(branchRow.company_id) !== String(assignedCompanyId)) {
        return jsonError(res, 400, "The selected branch does not belong to this company.", "BRANCH_COMPANY_MISMATCH");
      }
      if (branchRow.active === false) {
        return jsonError(res, 400, "The selected branch is inactive.", "BRANCH_INACTIVE");
      }
    }

    const existing = await listAllAuthUsers(admin);
    const companyUsers = existing.filter((user) => {
      const meta = user.app_metadata || {};
      if (isPlatformOwner(role)) return normalizeRole(meta.role) === "platform_owner";
      return String(meta.company_id) === String(assignedCompanyId);
    });
    if (!isPlatformOwner(role) && assignedCompanyId != null && assignedCompanyId !== "") {
      const limits = await loadCompanyPlanLimits(admin, assignedCompanyId);
      const limited = checkPlanLimit(limits, "users", companyUsers.length);
      if (limited) return res.status(403).json(limited);
    }
    if (companyUsers.some((user) => String(user.app_metadata?.username || "").toLowerCase() === username)) {
      return jsonError(res, 409, "That username is already in use.");
    }
    if (existing.some((user) => String(user.email || "").toLowerCase() === email)) {
      return jsonError(res, 409, "That email address is already in use.");
    }

    const app_metadata = {
      role,
      company_id: isPlatformOwner(role) ? null : assignedCompanyId,
      branch_id: branchId,
      username,
      name,
      phone,
      active: accountStatus === "active" && loginEnabled,
      account_status: accountStatus,
      login_enabled: loginEnabled,
      must_change_password: mustChangePassword,
      employee_id: employeeId,
      department,
      position,
      address,
      national_id: nationalId,
      profile_photo: profilePhoto,
      created_by_name: caller.name || caller.email,
      created_by: caller.id,
      login_count: 0,
      failed_login_count: 0,
    };

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
      app_metadata,
    });

    if (error) {
      console.error("[admin-create-user]", error);
      return jsonError(res, 502, error.message || "Unable to create user.");
    }

    // Keep profiles in sync — sales.user_id FK references public.profiles(id).
    const profilePayload = {
      id: data.user.id,
      name,
      email,
      role,
      active: accountStatus === "active" && loginEnabled,
      branch_id: branchId,
      company_id: isPlatformOwner(role) ? null : assignedCompanyId,
      username,
      phone,
      profile_photo: profilePhoto,
      employee_id: employeeId || null,
      department: department || null,
      position: position || null,
      address: address || null,
      national_id: nationalId || null,
      account_status: accountStatus,
      login_enabled: loginEnabled,
      must_change_password: mustChangePassword,
      created_by: caller.id,
      created_by_name: caller.name || caller.email,
    };
    let { error: profileError } = await admin.from("profiles").upsert(profilePayload, { onConflict: "id" });
    if (profileError && /column|PGRST204/i.test(String(profileError.message || profileError.code || ""))) {
      const slim = {
        id: data.user.id,
        name,
        email,
        role: ["owner", "admin", "cashier", "branch_manager"].includes(role) ? role : "admin",
        active: accountStatus === "active" && loginEnabled,
        branch_id: branchId,
        company_id: isPlatformOwner(role) ? null : assignedCompanyId,
        username,
      };
      ({ error: profileError } = await admin.from("profiles").upsert(slim, { onConflict: "id" }));
    }
    if (profileError) {
      console.error("[admin-create-user] profiles upsert", profileError);
      return jsonError(res, 502, `User created but profile sync failed: ${profileError.message}`);
    }

    return res.status(200).json({
      success: true,
      id: data.user.id,
      user: {
        id: data.user.id,
        email: data.user.email,
        role,
        company_id: isPlatformOwner(role) ? null : assignedCompanyId,
        username,
        name,
        account_status: accountStatus,
        employee_id: employeeId,
      },
    });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[admin-create-user]", err);
    return jsonError(res, 500, "Unable to create user.");
  }
}
