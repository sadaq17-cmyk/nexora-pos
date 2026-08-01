import { useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff, ShieldCheck, Store } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { DEFAULT_TRIAL_DAYS } from "../../lib/subscriptionPlans";
import OtpVerification from "../../components/OtpVerification";
import {
  COUNTRIES,
  CURRENCIES,
  DEFAULT_COUNTRY_CODE,
  getCountry,
  getCurrency,
  getDefaultCurrencyForCountry,
} from "../../lib/currency";

const empty = {
  company_name: "",
  full_name: "",
  email: "",
  phone: "",
  password: "",
  confirm_password: "",
  country_code: DEFAULT_COUNTRY_CODE,
  currency: getDefaultCurrencyForCountry(DEFAULT_COUNTRY_CODE).code,
};

function friendlySignupError(error, code) {
  const msg = String(error || "");
  if (code === "RATE_LIMITED" || /rate.?limit|too many signup/i.test(msg)) {
    return "Too many signup attempts right now. Please wait about a minute and try again.";
  }
  if (code === "EMAIL_EXISTS" || /already exists for this email|already registered/i.test(msg)) {
    return "An account already exists for this email. Sign in, or reset your password if you forgot it.";
  }
  if (code === "COMPANY_EXISTS") {
    return "A company with that name already exists. Try a different company name.";
  }
  if (/over_email_send_rate_limit|email rate limit exceeded/i.test(msg)) {
    return "Email verification is temporarily busy. Please wait about a minute, then try again.";
  }
  return msg || "Unable to create your account.";
}

