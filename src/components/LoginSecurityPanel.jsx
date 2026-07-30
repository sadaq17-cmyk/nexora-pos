import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MessageSquare,
  MonitorSmartphone,
  Shield,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { isOwner } from "../lib/rbac";
import { PASSWORD_HINT } from "../lib/passwordPolicy";
import { isValidEmail } from "../lib/emailValidation";
import { requireSupabase } from "../lib/supabaseClient";
import OtpVerification from "./OtpVerification";
import {
  challengeAndVerifyTotp,
  enrollTotp,
  listTotpFactors,
  unenrollFactor,
} from "../lib/mfaHelpers";
import {
  ACTIVITY_LABELS,
  activityTone,
  clearAllSessions,
  listSecurityActivity,
  listSessions,
  recordSecurityActivity,
  registerSession,
  revokeOtherSessions,
  revokeSession,
  touchSession,
} from "../lib/securityCenter";

function DeviceIcon({ device }) {
  if (device === "Mobile") return <Smartphone size={18} />;
  if (device === "Tablet") return <Tablet size={18} />;
  return <Laptop size={18} />;
}

function toneClasses(tone) {
  if (tone === "success") return "border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--success)]";
  if (tone === "warning") return "border-[var(--warning)]/25 bg-[var(--warning-soft)] text-[var(--warning)]";
  if (tone === "danger") return "border-[var(--danger)]/25 bg-[var(--danger-soft)] text-[var(--danger)]";
  return "border-[var(--brand)]/25 bg-[var(--brand-soft)] text-[var(--brand)]";
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function SecCard({ title, subtitle, icon: Icon, children, delay = 0 }) {
  return (
    <section
      className="login-sec-card"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="mb-5 flex items-start gap-3">
        <div className="login-sec-icon">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--ls-text)]">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-[var(--ls-muted)]">{subtitle}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--ls-muted)]">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-[var(--ls-border)] bg-[var(--ls-bg)] px-3.5 py-2.5 text-sm text-[var(--ls-text)] outline-none transition duration-200 focus:border-[var(--ls-primary)] focus:ring-2 focus:ring-[var(--focus-ring)]";

