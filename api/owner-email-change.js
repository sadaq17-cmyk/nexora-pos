import { createHash, randomBytes } from "node:crypto";
import {
  applySecurityHeaders,
  createAdminClient,
  beginApiRequest,
  isAllowedOrigin,
  verifyCallerFromRequest,
  parseBody,
  methodNotAllowed,
  jsonError,
  isOwner,
  listAllAuthUsers,
  getClientIp,
  consumeRateLimit,
  rateLimitResponse,
  sanitizeText,
  escapeHtml,
} from "./_authHelpers.js";
import { isValidEmailAddress, sendOutboundEmail, mailProviderLabel } from "./_mailTransport.js";

const SITE_ORIGIN = "https://www.nexorapospro.com";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function makeToken() {
  return randomBytes(32).toString("hex");
}

function siteOriginFromRequest(req) {
  const origin = String(req.headers?.origin || "").trim();
  if (origin.startsWith("https://") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
    return origin.replace(/\/$/, "");
  }
  return SITE_ORIGIN;
}

function emailChangeTemplate({ name, newEmail, link }) {
  const safeName = escapeHtml(name || "there");
  const safeEmail = escapeHtml(newEmail);
  const subject = "Confirm your new Nexora POS Pro login email";
  const html = `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0F172A;">
    <p style="font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #059669; margin: 0 0 20px;">Nexora POS Pro</p>
    <h1 style="font-size: 20px; margin: 0 0 16px;">Confirm email change</h1>
    <p style="font-size: 14px; line-height: 22px; margin: 0 0 16px;">Hi ${safeName}, confirm that <strong>${safeEmail}</strong> should become your Company Owner login email.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${link}" style="display: inline-block; background: #059669; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px;">Confirm new email</a>
    </p>
    <p style="font-size: 13px; line-height: 20px; word-break: break-all; margin: 0 0 16px;"><a href="${link}" style="color: #059669;">${escapeHtml(link)}</a></p>
    <p style="font-size: 13px; color: #64748B; margin: 0;">This link expires in 24 hours. If you did not request this, ignore this message.</p>
  </div>`;
  const text = [
    `Hi ${name || "there"},`,
    `Confirm that ${newEmail} should become your Company Owner login email:`,
    link,
    "",
    "This link expires in 24 hours.",
  ].join("\n");
  return { subject, html, text };
}

async function applyEmailChange(admin, userId, nextEmail) {
  const { data: existingData, error: getError } = await admin.auth.admin.getUserById(userId);
  if (getError || !existingData?.user) {
    return { success: false, status: 404, error: "User not found." };
  }
  const user = existingData.user;
  const meta = user.app_metadata || {};
  const previousEmail = String(user.email || "").toLowerCase();
  const all = await listAllAuthUsers(admin);
  if (all.some((row) => row.id !== userId && String(row.email || "").toLowerCase() === nextEmail)) {
    return { success: false, status: 409, error: "That email address is already in use." };
  }

  // Apply login email only after Zoho verification — admin API, not supabase.auth.updateUser.
  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, {
    email: nextEmail,
    email_confirm: true,
    app_metadata: {
      ...meta,
      pending_email_change: null,
      email_customized: true,
      email_changed_at: new Date().toISOString(),
      previous_login_email: previousEmail || null,
    },
    user_metadata: {
      ...(user.user_metadata || {}),
      email: nextEmail,
      name: meta.name || user.user_metadata?.name || "",
    },
  });
  if (updateError) {
    return { success: false, status: 502, error: updateError.message || "Unable to update email address." };
  }

  const confirmedEmail = String(updated?.user?.email || nextEmail).toLowerCase();
  return {
    success: true,
    email: confirmedEmail,
    company_id: meta.company_id ?? null,
    previous_email: previousEmail,
  };
}

