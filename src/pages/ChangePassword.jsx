import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { PASSWORD_HINT, validatePassword } from "../lib/passwordPolicy";

export default function ChangePassword() {
  const { user, changePassword, mustChangePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState({ loading: false, error: "", success: false });
  const navTimer = useRef(null);

  useEffect(() => () => {
    if (navTimer.current) window.clearTimeout(navTimer.current);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const policy = validatePassword(password, { username: user?.username, email: user?.email });
    if (!policy.ok) return setState({ loading: false, error: policy.message, success: false });
    if (password !== confirm) return setState({ loading: false, error: "Passwords do not match.", success: false });
    if (!mustChangePassword && !currentPassword) {
      return setState({ loading: false, error: "Enter your current password.", success: false });
    }

    setState({ loading: true, error: "", success: false });
    const result = await changePassword({
      currentPassword: mustChangePassword ? undefined : currentPassword,
      newPassword: password,
    });
    if (!result.success) {
      setState({ loading: false, error: result.error || "Unable to change password.", success: false });
      return;
    }
    setState({ loading: false, error: "", success: true });
    navTimer.current = window.setTimeout(() => {
      navigate(user?.role === "platform_owner" ? "/platform" : "/dashboard", { replace: true });
    }, 800);
  };

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4 py-10">
      <div className="nx-login-card w-full p-6 sm:p-8">
        <div className="mb-4 flex items-center gap-3">
          <Lock className="text-brand" size={22} />
          <h1 className="page-title" style={{ fontSize: "28px" }}>
            {mustChangePassword ? "Change password required" : "Change password"}
          </h1>
        </div>
        <p className="text-base text-app-muted">
          {mustChangePassword
            ? "For security, you must set a new password before continuing."
            : "Update your account password. You will stay signed in."}
        </p>
        <p className="mt-2 text-sm text-app-muted">{PASSWORD_HINT}</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {!mustChangePassword && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Current password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="form-control min-h-11 w-full rounded-xl border px-3"
              />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium">New password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-control min-h-11 w-full rounded-xl border px-3"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Confirm new password</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="form-control min-h-11 w-full rounded-xl border px-3"
            />
          </div>

          {state.error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>
          )}
          {state.success && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Password updated.
            </div>
          )}

          <button
            type="submit"
            disabled={state.loading}
            className="btn btn-primary w-full"
          >
            {state.loading ? "Updating…" : "Update password"}
          </button>
        </form>

        {!mustChangePassword && (
          <p className="mt-5 text-center text-sm">
            <Link to="/forgot-password" className="font-semibold text-brand">Forgot password?</Link>
          </p>
        )}
      </div>
    </div>
  );
}
