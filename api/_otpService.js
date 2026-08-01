/**
 * OTP verification service — SMS (Africa's Talking) with automatic Email
 * fallback. Used for: registration, login step-up verification, and
 * password reset. Server-only; all reads/writes use the Supabase
 * service-role (admin) client against public.otp_verifications.
 */
import crypto from "node:crypto";
import { sendSms, isSmsConfigured, normalizePhone } from "./_smsProvider.js";
import { sendOutboundEmail, isValidEmailAddress, mailProviderLabel } from "./_mailTransport.js";
import { escapeHtml } from "./_authHelpers.js";

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const OTP_MAX_ATTEMPTS = 5;
const OTP_CODE_LENGTH = 6;
const PURPOSES = new Set(["registration", "login", "password_reset"]);
const CHANNELS = new Set(["sms", "email"]);

function otpHashSecret() {
  const secret = String(
    process.env.OTP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  ).trim();
  if (!secret) {
    throw Object.assign(new Error("OTP hashing secret is not configured."), { code: "CONFIG" });
  }
  return secret;
}

function generateCode() {
  const max = 10 ** OTP_CODE_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(OTP_CODE_LENGTH, "0");
}

function hashCode(code, salt) {
  return crypto.createHmac("sha256", otpHashSecret()).update(`${salt}:${code}`).digest("hex");
}

