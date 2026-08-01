import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Store } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { PERMANENT_PLATFORM_ADMIN } from "../lib/permanentPlatformAdmin";
import { PASSWORD_HINT, validatePassword } from "../lib/passwordPolicy";

export default function Login() {
  const { user, login, loginByEmail, verifyMfa, verifySmsOtpLogin, mustChangePassword, subscriptionLocked } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [companyIdentifier, setCompanyIdentifier] = useState("");
  const [companyRequired, setCompanyRequired] = useState(false);
  const [platformIdentifier, setPlatformIdentifier] = useState("platform");
  const [platformUsername, setPlatformUsername] = useState(PERMANENT_PLATFORM_ADMIN.username);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [smsOtpPending, setSmsOtpPending] = useState(false);
  const [smsOtpCode, setSmsOtpCode] = useState("");
  const [smsOtpHint, setSmsOtpHint] = useState("");

  if (user) {
    if (mustChangePassword) return <Navigate to="/change-password" replace />;
    if (subscriptionLocked) return <Navigate to="/subscription/renew" replace />;
    return <Navigate to={user.role === "platform_owner" ? "/platform" : "/dashboard"} replace />;
  }

  const finish = (result) => {
    if (result.success) {
      setMfaFactorId("");
      setMfaCode("");
      setSmsOtpPending(false);
      setSmsOtpCode("");
      if (result.mustChangePassword || result.user?.must_change_password) {
        navigate("/change-password");
      } else if (result.subscriptionLocked) {
        navigate("/subscription/renew");
      } else {
        navigate(result.user.role === "platform_owner" ? "/platform" : "/dashboard");
      }
    } else if (result.code === "MFA_REQUIRED") {
      setMfaFactorId(result.factorId || "");
      setMfaCode("");
      setError(result.error || "Enter your authenticator code.");
    } else if (result.code === "SMS_OTP_REQUIRED") {
      setSmsOtpPending(true);
      setSmsOtpCode("");
      setSmsOtpHint(result.maskedPhone || "");
      setError(result.error || "Enter the 6-digit code we texted to your phone.");
    } else {
      if (result.code === "COMPANY_REQUIRED") setCompanyRequired(true);
      setError(result.error || "Login failed.");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    if (mfaFactorId) {
      const result = await verifyMfa(mfaFactorId, mfaCode);
      setSubmitting(false);
      finish(result);
      return;
    }
    if (smsOtpPending) {
      const result = await verifySmsOtpLogin(smsOtpCode);
      setSubmitting(false);
      finish(result);
      return;
    }
    const policy = validatePassword(password);
    if (password.length < 8) {
      setSubmitting(false);
      setError(policy.message || "Password must be at least 8 characters.");
      return;
    }
    let result;
    if (mode === "platform") {
      // Always use the canonical production Platform Identifier (ignore typos in the field).
      result = await login("platform", platformUsername, password, rememberMe);
    } else if (mode === "company") {
      result = await login(companyIdentifier, email, password, rememberMe);
    } else {
      result = await loginByEmail(email, password, rememberMe, companyRequired ? companyIdentifier : "");
    }
    setSubmitting(false);
    finish(result);
  };

  const switchMode = (id) => {
    setMode(id);
    setError("");
    setCompanyRequired(false);
    setMfaFactorId("");
    setMfaCode("");
    setSmsOtpPending(false);
    setSmsOtpCode("");
  };

  return (
    <div className="nx-login-page">
      <div className="nx-login-inner">
        <div className="nx-login-brand">
          <div className="nx-login-brand-mark" aria-hidden>
            <Store size={22} strokeWidth={1.75} />
          </div>
          <h1>Nexora POS Pro</h1>
          <p>Enterprise point of sale for retail and multi-branch teams.</p>
        </div>

        <div className="nx-login-card">
          <header className="nx-login-card-head">
            <h2>Sign in</h2>
            <p>Company users sign in with email. Platform Super Admin uses Platform login.</p>
          </header>

          <div className="nx-login-tabs" role="tablist" aria-label="Sign-in method">
            {[
              ["email", "Email"],
              ["company", "Company"],
              ["platform", "Platform"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => switchMode(id)}
                className={mode === id ? "is-active" : ""}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="nx-login-form">
            {!mfaFactorId && !smsOtpPending && mode === "platform" && (
              <>
                <div className="nx-login-field">
                  <label className="nx-login-label" htmlFor="login-platform-id">Platform identifier</label>
                  <input
                    id="login-platform-id"
                    required
                    readOnly
                    value={platformIdentifier}
                    onChange={(event) => setPlatformIdentifier(event.target.value)}
                    className="nx-login-input"
                    autoComplete="organization"
                    title="Fixed value for Super Owner login"
                  />
                  <p className="nx-login-hint">Use exactly: <strong>platform</strong></p>
                </div>
                <div className="nx-login-field">
                  <label className="nx-login-label" htmlFor="login-platform-user">Username or email</label>
                  <input
                    id="login-platform-user"
                    required
                    value={platformUsername}
                    onChange={(event) => setPlatformUsername(event.target.value)}
                    className="nx-login-input"
                    placeholder={PERMANENT_PLATFORM_ADMIN.username}
                    autoComplete="username"
                  />
                </div>
              </>
            )}

            {!mfaFactorId && !smsOtpPending && mode === "company" && (
              <div className="nx-login-field">
                <label className="nx-login-label" htmlFor="login-company-code">Company code or verified domain</label>
                <input
                  id="login-company-code"
                  required
                  value={companyIdentifier}
                  onChange={(event) => setCompanyIdentifier(event.target.value)}
                  className="nx-login-input"
                  placeholder="Your company code"
                  autoComplete="organization"
                />
              </div>
            )}

            {!mfaFactorId && !smsOtpPending && mode !== "platform" && (
              <div className="nx-login-field">
                <label className="nx-login-label" htmlFor="login-email">
                  {mode === "company" ? "Username or email" : "Email"}
                </label>
                <input
                  id="login-email"
                  required
                  type={mode === "email" ? "email" : "text"}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="nx-login-input"
                  placeholder={mode === "company" ? "you@company.com" : "you@company.com"}
                  autoComplete="username"
                />
              </div>
            )}

            {!mfaFactorId && !smsOtpPending && mode === "email" && companyRequired && (
              <div className="nx-login-field">
                <label className="nx-login-label" htmlFor="login-company-required">Company code required</label>
                <input
                  id="login-company-required"
                  required
                  value={companyIdentifier}
                  onChange={(event) => setCompanyIdentifier(event.target.value)}
                  className="nx-login-input"
                  placeholder="Your company code"
                  autoComplete="organization"
                />
              </div>
            )}

            {!mfaFactorId && !smsOtpPending && (
              <div className="nx-login-field">
                <label className="nx-login-label" htmlFor="login-password">Password</label>
                <div className="nx-login-password">
                  <input
                    id="login-password"
                    required
                    minLength={8}
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="nx-login-input has-toggle"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((value) => !value)}
                    className="nx-login-pw-toggle"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
                  </button>
                </div>
                {mode === "platform" && <p className="nx-login-hint">{PASSWORD_HINT}</p>}
              </div>
            )}

            {mfaFactorId && (
              <div className="nx-login-field">
                <label className="nx-login-label" htmlFor="login-mfa">Authenticator code</label>
                <input
                  id="login-mfa"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  className="nx-login-input"
                  placeholder="6-digit code"
                />
              </div>
            )}

            {smsOtpPending && (
              <div className="nx-login-field">
                <label className="nx-login-label" htmlFor="login-sms-otp">SMS verification code</label>
                <input
                  id="login-sms-otp"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={smsOtpCode}
                  onChange={(event) => setSmsOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="nx-login-input"
                  placeholder="6-digit code"
                />
                {smsOtpHint ? <p className="nx-login-hint">Sent to {smsOtpHint}</p> : null}
              </div>
            )}

            {!mfaFactorId && !smsOtpPending && (
              <div className="nx-login-meta">
                <label className="nx-login-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
                <Link to="/forgot-password" className="nx-login-link">Forgot password</Link>
              </div>
            )}

            {error && (
              <div className="nx-login-error" role="alert">
                {error}
              </div>
            )}

            <button
              disabled={submitting}
              type="submit"
              className={`nx-login-submit${submitting ? " is-loading" : ""}`}
            >
              {submitting
                ? (mfaFactorId || smsOtpPending ? "Verifying…" : "Signing in…")
                : (mfaFactorId || smsOtpPending ? "Verify code" : "Sign in")}
            </button>
          </form>

          <p className="nx-login-footer">
            New company? <Link to="/signup" className="nx-login-link">Start Free Trial</Link>
            <span className="nx-login-sep" aria-hidden>·</span>
            <Link to="/" className="nx-login-link">Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