export default function LoginSecurityPanel() {
  const { user, updateOwnerAccount, logout, logoutAllDevices, enableSmsLoginOtp, disableSmsLoginOtp } = useAuth();
  const { showToast } = useToast();

  const [smsPhone, setSmsPhone] = useState("");
  const [smsEnrolling, setSmsEnrolling] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsMsg, setSmsMsg] = useState({ error: "", info: "" });

  const [email, setEmail] = useState(user?.email || "");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState({ error: "", info: "" });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState({ error: "", info: "" });

  const [factors, setFactors] = useState([]);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState({ error: "", info: "" });

  const [sessions, setSessions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [sessionBusy, setSessionBusy] = useState("");

  const refreshLists = useCallback(() => {
    if (!user?.id) return;
    registerSession(user.id, { email: user.email });
    touchSession(user.id);
    setSessions(listSessions(user.id));
    setActivity(listSecurityActivity(user.id, user.email));
  }, [user?.id, user?.email]);

  const refreshMfa = useCallback(async () => {
    setMfaLoading(true);
    setMfaMsg({ error: "", info: "" });
    try {
      const client = requireSupabase();
      const result = await listTotpFactors(client);
      if (result.error) setMfaMsg({ error: result.error, info: "" });
      setFactors(result.factors || []);
    } catch (err) {
      setMfaMsg({ error: err?.message || "Unable to load MFA status.", info: "" });
    } finally {
      setMfaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;
    refreshLists();
    refreshMfa();
    const timer = window.setInterval(() => touchSession(user.id), 60000);
    return () => window.clearInterval(timer);
  }, [user?.id, refreshLists, refreshMfa]);

  useEffect(() => {
    setEmail(user?.email || "");
  }, [user?.email]);

  const mfaEnabled = factors.length > 0;

  const submitEmail = async (event) => {
    event.preventDefault();
    setEmailMsg({ error: "", info: "" });
    const nextEmail = String(email || "").trim().toLowerCase();
    if (!isValidEmail(nextEmail)) {
      setEmailMsg({ error: "Enter a valid email address.", info: "" });
      return;
    }
    setEmailBusy(true);
    const result = await updateOwnerAccount({
      currentPassword: emailPassword,
      email: nextEmail,
    });
    setEmailBusy(false);
    if (!result.success) {
      setEmailMsg({ error: result.error || "Unable to update email.", info: "" });
      return;
    }
    setEmailPassword("");
    setEmailMsg({
      error: "",
      info: result.emailVerificationSent
        ? `Verification email sent via Zoho SMTP to ${nextEmail}. Your current login stays active until you confirm the link.`
        : "Email updated.",
    });
    showToast(result.emailVerificationSent ? "Verification email sent via Zoho" : "Email updated");
    // Keep the form showing the current login email until verification completes.
    setEmail(user?.email || nextEmail);
    refreshLists();
  };

  const submitPassword = async (event) => {
    event.preventDefault();
    setPasswordMsg({ error: "", info: "" });
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ error: "New password and confirmation do not match.", info: "" });
      return;
    }
    setPasswordBusy(true);
    const result = await updateOwnerAccount({
      currentPassword,
      password: newPassword,
      confirmPassword,
    });
    setPasswordBusy(false);
    if (!result.success) {
      setPasswordMsg({ error: result.error || "Unable to update password.", info: "" });
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMsg({ error: "", info: "Password updated successfully." });
    showToast("Password updated");
    refreshLists();
  };

  const startMfa = async () => {
    setMfaBusy(true);
    setMfaMsg({ error: "", info: "" });
    try {
      const client = requireSupabase();
      const result = await enrollTotp(client);
      if (!result.success) {
        setMfaMsg({ error: result.error || "Unable to start MFA enrollment.", info: "" });
      } else {
        setEnrolling(result);
        setMfaCode("");
      }
    } catch (err) {
      setMfaMsg({ error: err?.message || "Unable to start MFA enrollment.", info: "" });
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmMfa = async () => {
    if (!enrolling?.factorId) return;
    setMfaBusy(true);
    setMfaMsg({ error: "", info: "" });
    try {
      const client = requireSupabase();
      const result = await challengeAndVerifyTotp(client, enrolling.factorId, mfaCode);
      if (!result.success) {
        setMfaMsg({ error: result.error || "Invalid authenticator code.", info: "" });
      } else {
        setEnrolling(null);
        setMfaCode("");
        setMfaMsg({ error: "", info: "Two-factor authentication is enabled." });
        recordSecurityActivity({
          userId: user.id,
          email: user.email,
          type: "mfa_enabled",
          detail: "TOTP authenticator enabled",
        });
        showToast("2FA enabled");
        await refreshMfa();
        refreshLists();
      }
    } catch (err) {
      setMfaMsg({ error: err?.message || "Unable to verify authenticator.", info: "" });
    } finally {
      setMfaBusy(false);
    }
  };

  const disableMfa = async (factorId) => {
    if (!confirm("Disable two-factor authentication for this account?")) return;
    setMfaBusy(true);
    setMfaMsg({ error: "", info: "" });
    try {
      const client = requireSupabase();
      const result = await unenrollFactor(client, factorId);
      if (!result.success) {
        setMfaMsg({ error: result.error || "Unable to disable MFA.", info: "" });
      } else {
        setMfaMsg({ error: "", info: "Two-factor authentication disabled." });
        recordSecurityActivity({
          userId: user.id,
          email: user.email,
          type: "mfa_disabled",
          detail: "TOTP authenticator disabled",
        });
        showToast("2FA disabled");
        await refreshMfa();
        refreshLists();
      }
    } catch (err) {
      setMfaMsg({ error: err?.message || "Unable to disable MFA.", info: "" });
    } finally {
      setMfaBusy(false);
    }
  };

  const startSmsEnroll = () => {
    setSmsMsg({ error: "", info: "" });
    if (!/^[+\d][\d\s().-]{7,}$/.test(smsPhone.trim())) {
      setSmsMsg({ error: "Enter a valid phone number, including country code.", info: "" });
      return;
    }
    setSmsEnrolling(true);
  };

  const onSmsOtpVerified = async (otpResult) => {
    setSmsBusy(true);
    const result = await enableSmsLoginOtp({ phone: smsPhone, ticket: otpResult?.enrollment_ticket });
    setSmsBusy(false);
    if (!result?.success) {
      setSmsMsg({ error: result?.error || "Unable to enable SMS login verification.", info: "" });
      return;
    }
    setSmsEnrolling(false);
    setSmsPhone("");
    setSmsMsg({ error: "", info: "SMS login verification is enabled." });
    showToast("SMS login verification enabled");
    recordSecurityActivity({ userId: user.id, email: user.email, type: "mfa_enabled", detail: "SMS login verification enabled" });
  };

  const disableSms = async () => {
    if (!confirm("Disable SMS login verification for this account?")) return;
    setSmsBusy(true);
    const result = await disableSmsLoginOtp();
    setSmsBusy(false);
    if (!result?.success) {
      setSmsMsg({ error: result?.error || "Unable to disable SMS login verification.", info: "" });
      return;
    }
    setSmsMsg({ error: "", info: "SMS login verification disabled." });
    showToast("SMS login verification disabled");
    recordSecurityActivity({ userId: user.id, email: user.email, type: "mfa_disabled", detail: "SMS login verification disabled" });
  };

  const endSession = async (session) => {
    setSessionBusy(session.id);
    const result = revokeSession(user.id, session.id);
    recordSecurityActivity({
      userId: user.id,
      email: user.email,
      type: "session_revoked",
      detail: `${session.browser} on ${session.os}`,
    });
    if (result.current) {
      showToast("Signed out of this device");
      await logout();
      return;
    }
    showToast("Session logged out");
    setSessionBusy("");
    refreshLists();
  };

  const endAllDevices = async () => {
    if (!confirm("Log out of all devices? You will need to sign in again on every device, including this one.")) {
      return;
    }
    setSessionBusy("all");
    try {
      if (typeof logoutAllDevices === "function") {
        await logoutAllDevices();
      } else {
        clearAllSessions(user.id);
        recordSecurityActivity({
          userId: user.id,
          email: user.email,
          type: "logout_all",
          detail: "All devices signed out",
        });
        const client = requireSupabase();
        await client.auth.signOut({ scope: "global" });
        await logout();
      }
      showToast("Logged out of all devices");
    } catch (err) {
      showToast(err?.message || "Unable to log out all devices");
      setSessionBusy("");
    }
  };

  const endOtherDevices = async () => {
    if (!confirm("Log out of every other device? This device will stay signed in.")) return;
    setSessionBusy("others");
    revokeOtherSessions(user.id);
    try {
      const client = requireSupabase();
      await client.auth.signOut({ scope: "others" });
    } catch {
      /* local revoke still applied */
    }
    recordSecurityActivity({
      userId: user.id,
      email: user.email,
      type: "session_revoked",
      detail: "Other devices signed out",
    });
    showToast("Other devices logged out");
    setSessionBusy("");
    refreshLists();
  };

  const statusBadge = useMemo(() => {
    if (mfaEnabled) {
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses("success")}`}>
          <ShieldCheck size={12} /> 2FA on
        </span>
      );
    }
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses("warning")}`}>
        <AlertTriangle size={12} /> 2FA off
      </span>
    );
  }, [mfaEnabled]);

  if (!isOwner(user?.role)) {
    return (
      <div className="login-sec-shell">
        <div className="login-sec-card">
          <p className="text-sm text-[var(--ls-muted)]">
            Login &amp; Security is available to Company Owners only.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-sec-shell animate-fadein">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ls-primary)]">Security center</div>
          <h2 className="mt-1 text-2xl font-bold text-[var(--ls-text)]">Login &amp; Security</h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--ls-muted)]">
            Manage owner credentials, two-factor authentication, active sessions, and recent security activity.
          </p>
        </div>
        {statusBadge}
      </div>

      {(user?.pending_email_change || user?.pending_email) ? (
        <div className="mb-5 rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--ls-text)]">
          Verification pending for <strong>{user.pending_email}</strong>. Your current login email (
          <strong>{user.email}</strong>) stays active until you confirm the Zoho email link.
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <SecCard
          title="Change email"
          subtitle="Requires your current password. A Zoho verification message is sent to the new address. After you confirm, that address becomes your login email."
          icon={Mail}
          delay={40}
        >
          <form onSubmit={submitEmail} className="space-y-3" noValidate>
            <Field label="New email">
              <input
                type="text"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="support@httpsnexorapos.com"
                className={inputClass}
              />
            </Field>
            <Field label="Current password">
              <input
                type="password"
                required
                autoComplete="current-password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            {emailMsg.error ? <p className="text-sm text-[#DC2626]">{emailMsg.error}</p> : null}
            {emailMsg.info ? <p className="rounded-xl border border-[#16A34A]/20 bg-[#16A34A]/10 px-3 py-2 text-sm text-[#15803D]">{emailMsg.info}</p> : null}
            <button type="submit" disabled={emailBusy} className="login-sec-btn-primary">
              {emailBusy ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
              Update email
            </button>
          </form>
        </SecCard>

        <SecCard
          title="Change password"
          subtitle="Use a strong password. Your current password is required."
          icon={KeyRound}
          delay={80}
        >
          <form onSubmit={submitPassword} className="space-y-3">
            <Field label="Current password">
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="New password">
              <input
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            <p className="text-xs text-[var(--ls-muted)]">{PASSWORD_HINT}</p>
            {passwordMsg.error ? <p className="text-sm text-[#DC2626]">{passwordMsg.error}</p> : null}
            {passwordMsg.info ? <p className="rounded-xl border border-[#16A34A]/20 bg-[#16A34A]/10 px-3 py-2 text-sm text-[#15803D]">{passwordMsg.info}</p> : null}
            <button type="submit" disabled={passwordBusy} className="login-sec-btn-primary">
              {passwordBusy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
              Update password
            </button>
          </form>
        </SecCard>

        <SecCard
          title="Two-factor authentication"
          subtitle="Optional TOTP authenticator app protection for your owner account."
          icon={Fingerprint}
          delay={120}
        >
          {mfaLoading ? (
            <p className="text-sm text-[var(--ls-muted)]">Loading 2FA status…</p>
          ) : (
            <div className="space-y-3">
              <div className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${toneClasses(mfaEnabled ? "success" : "warning")}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Shield size={16} />
                  {mfaEnabled ? "Authenticator enabled" : "Authenticator not enabled"}
                </div>
                <span className="text-xs font-medium opacity-80">{mfaEnabled ? "Protected" : "Recommended"}</span>
              </div>

              {mfaMsg.error ? <p className="text-sm text-[#DC2626]">{mfaMsg.error}</p> : null}
              {mfaMsg.info ? <p className="rounded-xl border border-[#16A34A]/20 bg-[#16A34A]/10 px-3 py-2 text-sm text-[#15803D]">{mfaMsg.info}</p> : null}

              {mfaEnabled ? (
                factors.map((factor) => (
                  <div key={factor.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ls-border)] bg-[var(--ls-bg)] px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--ls-text)]">{factor.friendly_name || "Authenticator"}</div>
                      <div className="text-xs text-[var(--ls-muted)]">Verified TOTP factor</div>
                    </div>
                    <button
                      type="button"
                      disabled={mfaBusy}
                      onClick={() => disableMfa(factor.id)}
                      className="login-sec-btn-danger"
                    >
                      Disable
                    </button>
                  </div>
                ))
              ) : !enrolling ? (
                <button type="button" disabled={mfaBusy} onClick={startMfa} className="login-sec-btn-primary">
                  {mfaBusy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                  Enable 2FA
                </button>
              ) : null}

              {enrolling ? (
                <div className="space-y-3 rounded-2xl border border-[var(--ls-border)] bg-[var(--ls-bg)] p-4">
                  <p className="text-sm text-[var(--ls-text)]">
                    Scan this QR code with your authenticator app, then enter the 6-digit code.
                  </p>
                  {enrolling.qr ? (
                    <img
                      src={enrolling.qr}
                      alt="MFA QR code"
                      className="mx-auto h-44 w-44 rounded-2xl border border-[var(--ls-border)] bg-white p-2"
                    />
                  ) : null}
                  {enrolling.secret ? (
                    <p className="break-all text-xs text-[var(--ls-muted)]">Manual secret: {enrolling.secret}</p>
                  ) : null}
                  <input
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    className={inputClass}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={mfaBusy} onClick={confirmMfa} className="login-sec-btn-primary">
                      Verify &amp; enable
                    </button>
                    <button
                      type="button"
                      disabled={mfaBusy}
                      onClick={() => { setEnrolling(null); setMfaCode(""); }}
                      className="login-sec-btn-ghost"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </SecCard>

        <SecCard
          title="SMS login verification"
          subtitle="Optional: require a 6-digit SMS code (via Africa's Talking) after your password, with automatic email fallback."
          icon={MessageSquare}
          delay={140}
        >
          <div className="space-y-3">
            <div className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${toneClasses(user?.sms_login_otp_enabled ? "success" : "warning")}`}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquare size={16} />
                {user?.sms_login_otp_enabled ? `Enabled for ${user.otp_phone || "your phone"}` : "Not enabled"}
              </div>
              <span className="text-xs font-medium opacity-80">{user?.sms_login_otp_enabled ? "Protected" : "Optional"}</span>
            </div>

            {smsMsg.error ? <p className="text-sm text-[#DC2626]">{smsMsg.error}</p> : null}
            {smsMsg.info ? <p className="rounded-xl border border-[#16A34A]/20 bg-[#16A34A]/10 px-3 py-2 text-sm text-[#15803D]">{smsMsg.info}</p> : null}

            {user?.sms_login_otp_enabled ? (
              <button type="button" disabled={smsBusy} onClick={disableSms} className="login-sec-btn-danger">
                Disable
              </button>
            ) : !smsEnrolling ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="tel"
                  value={smsPhone}
                  onChange={(e) => setSmsPhone(e.target.value)}
                  placeholder="+2547XXXXXXXX"
                  className={inputClass}
                  style={{ maxWidth: 220 }}
                />
                <button type="button" disabled={smsBusy} onClick={startSmsEnroll} className="login-sec-btn-primary">
                  {smsBusy ? <Loader2 size={15} className="animate-spin" /> : <MessageSquare size={15} />}
                  Verify &amp; enable
                </button>
              </div>
            ) : (
              <OtpVerification
                purpose="login"
                channel="sms"
                phone={smsPhone}
                title="Verify your phone"
                description="Enter the 6-digit code to confirm this number."
                onVerified={onSmsOtpVerified}
                onCancel={() => setSmsEnrolling(false)}
              />
            )}
          </div>
        </SecCard>

        <SecCard
          title="Active sessions"
          subtitle="Devices currently associated with your owner login on this browser profile."
          icon={MonitorSmartphone}
          delay={160}
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(sessionBusy)}
              onClick={endOtherDevices}
              className="login-sec-btn-ghost"
            >
              <LogOut size={14} /> Logout other devices
            </button>
            <button
              type="button"
              disabled={Boolean(sessionBusy)}
              onClick={endAllDevices}
              className="login-sec-btn-danger"
            >
              <Trash2 size={14} /> Logout all devices
            </button>
          </div>

          <div className="space-y-3">
            {sessions.length === 0 ? (
              <p className="text-sm text-[var(--ls-muted)]">No tracked sessions yet.</p>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex flex-col gap-3 rounded-2xl border border-[var(--ls-border)] bg-[var(--ls-bg)] p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex gap-3">
                    <div className="login-sec-icon shrink-0">
                      <DeviceIcon device={session.device} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--ls-text)]">
                          {session.device} · {session.browser}
                        </span>
                        {session.current ? (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${toneClasses("success")}`}>
                            This device
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ls-muted)]">
                        OS: {session.os} · Location: {session.location || "Unknown"}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ls-muted)]">
                        Last active: {formatWhen(session.lastActive)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={sessionBusy === session.id || sessionBusy === "all"}
                    onClick={() => endSession(session)}
                    className="login-sec-btn-ghost shrink-0"
                  >
                    {sessionBusy === session.id ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                    Logout
                  </button>
                </div>
              ))
            )}
          </div>
        </SecCard>
      </div>

      <div className="mt-5">
        <SecCard
          title="Security activity"
          subtitle="Password changes, email changes, new logins, and failed login attempts."
          icon={CheckCircle2}
          delay={200}
        >
          <div className="overflow-hidden rounded-2xl border border-[var(--ls-border)]">
            {activity.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--ls-muted)]">No security events recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--ls-border)]">
                {activity.map((row) => {
                  const tone = activityTone(row.type);
                  return (
                    <li key={row.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${toneClasses(tone)}`}>
                          {ACTIVITY_LABELS[row.type] || row.type}
                        </span>
                        <div>
                          <div className="text-sm text-[var(--ls-text)]">
                            {row.detail || ACTIVITY_LABELS[row.type] || row.type}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--ls-muted)]">
                            {row.browser} · {row.os} · {row.location}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-[var(--ls-muted)]">{formatWhen(row.at)}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SecCard>
      </div>
    </div>
  );
}
