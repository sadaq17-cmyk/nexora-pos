import {
  applySecurityHeaders,
  consumeRateLimit,
  createAdminClient,
  getClientIp,
  isAllowedOrigin,
  verifyCallerFromRequest,
  listAllAuthUsers,
  safeUserFields,
  isPlatformOwner,
  methodNotAllowed,
  jsonError,
  parseBody,
  rateLimitResponse,
  requireUserManager,
  sameCompany,
} from "./_authHelpers.js";

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
    const all = await listAllAuthUsers(admin);
    let rows = all.map(safeUserFields);

    if (!isPlatformOwner(caller.role)) {
      rows = rows.filter((user) => sameCompany(user.company_id, caller.company_id));
    }

    if (filterUserId) {
      const one = rows.find((user) => String(user.id) === String(filterUserId));
      return res.status(200).json({ success: true, user: one || null, users: one ? [one] : [] });
    }

    return res.status(200).json({ success: true, users: rows });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[admin-list-users]", err);
    return jsonError(res, 500, "Unable to list users.");
  }
}
