/**
 * Permanent Platform Super Admin (global SaaS admin — no company).
 * Password provisioning is server-side only via ensure-permanent-owner.
 */
export const PERMANENT_PLATFORM_ADMIN = Object.freeze({
  username: "SuperAdmin",
  email: "saadaq17@icloud.com",
  name: "Platform Super Admin",
  role: "platform_owner",
  company_id: null,
  branch_id: null,
});

export function isPermanentPlatformAdminUsername(value) {
  return String(value || "").trim().toLowerCase() === PERMANENT_PLATFORM_ADMIN.username.toLowerCase();
}

export function isPermanentPlatformAdminEmail(value) {
  return String(value || "").trim().toLowerCase() === PERMANENT_PLATFORM_ADMIN.email.toLowerCase();
}
