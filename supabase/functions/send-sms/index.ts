// Supabase Edge Function: send-sms
//
// Server-to-server only SMS gateway (Africa's Talking). This function must
// NEVER be callable from the frontend — the Africa's Talking API key lives
// exclusively in Supabase Edge Function secrets and is never exposed to any
// client bundle.
//
// Auth model (defense in depth):
//   1. `verify_jwt = true` (supabase/config.toml) — the Supabase gateway
//      rejects any request without a valid, project-signed JWT before this
//      code even runs.
//   2. This function additionally requires the JWT's `role` claim to be
//      "service_role" — i.e. only the Vercel backend, calling with
//      SUPABASE_SERVICE_ROLE_KEY, may invoke it. Anon or end-user JWTs are
//      rejected even though they pass gateway verification.
//
// Every send attempt (success or failure) is logged to public.sms_logs via
// the service-role client for auditing.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendSms, normalizePhone, isSmsConfigured, SmsError } from "../_shared/africastalking.ts";

const PURPOSES = new Set([
  "registration",
  "otp",
  "login",
  "password_reset",
  "subscription_confirmation",
  "payment_confirmation",
  "invoice_notification",
  "custom",
]);

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeJwtRole(authHeader: string | null): string | null {
  try {
    const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson);
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function logAttempt(params: {
  purpose: string;
  phone: string;
  message: string;
  status: "sent" | "failed";
  providerMessageId?: string | null;
  cost?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  companyId?: number | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    const admin = adminClient();
    await admin.from("sms_logs").insert({
      purpose: params.purpose,
      phone: params.phone,
      message: params.message,
      status: params.status,
      provider: "africastalking",
      provider_message_id: params.providerMessageId ?? null,
      cost: params.cost ?? null,
      error_code: params.errorCode ?? null,
      error_message: params.errorMessage ?? null,
      company_id: params.companyId ?? null,
      user_id: params.userId ?? null,
      metadata: params.metadata ?? {},
      ip: params.ip ?? null,
    });
  } catch (err) {
    console.error("[send-sms] failed to write sms_logs", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" }, 405);
  }

  // Defense in depth: only the service-role JWT may invoke this function.
  const role = decodeJwtRole(req.headers.get("Authorization"));
  if (role !== "service_role") {
    console.warn("[send-sms] rejected caller with role:", role || "none");
    return jsonResponse({ success: false, error: "Forbidden.", code: "FORBIDDEN" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body.", code: "VALIDATION" }, 400);
  }

  const purpose = String(body.purpose || "custom");
  const rawPhone = body.phone ?? body.to;
  const message = String(body.message || "").trim();
  const companyId = body.company_id != null && body.company_id !== "" ? Number(body.company_id) : null;
  const userId = body.user_id ? String(body.user_id) : null;
  const metadata = body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {};
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null;

  if (!PURPOSES.has(purpose)) {
    return jsonResponse({ success: false, error: "Invalid SMS purpose.", code: "VALIDATION" }, 400);
  }
  if (!message) {
    return jsonResponse({ success: false, error: "A message body is required.", code: "VALIDATION" }, 400);
  }

  const normalizedPhone = normalizePhone(rawPhone);
  if (!normalizedPhone) {
    return jsonResponse(
      { success: false, error: "A valid phone number with country code is required, e.g. +2547XXXXXXXX.", code: "VALIDATION" },
      400
    );
  }

  if (!isSmsConfigured()) {
    await logAttempt({
      purpose,
      phone: normalizedPhone,
      message,
      status: "failed",
      errorCode: "CONFIG",
      errorMessage: "Africa's Talking secrets are not configured on this Supabase project.",
      companyId,
      userId,
      metadata,
      ip,
    });
    return jsonResponse(
      { success: false, error: "SMS provider is not configured.", code: "CONFIG" },
      503
    );
  }

  try {
    const result = await sendSms(normalizedPhone, message);
    await logAttempt({
      purpose,
      phone: normalizedPhone,
      message,
      status: "sent",
      providerMessageId: result.messageId,
      cost: result.cost,
      companyId,
      userId,
      metadata,
      ip,
    });
    return jsonResponse({
      success: true,
      provider: result.provider,
      messageId: result.messageId,
      cost: result.cost,
      to: result.to,
    });
  } catch (err) {
    const smsErr = err instanceof SmsError ? err : new SmsError(String((err as Error)?.message || err), "PROVIDER");
    await logAttempt({
      purpose,
      phone: normalizedPhone,
      message,
      status: "failed",
      errorCode: smsErr.code,
      errorMessage: smsErr.message,
      companyId,
      userId,
      metadata,
      ip,
    });
    console.error(`[send-sms] delivery failed (${smsErr.code}):`, smsErr.message, smsErr.detail || "");
    const status = smsErr.code === "CONFIG" ? 503 : smsErr.code === "VALIDATION" ? 400 : 502;
    return jsonResponse({ success: false, error: smsErr.message, code: smsErr.code }, status);
  }
});
