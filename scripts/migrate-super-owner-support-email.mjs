/**
 * One-shot: migrate existing Super Owner → support@httpsnexorapos.com
 * and free that inbox from any company-owner Auth user.
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (and optionally
 * PERMANENT_PLATFORM_ADMIN_PASSWORD if force_password=1).
 *
 * Does NOT create a second platform_owner.
 */
import { createClient } from "@supabase/supabase-js";
import { assertNotProductionSupabase } from "./_prodSafety.mjs";

const SUPPORT_EMAIL = "support@httpsnexorapos.com";
const COMPANY_OWNER_EMAIL = "owner@httpsnexorapos.com";
const PLATFORM_USERNAME = "SuperAdmin";
const COMPANY_OWNER_ID = "3220e336-22c2-4ef6-8a42-198b5059bedb";
const LEGACY_PLATFORM = new Set(["saadaq17@icloud.com", "platform.owner@nexora.demo"]);

const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const forcePassword = String(process.env.FORCE_PLATFORM_PASSWORD || "") === "1";
const allowProd = String(process.env.ALLOW_PROD_AUTH_MIGRATE || "") === "I_UNDERSTAND_THIS_WRITES_REAL_AUTH";

if (!url || !service) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!allowProd) {
  assertNotProductionSupabase(url, { scriptName: "migrate-super-owner-support-email.mjs" });
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function listUsers() {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

function roleOf(user) {
  return String(user?.app_metadata?.role || "").toLowerCase();
}

function emailOf(user) {
  return String(user?.email || "").trim().toLowerCase();
}

async function syncProfile(user, fields) {
  const row = {
    id: user.id,
    email: fields.email,
    name: fields.name,
    role: fields.role,
    company_id: fields.company_id,
    branch_id: fields.branch_id,
    username: fields.username,
    active: true,
  };
  // Free unique email if held by another profile row.
  await admin.from("profiles").update({ email: `migrated+${String(user.id).slice(0, 8)}@httpsnexorapos.com` })
    .eq("email", fields.email)
    .neq("id", user.id);
  const { error } = await admin.from("profiles").upsert(row, { onConflict: "id" });
  if (error) console.warn("profile sync warning:", error.message);
  return !error;
}

const before = await listUsers();
const platformUsers = before.filter((u) => roleOf(u) === "platform_owner");
console.log(JSON.stringify({
  step: "before",
  platform_owner_count: platformUsers.length,
  platform_owners: platformUsers.map((u) => ({ id: u.id, email: emailOf(u), username: u.app_metadata?.username })),
  support_holders: before.filter((u) => emailOf(u) === SUPPORT_EMAIL).map((u) => ({
    id: u.id, email: emailOf(u), role: roleOf(u), company_id: u.app_metadata?.company_id,
  })),
}, null, 2));

let existing = platformUsers.find((u) =>
  String(u.app_metadata?.username || "").toLowerCase() === PLATFORM_USERNAME.toLowerCase()
) || null;
if (!existing) {
  existing = platformUsers.find((u) =>
    emailOf(u) === SUPPORT_EMAIL || LEGACY_PLATFORM.has(emailOf(u))
  ) || null;
}
if (!existing && platformUsers.length === 1) existing = platformUsers[0];

if (!existing) {
  console.error("No existing platform_owner found — refusing to create a new Super Owner from this script.");
  process.exit(2);
}

for (const extra of platformUsers) {
  if (String(extra.id) === String(existing.id)) continue;
  const meta = extra.app_metadata || {};
  const demoteRole = meta.company_id != null ? (roleOf(extra) === "platform_owner" ? "owner" : roleOf(extra) || "owner") : "cashier";
  const { error } = await admin.auth.admin.updateUserById(extra.id, {
    app_metadata: {
      ...meta,
      role: demoteRole,
      permanent: false,
      platform_super_admin: false,
      active: meta.company_id != null ? meta.active !== false : false,
      demoted_from_platform_owner: true,
    },
  });
  if (error) throw error;
  console.log("demoted_extra_platform_owner", extra.id, emailOf(extra));
}

const conflict = before.find((u) =>
  emailOf(u) === SUPPORT_EMAIL
  && roleOf(u) !== "platform_owner"
  && String(u.id) !== String(existing.id)
);
if (conflict) {
  const meta = conflict.app_metadata || {};
  const { error } = await admin.auth.admin.updateUserById(conflict.id, {
    email: COMPANY_OWNER_EMAIL,
    email_confirm: true,
    app_metadata: {
      ...meta,
      role: roleOf(conflict) === "platform_owner" ? "owner" : (roleOf(conflict) || "owner"),
      company_id: meta.company_id ?? 1,
      username: meta.username || "Owner@Honest",
      permanent: meta.permanent === true,
      platform_super_admin: false,
    },
  });
  if (error) throw error;
  console.log("moved_company_owner_off_support", conflict.id, "→", COMPANY_OWNER_EMAIL);
  await syncProfile(conflict, {
    email: COMPANY_OWNER_EMAIL,
    name: meta.name || "Honest Company Owner",
    role: "owner",
    company_id: meta.company_id ?? 1,
    branch_id: meta.branch_id ?? 1,
    username: meta.username || "Owner@Honest",
  });
  if (String(conflict.id) === COMPANY_OWNER_ID || Number(meta.company_id) === 1) {
    await admin.from("companies").update({ email: COMPANY_OWNER_EMAIL }).eq("id", 1);
  }
}

const meta = existing.app_metadata || {};
const updatePayload = {
  email: SUPPORT_EMAIL,
  email_confirm: true,
  ban_duration: "none",
  app_metadata: {
    ...meta,
    role: "platform_owner",
    company_id: null,
    branch_id: null,
    username: PLATFORM_USERNAME,
    name: "Platform Super Admin",
    phone: "",
    active: true,
    permanent: true,
    platform_super_admin: true,
    must_change_password: meta.must_change_password === false ? false : true,
  },
  user_metadata: { ...(existing.user_metadata || {}), name: "Platform Super Admin" },
};
if (forcePassword) {
  const pwd = String(process.env.PERMANENT_PLATFORM_ADMIN_PASSWORD || "").trim();
  if (!pwd || pwd.length < 8) {
    console.error("FORCE_PLATFORM_PASSWORD=1 requires PERMANENT_PLATFORM_ADMIN_PASSWORD");
    process.exit(1);
  }
  updatePayload.password = pwd;
  updatePayload.app_metadata.must_change_password = true;
}

const { data: updated, error: updErr } = await admin.auth.admin.updateUserById(existing.id, updatePayload);
if (updErr) throw updErr;

await syncProfile(updated.user, {
  email: SUPPORT_EMAIL,
  name: "Platform Super Admin",
  role: "platform_owner",
  company_id: null,
  branch_id: null,
  username: PLATFORM_USERNAME,
});

const after = await listUsers();
const afterPlatform = after.filter((u) => roleOf(u) === "platform_owner");
const support = after.filter((u) => emailOf(u) === SUPPORT_EMAIL);

console.log(JSON.stringify({
  step: "after",
  platform_owner_count: afterPlatform.length,
  platform_owners: afterPlatform.map((u) => ({
    id: u.id,
    email: emailOf(u),
    username: u.app_metadata?.username,
    company_id: u.app_metadata?.company_id,
    platform_super_admin: u.app_metadata?.platform_super_admin,
  })),
  support_account: support.map((u) => ({
    id: u.id,
    email: emailOf(u),
    role: roleOf(u),
    username: u.app_metadata?.username,
    company_id: u.app_metadata?.company_id,
  })),
  company_owner_known: (() => {
    const co = after.find((u) => String(u.id) === COMPANY_OWNER_ID);
    return co ? { id: co.id, email: emailOf(co), role: roleOf(co), company_id: co.app_metadata?.company_id } : null;
  })(),
  ok:
    afterPlatform.length === 1
    && support.length === 1
    && roleOf(support[0]) === "platform_owner"
    && emailOf(afterPlatform[0]) === SUPPORT_EMAIL,
}, null, 2));

process.exit(
  afterPlatform.length === 1
  && support.length === 1
  && roleOf(support[0]) === "platform_owner"
    ? 0
    : 3
);
