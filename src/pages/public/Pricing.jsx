import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import Seo from "../../components/public/Seo";
import { api } from "../../lib/api";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../../lib/supportContact";
import {
  DEFAULT_TRIAL_DAYS,
  formatLimit,
  paidPublicPlans,
  planPriceLabel,
  PAID_PLAN_CODES,
} from "../../lib/subscriptionPlans";

export default function Pricing() {
  const [plans, setPlans] = useState([]);
  const [yearly, setYearly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.platformPublic.getPlans().then((result) => {
      const list = Array.isArray(result) ? result : [];
      const paid = list.filter((plan) => PAID_PLAN_CODES.includes(plan.code) && plan.public_visible !== false);
      setPlans(paid.length ? paid.sort((a, b) => Number(a.sort_order) - Number(b.sort_order)) : paidPublicPlans());
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <Seo
        title="Pricing — Nexora POS"
        description={`Nexora POS plans in KES: Starter, Business, Professional, and Enterprise. Every new company gets a ${DEFAULT_TRIAL_DAYS}-day free trial with all Enterprise features.`}
      />

      <section className="nx-section" style={{ paddingTop: "3.5rem", textAlign: "center" }}>
        <div className="nx-section__label">Pricing</div>
        <h1 className="nx-section__title">Plans built for Kenyan retail teams</h1>
        <p className="nx-section__lead" style={{ marginLeft: "auto", marginRight: "auto" }}>
          Starter, Business, Professional, and Enterprise — billed in KES. Every new company gets a{" "}
          {DEFAULT_TRIAL_DAYS}-day free trial with all Enterprise features. Questions? Email{" "}
          <a className="nx-support-link" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <div
          className="mt-6 inline-flex rounded-xl border border-[#D9E3F2] bg-white p-1"
          style={{ boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04)" }}
        >
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${!yearly ? "bg-[#0B1C3D] text-white" : "text-[#51607A]"}`}
            onClick={() => setYearly(false)}
          >
            Monthly
          </button>
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${yearly ? "bg-[#0B1C3D] text-white" : "text-[#51607A]"}`}
            onClick={() => setYearly(true)}
          >
            Yearly
          </button>
        </div>
      </section>

      <section className="nx-section" style={{ paddingTop: 0 }}>
        {loading && (
          <div className="rounded-2xl border border-[#D9E3F2] bg-white p-10 text-center text-sm text-[#64748B]">
            Loading plans…
          </div>
        )}
        {!loading && !plans.length && (
          <div className="rounded-2xl border border-[#D9E3F2] bg-white p-10 text-center text-sm text-[#64748B]">
            No public packages are currently available. Contact{" "}
            <a className="nx-support-link" href={SUPPORT_MAILTO}>
              {SUPPORT_EMAIL}
            </a>
            .
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => {
            const featured = plan.code === "business";
            const enterprise = plan.code === "enterprise";
            const priceText = planPriceLabel(plan, { yearly });
            return (
              <article
                key={plan.code}
                className={`flex rounded-3xl border bg-white p-6 ${
                  enterprise
                    ? "border-[#0B1C3D] shadow-[0_12px_40px_rgba(11,28,61,0.12)] ring-2 ring-slate-200"
                    : featured
                      ? "border-[#2563EB] shadow-[0_12px_40px_rgba(37,99,235,0.12)] ring-2 ring-blue-100"
                      : "border-[#D9E3F2] shadow-sm"
                }`}
              >
                <div className="flex w-full flex-col">
                  {featured && (
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#2563EB]">Most popular</div>
                  )}
                  {enterprise && (
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#0B1C3D]">Highest tier</div>
                  )}
                  <h2 className="text-xl font-bold text-[#0B1C3D]" style={{ fontFamily: "var(--font-display)" }}>
                    {plan.name}
                  </h2>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-[#64748B]">{plan.description}</p>
                  <div className="mt-5 text-3xl font-bold text-[#0B1C3D]">
                    {priceText}
                    {Number(yearly ? plan.price_yearly : plan.price_monthly) > 0 && (
                      <span className="text-sm font-normal text-[#64748B]">
                        /{yearly ? "year" : "month"}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-semibold text-[#2563EB]">
                    Includes {DEFAULT_TRIAL_DAYS}-day Enterprise trial
                  </p>
                  <div className="mt-5 space-y-2">
                    {(plan.features || []).map((feature) => (
                      <div key={feature} className="flex gap-2 text-sm text-[#0F1B33]">
                        <Check size={16} className="mt-0.5 shrink-0 text-[#2563EB]" />
                        {feature}
                      </div>
                    ))}
                  </div>
                  <p className="mt-5 text-xs text-[#64748B]">
                    {formatLimit(plan.limits?.users)} users · {formatLimit(plan.limits?.branches)} branches ·{" "}
                    {formatLimit(plan.limits?.products)} products
                  </p>
                  <Link to="/signup" className="mt-auto pt-6">
                    <span
                      className={`block rounded-xl px-4 py-3 text-center text-sm font-semibold ${
                        featured ? "bg-[#2563EB] text-white" : "bg-[#0B1C3D] text-white"
                      }`}
                    >
                      Start Free Trial
                    </span>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
