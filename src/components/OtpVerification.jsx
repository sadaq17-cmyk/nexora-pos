import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MailCheck, ShieldCheck, Smartphone } from "lucide-react";
import { requestOtp as requestOtpApi, verifyOtp as verifyOtpApi } from "../lib/otpApi";

function useCountdown(targetTimeMs) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((targetTimeMs - Date.now()) / 1000)));
  useEffect(() => {
    if (!targetTimeMs) {
      setRemaining(0);
      return undefined;
    }
    setRemaining(Math.max(0, Math.ceil((targetTimeMs - Date.now()) / 1000)));
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((targetTimeMs - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [targetTimeMs]);
  return remaining;
}

/**
 * Reusable 6-digit OTP verification flow: request (SMS via Africa's Talking,
 * with automatic email fallback) + verify, with live expiry/resend
 * countdowns and attempts-remaining feedback.
 *
 * Backend: POST /api/send-email { action: "otp_request" | "otp_verify" }.
 */
export default function OtpVerification({
  purpose,
  channel = "sms",
  identifier,
  email,
  phone,
  fallbackEmail,
  companyId,
  userId,
  autoSend = true,
  /** When the parent already sent an OTP (e.g. during signup), skip auto-send and show the code form immediately. */
  initiallySent = false,
  initialExpiresAt = null,
  initialResendAfter = 60,
  initialMaskedIdentifier = "",
  onVerified,
  onCancel,
  title = "Verify your code",
  description,
}) {
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(Boolean(initiallySent));
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [code, setCode] = useState("");
  const [maskedIdentifier, setMaskedIdentifier] = useState(initialMaskedIdentifier || "");
  const [usedChannel, setUsedChannel] = useState(channel);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [expiresAtMs, setExpiresAtMs] = useState(() => {
    if (initialExpiresAt) return new Date(initialExpiresAt).getTime();
    if (initiallySent) return Date.now() + 10 * 60 * 1000;
    return 0;
  });
  const [resendAtMs, setResendAtMs] = useState(() => (
    initiallySent ? Date.now() + Math.max(1, Number(initialResendAfter) || 60) * 1000 : 0
  ));
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const sentOnce = useRef(Boolean(initiallySent));

  const expirySeconds = useCountdown(expiresAtMs);
  const resendSeconds = useCountdown(resendAtMs);
  const expired = sent && expiresAtMs > 0 && expirySeconds <= 0;

  const send = useCallback(async () => {
    setSending(true);
    setError("");
    setInfo("");
    const result = await requestOtpApi({ purpose, channel, identifier, email, phone, fallbackEmail, companyId, userId });
    setSending(false);
    if (!result?.success) {
      const friendly = /rate.?limit|wait \d+s|too many/i.test(String(result?.error || ""))
        ? (result.error || "Please wait before requesting another code.")
        : (result?.error || "Unable to send the verification code.");
      setError(friendly);
      if (result?.retry_after) {
        setResendAtMs(Date.now() + result.retry_after * 1000);
      }
      // If a code was already sent (e.g. signup), keep the entry form visible.
      if (result?.code === "RESEND_COOLDOWN" || result?.retry_after) {
        setSent(true);
      }
      return;
    }
    setSent(true);
    setCode("");
    setAttemptsRemaining(null);
    setUsedChannel(result.channel || channel);
    setFallbackUsed(Boolean(result.fallback_used));
    setMaskedIdentifier(result.masked_identifier || "");
    setExpiresAtMs(result.expires_at ? new Date(result.expires_at).getTime() : Date.now() + 10 * 60 * 1000);
    setResendAtMs(Date.now() + (result.resend_after || 60) * 1000);
    if (result.fallback_used) {
      setInfo("SMS delivery was unavailable, so we emailed your code instead.");
    }
  }, [purpose, channel, identifier, email, phone, fallbackEmail, companyId, userId]);

  useEffect(() => {
    if (autoSend && !sentOnce.current) {
      sentOnce.current = true;
      send();
    }
  }, [autoSend, send]);

  const verify = async (event) => {
    event?.preventDefault?.();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setVerifying(true);
    setError("");
    const result = await verifyOtpApi({
      purpose,
      channel: usedChannel,
      identifier: identifier || email || phone,
      code,
    });
    setVerifying(false);
    if (!result?.success) {
      setError(result?.error || "Incorrect or expired code.");
      if (typeof result?.attempts_remaining === "number") {
        setAttemptsRemaining(result.attempts_remaining);
      }
      return;
    }
    setInfo("Verified successfully.");
    onVerified?.(result);
  };

  const Icon = usedChannel === "email" ? MailCheck : Smartphone;

  return (
    <div className="rounded-[16px] border border-[color-mix(in_srgb,var(--brand)_18%,transparent)] bg-[var(--brand-soft)] p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-app-text">
        <Icon size={16} className="text-brand" />
        {title}
      </div>
      {description ? <p className="mt-1 text-xs text-app-muted">{description}</p> : null}

      {sending && !sent ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-app-muted">
          <Loader2 size={14} className="animate-spin" /> Sending your verification code…
        </p>
      ) : null}

      {sent ? (
        <form onSubmit={verify} className="mt-3 space-y-3">
          <p className="text-xs text-app-muted">
            {fallbackUsed ? "Emailed" : usedChannel === "email" ? "Emailed" : "Texted"} to{" "}
            <strong>{maskedIdentifier || "your contact"}</strong>. Code expires in{" "}
            <strong>{Math.floor(expirySeconds / 60)}:{String(expirySeconds % 60).padStart(2, "0")}</strong>.
          </p>
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            disabled={expired}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className="form-control w-full text-center text-lg tracking-[0.4em]"
          />
          {expired ? <p className="text-sm text-danger">This code expired. Request a new one below.</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {attemptsRemaining != null ? (
            <p className="text-xs text-app-muted">{attemptsRemaining} attempt(s) remaining.</p>
          ) : null}
          {info ? <p className="text-sm text-success">{info}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={verifying || expired} className="btn btn-primary">
              {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Verify code
            </button>
            <button
              type="button"
              disabled={sending || resendSeconds > 0}
              onClick={send}
              className="btn btn-ghost text-xs"
            >
              {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
            </button>
            {onCancel ? (
              <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : !sending ? (
        <div className="mt-3 space-y-2">
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button type="button" onClick={send} disabled={resendSeconds > 0} className="btn btn-primary">
            {resendSeconds > 0 ? `Try again in ${resendSeconds}s` : "Send verification code"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
