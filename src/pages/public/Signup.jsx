import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff, Store } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { DEFAULT_TRIAL_DAYS } from "../../lib/subscriptionPlans";

const empty = { company_name: "", full_name: "", email: "", phone: "", password: "", confirm_password: "" };

export default function Signup() {
  const { user, signup } = useAuth();
  const [form, setForm] = useState(empty);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const planCode = "free_trial";

  if (user) return <Navigate to={user.role === "platform_owner" ? "/platform" : "/dashboard"} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (form.password.length < 8) return setError("Use at least 8 characters for your password.");
    if (form.password !== form.confirm_password) return setError("Passwords do not match.");
    setLoading(true);
    const response = await signup({ ...form, plan_code: planCode });
    setLoading(false);
    if (!response.success) return setError(response.error || "Unable to create your account.");
    setResult(response);
  };

  if (result) {
    return (
      <div className="nx-login-page">
        <div className="nx-login-inner" style={{ width: "min(480px, 100%)" }}>
          <div className="nx-login-card text-center">
            <CheckCircle2 className="mx-auto text-success" size={40} />
            <h1 className="page-title mt-3" style={{ fontSize: "24px" }}>Check your email</h1>
            <p className="mt-3 text-sm leading-6 text-app-muted">
              Your company, Main Branch, Company Owner, and trial are ready. Confirm{" "}
              <strong>{result.email}</strong> using the verification email before signing in.
              Company code: <strong>{result.company_code}</strong>.
            </p>
            {result.email_delivery_configured ? (
              <p className="mt-4 rounded-[12px] bg-[var(--success-soft)] p-3 text-xs text-success">
                We sent a verification email to {result.email}.
              </p>
            ) : (
              <p className="mt-4 rounded-[12px] bg-[var(--warning-soft)] p-3 text-xs text-warning">
                We were unable to confirm email delivery{result.email_error ? `: ${result.email_error}` : "."}
              </p>
            )}
            <Link to="/login" className="btn btn-primary mt-5 w-full">Sign in</Link>
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
          <h1>Nexora POS</h1>
          <p>Start a {DEFAULT_TRIAL_DAYS}-day free trial with all Enterprise features.</p>
        </div>
        <form onSubmit={submit} className="nx-login-card">
          <h2 className="page-title" style={{ fontSize: "22px" }}>Create your workspace</h2>
          <p className="mt-1 text-sm text-app-muted">
            Your account is always a Company Owner scoped to your tenant. After the trial, pick Starter, Business,
            Professional, or Enterprise — all company data is preserved.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Company Name" value={form.company_name} onChange={(value) => setForm({ ...form, company_name: value })} autoComplete="organization" />
            <Field label="Full Name" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} autoComplete="name" />
            <Field label="Email" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} autoComplete="email" />
            <Field label="Phone" type="tel" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} autoComplete="tel" />
            <Field label="Password" type={showPassword ? "text" : "password"} value={form.password} onChange={(value) => setForm({ ...form, password: value })} autoComplete="new-password" />
            <Field label="Confirm Password" type={showPassword ? "text" : "password"} value={form.confirm_password} onChange={(value) => setForm({ ...form, confirm_password: value })} autoComplete="new-password" />
          </div>
          <button type="button" onClick={() => setShowPassword((value) => !value)} className="mt-3 inline-flex items-center gap-2 text-xs text-app-muted">
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />} {showPassword ? "Hide" : "Show"} passwords
          </button>
          {error && <div role="alert" className="mt-4 rounded-[12px] border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[var(--danger-soft)] p-3 text-sm text-danger">{error}</div>}
          <button disabled={loading} className="btn btn-primary mt-5 w-full">{loading ? "Creating workspace…" : "Start Free Trial"}</button>
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