export default async function handler(req, res) {
  if (beginApiRequest(req, res, { methods: ["POST"] })) return;

  const ip = getClientIp(req);
  if (!consumeRateLimit(`owner-email-change:${ip}`, 10, 60_000)) {
    return rateLimitResponse(res, 60);
  }

  const body = parseBody(req);
  const action = String(body.action || "request").trim().toLowerCase();

  try {
    if (action === "confirm") {
      const userId = String(body.user_id || body.uid || "").trim();
      const token = String(body.token || "").trim();
      if (!userId || !token) return jsonError(res, 400, "Verification token is required.");

      const admin = createAdminClient();
      let data = null;
      try {
        const lookup = await admin.auth.admin.getUserById(userId);
        data = lookup.data;
        if (lookup.error || !data?.user) {
          return jsonError(res, 404, "Verification link is invalid or expired.");
        }
      } catch {
        return jsonError(res, 404, "Verification link is invalid or expired.");
      }

      const pending = data.user.app_metadata?.pending_email_change;
      if (!pending?.email || !pending?.token_hash || !pending?.expires_at) {
        return jsonError(res, 400, "No pending email change was found for this account.");
      }
      if (new Date(pending.expires_at).getTime() < Date.now()) {
        return jsonError(res, 400, "This verification link has expired. Request a new email change.");
      }
      if (hashToken(token) !== String(pending.token_hash)) {
        return jsonError(res, 400, "This verification link is invalid or has already been used.");
      }
      if (!isValidEmailAddress(pending.email)) {
        return jsonError(res, 400, "Pending email address is invalid.");
      }

      const applied = await applyEmailChange(admin, userId, String(pending.email).toLowerCase());
      if (!applied.success) return jsonError(res, applied.status || 502, applied.error);
      return res.status(200).json({
        success: true,
        email: applied.email,
        previous_email: applied.previous_email,
        company_id: applied.company_id,
        login_email_updated: true,
        message: "Email verified. You can sign in with your new login email.",
      });
    }

    if (action !== "request") {
      return jsonError(res, 400, "Unsupported action.");
    }

    const verified = await verifyCallerFromRequest(req);
    if (verified.error) return jsonError(res, verified.status, verified.error);
    const { caller } = verified;

    if (!isOwner(caller.role)) {
      return jsonError(res, 403, "Only the Company Owner can change their login email.", "FORBIDDEN");
    }

    const nextEmail = sanitizeText(body.email, 160).toLowerCase();
    if (!isValidEmailAddress(nextEmail)) {
      return jsonError(res, 400, "Enter a valid email address.");
    }
    if (nextEmail === String(caller.email || "").toLowerCase()) {
      return jsonError(res, 400, "That is already your current login email.");
    }

    const admin = createAdminClient();
    const { data: existingData, error: getError } = await admin.auth.admin.getUserById(caller.id);
    if (getError || !existingData?.user) return jsonError(res, 404, "User not found.");

    const all = await listAllAuthUsers(admin);
    if (all.some((row) => row.id !== caller.id && String(row.email || "").toLowerCase() === nextEmail)) {
      return jsonError(res, 409, "That email address is already in use.");
    }

    // Keep current login email + session intact until verification completes.
    // Only store a pending change marker — do not call Auth updateUser({ email }).
    if (mailProviderLabel() !== "zoho_smtp") {
      return jsonError(
        res,
        503,
        "Zoho SMTP is required for owner email verification. Set SMTP_HOST, SMTP_USER, and SMTP_PASS (support@httpsnexorapos.com) in Vercel.",
        "ZOHO_SMTP_REQUIRED"
      );
    }

    const token = makeToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    const meta = existingData.user.app_metadata || {};
    const currentLoginEmail = String(existingData.user.email || caller.email || "").toLowerCase();
    const { error: metaError } = await admin.auth.admin.updateUserById(caller.id, {
      app_metadata: {
        ...meta,
        pending_email_change: {
          email: nextEmail,
          token_hash: hashToken(token),
          expires_at: expiresAt,
          requested_at: new Date().toISOString(),
          previous_email: currentLoginEmail,
        },
      },
    });
    if (metaError) {
      return jsonError(res, 502, metaError.message || "Unable to start email change.");
    }

    const origin = siteOriginFromRequest(req);
    const link = `${origin}/verify-email-change?uid=${encodeURIComponent(caller.id)}&token=${encodeURIComponent(token)}`;
    const template = emailChangeTemplate({
      name: caller.name || meta.name || "there",
      newEmail: nextEmail,
      link,
    });

    try {
      const mailed = await sendOutboundEmail({
        to: nextEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });
      if (mailed.provider !== "zoho_smtp") {
        return jsonError(res, 503, "Owner email verification must be sent through Zoho SMTP.", "ZOHO_SMTP_REQUIRED");
      }
    } catch (mailErr) {
      console.error("[owner-email-change] mail failed:", mailErr);
      return jsonError(
        res,
        mailErr?.code === "CONFIG" ? 503 : 502,
        mailErr?.message || "Unable to send verification email. Check Zoho SMTP configuration."
      );
    }

    return res.status(200).json({
      success: true,
      emailVerificationSent: true,
      pendingEmail: nextEmail,
      currentLoginEmail,
      sessionUnchanged: true,
      provider: "zoho_smtp",
      message: "Verification email sent via Zoho SMTP. Your current login stays active until you confirm the new address.",
    });
  } catch (err) {
    if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
    console.error("[owner-email-change]", err);
    return jsonError(res, 500, "Unable to process email change.");
  }
}
