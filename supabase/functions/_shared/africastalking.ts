/**
 * Africa's Talking SMS transport for Supabase Edge Functions (Deno).
 *
 * Credentials are read exclusively from Supabase Edge Function secrets
 * (`supabase secrets set ...`) — never hardcoded, never sent to the client.
 *
 * Required secrets:
 *   AFRICASTALKING_USERNAME
 *   AFRICASTALKING_API_KEY
 * Optional secrets:
 *   AFRICASTALKING_SENDER_ID  (registered short code / alphanumeric sender ID)
 *   AFRICASTALKING_ENV=sandbox (force the sandbox endpoint; auto-detected when
 *                               AFRICASTALKING_USERNAME === "sandbox")
 */

export interface SendSmsResult {
  success: true;
  provider: "africastalking";
  messageId: string | null;
  cost: string | null;
  to: string;
}

export class SmsError extends Error {
  code: "CONFIG" | "VALIDATION" | "PROVIDER";
  detail?: string;
  constructor(message: string, code: "CONFIG" | "VALIDATION" | "PROVIDER", detail?: string) {
    super(message);
    this.name = "SmsError";
    this.code = code;
    this.detail = detail;
  }
}

function credentials() {
  return {
    username: (Deno.env.get("AFRICASTALKING_USERNAME") || "").trim(),
    apiKey: (Deno.env.get("AFRICASTALKING_API_KEY") || "").trim(),
  };
}

export function isSmsConfigured(): boolean {
  const { username, apiKey } = credentials();
  return Boolean(username && apiKey);
}

function atBaseUrl(username: string): string {
  const isSandbox =
    username.toLowerCase() === "sandbox" ||
    (Deno.env.get("AFRICASTALKING_ENV") || "").trim().toLowerCase() === "sandbox";
  return isSandbox
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";
}

/**
 * Normalize a phone number to E.164. Callers must already supply a country
 * code (leading "+" or bare digits with country code) — silently guessing a
 * local-format number's country is unsafe for OTP/transactional delivery.
 */
export function normalizePhone(phone: unknown): string | null {
  const raw = String(phone || "").trim().replace(/[\s().-]/g, "");
  if (!raw) return null;
  if (/^\+\d{8,15}$/.test(raw)) return raw;
  if (/^\d{9,15}$/.test(raw)) return `+${raw}`;
  return null;
}

/**
 * Send a single SMS via Africa's Talking. Throws `SmsError` with a `.code`
 * of "CONFIG" (missing secrets), "VALIDATION" (bad phone), or "PROVIDER"
 * (Africa's Talking rejected/failed the send).
 */
export async function sendSms(phoneNumber: unknown, message: string): Promise<SendSmsResult> {
  const { username, apiKey } = credentials();
  if (!username || !apiKey) {
    throw new SmsError(
      "SMS provider is not configured. Set AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY as Supabase secrets.",
      "CONFIG"
    );
  }

  const to = normalizePhone(phoneNumber);
  if (!to) {
    throw new SmsError(
      "Recipient phone number must include a country code, e.g. +2547XXXXXXXX.",
      "VALIDATION"
    );
  }

  const body = new URLSearchParams({
    username,
    to,
    // Africa's Talking bills in ~153-char segments; 459 chars keeps us at <= 3 segments.
    message: String(message || "").slice(0, 459),
  });
  const senderId = (Deno.env.get("AFRICASTALKING_SENDER_ID") || "").trim();
  if (senderId) body.set("from", senderId);

  let res: Response;
  try {
    res = await fetch(atBaseUrl(username), {
      method: "POST",
      headers: {
        apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (networkErr) {
    const detail = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new SmsError(`Unable to reach Africa's Talking: ${detail}.`, "PROVIDER");
  }

  const raw = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new SmsError(`Africa's Talking SMS request failed (HTTP ${res.status}).`, "PROVIDER", String(raw || "").slice(0, 500));
  }

  const smsData = (data as any)?.SMSMessageData;
  const recipients = smsData?.Recipients || [];
  const first = recipients[0];
  const status = String(first?.status || "");
  if (!first || !/^(Success|Sent|Buffered|Queued)/i.test(status)) {
    throw new SmsError(status || "SMS delivery failed.", "PROVIDER", JSON.stringify(recipients).slice(0, 500));
  }

  return {
    success: true,
    provider: "africastalking",
    messageId: first.messageId || null,
    cost: first.cost || null,
    to: first.number || to,
  };
}