function timingSafeEqualHex(a, b) {
  try {
    const bufA = Buffer.from(String(a || ""), "hex");
    const bufB = Buffer.from(String(b || ""), "hex");
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function purposeLabel(purpose) {
  if (purpose === "registration") return "registration";
  if (purpose === "password_reset") return "password reset";
  return "login verification";
}

function smsBody(code, purpose) {
  return `Nexora POS Pro: your ${purposeLabel(purpose)} code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`;
}

function emailTemplate(code, purpose) {
  const label = purposeLabel(purpose);
  const subject = `${code} is your Nexora POS Pro ${label} code`;
  const html = `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0B1C3D; background: #ffffff;">
    <p style="font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #2563EB; margin: 0 0 20px;">Nexora POS Pro</p>
    <h1 style="font-size: 20px; margin: 0 0 16px;">Your ${escapeHtml(label)} code</h1>
    <p style="font-size: 14px; line-height: 22px; margin: 0 0 20px;">Enter this code to complete your ${escapeHtml(label)}:</p>
    <p style="text-align: center; margin: 0 0 20px;">
      <span style="display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0B1C3D; background: #F1F5F9; padding: 14px 24px; border-radius: 10px;">${code}</span>
    </p>
    <p style="font-size: 13px; color: #64748B; margin: 0 0 8px;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>
  </div>`;
  const text = `Your Nexora POS Pro ${label} code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`;
  return { subject, html, text };
}

async function writeOtpAudit(admin, { action, identifier, purpose, channel, companyId, userId, ip, details }) {
  try {
    const payload = {
      action,
      module: "otp",
      user_id: userId || null,
      user_name: identifier,
      details: JSON.stringify({ purpose, channel, ...details }),
      company_id: companyId ?? null,
      ip: ip || null,
    };
    const { error } = await admin.from("audit_log").insert(payload);
    if (error && /column .*(ip|company_id).* does not exist/i.test(error.message || "")) {
      delete payload.ip;
      delete payload.company_id;
      await admin.from("audit_log").insert(payload);
    }
  } catch (err) {
    console.warn("[otpService] audit log write failed", err?.message || err);
  }
}

function normalizeIdentifier(channel, rawIdentifier) {
  if (channel === "sms") return normalizePhone(rawIdentifier);
  const email = String(rawIdentifier || "").trim().toLowerCase();
  return isValidEmailAddress(email) ? email : null;
}

/**
 * Request a new OTP. Enforces the 60s resend cooldown against the most
 * recent pending row for this identifier+purpose. Falls back to email when
 * the SMS channel is requested but Africa's Talking is not configured, or
 * the send itself fails.
 */
export async function requestOtp(admin, {
  purpose,
  channel,
  identifier: rawIdentifier,
  fallbackEmail,
  companyId = null,
  userId = null,
  ip = null,
} = {}) {
  if (!PURPOSES.has(purpose)) {
    return { success: false, status: 400, error: "Invalid OTP purpose.", code: "INVALID_PURPOSE" };
  }
  if (!CHANNELS.has(channel)) {
    return { success: false, status: 400, error: "Invalid OTP channel.", code: "INVALID_CHANNEL" };
  }

  const identifier = normalizeIdentifier(channel, rawIdentifier);
  if (!identifier) {
    return {
      success: false,
      status: 400,
      error: channel === "sms"
        ? "A valid phone number with country code is required, e.g. +2547XXXXXXXX."
        : "A valid email address is required.",
      code: "INVALID_IDENTIFIER",
    };
  }

  // Enforce the resend cooldown against the latest pending row.
  const { data: latest } = await admin
    .from("otp_verifications")
    .select("id, status, last_sent_at, resend_count, expires_at")
    .eq("identifier", identifier)
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = Date.now();
  if (latest && latest.status === "pending") {
    const elapsedMs = now - new Date(latest.last_sent_at).getTime();
    if (elapsedMs < OTP_RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsedMs) / 1000);
      return {
        success: false,
        status: 429,
        error: `Please wait ${retryAfter}s before requesting another code.`,
        code: "RESEND_COOLDOWN",
        retry_after: retryAfter,
      };
    }
    // Superseded — invalidate the previous pending code.
    await admin.from("otp_verifications").update({ status: "expired" }).eq("id", latest.id);
  }

  const code = generateCode();
  const salt = crypto.randomBytes(16).toString("hex");
  const codeHash = hashCode(code, salt);
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString();
  const resendCount = latest ? Number(latest.resend_count || 0) + 1 : 0;

  let deliveredChannel = channel;
  let fallbackUsed = false;
  let deliveryError = null;

  if (channel === "sms") {
    if (isSmsConfigured()) {
      try {
        await sendSms(identifier, smsBody(code, purpose));
      } catch (err) {
        deliveryError = err;
      }
    } else {
      deliveryError = Object.assign(new Error("SMS not configured"), { code: "CONFIG" });
    }

    if (deliveryError) {
      const emailTarget = String(fallbackEmail || "").trim().toLowerCase();
      if (isValidEmailAddress(emailTarget)) {
        try {
          const template = emailTemplate(code, purpose);
          await sendOutboundEmail({ to: emailTarget, ...template });
          deliveredChannel = "email";
          fallbackUsed = true;
          deliveryError = null;
        } catch (emailErr) {
          deliveryError = emailErr;
        }
      }
    }
  } else {
    try {
      const template = emailTemplate(code, purpose);
      await sendOutboundEmail({ to: identifier, ...template });
    } catch (err) {
      deliveryError = err;
    }
  }

  if (deliveryError) {
    await writeOtpAudit(admin, {
      action: "otp_send_failed",
      identifier,
      purpose,
      channel,
      companyId,
      userId,
      ip,
      details: { error: deliveryError.message || String(deliveryError) },
    });
    const status = deliveryError.code === "CONFIG" ? 503 : deliveryError.code === "VALIDATION" ? 400 : 502;
    return {
      success: false,
      status,
      error: "Unable to send the verification code right now. Please try again shortly.",
      code: "DELIVERY_FAILED",
    };
  }

  const insertPayload = {
    purpose,
    channel: deliveredChannel,
    identifier,
    company_id: companyId,
    user_id: userId,
    code_hash: codeHash,
    code_salt: salt,
    attempts: 0,
    max_attempts: OTP_MAX_ATTEMPTS,
    resend_count: resendCount,
    last_sent_at: new Date(now).toISOString(),
    expires_at: expiresAt,
    status: "pending",
    ip,
    fallback_used: fallbackUsed,
  };
  const { error: insertError } = await admin.from("otp_verifications").insert(insertPayload);
  if (insertError) {
    console.error("[otpService] insert failed", insertError);
    return { success: false, status: 500, error: "Unable to start verification. Please try again.", code: "STORE_FAILED" };
  }

  await writeOtpAudit(admin, {
    action: fallbackUsed ? "otp_sent_email_fallback" : "otp_sent",
    identifier,
    purpose,
    channel: deliveredChannel,
    companyId,
    userId,
    ip,
    details: { mail_provider: deliveredChannel === "email" ? mailProviderLabel() : undefined },
  });

  return {
    success: true,
    channel: deliveredChannel,
    fallback_used: fallbackUsed,
    expires_at: expiresAt,
    resend_after: 60,
    masked_identifier: maskIdentifier(deliveredChannel, identifier),
  };
}

export function maskIdentifier(channel, identifier) {
  if (channel === "email") {
    const [local, domain] = identifier.split("@");
    if (!local || !domain) return identifier;
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
  }
  return identifier.length > 4 ? `${identifier.slice(0, -4).replace(/\d/g, "*")}${identifier.slice(-4)}` : identifier;
}

/**
 * Verify a submitted OTP code against the most recent pending row for the
 * given identifier+purpose. Increments attempts on mismatch and locks the
 * code after OTP_MAX_ATTEMPTS failures.
 */
