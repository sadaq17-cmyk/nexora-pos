import {
  getClientIp,
  consumeRateLimit,
  rateLimitResponse,
  isAllowedOrigin,
  sanitizeText,
  escapeHtml,
  applySecurityHeaders,
  methodNotAllowed,
  verifyCallerFromRequest,
  createAdminClient,
  jsonError,
} from "./_authHelpers.js";
import { isValidEmailAddress, sendOutboundEmail, mailProviderLabel } from "./_mailTransport.js";
import { normalizePhone } from "./_smsProvider.js";
import {
  requestOtp,
  verifyOtp,
  maskIdentifier,
  createPasswordResetTicket,
  verifyPasswordResetTicket,
  createEnrollmentTicket,
  OTP_TTL_MS,
} from "./_otpService.js";
import { validatePassword } from "../src/lib/passwordPolicy.js";

/**
 * Nexora POS Pro — transactional + contact email via Zoho SMTP (preferred) or Resend.
 * Contact messages always deliver to support@httpsnexorapos.com.
 *
 * Security:
 * - `contact` is public (rate-limited + honeypot).
 * - `password_changed` requires a valid Bearer session; recipient must match the caller.
 * - `verification` / `password_reset` require an internal server secret (no public relay).
 */

const SUPPORT_INBOX = "support@httpsnexorapos.com";
const SUPPORTED_TYPES = new Set([
  "verification",
  "password_reset",
  "password_changed",
  "contact",
  "supplier_statement",
]);
const TYPES_REQUIRING_LINK = new Set(["verification", "password_reset"]);
const TYPES_REQUIRING_INTERNAL_SECRET = new Set(["verification", "password_reset"]);

function emailShell(bodyHtml) {
  return `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0B1C3D; background: #ffffff;">
    <p style="font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #2563EB; margin: 0 0 20px;">Nexora POS Pro</p>
    ${bodyHtml}
    <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 28px 0 16px;" />
    <p style="font-size: 12px; color: #94A3B8; margin: 0;">Nexora POS Pro &mdash; automated message. Support: ${SUPPORT_INBOX}</p>
  </div>`;
}

function verificationTemplate({ name, companyName, link }) {
  const safeName = escapeHtml(name || "there");
  const safeCompany = escapeHtml(companyName || "your company");
  const subject = "Verify your Nexora POS Pro account";
  const html = emailShell(`
    <h1 style="font-size: 20px; margin: 0 0 16px;">Welcome, ${safeName}!</h1>
    <p style="font-size: 14px; line-height: 22px; margin: 0 0 16px;">Thanks for creating a Nexora POS Pro workspace for <strong>${safeCompany}</strong>. Please confirm your email address to activate your account.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${link}" style="display: inline-block; background: #2563EB; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px;">Verify email address</a>
    </p>
    <p style="font-size: 13px; line-height: 20px; color: #64748B; margin: 0 0 8px;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 13px; line-height: 20px; word-break: break-all; margin: 0 0 16px;"><a href="${link}" style="color: #2563EB;">${escapeHtml(link)}</a></p>
    <p style="font-size: 13px; color: #64748B; margin: 0;">This link will expire in 24 hours.</p>
  `);
  const text = [
    `Welcome to Nexora POS Pro, ${name || "there"}!`,
    `Please verify your email for ${companyName || "your company"}:`,
    link,
    "",
    `Support: ${SUPPORT_INBOX}`,
  ].join("\n");
  return { subject, html, text };
}

