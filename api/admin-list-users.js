import {
  applySecurityHeaders,
  consumeRateLimit,
  createAdminClient,
  getClientIp,
  isAllowedOrigin,
  verifyCallerFromRequest,
  safeUserFields,
  isPlatformOwner,
  methodNotAllowed,
  jsonError,
  parseBody,
  rateLimitResponse,
  requireUserManager,
  sameCompany,
  normalizeRole,
} from "./_authHelpers.js";

function profileToSafeUser(profile, authUser) {
  const fromAuth = authUser ? safeUserFields(authUser) : null;
  const activeFlag = profile.active === false || profile.active === 0 ? 0 : 1;
  const accountStatus = String(
    profile.account_status || fromAuth?.account_status || (activeFlag ? "active" : "inactive")
  ).toLowerCase();
  return {
    id: profile.id,
    employee_id: profile.employee_id || fromAuth?.employee_id || "",
    name: profile.name || fromAuth?.name || "",
    username: profile.username || fromAuth?.username || "",
    email: profile.email || fromAuth?.email || "",
    phone: profile.phone || fromAuth?.phone || "",
    role: normalizeRole(profile.role || fromAuth?.role),
    department: profile.department || fromAuth?.department || "",
    position: profile.position || fromAuth?.position || "",
    address: profile.address || fromAuth?.address || "",
    national_id: profile.national_id || fromAuth?.national_id || "",
    branch_id: profile.branch_id == null || profile.branch_id === ""
      ? (fromAuth?.branch_id ?? null)
      : profile.branch_id,
    company_id: profile.company_id == null || profile.company_id === ""
      ? (fromAuth?.company_id ?? null)
      : profile.company_id,
    active: fromAuth?.active ?? activeFlag,
    account_status: ["active", "inactive", "suspended", "locked"].includes(accountStatus)
      ? accountStatus
      : (activeFlag ? "active" : "inactive"),
    login_enabled: profile.login_enabled === false || profile.login_enabled === 0
      ? 0
      : (fromAuth?.login_enabled ?? 1),
    must_change_password: !!(profile.must_change_password ?? fromAuth?.must_change_password),
    force_logout_at: profile.force_logout_at || fromAuth?.force_logout_at || null,
    created_at: fromAuth?.created_at || profile.created_at || null,
    created_by: profile.created_by || fromAuth?.created_by || null,
    created_by_name: profile.created_by_name || fromAuth?.created_by_name || "",
    last_login_at: fromAuth?.last_login_at || profile.last_login_at || null,
    last_activity_at: profile.last_activity_at || fromAuth?.last_activity_at || null,
    login_count: Number(profile.login_count ?? fromAuth?.login_count ?? 0) || 0,
    last_ip: profile.last_ip || fromAuth?.last_ip || "",
    last_device: profile.last_device || fromAuth?.last_device || "",
    last_browser: profile.last_browser || fromAuth?.last_browser || "",
    last_os: profile.last_os || fromAuth?.last_os || "",
    failed_login_count: Number(profile.failed_login_count ?? fromAuth?.failed_login_count ?? 0) || 0,
    locked_until: profile.locked_until || fromAuth?.locked_until || null,
    profile_photo: profile.profile_photo || fromAuth?.profile_photo || "",
    email_verified: fromAuth?.email_verified ?? false,
    branch_name: "",
    total_sales: 0,
    total_revenue: 0,
  };
}

