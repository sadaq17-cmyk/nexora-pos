import { useState } from "react";
import { Link } from "react-router-dom";
import { Store } from "lucide-react";
import { requireSupabase, supabaseConfigError } from "../../lib/supabaseClient";
import { isValidEmail, normalizeEmail } from "../../lib/emailValidation";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

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
        redirectTo: "https://www.httpsnexorapos.com/reset-password",
      });
    } catch {
      /* intentionally swallow — same UI either way */
    }
    setLoading(false);
    setResult(generic);
  };

  return (
    <div className="nx-login-page">
      <div className="nx-login-inner">
        <div className="nx-login-brand">
          <div className="nx-login-brand-mark" aria-hidden>
            <Store size={24} />
          </div>
          <h1>Nexora POS</h1>
          <p>Reset access to your company workspace.</p>
        </div>
        <div className="nx-login-card">
          <h2 className="page-title" style={{ fontSize: "22px" }}>Forgot password</h2>
          <p className="mt-1 text-sm text-app-muted">
            Enter your current login email. The response is the same whether an account exists or not.
          </p>
          {!result ? (
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
          ) : (
            <div className="mt-5 rounded-[12px] border border-[color-mix(in_srgb,var(--success)_25%,transparent)] bg-[var(--success-soft)] p-4 text-sm text-app-text">
              <p>{result.message}</p>
              <p className="mt-2 text-xs text-app-muted">
                Use the email that is currently set as your login address.
              </p>
            </div>
          )}
          <Link to="/login" className="mt-5 inline-flex text-sm font-semibold text-brand">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
