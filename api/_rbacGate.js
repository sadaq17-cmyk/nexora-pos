/**
 * Server-side RBAC for /api/pos — mirrors client API_PERMISSION_MAP.
 * Fail-closed for mapped actions; platform_owner blocked from tenant ops.
 */
import { hasPermission, isPlatformOwner, isOwner, isSuperAdmin, normalizeRole } from "../src/lib/rbac.js";
import { API_PERMISSION_MAP } from "../src/lib/permissionMiddleware.js";

/** Actions platform Super Admin may call without impersonation / company scope. */
const PLATFORM_BASELINE = new Set([
  "health.probe",
  "settings.getPublic",
  "ai.meta",
  "ai.chat",
  "nexoraAi.meta",
  "nexoraAi.chat",
]);

function deny(error, code = "FORBIDDEN") {
  return { ok: false, success: false, error, code };
}

/**
 * @param {{ role?: string, company_id?: unknown, id?: string }} caller
 * @param {string} action
 * @param {Record<string, unknown>} [params]
 */
export function assertPosActionAllowed(caller, action, params = {}) {
  const act = String(action || "").trim();
  if (!act) return deny("action is required.", "BAD_REQUEST");

  if (act.startsWith("platform.") || act.startsWith("owner.")) {
    if (!isPlatformOwner(caller?.role)) {
      return deny("Platform Super Admin access required.", "FORBIDDEN");
    }
    return { ok: true };
  }

  if (isPlatformOwner(caller?.role)) {
    // Isolation: Super Owner is not a tenant operator. Use Company Management or impersonation.
    if (PLATFORM_BASELINE.has(act)) return { ok: true };
    return deny(
      "Platform Super Admin cannot access tenant operational data. Use Company Management or impersonation.",
      "PLATFORM_ISOLATION"
    );
  }

  if (act === "permissions.saveMatrix") {
    const role = normalizeRole(caller?.role);
    if (!(isOwner(role) || isSuperAdmin(role) || role === "admin")) {
      return deny("Only Owner or Admin can edit the permission matrix.", "FORBIDDEN");
    }
    return { ok: true };
  }

  if (act === "settings.update") {
    const updates = params && typeof params === "object" ? params : {};
    const changesCurrency =
      Object.prototype.hasOwnProperty.call(updates, "currency") ||
      Object.prototype.hasOwnProperty.call(updates, "currency_symbol") ||
      Object.prototype.hasOwnProperty.call(updates, "base_currency_code");
    if (changesCurrency && !isSuperAdmin(caller?.role) && !isOwner(caller?.role)) {
      return deny("Only Owner can change the base currency.", "FORBIDDEN");
    }
  }

  const rule = API_PERMISSION_MAP[act];
  if (rule === null) return { ok: true };
  if (rule === undefined) {
    // Unmapped actions: allow only non-mutating namespaces already used by health/auth flags.
    if (/^(auth\.|publicAuth\.|subscription\.get|subscription\.getPlans)/.test(act)) return { ok: true };
    // Prefer allow for legacy unmapped reads that still exist in the switch — deny writes.
    if (/\.(create|update|delete|import|adjust|save|post|register|transfer|receive|approve|cancel|add)/i.test(act)) {
      return deny("Permission denied.", "FORBIDDEN");
    }
    return { ok: true };
  }

  const [module, permAction] = rule;
  if (!hasPermission(caller?.role, module, permAction, null)) {
    return deny("Permission denied.", "FORBIDDEN");
  }
  return { ok: true };
}
