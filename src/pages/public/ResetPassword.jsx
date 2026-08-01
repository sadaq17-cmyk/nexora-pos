import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Store } from "lucide-react";
import { requireSupabase, supabaseConfigError } from "../../lib/supabaseClient";
import { validatePassword } from "../../lib/passwordPolicy";
import { authFetch } from "../../lib/authApi";

const EMAIL_NOT_SENT_MESSAGE = "We couldn't send the email right now. Please try again later or contact support.";

async function notifyPasswordChanged({ to, name }) {
  try {
    const data = await authFetch("/api/send-email", {
      method: "POST",
      body: { type: "password_changed", to, name },
    });
    if (!data?.success) {
      if (import.meta.env.DEV) console.error("[ResetPassword] password_changed notification failed:", data?.error || EMAIL_NOT_SENT_MESSAGE);
    }
  } catch (err) {
    if (import.meta.env.DEV) console.error("[ResetPassword] password_changed notification error:", err);
  }
}

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [state, setState] = useState({ loading: false, error: "", success: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supabaseConfigError) {
        if (!cancelled) setSessionError(supabaseConfigError);
        return;
      }
      try {
        const client = requireSupabase();
        const { data, error } = await client.auth.getSession();
        if (error) {
          if (!cancelled) setSessionError(error.message || "This reset link is invalid or expired.");
          return;
        }
        if (!data?.session) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          const retry = await client.auth.getSession();
          if (!retry.data?.session) {
            if (!cancelled) setSessionError("This reset link is invalid or expired. Request a new one.");
            return;
          }
        }
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) setSessionError(err?.message || "This reset link is invalid or expired.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const policy = validatePassword(password);
    if (!policy.ok) return setState({ loading: false, error: policy.message, success: false });
    if (password !== confirm) return setState({ loading: false, error: "Passwords do not match.", success: false });
    setState({ loading: true, error: "", success: false });
    try {
      const client = requireSupabase();
      const { data: userData } = await client.auth.getUser();
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        setState({ loading: false, error: error.message || "Unable to update password.", success: false });
        return;
      }
      const email = userData?.user?.email || "";
      const name = userData?.user?.app_metadata?.name || userData?.user?.user_metadata?.name || "";
      await authFetch("/api/admin-update-user", {
        method: "POST",
        body: { action: "clear_must_change_password" },
      }).catch(() => null);
      notifyPasswordChanged({ to: email, name });
      await client.auth.signOut();
      setState({ loading: false, error: "", success: true });
    } catch (err) {
      setState({ loading: false, error: err?.message || "Unable to update password.", success: false });
    }
  };

  return (
    <div className="nx-login-page">
      <div className="nx-login-inner">
        <div className="nx-login-brand">
          <div className="nx-login-brand-mark" aria-hidden>
            <Store size={24} />
          </div>
          <h1>Nexora POS Pro</h1>
          <p>Choose a new password for your account.</p>
        </div>
        <div className="nx-login-card">
          <h2 className="page-title" style={{ fontSize: "22px" }}>Reset password</h2>
          {state.success ? (
            <div className="mt-5 rounded-[12px] bg-[var(--success-soft)] p-4 text-sm text-success">
              Your password was updated. <Link to="/login" className="font-semibold text-brand">Sign in</Link>.
            </div>
          ) : sessionError ? (
            <div className="mt-5 space-y-3">
              <p role="alert" className="text-sm text-danger">{sessionError}</p>
              <Link to="/forgot-password" className="inline-flex text-sm font-semibold text-brand">Request a new reset link</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-3">
              <label className="block">
                <span className="form-label">New password</span>
                <input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="form-control w-full" />
              </label>
              <label className="block">
                <span className="form-label">Confirm password</span>
                <input required minLength={8} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="form-control w-full" />
              </label>
              {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
              <button disabled={state.loading || !ready} className="btn btn-primary w-full">
                {state.loading ? "Updating…" : ready ? "Reset password" : "Preparing session…"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