export default function Signup() {
  const { user, signup } = useAuth();
  const [form, setForm] = useState(empty);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [otpVerified, setOtpVerified] = useState(false);
  const submittingRef = useRef(false);
  const planCode = "free_trial";

  const selectedCountry = useMemo(() => getCountry(form.country_code), [form.country_code]);
  const selectedCurrency = useMemo(() => getCurrency(form.currency), [form.currency]);

  if (user) return <Navigate to={user.role === "platform_owner" ? "/platform" : "/dashboard"} replace />;

  const onCountryChange = (countryCode) => {
    const nextCurrency = getDefaultCurrencyForCountry(countryCode).code;
    setForm((prev) => ({ ...prev, country_code: countryCode, currency: nextCurrency }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (loading || submittingRef.current) return;
    setError("");
    if (form.password.length < 8) return setError("Use at least 8 characters for your password.");
    if (form.password !== form.confirm_password) return setError("Passwords do not match.");
    if (!form.country_code) return setError("Select your country.");
    if (!form.currency) return setError("Select your currency.");

    submittingRef.current = true;
    setLoading(true);
    try {
      const response = await signup({
        ...form,
        plan_code: planCode,
        country: selectedCountry.name,
        country_code: selectedCountry.code,
        currency: selectedCurrency.code,
        currency_code: selectedCurrency.code,
        currency_symbol: selectedCurrency.symbol,
        locale: selectedCurrency.locale || selectedCountry.locale,
      });
      if (!response.success) {
        setError(friendlySignupError(response.error, response.code));
        return;
      }
      setResult(response);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  if (result) {
    return (
      <div className="nx-login-page">
        <div className="nx-login-inner" style={{ width: "min(480px, 100%)" }}>
          <div className="nx-login-card text-center">
            <CheckCircle2 className="mx-auto text-success" size={40} />
            <h1 className="page-title mt-3" style={{ fontSize: "24px" }}>
              {otpVerified ? "You're verified" : "Verify your email"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-app-muted">
              {otpVerified ? (
                <>
                  Your company <strong>{result.company_code}</strong> and {DEFAULT_TRIAL_DAYS}-day free trial are ready.
                  Sign in with <strong>{result.email}</strong> to get started.
                </>
              ) : (
                <>
                  Your company, Main Branch, Company Owner, and trial are ready. Enter the 6-digit code we sent to{" "}
                  <strong>{result.email}</strong> to verify your email and activate your trial.
                  Company code: <strong>{result.company_code}</strong>.
                </>
              )}
            </p>
            {(result.currency || result.currency_code) && (
              <p className="mt-3 text-sm text-app-muted">
                Company currency: <strong>{result.currency_code || result.currency}</strong>
                {result.country ? ` · ${result.country}` : ""}
              </p>
            )}

            {otpVerified ? (
              <p className="mt-4 flex items-center justify-center gap-2 rounded-[12px] bg-[var(--success-soft)] p-3 text-xs font-semibold text-success">
                <ShieldCheck size={14} /> Email verified — you can sign in now.
              </p>
            ) : (
              <div className="mt-4 text-left">
                <OtpVerification
                  purpose="registration"
                  channel="email"
                  identifier={result.email}
                  email={result.email}
                  phone={result.phone}
                  fallbackEmail={result.email}
                  userId={result.supabase_user_id}
                  companyId={result.company_id}
                  autoSend={!result.otp_sent}
                  initiallySent={Boolean(result.otp_sent)}
                  initialExpiresAt={result.expires_at || null}
                  initialResendAfter={result.resend_after || 60}
                  initialMaskedIdentifier={result.masked_identifier || result.email}
                  title="Enter your email code"
                  description={
                    result.otp_sent
                      ? "We emailed a 6-digit code. It expires in 10 minutes. You can resend after 60 seconds."
                      : "Tap Send to receive your 6-digit verification code. You can resend after 60 seconds."
                  }
                  onVerified={() => setOtpVerified(true)}
                />
              </div>
            )}

            <Link to="/login" className="btn btn-primary mt-5 w-full">
              {otpVerified ? "Sign in to start selling" : "Sign in"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nx-login-page">
      <div className="nx-login-inner" style={{ width: "min(720px, 100%)" }}>
        <div className="nx-login-brand">
          <div className="nx-login-brand-mark" aria-hidden>
            <Store size={24} />
          </div>
          <h1>Nexora POS Pro</h1>
          <p>Start a {DEFAULT_TRIAL_DAYS}-day free trial with all Enterprise features.</p>
        </div>
        <form onSubmit={submit} className="nx-login-card" aria-busy={loading}>
          <h2 className="page-title" style={{ fontSize: "22px" }}>Create your workspace</h2>
          <p className="mt-1 text-sm text-app-muted">
            Your account is always a Company Owner scoped to your tenant. After the trial, pick Starter, Business,
            Professional, or Enterprise — all company data is preserved.
          </p>
          <fieldset disabled={loading} className="mt-5 grid gap-3 border-0 p-0 sm:grid-cols-2">
            <Field label="Company Name" value={form.company_name} onChange={(value) => setForm({ ...form, company_name: value })} autoComplete="organization" />
            <Field label="Full Name" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} autoComplete="name" />
            <Field label="Email" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} autoComplete="email" />
            <Field label="Phone" type="tel" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} autoComplete="tel" />
            <label className="block text-sm font-medium text-app-text">
              <span className="form-label">Country</span>
              <select
                required
                className="form-control mt-1 w-full"
                value={form.country_code}
                onChange={(event) => onCountryChange(event.target.value)}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-app-text">
              <span className="form-label">Currency</span>
              <select
                required
                className="form-control mt-1 w-full"
                value={form.currency}
                onChange={(event) => setForm({ ...form, currency: event.target.value })}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.name} ({currency.symbol})
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-app-muted">
                Default for {selectedCountry.name} is {getDefaultCurrencyForCountry(selectedCountry.code).code}. You can change it.
              </span>
            </label>
            <Field label="Password" type={showPassword ? "text" : "password"} value={form.password} onChange={(value) => setForm({ ...form, password: value })} autoComplete="new-password" />
            <Field label="Confirm Password" type={showPassword ? "text" : "password"} value={form.confirm_password} onChange={(value) => setForm({ ...form, confirm_password: value })} autoComplete="new-password" />
          </fieldset>
          <button type="button" onClick={() => setShowPassword((value) => !value)} className="mt-3 inline-flex items-center gap-2 text-xs text-app-muted" disabled={loading}>
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />} {showPassword ? "Hide" : "Show"} passwords
          </button>
          {error && <div role="alert" className="mt-4 rounded-[12px] border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[var(--danger-soft)] p-3 text-sm text-danger">{error}</div>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-5 w-full" aria-disabled={loading}>
            {loading ? "Creating workspace…" : "Start Free Trial"}
          </button>
          <p className="mt-4 text-center text-sm text-app-muted">
            Already have an account? <Link to="/login" className="font-semibold text-brand">Sign in</Link>
            {" · "}
            <Link to="/" className="font-semibold text-brand">Home</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({ label, type = "text", value, onChange, autoComplete }) {
  return (
    <label className="block text-sm font-medium text-app-text">
      <span className="form-label">{label}</span>
      <input
        required
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        className="form-control mt-1 w-full"
      />
    </label>
  );
}
