import {
  applySecurityHeaders,
  consumeRateLimit,
  createAdminClient,
  getClientIp,
  isAllowedOrigin,
  normalizeRole,
  parseBody,
  methodNotAllowed,
  jsonError,
  rateLimitResponse,
  sanitizeText,
} from "./_authHelpers.js";

const GENERIC_OK = { success: true, email: null };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  // Tight limit — username→email resolution is an account-oracle surface.
  const rateKey = `resolve:${ip}`;
  if (!consumeRateLimit(rateKey, 8, 60_000)) {
    return rateLimitResponse(res, 60);
  }
  if (!consumeRateLimit(`resolve-id:${ip}:${identifier}`, 3, 60_000)) {
    return rateLimitResponse(res, 60);
  }

  const started = Date.now();
  try {
    // If identifier is already an email, do not enumerate — echo only after basic shape check.
    if (identifier.includes("@")) {
      await sleep(Math.max(0, 120 - (Date.now() - started)));
      return res.status(200).json({ success: true, email: identifier });
    }

    // Username lookup requires an explicit company scope (or platform).
    if (companyId == null) {
      await sleep(Math.max(0, 120 - (Date.now() - started)));
      return res.status(200).json(GENERIC_OK);
    }

    const admin = createAdminClient();

    if (companyId === "platform") {
      // Case-insensitive username match (login normalizes to lowercase; profiles keep display case).
      const { data, error } = await admin
        .from("profiles")
        .select("email, username, role, company_id")
        .ilike("username", identifier)
        .eq("role", "platform_owner")
        .limit(1)
        .maybeSingle();
      if (data?.email && !error) {
        await sleep(Math.max(0, 120 - (Date.now() - started)));
        return res.status(200).json({ success: true, email: String(data.email).toLowerCase() });
      }
      // Fallback: metadata scan limited to first page only (not full directory).
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 50 });
      const match = (listed.data?.users || []).find((user) => {
        const meta = user.app_metadata || {};
        return normalizeRole(meta.role) === "platform_owner"
          && String(meta.username || "").toLowerCase() === identifier;
      });
      await sleep(Math.max(0, 120 - (Date.now() - started)));
      return res.status(200).json(match?.email
        ? { success: true, email: String(match.email).toLowerCase() }
        : GENERIC_OK);
    }

    let query = admin
      .from("profiles")
      .select("email, username, role, company_id")
      .ilike("username", identifier)
      .eq("company_id", companyId)
      .limit(1);
    const { data, error } = await query.maybeSingle();
    if (error && error.code !== "PGRST116") {
      console.error("[resolve-login-email] profiles", error.message || error);
      await sleep(Math.max(0, 120 - (Date.now() - started)));
      return res.status(200).json(GENERIC_OK);
    }
    if (data?.email && normalizeRole(data.role) !== "platform_owner") {
      await sleep(Math.max(0, 120 - (Date.now() - started)));
      return res.status(200).json({ success: true, email: String(data.email).toLowerCase() });
    }

    await sleep(Math.max(0, 120 - (Date.now() - started)));
    return res.status(200).json(GENERIC_OK);
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, "Service configuration error.", "CONFIG");
    console.error("[resolve-login-email]", err);
    await sleep(Math.max(0, 120 - (Date.now() - started)));
    return res.status(200).json(GENERIC_OK);
  }
}
