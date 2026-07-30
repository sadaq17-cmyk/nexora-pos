import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Store } from "lucide-react";
import { requireSupabase, supabaseConfigError } from "../../lib/supabaseClient";
import { isValidEmail, normalizeEmail } from "../../lib/emailValidation";
import OtpVerification from "../../components/OtpVerification";
import { applyPasswordReset } from "../../lib/otpApi";
import { validatePassword, PASSWORD_HINT } from "../../lib/passwordPolicy";

const RESET_STEP = {
  EMAIL_LINK: "email_link",
  SMS_CONTACT: "sms_contact",
  SMS_OTP: "sms_otp",
  NEW_PASSWORD: "new_password",
  DONE: "done",
};

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(RESET_STEP.EMAIL_LINK);
  const [smsEmail, setSmsEmail] = useState("");
  const [smsPhone, setSmsPhone] = useState("");
  const [resetTicket, setResetTicket] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const nextEmail = normalizeEmail(email);
    if (!isValidEmail(nextEmail)) {
      setError("Enter a valid login email address.");
      return;
    }

    setLoading(true);
    const generic = {
      success: true,
      message: "If an account matches that login email, password reset instructions have been queued.",
    };
    try {
      if (supabaseConfigError) {
        setResult(generic);
        setLoading(false);
        return;
      }
      const client = requireSupabase();
      await client.auth.resetPasswordForEmail(nextEmail, {
        redirectTo: "https://www.nexorapospro.com/reset-password",
      });
    } catch {
      /* intentionally swallow — same UI either way */
    }
    setLoading(false);
    setResult(generic);
  };

  const submitSmsContact = (event) => {
    event.preventDefault();
    setError("");
    const nextEmail = normalizeEmail(smsEmail);
    if (!isValidEmail(nextEmail)) {
      setError("Enter the email address on your account.");
      return;
    }
    if (!/^[+\d][\d\s().-]{7,}$/.test(smsPhone.trim())) {
      setError("Enter the phone number on your account, including country code.");
      return;
    }
    setSmsEmail(nextEmail);
    setStep(RESET_STEP.SMS_OTP);
  };

  const onOtpVerified = (otpResult) => {
    if (otpResult?.reset_ticket) {
      setResetTicket(otpResult.reset_ticket);
      setStep(RESET_STEP.NEW_PASSWORD);
    } else {
      // Backend always issues a ticket for password_reset once the code matches;
      // if missing, fall back to the email-link path rather than a dead end.
      setStep(RESET_STEP.EMAIL_LINK);
      setResult({ success: true, message: "If an account matches those details, password reset instructions have been queued." });
    }
  };

  const submitNewPassword = async (event) => {
    event.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmNewPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    const policy = validatePassword(newPassword, { email: smsEmail });
    if (!policy.ok) {
      setPasswordError(policy.message);
      return;
    }
    setPasswordBusy(true);
    const response = await applyPasswordReset({ ticket: resetTicket, newPassword });
    setPasswordBusy(false);
    if (!response?.success) {
      setPasswordError(response?.error || "Unable to reset your password. Please request a new code.");
      return;
    }
    setStep(RESET_STEP.DONE);
  };

  return (
    <div className="nx-login-page">
      <div className="nx-login-inner">
        <div className="nx-login-brand">
          <div className="nx-login-brand-mark" aria-hidden>
            <Store size={24} />
          </div>
          <h1>Nexora POS Pro</h1>
          <p>Reset access to your company workspace.</p>
        </div>
        <div className="nx-login-card">
          {step === RESET_STEP.EMAIL_LINK && (
            <>
              <h2 className="page-title" style={{ fontSize: "22px" }}>Forgot password</h2>
              <p className="mt-1 text-sm text-app-muted">
                Enter your current login email. The response is the same whether an account exists or not.
              </p>
              {!result ? (
                <>
                  <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
                    <label className="block">
                      <span className="form-label">Login email</span>
                      <input
                        required
                        type="text"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="support@httpsnexorapos.com"
                        className="form-control w-full"
                      />
                    </label>
                    {error ? <p className="text-sm text-danger">{error}</p> : null}
                    <button disabled={loading} className="btn btn-primary w-full">
                      {loading ? "Requesting…" : "Send reset instructions"}
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={() => { setError(""); setStep(RESET_STEP.SMS_CONTACT); }}
                    className="mt-4 w-full text-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
                  >
                    Prefer a text message? Reset via SMS code instead
                  </button>
                </>
              ) : (
                <div className="mt-5 rounded-[12px] border border-[color-mix(in_srgb,var(--success)_25%,transparent)] bg-[var(--success-soft)] p-4 text-sm text-app-text">
                  <p>{result.message}</p>
                  <p className="mt-2 text-xs text-app-muted">
                    Use the email that is currently set as your login address.
                  </p>
                </div>
              )}
            </>
          )}

          {step === RESET_STEP.SMS_CONTACT && (
            <>
              <h2 className="page-title" style={{ fontSize: "22px" }}>Reset via SMS</h2>
              <p className="mt-1 text-sm text-app-muted">
                Enter the email and phone number on your account. If they match, we'll text a 6-digit code.
              </p>
              <form onSubmit={submitSmsContact} className="mt-5 space-y-3" noValidate>
                <label className="block">
                  <span className="form-label">Login email</span>
                  <input
                    required
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    value={smsEmail}
                    onChange={(event) => setSmsEmail(event.target.value)}
                    className="form-control w-full"
                  />
                </label>
                <label className="block">
                  <span className="form-label">Phone number</span>
                  <input
                    required
                    type="tel"
                    autoComplete="tel"
                    placeholder="+2547XXXXXXXX"
                    value={smsPhone}
                    onChange={(event) => setSmsPhone(event.target.value)}
                    className="form-control w-full"
                  />
                </label>
                {error ? <p className="text-sm text-danger">{error}</p> : null}
                <button className="btn btn-primary w-full">Send code</button>
              </form>
              <button
                type="button"
                onClick={() => { setError(""); setStep(RESET_STEP.EMAIL_LINK); }}
                className="mt-4 w-full text-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
              >
                Back to email link reset
              </button>
            </>
          )}

          {step === RESET_STEP.SMS_OTP && (
            <>
              <h2 className="page-title" style={{ fontSize: "22px" }}>Enter your code</h2>
              <div className="mt-5">
                <OtpVerification
                  purpose="password_reset"
                  channel="sms"
                  email={smsEmail}
                  phone={smsPhone}
                  title="Verify your identity"
                  description="If your details match an account, a code has been sent."
                  onVerified={onOtpVerified}
                  onCancel={() => setStep(RESET_STEP.SMS_CONTACT)}
                />
              </div>
            </>
          )}

          {step === RESET_STEP.NEW_PASSWORD && (
            <>
              <h2 className="page-title" style={{ fontSize: "22px" }}>Choose a new password</h2>
              <p className="mt-1 text-sm text-app-muted">{PASSWORD_HINT}</p>
              <form onSubmit={submitNewPassword} className="mt-5 space-y-3" noValidate>
                <label className="block">
                  <span className="form-label">New password</span>
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="form-control w-full"
                  />
                </label>
                <label className="block">
                  <span className="form-label">Confirm new password</span>
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    className="form-control w-full"
                  />
                </label>
                {passwordError ? <p className="text-sm text-danger">{passwordError}</p> : null}
                <button disabled={passwordBusy} className="btn btn-primary w-full">
                  {passwordBusy ? "Updating…" : "Update password"}
                </button>
              </form>
            </>
          )}

          {step === RESET_STEP.DONE && (
            <div className="mt-2 rounded-[12px] border border-[color-mix(in_srgb,var(--success)_25%,transparent)] bg-[var(--success-soft)] p-4 text-sm text-app-text">
              <p className="font-semibold">Password updated.</p>
              <p className="mt-2 text-xs text-app-muted">Sign in with your new password.</p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="btn btn-primary mt-4 w-full"
              >
                Go to login
              </button>
            </div>
          )}

          {step !== RESET_STEP.DONE && (
            <Link to="/login" className="mt-5 inline-flex text-sm font-semibold text-brand">
              Back to login
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
