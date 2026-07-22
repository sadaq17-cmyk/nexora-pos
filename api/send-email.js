import {
  getClientIp,
  consumeRateLimit,
  rateLimitResponse,
  isAllowedOrigin,
  sanitizeText,
  escapeHtml,
  applySecurityHeaders,
  methodNotAllowed,
} from "./_authHelpers.js";
import { isValidEmailAddress, sendOutboundEmail } from "./_mailTransport.js";

/**
 * Transactional + contact email via Zoho SMTP (preferred) or Resend.
 * Contact messages always deliver to support@httpsnexorapos.com.
 */

const SUPPORT_INBOX = "support@httpsnexorapos.com";
const SUPPORTED_TYPES = new Set([
  "verification",
  "password_reset",
  "password_changed",
  "contact",
]);
const TYPES_REQUIRING_LINK = new Set(["verification", "password_reset"]);

function emailShell(bodyHtml) {
  return `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0B1C3D; background: #ffffff;">
    <p style="font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #2563EB; margin: 0 0 20px;">Nexora POS</p>
    ${bodyHtml}
    <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 28px 0 16px;" />
    <p style="font-size: 12px; color: #94A3B8; margin: 0;">Nexora POS &mdash; automated message. Support: ${SUPPORT_INBOX}</p>
  </div>`;
}

function verificationTemplate({ name, companyName, link }) {
  const safeName = escapeHtml(name || "there");
  const safeCompany = escapeHtml(companyName || "your company");
  const subject = "Verify your Nexora POS account";
  const html = emailShell(`
    <h1 style="font-size: 20px; margin: 0 0 16px;">Welcome, ${safeName}!</h1>
    <p style="font-size: 14px; line-height: 22px; margin: 0 0 16px;">Thanks for creating a Nexora POS workspace for <strong>${safeCompany}</strong>. Please confirm your email address to activate your account.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${link}" style="display: inline-block; background: #2563EB; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px;">Verify email address</a>
    </p>
    <p style="font-size: 13px; line-height: 20px; color: #64748B; margin: 0 0 8px;">Or copy and paste this link into your browser:</p>
    <p style="font-size: 13px; line-height: 20px; word-break: break-all; margin: 0 0 16px;"><a href="${link}" style="color: #2563EB;">${escapeHtml(link)}</a></p>
    <p style="font-size: 13px; color: #64748B; margin: 0;">This link will expire in 24 hours.</p>
  `);
  const text = [
    `Welcome to Nexora POS, ${name || "there"}!`,
    `Please verify your email for ${companyName || "your company"}:`,
    link,
    "",
    `Support: ${SUPPORT_INBOX}`,
  ].join("\n");
  return { subject, html, text };
}

function passwordResetTemplate({ name, link }) {
  const safeName = escapeHtml(name || "there");
  const subject = "Reset your Nexora POS password";
  const html = emailShell(`
    <h1 style="font-size: 20px; margin: 0 0 16px;">Hi ${safeName},</h1>
    <p style="font-size: 14px; line-height: 22px; margin: 0 0 16px;">We received a request to reset your Nexora POS password.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${link}" style="display: inline-block; background: #2563EB; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px;">Reset password</a>
    </p>
    <p style="font-size: 13px; line-height: 20px; word-break: break-all; margin: 0 0 16px;"><a href="${link}" style="color: #2563EB;">${escapeHtml(link)}</a></p>
    <p style="font-size: 13px; color: #64748B; margin: 0;">This link expires in 1 hour. If you did not request this, ignore this email.</p>
  `);
  const text = [
    `Hi ${name || "there"},`,
    "Reset your Nexora POS password:",
    link,
    "",
    `Support: ${SUPPORT_INBOX}`,
  ].join("\n");
  return { subject, html, text };
}

function passwordChangedTemplate({ name }) {
  const safeName = escapeHtml(name || "there");
  const subject = "Your Nexora POS password was changed";
  const html = emailShell(`
    <h1 style="font-size: 20px; margin: 0 0 16px;">Hi ${safeName},</h1>
    <p style="font-size: 14px; line-height: 22px; margin: 0 0 16px;">Your Nexora POS password was just changed.</p>
    <p style="font-size: 14px; line-height: 22px; margin: 0; font-weight: 600;">If you did not do this, contact ${SUPPORT_INBOX} immediately.</p>
  `);
  const text = [
    `Hi ${name || "there"},`,
    "Your Nexora POS password was just changed.",
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

function isSafeHttpsLink(link) {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "www.httpsnexorapos.com" ||
      host === "httpsnexorapos.com" ||
      host.endsWith(".vercel.app") ||
      host === "localhost" ||
      host === "127.0.0.1"
    );
  } catch {
    return false;
  }
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

async function deliver(res, { to, subject, html, text, replyTo }) {
  try {
    const result = await sendOutboundEmail({ to, subject, html, text, replyTo });
    return res.status(200).json({ success: true, id: result.id, provider: result.provider });
  } catch (err) {
    console.error("[send-email] Unexpected error:", err);
    const status = err?.code === "CONFIG" ? 503 : err?.code === "VALIDATION" ? 400 : 502;
    return res.status(status).json({
      success: false,
      error: err?.message || "Unable to send email right now. Please try again later or contact support.",
    });
  }
}
