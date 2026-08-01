/**
 * Reusable SMS service (Node/Vercel side) — the single place server code
 * calls to send an SMS. Every send is proxied to the Supabase Edge Function
 * `send-sms`, which holds the actual Africa's Talking credentials
 * (Supabase secrets, never present in this process). This process only ever
 * holds SUPABASE_SERVICE_ROLE_KEY, which is already server-only and never
 * shipped to the frontend.
 *
 * Low-level `invokeSendSms` throws structured errors (`.code` of
 * "CONFIG" | "VALIDATION" | "PROVIDER" | "AUTH") mirroring the previous
 * direct-Africa's-Talking transport, so existing callers (OTP delivery with
 * email fallback) keep working unchanged.
 *
 * High-level `notify*` helpers are best-effort: they log and swallow errors
 * so a failed/unsent SMS notification never breaks the underlying business
 * transaction (registration, subscription update, payment, sale, etc.).
 */
/**
 * Local copy of the E.164 normalizer (not imported from `_smsProvider.js`
 * to avoid a circular import, since `_smsProvider.js` delegates its
 * `sendSms` to this module).
 */
function normalizePhone(phone) {
  const raw = String(phone || "").trim().replace(/[\s().-]/g, "");
  if (!raw) return null;
  if (/^\+\d{8,15}$/.test(raw)) return raw;
  if (/^\d{9,15}$/.test(raw)) return `+${raw}`;
  return null;
}

function supabaseConfig() {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return { url, serviceKey };
}

export function isSendSmsFunctionConfigured() {
  const { url, serviceKey } = supabaseConfig();
  return Boolean(url && serviceKey && /^https?:\/\//i.test(url) && serviceKey.length > 20);
}

/**
 * Low-level call to the `send-sms` Edge Function. Throws on any failure with
 * `.code` of "CONFIG" | "VALIDATION" | "PROVIDER" | "AUTH".
 */
export async function invokeSendSms({
  phone,
  message,
  purpose = "custom",
  companyId = null,
  userId = null,
  metadata = {},
} = {}) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) {
    const err = new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
    err.code = "CONFIG";
    throw err;
  }

  const to = normalizePhone(phone);
  if (!to) {
    const err = new Error("Recipient phone number must include a country code, e.g. +2547XXXXXXXX.");
    err.code = "VALIDATION";
    throw err;
  }

  const endpoint = `${url.replace(/\/+$/, "")}/functions/v1/send-sms`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: to,
        message: String(message || "").slice(0, 459),
        purpose,
        company_id: companyId,
        user_id: userId,
        metadata,
      }),
    });
  } catch (networkErr) {
    const err = new Error(`Unable to reach the send-sms function: ${networkErr?.message || "network error"}.`);
    err.code = "PROVIDER";
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || `send-sms request failed (HTTP ${res.status}).`);
    err.code = data?.code === "CONFIG" || data?.code === "VALIDATION" || data?.code === "FORBIDDEN"
      ? (data.code === "FORBIDDEN" ? "AUTH" : data.code)
      : "PROVIDER";
    throw err;
  }

  return {
    success: true,
    provider: data.provider || "africastalking",
    messageId: data.messageId || null,
    cost: data.cost || null,
    to: data.to || to,
  };
}

/**
 * Best-effort wrapper — never throws. Returns { sent: boolean, error?: string }.
 */
async function safeSend({ phone, message, purpose, companyId, userId, metadata }) {
  try {
    const result = await invokeSendSms({ phone, message, purpose, companyId, userId, metadata });
    return { sent: true, result };
  } catch (err) {
    console.error(`[smsService] ${purpose} notification failed:`, err?.code || "", err?.message || err);
    return { sent: false, error: err?.message || String(err) };
  }
}

export async function notifyRegistrationSms({ phone, ownerName, companyName, companyId, userId }) {
  if (!phone) return { sent: false, error: "No phone number on file." };
  const name = ownerName ? ownerName.split(" ")[0] : "there";
  const message = `Welcome to Nexora POS Pro, ${name}! Your workspace "${companyName}" is ready. Log in to start selling.`;
  return safeSend({ phone, message, purpose: "registration", companyId, userId });
}

export async function notifySubscriptionConfirmationSms({ phone, planName, expiresAt, companyId, userId }) {
  if (!phone) return { sent: false, error: "No phone number on file." };
  const expiryText = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })
    : null;
  const message = expiryText
    ? `Nexora POS Pro: your ${planName} subscription is confirmed and active until ${expiryText}. Thank you for your business!`
    : `Nexora POS Pro: your ${planName} subscription is confirmed and active. Thank you for your business!`;
  return safeSend({ phone, message, purpose: "subscription_confirmation", companyId, userId });
}

export async function notifyPaymentConfirmationSms({
  phone,
  amount,
  currencySymbol = "",
  reference,
  recipientName,
  companyId,
  userId,
}) {
  if (!phone) return { sent: false, error: "No phone number on file." };
  const amountText = `${currencySymbol}${Number(amount || 0).toLocaleString()}`.trim();
  const who = recipientName ? ` ${recipientName},` : "";
  const refText = reference ? ` Ref: ${reference}.` : "";
  const message = `Nexora POS Pro: payment of ${amountText} confirmed.${who ? ` Thank you${who}` : ""}${refText}`;
  return safeSend({ phone, message, purpose: "payment_confirmation", companyId, userId, metadata: { amount, reference } });
}

export async function notifyInvoiceSms({
  phone,
  invoiceNo,
  amount,
  currencySymbol = "",
  companyName,
  companyId,
  userId,
}) {
  if (!phone) return { sent: false, error: "No phone number on file." };
  const amountText = `${currencySymbol}${Number(amount || 0).toLocaleString()}`.trim();
  const store = companyName ? ` from ${companyName}` : "";
  const message = `Receipt${store}: Invoice #${invoiceNo}, amount ${amountText}. Thank you for your purchase!`;
  return safeSend({ phone, message, purpose: "invoice_notification", companyId, userId, metadata: { invoiceNo, amount } });
}
