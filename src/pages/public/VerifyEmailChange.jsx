import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

export default function VerifyEmailChange() {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState({ loading: true, success: false, error: "", email: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = String(searchParams.get("uid") || "").trim();
      const token = String(searchParams.get("token") || "").trim();
      if (!uid || !token) {
        if (!cancelled) {
          setState({
            loading: false,
            success: false,
            error: "This verification link is incomplete. Request a new email change from Login & Security.",
            email: "",
          });
        }
        return;
      }

      try {
        const response = await fetch("/api/owner-email-change", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirm", user_id: uid, token }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
          if (!cancelled) {
            setState({
              loading: false,
              success: false,
              error: data?.error || "Unable to verify this email change.",
              email: "",
            });
          }
          return;
        }

        // Keep local owner profile / company contact email aligned with Supabase Auth.
        if (api.publicAuth?.syncOwnerEmailProfile) {
          await api.publicAuth.syncOwnerEmailProfile({
            userId: uid,
            email: data.email,
            companyId: data.company_id,
          });
        }

        if (!cancelled) {
          setState({
            loading: false,
            success: true,
            error: "",
            email: data.email || "",
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            loading: false,
            success: false,
            error: err?.message || "Unable to verify this email change.",
            email: "",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <section className="mx-auto max-w-md px-4 py-20 sm:px-6">
      <div className="rounded-3xl border border-app bg-app-panel p-7 text-center shadow-card">
        {state.loading ? (
          <p className="text-sm text-app-muted">Confirming your new login email…</p>
        ) : state.success ? (
          <>
            <h1 className="text-3xl font-bold text-app-text">Email updated</h1>
            <p className="mt-3 text-sm text-app-muted">
              {state.email ? (
                <>
                  Your login email is now <strong>{state.email}</strong>. Sign in with this address.
                </>
              ) : (
                "Your login email was updated. Sign in with your new address."
              )}
            </p>
            <Link
              to="/login"
              className="mt-5 inline-flex rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-app-text">Unable to verify</h1>
            <p className="mt-3 text-sm text-danger">{state.error}</p>
            <Link to="/settings/login-security" className="mt-5 inline-flex text-sm font-semibold text-brand">
              Back to Login &amp; Security
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