function passwordResetTemplate({ name, link }) {
  const safeName = escapeHtml(name || "there");
  const subject = "Reset your Nexora POS Pro password";
  const html = emailShell(`
    <h1 style="font-size: 20px; margin: 0 0 16px;">Hi ${safeName},</h1>
    <p style="font-size: 14px; line-height: 22px; margin: 0 0 16px;">We received a request to reset your Nexora POS Pro password.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${link}" style="display: inline-block; background: #2563EB; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px;">Reset password</a>
    </p>
    <p style="font-size: 13px; line-height: 20px; word-break: break-all; margin: 0 0 16px;"><a href="${link}" style="color: #2563EB;">${escapeHtml(link)}</a></p>
    <p style="font-size: 13px; color: #64748B; margin: 0;">This link expires in 1 hour. If you did not request this, ignore this email.</p>
  `);
  const text = [
    `Hi ${name || "there"},`,
    "Reset your Nexora POS Pro password:",
    link,
    "",
    `Support: ${SUPPORT_INBOX}`,
  ].join("\n");
  return { subject, html, text };
}

function passwordChangedTemplate({ name }) {
  const safeName = escapeHtml(name || "there");
  const subject = "Your Nexora POS Pro password was changed";
  const html = emailShell(`
    <h1 style="font-size: 20px; margin: 0 0 16px;">Hi ${safeName},</h1>
    <p style="font-size: 14px; line-height: 22px; margin: 0 0 16px;">Your Nexora POS Pro password was just changed.</p>
    <p style="font-size: 14px; line-height: 22px; margin: 0; font-weight: 600;">If you did not do this, contact ${SUPPORT_INBOX} immediately.</p>
  `);
  const text = [
    `Hi ${name || "there"},`,
    "Your Nexora POS Pro password was just changed.",
    `If you did not do this, contact ${SUPPORT_INBOX} immediately.`,
  ].join("\n");
  return { subject, html, text };
}

