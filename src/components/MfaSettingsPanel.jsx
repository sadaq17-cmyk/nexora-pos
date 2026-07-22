import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { requireSupabase } from "../lib/supabaseClient";
import {
  challengeAndVerifyTotp,
  enrollTotp,
  listTotpFactors,
  unenrollFactor,
} from "../lib/mfaHelpers";

export default function MfaSettingsPanel() {
  const [factors, setFactors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [enrolling, setEnrolling] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const client = requireSupabase();
      const result = await listTotpFactors(client);
      if (result.error) setError(result.error);
      setFactors(result.factors || []);
    } catch (err) {
      setError(err?.message || "Unable to load MFA status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const startEnroll = async () => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const client = requireSupabase();
      const result = await enrollTotp(client);
      if (!result.success) {
        setError(result.error || "Unable to start MFA enrollment. Ensure MFA is enabled in Supabase Auth.");
      } else {
        setEnrolling(result);
        setCode("");
      }
    } catch (err) {
      setError(err?.message || "Unable to start MFA enrollment.");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async () => {
    if (!enrolling?.factorId) return;
    setBusy(true);
    setError("");
    try {
      const client = requireSupabase();
      const result = await challengeAndVerifyTotp(client, enrolling.factorId, code);
      if (!result.success) {
        setError(result.error || "Invalid code.");
      } else {
        setEnrolling(null);
        setCode("");
        setInfo("Two-factor authentication is now enabled.");
        await refresh();
      }
    } catch (err) {
      setError(err?.message || "Unable to verify authenticator.");
    } finally {
      setBusy(false);
    }
  };

  const removeFactor = async (factorId) => {
    if (!confirm("Disable two-factor authentication for this account?")) return;
    setBusy(true);
    setError("");
    try {
      const client = requireSupabase();
      const result = await unenrollFactor(client, factorId);
      if (!result.success) setError(result.error || "Unable to disable MFA.");
      else {
        setInfo("Two-factor authentication disabled.");
        await refresh();
      }
    } catch (err) {
      setError(err?.message || "Unable to disable MFA.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-[#6B7690]">Loading security settings…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 text-[#2563EB]" size={18} />
        <div>
          <h2 className="text-sm font-semibold text-[#1B2439]">Two-factor authentication (optional)</h2>
          <p className="mt-1 text-xs text-[#6B7690]">
            Protect your account with a TOTP authenticator app. MFA is optional and stored in Supabase Auth (no app schema changes).
          </p>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {info && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>}

      {factors.length > 0 ? (
        <div className="space-y-2">
          {factors.map((factor) => (
            <div key={factor.id} className="flex items-center justify-between rounded-xl border border-[#E4E9F2] px-4 py-3">
              <div>
                <div className="text-sm font-medium text-[#1B2439]">{factor.friendly_name || "Authenticator"}</div>
                <div className="text-xs text-[#6B7690]">Verified TOTP factor</div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => removeFactor(factor.id)}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-60"
              >
                Disable
              </button>
            </div>
          ))}
        </div>
      ) : !enrolling ? (
        <button
          type="button"
          disabled={busy}
          onClick={startEnroll}
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Enable authenticator app
        </button>
      ) : null}

      {enrolling && (
        <div className="space-y-3 rounded-xl border border-[#E4E9F2] p-4">
          <p className="text-sm text-[#1B2439]">Scan this QR code with your authenticator app, then enter the 6-digit code.</p>
          {enrolling.qr ? (
            <img src={enrolling.qr} alt="MFA QR code" className="mx-auto h-44 w-44 rounded-lg border border-[#E4E9F2] bg-white p-2" />
          ) : null}
          {enrolling.secret ? (
            <p className="break-all text-xs text-[#6B7690]">Manual secret: {enrolling.secret}</p>
          ) : null}
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6-digit code"
            className="w-full rounded-lg border border-[#E4E9F2] px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={confirmEnroll}
              className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Verify &amp; enable
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setEnrolling(null); setCode(""); }}
              className="rounded-lg border border-[#E4E9F2] px-4 py-2 text-sm font-medium text-[#64748B]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
