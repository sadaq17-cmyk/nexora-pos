import { resolveApiUrl } from "./desktopRuntime";

const ENDPOINT = "/api/send-email";

async function postOtp(payload) {
  try {
    const res = await fetch(resolveApiUrl(ENDPOINT), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data?.success !== true) {
      return { success: false, status: res.status, ...data };
    }
    return data;
  } catch (err) {
    return { success: false, error: err?.message || "Network error. Please try again." };
  }
}

/**
 * Request a new OTP code.
 * @param {{purpose: "registration"|"login"|"password_reset", channel: "sms"|"email", identifier?: string, email?: string, phone?: string, fallbackEmail?: string, companyId?: string|number, userId?: string}} params
 */
export function requestOtp({ purpose, channel = "sms", identifier, email, phone, fallbackEmail, companyId, userId } = {}) {
  return postOtp({
    action: "otp_request",
    purpose,
    channel,
    identifier,
    email,
    phone,
    fallback_email: fallbackEmail,
    company_id: companyId,
    user_id: userId,
  });
}

/**
 * Verify a submitted OTP code. On success for purpose "password_reset", the
 * response includes a short-lived `reset_ticket` for applyPasswordReset().
 * @param {{purpose: "registration"|"login"|"password_reset", channel?: "sms"|"email", identifier: string, code: string}} params
 */
export function verifyOtp({ purpose, channel, identifier, code } = {}) {
  return postOtp({
    action: "otp_verify",
    purpose,
    channel,
    identifier,
    code,
  });
}

/** Apply a new password using the reset_ticket returned by verifyOtp(). */
export function applyPasswordReset({ ticket, newPassword } = {}) {
  return postOtp({
    action: "otp_reset_password",
    ticket,
    new_password: newPassword,
  });
}