function enrichWithProfile(authSafe, profile) {
  if (!profile) return { ...authSafe, branch_name: authSafe.branch_name || "", total_sales: 0, total_revenue: 0 };
  return {
    ...authSafe,
    employee_id: profile.employee_id || authSafe.employee_id || "",
    name: profile.name || authSafe.name || "",
    username: profile.username || authSafe.username || "",
    email: profile.email || authSafe.email || "",
    phone: profile.phone || authSafe.phone || "",
    role: normalizeRole(profile.role || authSafe.role),
    department: profile.department || authSafe.department || "",
    position: profile.position || authSafe.position || "",
    address: profile.address || authSafe.address || "",
    national_id: profile.national_id || authSafe.national_id || "",
    branch_id: profile.branch_id == null || profile.branch_id === "" ? authSafe.branch_id : profile.branch_id,
    company_id: profile.company_id == null || profile.company_id === "" ? authSafe.company_id : profile.company_id,
    account_status: profile.account_status || authSafe.account_status,
    login_enabled: profile.login_enabled === false || profile.login_enabled === 0 ? 0 : authSafe.login_enabled,
    must_change_password: !!(profile.must_change_password ?? authSafe.must_change_password),
    last_login_at: authSafe.last_login_at || profile.last_login_at || null,
    last_activity_at: profile.last_activity_at || authSafe.last_activity_at || null,
    login_count: Number(profile.login_count ?? authSafe.login_count ?? 0) || 0,
    last_ip: profile.last_ip || authSafe.last_ip || "",
    last_device: profile.last_device || authSafe.last_device || "",
    last_browser: profile.last_browser || authSafe.last_browser || "",
    last_os: profile.last_os || authSafe.last_os || "",
    profile_photo: profile.profile_photo || authSafe.profile_photo || "",
    branch_name: "",
    total_sales: 0,
    total_revenue: 0,
  };
}

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res, "GET, POST");
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  const verified = await verifyCallerFromRequest(req);
  if (verified.error) return jsonError(res, verified.status, verified.error);

  const { caller } = verified;
  const forbidden = requireUserManager(caller);
  if (forbidden) return jsonError(res, 403, forbidden.error, forbidden.code);

  const ip = getClientIp(req);
  if (!consumeRateLimit(`admin-list:${caller.id}:${ip}`, 30, 60000)) {
    return rateLimitResponse(res, 60);
  }

  const body = req.method === "POST" ? parseBody(req) : {};
  const filterUserId = body.id || (req.query && req.query.id) || null;

  try {
    const admin = createAdminClient();

    // Fast path: single-user lookup (no Auth directory scan).
    if (filterUserId) {
      const { data: byIdData, error: byIdErr } = await admin.auth.admin.getUserById(String(filterUserId));
      if (byIdErr || !byIdData?.user) {
        return res.status(200).json({ success: true, users: [], totals: { total: 0, active: 0, inactive: 0 } });
      }
      const authUser = byIdData.user;
      if (!isPlatformOwner(caller.role) && !sameCompany(authUser.app_metadata?.company_id, caller.company_id)) {
        return res.status(200).json({ success: true, users: [], totals: { total: 0, active: 0, inactive: 0 } });
      }
      const { data: profile } = await admin.from("profiles").select("*").eq("id", authUser.id).maybeSingle();
      const row = enrichWithProfile(safeUserFields(authUser), profile || null);
      return res.status(200).json({
        success: true,
        users: [row],
        totals: {
          total: 1,
          active: row.active ? 1 : 0,
          inactive: row.active ? 0 : 1,
        },
      });
    }

    // Profiles-only listing (indexed). No Auth directory scan for tenant or platform.
    let profileQuery = admin.from("profiles").select("*");
    if (!isPlatformOwner(caller.role)) {
      if (caller.company_id == null || caller.company_id === "") {
        return res.status(200).json({
          success: true,
          users: [],
          totals: { total: 0, active: 0, inactive: 0 },
        });
      }
      profileQuery = profileQuery.eq("company_id", caller.company_id);
    } else {
      profileQuery = profileQuery.neq("role", "platform_owner").limit(2000);
    }
    const { data: profiles, error: profileError } = await profileQuery;
    if (profileError) {
      console.error("[admin-list-users] profiles", profileError);
    }
    const profileList = Array.isArray(profiles) ? profiles : [];

    const byId = new Map();
    for (const profile of profileList) {
      const key = String(profile.id);
      if (!isPlatformOwner(caller.role) && !sameCompany(profile.company_id, caller.company_id)) continue;
      byId.set(key, profileToSafeUser(profile, null));
    }

    let rows = [...byId.values()];

    // Branch names for Role / Branch column
    const branchIds = [...new Set(rows.map((row) => row.branch_id).filter((id) => id != null && id !== ""))];
    if (branchIds.length) {
      const { data: branches } = await admin.from("branches").select("id, name").in("id", branchIds);
      const branchNameById = new Map((branches || []).map((b) => [String(b.id), b.name]));
      rows = rows.map((row) => ({
        ...row,
        branch_name: row.branch_id != null ? (branchNameById.get(String(row.branch_id)) || "") : "",
      }));
    }

    // Optional sales rollup (best-effort; never fail the list)
    try {
      const userIds = rows.map((row) => row.id);
      if (userIds.length && !isPlatformOwner(caller.role) && caller.company_id != null) {
        const { data: sales } = await admin
          .from("sales")
          .select("user_id, total")
          .eq("company_id", caller.company_id)
          .in("user_id", userIds)
          .limit(5000);
        const stats = new Map();
        for (const sale of sales || []) {
          const key = String(sale.user_id);
          const prev = stats.get(key) || { total_sales: 0, total_revenue: 0 };
          prev.total_sales += 1;
          prev.total_revenue += Number(sale.total) || 0;
          stats.set(key, prev);
        }
        rows = rows.map((row) => {
          const s = stats.get(String(row.id));
          return s ? { ...row, ...s } : row;
        });
      }
    } catch (salesErr) {
      console.warn("[admin-list-users] sales rollup skipped", salesErr?.message || salesErr);
    }

    rows.sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));

    const totals = {
      total: rows.length,
      active: rows.filter((row) => {
        const status = String(row.account_status || (row.active ? "active" : "inactive")).toLowerCase();
        return status === "active" && row.active !== 0 && row.active !== false;
      }).length,
      inactive: 0,
    };
    totals.inactive = totals.total - totals.active;

    if (filterUserId) {
      const one = rows.find((user) => String(user.id) === String(filterUserId));
      return res.status(200).json({
        success: true,
        user: one || null,
        users: one ? [one] : [],
        totals: one
          ? { total: 1, active: one.active ? 1 : 0, inactive: one.active ? 0 : 1 }
          : { total: 0, active: 0, inactive: 0 },
      });
    }

    return res.status(200).json({ success: true, users: rows, totals });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[admin-list-users]", err);
    return jsonError(res, 500, "Unable to list users.");
  }
}
