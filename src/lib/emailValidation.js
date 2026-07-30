/**
 * Standard email format validation only.
 * Accepts real domains including nexorapospro.com (support@httpsnexorapos.com).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254) return false;
  if (!EMAIL_PATTERN.test(email)) return false;
  const [local, domain] = email.split("@");
  if (!local || !domain) return false;
  if (local.length > 64) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  if (!domain.includes(".")) return false;
  return true;
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