export async function verifyOtp(admin, { purpose, identifier: rawIdentifier, channel, code, ip = null } = {}) {
  if (!PURPOSES.has(purpose)) {
    return { success: false, status: 400, error: "Invalid OTP purpose.", code: "INVALID_PURPOSE" };
  }
  const identifier = channel ? normalizeIdentifier(channel, rawIdentifier) : normalizeSanitizedIdentifier(rawIdentifier);
  const submittedCode = String(code || "").trim();
  if (!identifier || !/^\d{6}$/.test(submittedCode)) {
    return { success: false, status: 400, error: "A valid 6-digit code is required.", code: "INVALID_CODE" };
  }

  const { data: row, error } = await admin
    .from("otp_verifications")
    .select("id, code_hash, code_salt, attempts, max_attempts, status, expires_at, company_id, user_id")
    .eq("identifier", identifier)
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !row) {
    return { success: false, status: 400, error: "No verification code was requested for this contact.", code: "NOT_FOUND" };
  }

  if (row.status === "locked") {
    return { success: false, status: 423, error: "Too many failed attempts. Please request a new code.", code: "LOCKED" };
  }
  if (row.status === "verified") {
    return { success: false, status: 400, error: "This code has already been used.", code: "ALREADY_VERIFIED" };
  }
  if (row.status === "expired" || new Date(row.expires_at).getTime() < Date.now()) {
    if (row.status !== "expired") {
      await admin.from("otp_verifications").update({ status: "expired" }).eq("id", row.id);
    }
    return { success: false, status: 400, error: "This code has expired. Please request a new one.", code: "EXPIRED" };
  }

  const attemptedHash = hashCode(submittedCode, row.code_salt);
  const isMatch = timingSafeEqualHex(attemptedHash, row.code_hash);

  if (!isMatch) {
    const attempts = Number(row.attempts || 0) + 1;
    const maxAttempts = Number(row.max_attempts || OTP_MAX_ATTEMPTS);
    const nextStatus = attempts >= maxAttempts ? "locked" : "pending";
    await admin.from("otp_verifications").update({ attempts, status: nextStatus }).eq("id", row.id);
    await writeOtpAudit(admin, {
      action: "otp_verify_failed",
      identifier,
      purpose,
      channel: channel || "unknown",
      companyId: row.company_id,
      userId: row.user_id,
      ip,
      details: { attempts, locked: nextStatus === "locked" },
    });
    if (nextStatus === "locked") {
      return { success: false, status: 423, error: "Too many failed attempts. Please request a new code.", code: "LOCKED" };
    }
    return {
      success: false,
      status: 400,
      error: "Incorrect code. Please try again.",
      code: "MISMATCH",
      attempts_remaining: Math.max(0, maxAttempts - attempts),
    };
  }

  await admin
    .from("otp_verifications")
    .update({ status: "verified", verified_at: new Date().toISOString() })
    .eq("id", row.id);

  await writeOtpAudit(admin, {
    action: "otp_verified",
    identifier,
    purpose,
    channel: channel || "unknown",
    companyId: row.company_id,
    userId: row.user_id,
    ip,
    details: {},
  });

  return { success: true, company_id: row.company_id, user_id: row.user_id };
}

const RESET_TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes to apply the new password after OTP verification

/**
 * Stateless, signed "you just verified an OTP for password_reset" ticket.
 * Avoids needing a separate session/DB row between verify and apply-password.
 */
export function createPasswordResetTicket(userId) {
  const expiresAt = Date.now() + RESET_TICKET_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", otpHashSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function verifyPasswordResetTicket(ticket) {
  try {
    const decoded = Buffer.from(String(ticket || ""), "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return { valid: false };
    const [userId, expiresAtRaw, signature] = parts;
    const expiresAt = Number(expiresAtRaw);
    if (!userId || !Number.isFinite(expiresAt)) return { valid: false };
    const expected = crypto.createHmac("sha256", otpHashSecret()).update(`${userId}.${expiresAtRaw}`).digest("hex");
    if (!timingSafeEqualHex(signature, expected)) return { valid: false };
    if (Date.now() > expiresAt) return { valid: false, expired: true };
    return { valid: true, userId };
  } catch {
    return { valid: false };
  }
}

/**
 * Enrollment proof ticket — issued after a successful "login" purpose OTP
 * verification so the account owner can self-enable SMS login verification
 * (proves phone ownership without a second round-trip OTP just for that).
 */
export function createEnrollmentTicket(userId, phone) {
  const expiresAt = Date.now() + RESET_TICKET_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ userId, phone, expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", otpHashSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifyEnrollmentTicket(ticket) {
  try {
    const [payload, signature] = String(ticket || "").split(".");
    if (!payload || !signature) return { valid: false };
    const expected = crypto.createHmac("sha256", otpHashSecret()).update(payload).digest("hex");
    if (!timingSafeEqualHex(signature, expected)) return { valid: false };
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.userId || !data.phone) return { valid: false };
    if (Date.now() > Number(data.expiresAt || 0)) return { valid: false, expired: true };
    return { valid: true, userId: data.userId, phone: data.phone };
  } catch {
    return { valid: false };
  }
}

function normalizeSanitizedIdentifier(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    return isValidEmailAddress(email) ? email : null;
  }
  return normalizePhone(trimmed);
}
