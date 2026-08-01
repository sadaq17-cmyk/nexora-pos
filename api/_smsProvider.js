/**
 * SMS transport — routes through the Supabase Edge Function `send-sms`,
 * which holds the actual Africa's Talking credentials as Supabase secrets.
 * This module (and this Vercel process) never sees the Africa's Talking
 * API key; it only holds SUPABASE_SERVICE_ROLE_KEY, which is already
 * server-only.
 *
 * Kept as a thin, backward-compatible wrapper around `./_smsService.js` so
 * every existing caller (OTP request/verify with email fallback) keeps
 * working unchanged: `sendSms()` still throws on failure with a `.code` of
 * "CONFIG" | "VALIDATION" | "PROVIDER" | "AUTH", and `isSmsConfigured()`
 * still gates whether SMS should be attempted before falling back to email.
 */
import { invokeSendSms, isSendSmsFunctionConfigured } from "./_smsService.js";

export function isSmsConfigured() {
  return isSendSmsFunctionConfigured();
}

/**
 * Normalize a phone number to E.164. We require the caller to already supply
 * a country code (leading "+" or bare digits with country code) — silently
 * guessing a local-format number's country is unsafe for OTP delivery.
 */
export function normalizePhone(phone) {
  const raw = String(phone || "").trim().replace(/[\s().-]/g, "");
  if (!raw) return null;
  if (/^\+\d{8,15}$/.test(raw)) return raw;
  if (/^\d{9,15}$/.test(raw)) return `+${raw}`;
  return null;
}

/**
 * Send a single SMS via the `send-sms` Supabase Edge Function (Africa's
 * Talking). Throws on any failure with a `.code` of "CONFIG" (missing
 * config), "VALIDATION" (bad phone), "PROVIDER" (Africa's Talking
 * rejected/failed the send), or "AUTH" (the Edge Function rejected this
 * caller).
 */
export async function sendSms(phoneNumber, message, options = {}) {
  return invokeSendSms({
    phone: phoneNumber,
    message,
    purpose: options.purpose || "otp",
    companyId: options.companyId,
    userId: options.userId,
    metadata: options.metadata,
  });
}
