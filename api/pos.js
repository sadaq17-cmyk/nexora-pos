import {
  applySecurityHeaders,
  applyCorsHeaders,
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
import { assertPosActionAllowed } from "./_rbacGate.js";
import { getAiMeta, resolveAiMode, runNexoraAiChat } from "./_aiEngine.js";

/** Allow longer AI tool loops on Pro; Hobby still caps wall time. */
export const config = { maxDuration: 60 };

const PUBLIC_ACTIONS = new Set(["settings.getPublic", "health.probe"]);
const AI_ACTIONS = new Set(["ai.meta", "ai.chat", "nexoraAi.meta", "nexoraAi.chat"]);

export default async function handler(req, res) {
  applySecurityHeaders(res);
  applyCorsHeaders(req, res);
  if (String(req.method || "").toUpperCase() === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return methodNotAllowed(res, "POST");

  const body = parseBody(req) || {};
  const action = String(body.action || "").trim();
  if (!action) return jsonError(res, 400, "action is required.");

  // Public read-only probes may be called by monitors without browser Origin.
  // Mutating authenticated actions still require Origin/Referer, Bearer, or desktop attestation.
  const publicAction = PUBLIC_ACTIONS.has(action);
  const origin = String(req.headers?.origin || "").trim();
  const referer = String(req.headers?.referer || "").trim();
  if (!isAllowedOrigin(req) && !(publicAction && !origin && !referer)) {
    return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");
  }

  const ip = getClientIp(req);
  const aiAction = AI_ACTIONS.has(action);
  if (!consumeRateLimit(aiAction ? `pos-ai:${ip}` : `pos:${ip}`, aiAction ? 40 : 120, 60000)) {
    return rateLimitResponse(res, 60);
  }

  let caller = null;
  if (!publicAction) {
    const verified = await verifyCallerFromRequest(req);
    if (verified.error) return jsonError(res, verified.status, verified.error, "UNAUTHENTICATED");
    caller = verified.caller;
    if (!caller.active) return jsonError(res, 403, "Account is inactive.", "INACTIVE");
  } else {
    // Public actions may still attach a Bearer token (e.g. owner dashboard health.probe).
    // Prefer the authenticated caller when present so privileged probes stay useful.
    const authHeader = String(req.headers?.authorization || req.headers?.Authorization || "");
    if (/^Bearer\s+\S+/i.test(authHeader)) {
      const verified = await verifyCallerFromRequest(req);
      if (!verified.error && verified.caller?.active) {
        caller = verified.caller;
      }
    }
    if (!caller) {
      caller = { id: null, role: "cashier", company_id: null, branch_id: null, name: "", username: "", active: true };
    }
  }

  try {
    // Nexora AI Dual Mode — hosted on /api/pos to stay within Hobby function limits.
    if (action === "ai.meta" || action === "nexoraAi.meta") {
      return res.status(200).json(getAiMeta(caller));
    }
    if (action === "ai.chat" || action === "nexoraAi.chat") {
      const params = body.params && typeof body.params === "object" ? body.params : body;
      const modeResolved = resolveAiMode(params.mode, caller);
      if (modeResolved.error) {
        return jsonError(res, modeResolved.status, modeResolved.error, modeResolved.code);
      }
      const result = await runNexoraAiChat({
        caller,
        mode: modeResolved.mode,
        messages: params.messages,
        image_base64: params.image_base64 || null,
        stream: Boolean(params.stream),
      });
      if (!result.success) {
        return jsonError(res, result.status || 500, result.error, result.code);
      }
      return res.status(200).json(result);
    }

    const params = body.params && typeof body.params === "object" ? body.params : {};
    const gate = assertPosActionAllowed(caller, action, params);
    if (!gate.ok) {
      return jsonError(res, 403, gate.error || "Permission denied.", gate.code || "FORBIDDEN");
    }

    // Public health probe must never depend on admin client init (desktop monitors / Electron).
    if (action === "health.probe" && !caller?.id) {
      return res.status(200).json({ success: true, ok: true });
    }

    const admin = createAdminClient();
    const result = await handlePosAction(admin, caller, action, params);
    if (result && typeof result === "object" && result.success === false && result.code === "UNKNOWN_ACTION") {
      return jsonError(res, 400, result.error, result.code);
    }
    if (result && typeof result === "object" && result.success === false && result.code === "FORBIDDEN") {
      return jsonError(res, 403, result.error || "Permission denied.", result.code);
    }
    return res.status(200).json(result);
  } catch (err) {
    if (err?.code === "CONFIG") {
      return jsonError(res, 503, "Service configuration error.", "CONFIG");
    }
    console.error("[api/pos]", action, err?.code || err?.message || err);
    return jsonError(res, 500, "POS data request failed.", "POS_ERROR");
  }
}
