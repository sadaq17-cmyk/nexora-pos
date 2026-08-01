import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CreditCard, LogOut, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import {
  CANONICAL_PLANS,
  DEFAULT_TRIAL_DAYS,
  PAID_PLAN_CODES,
  planPriceLabel,
} from "../lib/subscriptionPlans";

function fallbackPlans() {
  return CANONICAL_PLANS.filter((p) => PAID_PLAN_CODES.includes(p.code) && p.active !== false);
}

function normalizePlanList(planList) {
  if (!Array.isArray(planList) || !planList.length) return fallbackPlans();
  const paid = planList.filter((p) => p && PAID_PLAN_CODES.includes(p.code) && p.active !== false);
  return paid.length ? paid : fallbackPlans();
}

/**
 * Limited portal for companies with inactive/expired subscriptions.
 * Only Company Owner may access renewal after trial/subscription expiry.
 * Standalone page (not nested in app Layout) so API/layout failures cannot blank it.
 */
export default function SubscriptionRenew() {
  const { user, logout, subscriptionLocked, refreshSessionGate } = useAuth();
  const navigate = useNavigate();
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState(() => fallbackPlans());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        let sub = null;
        try {
          sub = await api.subscription?.get?.();
          if (sub && typeof sub === "object" && sub.success === false) {
            sub = null;
          }
        } catch (err) {
          if (import.meta.env.DEV) console.warn("[SubscriptionRenew] subscription.get failed", err);
        }
        if (!cancelled) setSubscription(sub && typeof sub === "object" ? sub : null);

        let planList = null;
        try {
          planList =
            (await api.plans?.listPublic?.()) ||
            (await api.subscription?.getPlans?.()) ||
            null;
        } catch (err) {
          if (import.meta.env.DEV) console.warn("[SubscriptionRenew] plans list failed", err);
        }
        if (!cancelled) setPlans(normalizePlanList(planList));
      } catch (err) {
        if (import.meta.env.DEV) console.error("[SubscriptionRenew] load failed", err);
        if (!cancelled) {
          setLoadError(err?.message || "Unable to load subscription details. You can still choose a plan below.");
          setPlans(fallbackPlans());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const renew = async (planCode) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await (api.subscription?.changePlan
        ? api.subscription.changePlan({ plan_code: planCode })
        : api.subscription?.requestRenewal?.({
            plan_code: planCode,
            company_id: user?.company_id,
            payment_reference: `PAY-${Date.now()}`,
          }));
      if (!result?.success) {
        setMessage(result?.error || "Unable to activate plan. Contact support or your Platform Admin.");
        return;
      }
      setMessage(result.message || "Plan activated. All company data is preserved.");
      if (refreshSessionGate) {
        const gate = await refreshSessionGate();
        if (gate?.success && !gate.subscriptionLocked) {
          navigate("/dashboard", { replace: true });
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("[SubscriptionRenew] renew failed", err);
      setMessage(err?.message || "Unable to activate plan. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#F4F7FB]">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <CreditCard className="mt-1 text-amber-700" size={24} />
            <div>
              <h1 className="text-2xl font-bold text-amber-950">Subscription locked</h1>
              <p className="mt-2 text-sm text-amber-900/80">
                {user?.company?.name || "Your company"} trial or subscription has ended. Only the Company Owner can
                log in and choose a plan. Staff logins are temporarily disabled. Choosing a plan preserves all
                company data (transactions, products, customers, suppliers, inventory, and reports).
              </p>
              <p className="mt-2 text-xs text-amber-800">
                New companies receive a {DEFAULT_TRIAL_DAYS}-day free trial with all Enterprise features.
              </p>
            </div>
          </div>

          {loading && (
            <div className="mt-6 flex items-center gap-2 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-900">
              <Loader2 className="animate-spin" size={16} />
              Loading subscription status…
            </div>
          )}

          {loadError && (
            <div className="mt-6 flex items-start gap-2 rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={16} />
              <span>{loadError}</span>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-amber-200 bg-white p-4 text-sm">
            <div className="font-semibold text-app-text">Current status</div>
            <div className="mt-2 text-[#64748B]">
              Plan: <strong className="text-app-text">{subscription?.plan_code || subscription?.plan || "—"}</strong>
              {" · "}
              Status: <strong className="capitalize text-app-text">{subscription?.status || "expired"}</strong>
              {subscription?.expires_at ? ` · Expired ${new Date(subscription.expires_at).toLocaleDateString()}` : ""}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold text-amber-950">Choose a plan (KES / month)</h2>
            {plans.map((plan) => (
              <button
                key={plan.code || plan.id || plan.name}
                type="button"
                disabled={busy || loading}
                onClick={() => renew(plan.code)}
                className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-white px-4 py-3 text-left text-sm hover:border-amber-400 disabled:opacity-60"
              >
                <span>
                  <strong>{plan.name || plan.code}</strong>
                  <span className="mt-0.5 block text-xs text-[#64748B]">Activate plan — no data loss</span>
                </span>
                <span className="font-semibold text-app-text">{planPriceLabel(plan)}</span>
              </button>
            ))}
          </div>

          {message && (
            <div className="mt-4 rounded-xl border border-[#D9E3F2] bg-white px-3 py-2 text-sm text-app-text">{message}</div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/login" className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900">
              Login page
            </Link>
            {!subscriptionLocked && (
              <Link
                to="/dashboard"
                className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900"
              >
                Back to dashboard
              </Link>
            )}
            <button
              type="button"
              onClick={doLogout}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-800 px-4 py-2 text-sm font-semibold text-white"
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>

          {!subscriptionLocked && (
            <p className="mt-4 text-xs text-amber-800">Your subscription appears active — you can return to the dashboard.</p>
          )}
        </div>
      </div>
    </div>
  );
}
