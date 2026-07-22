import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { requireSupabase, supabaseConfigError } from "../../lib/supabaseClient";

export default function VerifyEmail() {
  const [state, setState] = useState({ loading: true, success: false, error: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supabaseConfigError) {
        if (!cancelled) setState({ loading: false, success: false, error: supabaseConfigError });
        return;
      }
      try {
        const client = requireSupabase();
        // Confirmation links land with tokens in the URL; detectSessionInUrl exchanges them.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const { data, error } = await client.auth.getSession();
        if (error) {
          if (!cancelled) setState({ loading: false, success: false, error: error.message || "Unable to verify." });
          return;
        }
        const user = data?.session?.user;
        if (user?.email_confirmed_at || user?.confirmed_at) {
          if (api.publicAuth?.activateCompanyForOwner) {
            await api.publicAuth.activateCompanyForOwner(user.id);
          }
          // Do not leave the user logged in on the verify page unless they want to continue.
          await client.auth.signOut();
          if (!cancelled) setState({ loading: false, success: true, error: "" });
          return;
        }

        // Some flows confirm without establishing a full session — check getUser after exchange.
        const { data: userData } = await client.auth.getUser();
        if (userData?.user?.email_confirmed_at) {
          if (api.publicAuth?.activateCompanyForOwner) {
            await api.publicAuth.activateCompanyForOwner(userData.user.id);
          }
          await client.auth.signOut();
          if (!cancelled) setState({ loading: false, success: true, error: "" });
          return;
        }

        if (!cancelled) {
          setState({
            loading: false,
            success: false,
            error: "This verification link is invalid or has already been used. If you already verified, you can sign in.",
          });
        }
      } catch (err) {
        if (!cancelled) setState({ loading: false, success: false, error: err?.message || "Unable to verify." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="mx-auto max-w-md px-4 py-20 sm:px-6">
      <div className="rounded-3xl border border-[#D9E3F2] bg-white p-7 text-center shadow-sm">
        {state.loading ? (
          <p className="text-sm text-[#64748B]">Verifying your email…</p>
        ) : state.success ? (
          <>
            <h1 className="text-3xl font-bold text-[#0B1C3D]">Email verified</h1>
            <p className="mt-3 text-sm text-[#64748B]">Your company is active. You can sign in now.</p>
            <Link to="/login" className="mt-5 inline-flex rounded-xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white">Sign in</Link>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-[#0B1C3D]">Unable to verify</h1>
            <p className="mt-3 text-sm text-red-600">{state.error}</p>
            <Link to="/login" className="mt-5 inline-flex text-sm font-semibold text-[#2563EB]">Return to login</Link>
          </>
        )}
      </div>
    </section>
  );
}
