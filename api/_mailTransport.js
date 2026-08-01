/**
 * Outbound mail transport: Zoho SMTP (preferred) with Resend fallback.
 * Server-only — never import from src/.
 */
import { Resend } from "resend";
import nodemailer from "nodemailer";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) return false;
  const [local, domain] = email.split("@");
  if (!local || !domain || local.length > 64) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  return domain.includes(".");
}

function defaultFromAddress() {
  return (
    process.env.SMTP_FROM
    || process.env.MAIL_FROM
    || "Nexora POS Pro <noreply@nexorapospro.com>"
  );
}

function zohoSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST
    && process.env.SMTP_USER
    && process.env.SMTP_PASS
  );
}

/** Normalizes {filename, base64, contentType} attachments to what each provider expects. */
function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  return attachments
    .filter((a) => a && a.base64 && a.filename)
    .slice(0, 5) // cap attachment count defensively
    .map((a) => ({
      filename: String(a.filename).slice(0, 150),
      base64: String(a.base64),
      contentType: a.contentType || "application/pdf",
    }));
}

async function sendViaZohoSmtp({ to, subject, html, text, replyTo, attachments }) {
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || (port === 465 ? "true" : "false")).toLowerCase() !== "false";
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: defaultFromAddress(),
    to,
    subject,
    html,
    text,
    replyTo: replyTo && isValidEmailAddress(replyTo) ? replyTo : undefined,
    attachments: normalizeAttachments(attachments).map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.base64, "base64"),
      contentType: a.contentType,
    })),
  });

  return { id: info.messageId || null, provider: "zoho_smtp" };
}

async function sendViaResend({ to, subject, html, text, replyTo, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "Email service not configured. Set Zoho SMTP (SMTP_HOST/SMTP_USER/SMTP_PASS) or RESEND_API_KEY."
    );
    err.code = "CONFIG";
    throw err;
  }
  const resend = new Resend(apiKey);
  const payload = {
    from: defaultFromAddress(),
    to,
    subject,
    html,
    text,
  };
  if (replyTo && isValidEmailAddress(replyTo)) payload.reply_to = replyTo;
  const normalizedAttachments = normalizeAttachments(attachments);
  if (normalizedAttachments.length) {
    payload.attachments = normalizedAttachments.map((a) => ({ filename: a.filename, content: a.base64 }));
  }
  const { data, error } = await resend.emails.send(payload);
  if (error) {
    const err = new Error(error.message || "The email provider rejected the request.");
    err.code = "PROVIDER";
    throw err;
  }
  return { id: data?.id || null, provider: "resend" };
}

/**
 * Send transactional email. Prefers Zoho SMTP when configured.
 * `attachments`: optional array of { filename, base64, contentType }.
 */
export async function sendOutboundEmail({ to, subject, html, text, replyTo, attachments } = {}) {
  const recipient = String(to || "").trim().toLowerCase();
  if (!isValidEmailAddress(recipient)) {
    const err = new Error("A valid recipient email address is required.");
    err.code = "VALIDATION";
    throw err;
  }

  try {
    if (zohoSmtpConfigured()) {
      return await sendViaZohoSmtp({ to: recipient, subject, html, text, replyTo, attachments });
    }
    return await sendViaResend({ to: recipient, subject, html, text, replyTo, attachments });
  } catch (err) {
    console.error("[mailTransport] send failed", {
      to: recipient.replace(/(.{2}).+(@.+)/, "$1***$2"),
      provider: mailProviderLabel(),
      code: err?.code,
      message: err?.message || String(err),
    });
    throw err;
  }
}

export function mailProviderLabel() {
  return zohoSmtpConfigured() ? "zoho_smtp" : (process.env.RESEND_API_KEY ? "resend" : "none");
}
