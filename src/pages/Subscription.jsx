import { useEffect, useMemo, useState } from "react";
import { CreditCard, Building2, Users, Coins, Save, CalendarClock, RefreshCw, Package } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { isOwner, isPlatformOwner } from "../lib/rbac";
import { Navigate } from "react-router-dom";
import {
  CANONICAL_PLANS,
  DEFAULT_TRIAL_DAYS,
  formatLimit,
  getPlanByCode,
  normalizePlanCode,
  PAID_PLAN_CODES,
  planPriceLabel,
} from "../lib/subscriptionPlans";

function daysRemaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function deriveStatus(subscription) {
  const raw = String(subscription.status || "").toLowerCase();
  const days = daysRemaining(subscription.expires_at || subscription.renewsAt || subscription.renews_at);
  if (raw === "suspended") return "Suspended";
  if (raw === "expired" || (days != null && days < 0)) return "Expired";
  if (days != null && days <= 14) return "Expiring Soon";
  if (raw === "trial" || raw === "trialing") return "Trial";
  if (raw === "active") return "Active";
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Unknown";
}

export default function Subscription() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [subscription, setSubscription] = useState(null);
  const [busy, setBusy] = useState(false);
  const ownerOnly = isOwner(user?.role) || isPlatformOwner(user?.role);
  const paidPlans = useMemo(
    () => CANONICAL_PLANS.filter((plan) => PAID_PLAN_CODES.includes(plan.code)),
    []
  );

  const hydrate = (row) => {
    if (!row) {
      setSubscription(null);
      return;
    }
    const code = normalizePlanCode(row.plan_code || row.plan || "enterprise");
    const catalog = getPlanByCode(code);
    setSubscription({
      ...row,
      plan: catalog?.name || row.plan || code,
      plan_code: code,
      status: row.status || "active",
      billingCycle: row.billingCycle || row.billing_cycle || "monthly",
      renewsAt: row.renewsAt || row.expires_at || row.renews_at || "",
      startsAt: row.starts_at || row.startsAt || row.created_at || "",
      paymentStatus: row.payment_status || row.paymentStatus || "paid",
      autoRenewal: row.auto_renewal ?? row.autoRenewal ?? true,
      branchesAllowed: row.branchesAllowed ?? row.limits?.branches ?? catalog?.limits?.branches ?? 1,
      usersAllowed: row.usersAllowed ?? row.limits?.users ?? catalog?.limits?.users ?? 3,
      productsAllowed: row.limits?.products ?? catalog?.limits?.products ?? 1000,
      expires_at: row.expires_at || row.renewsAt || row.renews_at || "",
    });
  };

  useEffect(() => {
    api.subscription.get().then(hydrate);
  }, []);

  const displayStatus = useMemo(() => (subscription ? deriveStatus(subscription) : "—"), [subscription]);
  const remaining = useMemo(
    () => (subscription ? daysRemaining(subscription.expires_at || subscription.renewsAt) : null),
    [subscription]
  );
  const currentPlan = useMemo(
    () => getPlanByCode(subscription?.plan_code || subscription?.plan),
    [subscription]
  );

  if (!ownerOnly) return <Navigate to="/dashboard" replace />;

  if (!subscription) {
    return <div className="py-16 text-center text-sm text-app-muted">Loading subscription…</div>;
  }

  const changePlan = async (planCode) => {
    setBusy(true);
    const result = await (api.subscription.changePlan
      ? api.subscription.changePlan({ plan_code: planCode })
      : api.subscription.requestRenewal?.({ plan_code: planCode, payment_reference: `PLAN-${Date.now()}` }));
    setBusy(false);
    if (!result?.success) {
      showToast(result?.error || "Could not change plan");
      return;
    }
    showToast(result.message || "Plan updated — all company data preserved");
    const row = result.subscription || (await api.subscription.get());
    hydrate(row);
  };

  const save = async () => {
    setBusy(true);
    const planCode = normalizePlanCode(subscription.plan_code || subscription.plan);
    const result = await (api.subscription.changePlan
      ? api.subscription.changePlan({
          plan_code: planCode,
          billing_cycle: subscription.billingCycle,
          auto_renewal: subscription.autoRenewal,
        })
      : api.subscription.update?.({
          ...subscription,
          plan_code: planCode,
          billing_cycle: subscription.billingCycle,
          payment_status: subscription.paymentStatus,
          auto_renewal: subscription.autoRenewal,
          expires_at: subscription.renewsAt || subscription.expires_at,
          starts_at: subscription.startsAt,
          status: subscription.status,
        }));
    setBusy(false);
    showToast(result?.success ? "Subscription updated — data preserved" : result?.error || "Could not update subscription");
    if (result?.success) {
      hydrate(result.subscription || (await api.subscription.get()));
    }
  };

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Subscription</h1>
          <p className="mt-1 text-base text-app-muted">
            Owner-only plan management. Upgrade or downgrade anytime — transactions, products, customers, suppliers,
            inventory, and reports stay intact. New companies start with a {DEFAULT_TRIAL_DAYS}-day Enterprise trial.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          displayStatus === "Active" ? "bg-[#E8FAEF] text-success"
            : displayStatus === "Expiring Soon" ? "bg-[#FEF3C7] text-[#B45309]"
              : displayStatus === "Expired" || displayStatus === "Suspended" ? "bg-[#FEE2E2] text-danger"
                : "bg-[#F1F3F8] text-app-muted"
        }`}>{displayStatus}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="card">
          <div className="mb-2 flex items-center gap-2 text-brand"><CreditCard size={18} /><span className="card-title">Plan</span></div>
          <div className="page-title capitalize">{currentPlan?.name || subscription.plan}</div>
          <div className="mt-2 text-sm text-app-muted">
            {currentPlan ? `${planPriceLabel(currentPlan)} / month` : `Billing: ${subscription.billingCycle}`}
          </div>
        </div>
        <div className="card">
          <div className="mb-2 flex items-center gap-2 text-brand"><CalendarClock size={18} /><span className="card-title">Days remaining</span></div>
          <div className="page-title">{remaining == null ? "—" : remaining}</div>
          <div className="mt-2 text-sm text-app-muted">Expires / renews: {subscription.renewsAt ? String(subscription.renewsAt).slice(0, 10) : "—"}</div>
        </div>
        <div className="card">
          <div className="mb-2 flex items-center gap-2 text-brand"><Building2 size={18} /><span className="card-title">Branches</span></div>
          <div className="page-title">{formatLimit(subscription.branchesAllowed ?? currentPlan?.limits?.branches)}</div>
          <div className="mt-2 text-sm text-app-muted">Capacity on this plan</div>
        </div>
        <div className="card">
          <div className="mb-2 flex items-center gap-2 text-brand"><Users size={18} /><span className="card-title">Users</span></div>
          <div className="page-title">{formatLimit(subscription.usersAllowed ?? currentPlan?.limits?.users)}</div>
          <div className="mt-2 text-sm text-app-muted">
            Products: {formatLimit(subscription.productsAllowed ?? currentPlan?.limits?.products)}
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <div className="mb-4 flex items-center gap-2">
          <Package size={18} className="text-brand" />
          <h3 className="card-title">Choose or change plan</h3>
        </div>
        <p className="mb-4 text-sm text-app-muted">
          Select any plan below. Changing plans never wipes company data.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {paidPlans.map((plan) => {
            const selected = normalizePlanCode(subscription.plan_code) === plan.code;
            return (
              <button
                key={plan.code}
                type="button"
                disabled={busy || selected}
                onClick={() => changePlan(plan.code)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-brand bg-[color-mix(in_srgb,var(--brand)_8%,white)]"
                    : "border-app hover:border-brand"
                } disabled:opacity-70`}
              >
                <div className="text-sm font-bold text-app-text">{plan.name}</div>
                <div className="mt-1 text-lg font-semibold text-brand">{planPriceLabel(plan)}<span className="text-xs font-normal text-app-muted">/mo</span></div>
                <div className="mt-2 text-xs text-app-muted">
                  {formatLimit(plan.limits.users)} users · {formatLimit(plan.limits.branches)} branches ·{" "}
                  {formatLimit(plan.limits.products)} products
                </div>
                <div className="mt-3 text-xs font-semibold text-brand">
                  {selected ? "Current plan" : "Switch to this plan"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card mt-6">
        <div className="mb-4 flex items-center gap-2">
          <Coins size={18} className="text-brand" />
          <h3 className="card-title">Billing preferences</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-app-text">Billing cycle</label>
            <select value={subscription.billingCycle} onChange={(e) => setSubscription((c) => ({ ...c, billingCycle: e.target.value }))} className="w-full rounded-lg border border-app px-3 py-2 text-sm">
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-app-text">Auto renewal</label>
            <select value={subscription.autoRenewal ? "1" : "0"} onChange={(e) => setSubscription((c) => ({ ...c, autoRenewal: e.target.value === "1" }))} className="w-full rounded-lg border border-app px-3 py-2 text-sm">
              <option value="1">Enabled</option>
              <option value="0">Disabled</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-app-text">Status</label>
            <div className="rounded-lg border border-app bg-[#F8FAFC] px-3 py-2 text-sm capitalize text-app-muted">
              {subscription.status || "—"}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => api.subscription.get().then(hydrate)} className="btn border border-app inline-flex items-center gap-2">
            <RefreshCw size={14} /> Reload
          </button>
          <button type="button" disabled={busy} onClick={save} className="btn btn-primary inline-flex items-center gap-2">
            <Save size={16} /> Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}
