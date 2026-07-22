import {
  applySecurityHeaders,
  consumeRateLimit,
  createAdminClient,
  getClientIp,
  isAllowedOrigin,
  parseBody,
  methodNotAllowed,
  jsonError,
  rateLimitResponse,
  verifyCallerFromRequest,
} from "./_authHelpers.js";
import { handlePosAction } from "./_posData.js";

const PUBLIC_ACTIONS = new Set(["settings.getPublic", "health.probe"]);

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST") return methodNotAllowed(res, "POST");

  const body = parseBody(req) || {};
  const action = String(body.action || "").trim();
  if (!action) return jsonError(res, 400, "action is required.");

  // Public read-only probes may be called by monitors without browser Origin.
  // Mutating authenticated actions still require Origin/Referer or Bearer (CSRF).
  const publicAction = PUBLIC_ACTIONS.has(action);
  const origin = String(req.headers?.origin || "").trim();
  const referer = String(req.headers?.referer || "").trim();
  if (!isAllowedOrigin(req) && !(publicAction && !origin && !referer)) {
    return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");
  }

  const ip = getClientIp(req);
  if (!consumeRateLimit(`pos:${ip}`, 120, 60000)) {
    return rateLimitResponse(res, 60);
  }

  let caller = null;
  if (!publicAction) {
    const verified = await verifyCallerFromRequest(req);
    if (verified.error) return jsonError(res, verified.status, verified.error, "UNAUTHENTICATED");
    caller = verified.caller;
    if (!caller.active) return jsonError(res, 403, "Account is inactive.", "INACTIVE");
  } else {
    caller = { id: null, role: "cashier", company_id: null, branch_id: null, name: "", username: "", active: true };
  }

  try {
    const admin = createAdminClient();
    const result = await handlePosAction(admin, caller, action, body.params || {});
    if (result && typeof result === "object" && result.success === false && result.code === "UNKNOWN_ACTION") {
      return jsonError(res, 400, result.error, result.code);
    }
    return res.status(200).json(result);
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[api/pos]", action, err);
    return jsonError(res, 500, err?.message || "POS data request failed.", "POS_ERROR");
  }
}