function contactTemplate({ name, email, company, phone, message }) {
  const subject = `[Nexora Contact] ${sanitizeText(name, 80)} — ${sanitizeText(company || "No company", 80)}`;
  const html = emailShell(`
    <h1 style="font-size: 20px; margin: 0 0 16px;">New website contact message</h1>
    <p style="font-size: 14px; margin: 0 0 8px;"><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p style="font-size: 14px; margin: 0 0 8px;"><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p style="font-size: 14px; margin: 0 0 8px;"><strong>Company:</strong> ${escapeHtml(company || "—")}</p>
    <p style="font-size: 14px; margin: 0 0 8px;"><strong>Phone:</strong> ${escapeHtml(phone || "—")}</p>
    <p style="font-size: 14px; margin: 16px 0 8px;"><strong>Message:</strong></p>
    <p style="font-size: 14px; line-height: 22px; white-space: pre-wrap; margin: 0;">${escapeHtml(message)}</p>
  `);
  const text = [
    "New website contact message",
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company || "—"}`,
    `Phone: ${phone || "—"}`,
    "",
    message,
  ].join("\n");
  return { subject, html, text, replyTo: email };
}

function buildTemplate(type, payload) {
  if (type === "verification") return verificationTemplate(payload);
  if (type === "password_reset") return passwordResetTemplate(payload);
  if (type === "password_changed") return passwordChangedTemplate(payload);
  if (type === "contact") return contactTemplate(payload);
  return null;
}

function productionHosts() {
  const hosts = new Set([
    "www.nexorapospro.com",
    "nexorapospro.com",
  ]);
  const vercelUrl = String(process.env.VERCEL_URL || "").trim().toLowerCase();
  if (vercelUrl) {
    hosts.add(vercelUrl.replace(/^https?:\/\//, "").split("/")[0]);
  }
  const appUrl = String(process.env.VITE_APP_URL || process.env.APP_URL || "").trim();
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  return hosts;
}

function isSafeHttpsLink(link) {
  try {
    const url = new URL(link);
    const isProd = String(process.env.VERCEL_ENV || process.env.NODE_ENV || "").toLowerCase() === "production";
    if (isProd) {
      if (url.protocol !== "https:") return false;
    } else if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (productionHosts().has(host)) return true;
    if (!isProd && (host === "localhost" || host === "127.0.0.1")) return true;
    // Preview deployments: only the exact VERCEL_URL host (never *.vercel.app wildcard).
    const vercelHost = String(process.env.VERCEL_URL || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (vercelHost && host === vercelHost && host.endsWith(".vercel.app")) return true;
    return false;
  } catch {
    return false;
  }
}

function hasValidInternalSecret(req) {
  const expected = String(
    process.env.SEND_EMAIL_SECRET || process.env.INTERNAL_API_SECRET || ""
  ).trim();
  if (!expected || expected.length < 16) return false;
  const provided = String(
    req.headers?.["x-nexora-email-secret"]
      || req.headers?.["x-internal-secret"]
      || ""
  ).trim();
  if (!provided || provided.length !== expected.length) return false;
  // Constant-time-ish compare
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (req.method !== "POST") return methodNotAllowed(res, "POST");

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ success: false, error: "Forbidden origin.", code: "ORIGIN" });
  }

  const ip = getClientIp(req);
  if (!consumeRateLimit(`send-email:${ip}`, 12, 60_000)) {
    return rateLimitResponse(res, 60);
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body && typeof body === "object" ? body : {};

  const action = String(body.action || "");
  if (action === "otp_request" || action === "otp_verify" || action === "otp_reset_password") {
    return handleOtp(req, res, { action, body, ip });
  }

  const type = String(body.type || "");
  if (!SUPPORTED_TYPES.has(type)) {
    return res.status(400).json({ success: false, error: "Unsupported email type." });
  }

  if (type === "contact") {
    if (!consumeRateLimit(`contact:${ip}`, 3, 60_000)) {
      return rateLimitResponse(res, 60);
    }
    // Honeypot
    if (sanitizeText(body.website || "", 20)) {
      return res.status(200).json({ success: true });
    }
    const name = sanitizeText(body.name, 120);
    const email = sanitizeText(body.email, 160).toLowerCase();
    const company = sanitizeText(body.company, 120);
    const phone = sanitizeText(body.phone, 40);
    const message = sanitizeText(body.message, 2000);
    if (!name || !isValidEmailAddress(email) || message.length < 10) {
      return res.status(400).json({ success: false, error: "Please provide valid contact details." });
    }
    const template = buildTemplate("contact", { name, email, company, phone, message });
    return deliver(res, {
      to: SUPPORT_INBOX,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: email,
    });
  }

  // Branded auth emails must not be an open relay.
  if (TYPES_REQUIRING_INTERNAL_SECRET.has(type)) {
    if (!hasValidInternalSecret(req)) {
      return jsonError(
        res,
        403,
        "Transactional email type is not publicly available.",
        "EMAIL_AUTH_REQUIRED"
      );
    }
  }

  if (type === "password_changed") {
    const verified = await verifyCallerFromRequest(req);
    if (verified.error) {
      return jsonError(res, verified.status || 401, verified.error, "UNAUTHENTICATED");
    }
    const callerEmail = String(verified.caller?.email || "").toLowerCase();
    const to = sanitizeText(body.to, 160).toLowerCase();
    if (!to || !isValidEmailAddress(to) || to !== callerEmail) {
      return jsonError(res, 403, "You can only notify your own account email.", "FORBIDDEN");
    }
    const name = sanitizeText(body.name, 120);
    const template = buildTemplate("password_changed", { name });
    return deliver(res, {
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  if (type === "supplier_statement") {
    if (!consumeRateLimit(`statement-email:${ip}`, 6, 60_000)) {
      return rateLimitResponse(res, 60);
    }
    const verified = await verifyCallerFromRequest(req);
    if (verified.error) {
      return jsonError(res, verified.status || 401, verified.error, "UNAUTHENTICATED");
    }
    const caller = verified.caller;

    const to = sanitizeText(body.to, 160).toLowerCase();
    const supplierId = Number(body.supplier_id);
    const pdfBase64 = String(body.pdf_base64 || "");
    const attachmentName = sanitizeText(body.filename, 150) || "supplier-statement.pdf";
    const note = sanitizeText(body.message, 1000);

    if (!to || !isValidEmailAddress(to)) {
      return res.status(400).json({ success: false, error: "A valid recipient email address is required." });
    }
    if (!supplierId) {
      return res.status(400).json({ success: false, error: "supplier_id is required." });
    }
    if (!pdfBase64 || pdfBase64.length > 12_000_000) {
      return res.status(400).json({ success: false, error: "A valid statement PDF attachment is required." });
    }

    const admin = createAdminClient();
    const { data: supplier } = await admin.from("suppliers").select("id,name,company_id").eq("id", supplierId).maybeSingle();
    if (!supplier) {
      return res.status(404).json({ success: false, error: "Supplier not found." });
    }
    if (caller.role !== "platform_owner" && String(supplier.company_id) !== String(caller.company_id)) {
      return jsonError(res, 403, "You do not have access to this supplier.", "FORBIDDEN");
    }

    const html = emailShell(`
      <h2 style="font-size: 18px; margin: 0 0 12px;">Supplier Statement</h2>
      <p style="font-size: 14px; line-height: 1.6; margin: 0 0 12px;">Hello,</p>
      <p style="font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
        Please find attached the account statement for <strong>${escapeHtml(supplier.name)}</strong>.
        ${note ? escapeHtml(note) : "Kindly review the attached document for full transaction details."}
      </p>
      <p style="font-size: 13px; color: #64748B; margin: 0;">Sent by ${escapeHtml(caller.name || caller.username || "Nexora POS Pro")}.</p>
    `);
    return deliver(res, {
      to,
      subject: `Supplier Statement — ${supplier.name}`,
      html,
      text: `Please find attached the account statement for ${supplier.name}.`,
      attachments: [{ filename: attachmentName, base64: pdfBase64, contentType: "application/pdf" }],
    });
  }

  const to = sanitizeText(body.to, 160).toLowerCase();
  const name = sanitizeText(body.name, 120);
  const companyName = sanitizeText(body.companyName, 120);
  const link = sanitizeText(body.link, 2000);

  if (!to || !isValidEmailAddress(to)) {
    return res.status(400).json({ success: false, error: "A valid recipient email address is required." });
  }
  if (TYPES_REQUIRING_LINK.has(type) && (!link || !isSafeHttpsLink(link))) {
    return res.status(400).json({ success: false, error: "A valid verification/reset link is required." });
  }

  const template = buildTemplate(type, { name, companyName, link });
  if (!template) {
    return res.status(400).json({ success: false, error: "Unable to build email content." });
  }

  return deliver(res, {
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Look up the account (id, phone, company_id) behind an email for
 * password-reset OTP requests. Returns null if no account matches — callers
 * must respond with the same generic shape either way (no enumeration).
 */
async function resolveAccountForReset(admin, email) {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, company_id")
    .eq("email", email)
    .maybeSingle();
  if (!profile?.id) return null;
  try {
    const { data } = await admin.auth.admin.getUserById(profile.id);
    const phone = data?.user?.phone || data?.user?.app_metadata?.phone || "";
    return { id: profile.id, company_id: profile.company_id ?? null, phone };
  } catch {
    return { id: profile.id, company_id: profile.company_id ?? null, phone: "" };
  }
}

const GENERIC_RESET_MESSAGE = "If an account matches those details, a verification code has been sent.";

/**
 * OTP send/verify/apply — shares this endpoint's origin check, security
 * headers, and rate-limit infrastructure (Hobby plan: no extra serverless
 * function).
 */
async function handleOtp(req, res, { action, body, ip }) {
  if (!consumeRateLimit(`otp:ip:${ip}`, 10, 60_000)) {
    return rateLimitResponse(res, 60);
  }

  const purpose = sanitizeText(body.purpose, 32);
  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return jsonError(res, 503, err.message, "CONFIG");
  }

  if (action === "otp_reset_password") {
    const ticket = sanitizeText(body.ticket, 400);
    const newPassword = String(body.new_password || body.password || "");
    const ticketCheck = verifyPasswordResetTicket(ticket);
    if (!ticketCheck.valid) {
      return jsonError(
        res,
        400,
        ticketCheck.expired ? "This reset session has expired. Please verify again." : "Invalid or expired reset session.",
        ticketCheck.expired ? "TICKET_EXPIRED" : "TICKET_INVALID"
      );
    }
    if (!consumeRateLimit(`otp:apply-reset:${ticketCheck.userId}`, 5, 10 * 60_000)) {
      return rateLimitResponse(res, 60);
    }
    const policy = validatePassword(newPassword);
    if (!policy.ok) {
      return jsonError(res, 400, policy.message || "Password does not meet security requirements.", "WEAK_PASSWORD");
    }
    try {
      const { error } = await admin.auth.admin.updateUserById(ticketCheck.userId, { password: newPassword });
      if (error) {
        console.error("[send-email] otp_reset_password update failed", error);
        return jsonError(res, 502, "Unable to reset the password. Please try again.", "UPDATE_FAILED");
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("[send-email] otp_reset_password", err);
      return jsonError(res, 500, "Unable to reset the password right now.");
    }
  }

  if (action === "otp_request") {
    const channel = sanitizeText(body.channel, 8) || "sms";
    let identifier = sanitizeText(body.identifier || body.phone || body.email, 160);
    const fallbackEmail = sanitizeText(body.fallback_email || body.email, 160).toLowerCase();
    let companyId = body.company_id == null || body.company_id === "" ? null : body.company_id;
    let userId = sanitizeText(body.user_id, 80) || null;

    // Password reset must prove account ownership server-side — never trust a
    // client-supplied identifier alone. Response shape is identical whether
    // or not the account/phone actually matches (no account enumeration).
    if (purpose === "password_reset") {
      const email = sanitizeText(body.email, 160).toLowerCase();
      if (!email || !isValidEmailAddress(email)) {
        return jsonError(res, 400, "A valid account email is required.", "MISSING_EMAIL");
      }
      if (!consumeRateLimit(`otp:reset-lookup:${email}`, 5, 10 * 60_000)) {
        return rateLimitResponse(res, 60);
      }
      const account = await resolveAccountForReset(admin, email);
      const genericExpiry = new Date(Date.now() + OTP_TTL_MS).toISOString();

      if (channel === "sms") {
        const typedPhone = normalizePhone(sanitizeText(body.phone, 40));
        const accountPhone = account?.phone ? normalizePhone(account.phone) : null;
        if (!account || !typedPhone || !accountPhone || typedPhone !== accountPhone) {
          return res.status(200).json({
            success: true,
            channel: "sms",
            fallback_used: false,
            expires_at: genericExpiry,
            resend_after: 60,
            message: GENERIC_RESET_MESSAGE,
            masked_identifier: typedPhone ? maskIdentifier("sms", typedPhone) : "your phone",
          });
        }
        identifier = typedPhone;
        userId = account.id;
        companyId = account.company_id;
      } else {
        if (!account) {
          return res.status(200).json({
            success: true,
            channel: "email",
            fallback_used: false,
            expires_at: genericExpiry,
            resend_after: 60,
            message: GENERIC_RESET_MESSAGE,
            masked_identifier: maskIdentifier("email", email),
          });
        }
        identifier = email;
        userId = account.id;
        companyId = account.company_id;
      }
    }

    if (!identifier) {
      return jsonError(res, 400, "A phone number or email address is required.", "MISSING_IDENTIFIER");
    }
    if (!consumeRateLimit(`otp:req:${identifier}:${purpose}`, 5, 10 * 60_000)) {
      return rateLimitResponse(res, 60);
    }

    try {
      const result = await requestOtp(admin, {
        purpose,
        channel,
        identifier,
        fallbackEmail,
        companyId,
        userId,
        ip,
      });
      if (!result.success) {
        if (result.retry_after) res.setHeader("Retry-After", String(result.retry_after));
        return res.status(result.status || 400).json({
          success: false,
          error: result.error,
          code: result.code,
          retry_after: result.retry_after,
        });
      }
      return res.status(200).json({
        success: true,
        channel: result.channel,
        fallback_used: result.fallback_used,
        expires_at: result.expires_at,
        resend_after: result.resend_after,
        masked_identifier: result.masked_identifier,
      });
    } catch (err) {
      console.error("[send-email] otp_request", err);
      return jsonError(res, 500, "Unable to send the verification code right now.");
    }
  }

  // action === "otp_verify"
  const channel = body.channel ? sanitizeText(body.channel, 8) : null;
  const identifier = sanitizeText(body.identifier || body.phone || body.email, 160);
  const code = sanitizeText(body.code, 12);

  if (!identifier) {
    return jsonError(res, 400, "A phone number or email address is required.", "MISSING_IDENTIFIER");
  }
  if (!consumeRateLimit(`otp:verify:${identifier}:${purpose}`, 8, 10 * 60_000)) {
    return rateLimitResponse(res, 60);
  }

  try {
    const result = await verifyOtp(admin, { purpose, identifier, channel, code, ip });
    if (!result.success) {
      // Password reset: never let the response shape (NOT_FOUND vs MISMATCH vs
      // EXPIRED, attempts_remaining) distinguish "no account/phone match" from
      // "wrong code" — that would re-introduce account enumeration.
      if (purpose === "password_reset") {
        return res.status(400).json({
          success: false,
          error: "Incorrect or expired code. Please try again.",
          code: "MISMATCH",
        });
      }
      return res.status(result.status || 400).json({
        success: false,
        error: result.error,
        code: result.code,
        attempts_remaining: result.attempts_remaining,
      });
    }

    const response = { success: true, company_id: result.company_id, user_id: result.user_id };
    if (purpose === "password_reset" && result.user_id) {
      response.reset_ticket = createPasswordResetTicket(result.user_id);
    }
    if (purpose === "login" && result.user_id && identifier) {
      response.enrollment_ticket = createEnrollmentTicket(result.user_id, identifier);
    }
    if (purpose === "registration" && result.user_id) {
      // Contact method confirmed via OTP — unblock login the same way an
      // email-link confirmation would, without requiring the email click.
      try {
        await admin.auth.admin.updateUserById(result.user_id, { email_confirm: true, phone_confirm: true });
      } catch (confirmErr) {
        console.warn("[send-email] otp_verify registration confirm failed", confirmErr?.message || confirmErr);
      }
      // Activate the pending company workspace so the free trial can start.
      try {
        const companyId = result.company_id;
        if (companyId != null && companyId !== "") {
          await admin
            .from("companies")
            .update({ status: "active" })
            .eq("id", companyId)
            .eq("status", "pending_verification");
        } else {
          // Fallback: activate by owner_user_id when OTP row has no company_id.
          await admin
            .from("companies")
            .update({ status: "active" })
            .eq("owner_user_id", result.user_id)
            .eq("status", "pending_verification");
        }
      } catch (activateErr) {
        console.warn("[send-email] otp_verify company activate failed", activateErr?.message || activateErr);
      }
      response.email_confirmed = true;
      response.company_activated = true;
    }
    return res.status(200).json(response);
  } catch (err) {
    console.error("[send-email] otp_verify", err);
    return jsonError(res, 500, "Unable to verify the code right now.");
  }
}

async function deliver(res, { to, subject, html, text, replyTo, attachments }) {
  try {
    const result = await sendOutboundEmail({ to, subject, html, text, replyTo, attachments });
    return res.status(200).json({ success: true, id: result.id, provider: result.provider });
  } catch (err) {
    console.error("[send-email] delivery failed", {
      to: String(to || "").replace(/(.{2}).+(@.+)/, "$1***$2"),
      code: err?.code,
      message: err?.message || String(err),
      provider: mailProviderLabel(),
    });
    const status = err?.code === "CONFIG" ? 503 : err?.code === "VALIDATION" ? 400 : 502;
    return res.status(status).json({
      success: false,
      error: "Unable to send email right now. Please try again later or contact support.",
      code: err?.code === "CONFIG" ? "CONFIG" : "DELIVERY_FAILED",
    });
  }
}
