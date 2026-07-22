import { useState } from "react";
import { Lock, Mail, Save } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { isOwner } from "../lib/rbac";
import { PASSWORD_HINT } from "../lib/passwordPolicy";

/**
 * Company Owner self-service: change own email / password.
 * Requires current password. Admin / Manager / Cashier never see this panel.
 */
export default function OwnerAccountPanel() {
  const { user, updateOwnerAccount } = useAuth();
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  if (!isOwner(user?.role)) {
    return (
      <div className="rounded-xl border border-[#E4E9F2] bg-[#F8FAFC] p-5 text-sm text-[#6B7690]">
        Only the Company Owner can change the owner email or password from this screen.
      </div>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setInfo("");
    setSaving(true);
    const result = await updateOwnerAccount({
      currentPassword,
      email,
      password: password || undefined,
      confirmPassword: confirmPassword || undefined,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error || "Unable to update account.");
      return;
    }
    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
    if (result.emailVerificationSent) {
      setInfo("Account updated. Check your new email inbox to verify the address before it becomes active.");
    } else {
      setInfo("Account updated successfully.");
    }
    showToast(result.emailVerificationSent ? "Verification email sent" : "Account updated");
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div>
        <h3 className="text-base font-semibold text-[#1B2439]">Company Owner credentials</h3>
        <p className="mt-1 text-sm text-[#6B7690]">
          Change your own email or password. Your current password is required for any change.
          Admins, managers, and cashiers cannot edit these credentials.
        </p>
      </div>

      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[#1B2439]">
          <Mail size={14} /> Email address
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-[#E4E9F2] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        />
      </div>

      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[#1B2439]">
          <Lock size={14} /> New password (optional)
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-[#E4E9F2] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        />
        <p className="mt-1 text-xs text-[#6B7690]">{PASSWORD_HINT}</p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[#1B2439]">Confirm new password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-lg border border-[#E4E9F2] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[#1B2439]">Current password (required)</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full rounded-lg border border-[#E4E9F2] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {info && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{info}</p>}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        <Save size={15} />
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
