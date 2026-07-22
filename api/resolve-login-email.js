import {
  applySecurityHeaders,
  consumeRateLimit,
  createAdminClient,
  getClientIp,
  isAllowedOrigin,
  listAllAuthUsers,
  normalizeRole,
  parseBody,
  methodNotAllowed,
  jsonError,
  rateLimitResponse,
  sanitizeText,
} from "./_authHelpers.js";

const GENERIC_OK = { success: true, email: null };

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  const body = parseBody(req);
  const companyId = body.company_id === "platform" || body.scope === "platform"
    ? "platform"
    : body.company_id == null || body.company_id === ""
      ? null
      : body.company_id;
  const identifier = sanitizeText(body.identifier, 160).toLowerCase();

  if (!identifier) {
    return jsonError(res, 400, "Identifier is required.");
  }

  const ip = getClientIp(req);
  const rateKey = `resolve:${ip}:${companyId ?? "none"}:${identifier}`;
  if (!consumeRateLimit(rateKey, 5, 60000)) {
    return rateLimitResponse(res, 60);
  }

  try {
    const admin = createAdminClient();
    const users = await listAllAuthUsers(admin);
    const match = users.find((user) => {
      const meta = user.app_metadata || {};
      const role = normalizeRole(meta.role);
      const email = String(user.email || "").toLowerCase();
      const username = String(meta.username || "").toLowerCase();
      const metaCompany = meta.company_id == null || meta.company_id === "" ? null : meta.company_id;

      if (companyId === "platform") {
        if (role !== "platform_owner") return false;
        return username === identifier || email === identifier;
      }
      if (companyId == null) {
        return email === identifier && role !== "platform_owner";
      }
      if (String(metaCompany) !== String(companyId)) return false;
      if (role === "platform_owner") return false;
      return username === identifier || email === identifier;
    });

    if (!match?.email) {
      return res.status(200).json(GENERIC_OK);
    }
    return res.status(200).json({ success: true, email: match.email });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[resolve-login-email]", err);
    return res.status(200).json(GENERIC_OK);
  }
}
