import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Building2, CircleDollarSign, CreditCard, Globe2,
  Settings2, ShieldCheck, Users,
} from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import CompanyManagementPanel from "../components/CompanyManagementPanel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { api } from "../lib/api";
import { isPlatformOwner } from "../lib/rbac";
import { formatLimit, isContactSalesPlan, planPriceLabel } from "../lib/saasPlans";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../lib/supportContact";

const ROUTE_MODULES = {
  "/platform": "dashboard",
  "/owner-management": "dashboard",
  "/platform/companies": "companies",
  "/platform/subscriptions": "subscriptions",
  "/platform/pricing": "pricing",
  "/platform/payments": "payments",
  "/platform/analytics": "analytics",
  "/platform/support": "support",
  "/platform/ai-guardian": "ai_guardian",
  "/platform/settings": "settings",
  "/platform/audit": "audit",
};

const fmt = (value) => (value ? new Date(value).toLocaleString() : "—");
const statusLabel = (value) => String(value || "unknown").replace(/_/g, " ");

export default function OwnerManagement() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const module = ROUTE_MODULES[location.pathname] || "dashboard";
  const [overview, setOverview] = useState({ companies: [], users: [], branches: [], stats: {}, audit: [] });
  const [consoleData, setConsoleData] = useState({ subscriptions: [], plans: [], domains: [], billing: [], audit: [], analytics: {}, platformSettings: {}, features: [], companyFeatureOverrides: [] });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const [companyPage, setCompanyPage] = useState(1);
  const [companyStatus, setCompanyStatus] = useState("");
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, page_size: 25, total: 0, total_pages: 1 });
  const overviewGen = useRef(0);
  const consoleLoaded = useRef(false);

  const loadOverview = useCallback(async (term, page = 1, opts = {}) => {
    const gen = ++overviewGen.current;
    setLoading(true);
    const overviewResult = await api.owner.getOverview({
      search: term,
      page,
      page_size: opts.page_size || 25,
      light: opts.light === true,
    });
    if (gen !== overviewGen.current) return;
    if (overviewResult.success) {
      setOverview(overviewResult);
      if (overviewResult.pagination) setPagination(overviewResult.pagination);
    }
    setLoading(false);
  }, []);

  const loadConsoleOnce = useCallback(async () => {
    if (consoleLoaded.current) return;
    consoleLoaded.current = true;
    const consoleResult = await api.owner.getPlatformConsole();
    if (consoleResult.success) setConsoleData(consoleResult);
  }, []);

  const load = useCallback(async () => {
    consoleLoaded.current = false;
    await Promise.all([loadOverview(debouncedSearch, companyPage), loadConsoleOnce()]);
  }, [debouncedSearch, companyPage, loadOverview, loadConsoleOnce]);

  useEffect(() => {
    setCompanyPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    // Dashboard preview: light enrich (no per-company counts). Companies module: paginated list counts.
    const light = module !== "companies";
    loadOverview(debouncedSearch, light ? 1 : companyPage, {
      light,
      page_size: light ? 10 : 25,
    });
  }, [debouncedSearch, companyPage, loadOverview, module]);
  useEffect(() => { loadConsoleOnce(); }, [loadConsoleOnce]);

  const companyMap = useMemo(
    () => Object.fromEntries(overview.companies.map((company) => [company.id, company])),
    [overview.companies]
  );
  const filteredCompanies = useMemo(
    () => overview.companies.filter((company) => {
      if (!companyStatus) return true;
      const ds = company.display_status || company.status;
      return ds === companyStatus || company.status === companyStatus;
    }),
    [overview.companies, companyStatus]
  );
  if (!isPlatformOwner(user?.role)) return <Navigate to="/dashboard" replace />;

  const act = async (promise, message) => {
    const result = await promise;
    if (!result.success) return showToast(result.error || "Action failed");
    showToast(message);
    await load();
  };

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-amber-600" size={28} />
            <h1 className="page-title">{titleFor(module)}</h1>
          </div>
          <p className="mt-1 text-base text-app-muted">Global SaaS administration · no company operational context</p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Platform Super Admin</span>
      </div>

      {loading && <div className="card p-10 text-center text-sm text-app-muted">Loading platform data…</div>}
      {!loading && module === "dashboard" && <PlatformDashboard overview={overview} data={consoleData} companyMap={companyMap} />}
      {!loading && module === "companies" && (
        <CompanyManagementPanel
          companies={filteredCompanies}
          users={overview.users}
          status={companyStatus}
          setStatus={setCompanyStatus}
          search={search}
          setSearch={setSearch}
          showCreate={showCreateCompany}
          setShowCreate={setShowCreateCompany}
          plans={consoleData.plans}
          load={load}
          act={act}
          showToast={showToast}
          pagination={pagination}
          page={companyPage}
          setPage={setCompanyPage}
        />
      )}
      {!loading && module === "subscriptions" && <Subscriptions rows={consoleData.subscriptions} plans={consoleData.plans} companyMap={companyMap} act={act} />}
      {!loading && module === "pricing" && <PricingPackages data={consoleData} companies={overview.companies} act={act} />}
      {!loading && module === "payments" && <Payments rows={consoleData.billing} companyMap={companyMap} />}
      {!loading && module === "analytics" && <Analytics data={consoleData.analytics} plans={consoleData.plans} subscriptions={consoleData.subscriptions} billing={consoleData.billing} />}
      {!loading && module === "support" && <PlatformSupport />}
      {!loading && module === "ai_guardian" && <PlatformAiGuardian />}
      {!loading && module === "settings" && <PlatformSettings settings={consoleData.platformSettings} act={act} />}
      {!loading && module === "audit" && <Audit rows={consoleData.audit} companies={overview.companies} companyMap={companyMap} />}
    </div>
  );
}

function titleFor(module) {
  return ({
    dashboard: "Platform Dashboard",
    companies: "Company Management",
    subscriptions: "Subscriptions",
    pricing: "Plans",
    payments: "Payments",
    analytics: "Reports",
    support: "Support",
    ai_guardian: "AI Guardian",
    settings: "Settings",
    audit: "Audit Logs",
  })[module];
}

function displayStatus(company) {
  return company.display_status || company.status || "unknown";
}

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "active") return "bg-emerald-100 text-emerald-800";
  if (s === "suspended" || s === "locked") return "bg-amber-100 text-amber-900";
  if (s === "expired") return "bg-orange-100 text-orange-900";
  if (s === "disabled" || s === "cancelled" || s === "inactive") return "bg-slate-200 text-slate-800";
  return "bg-sky-100 text-sky-800";
}

function PlatformDashboard({ overview, data, companyMap }) {
  const analytics = data.analytics || {};
  const currency = analytics.revenue_currency || "KES";
  const kpis = [
    [Building2, "Total companies", overview.stats.companies || 0],
    [Building2, "Active companies", overview.stats.active_companies || analytics.active_companies || 0],
    [CircleDollarSign, "Monthly revenue*", `${currency} ${Number(analytics.monthly_revenue || 0).toLocaleString()}`],
    [CircleDollarSign, "Total revenue*", `${currency} ${Number(analytics.total_revenue || 0).toLocaleString()}`],
    [Users, "Active users", overview.stats.active_users || analytics.active_users || 0],
    [Activity, "AI usage", analytics.ai_usage_label || "Not metered"],
    [Activity, "SMS usage", analytics.sms_usage_label || "Not metered"],
    [Activity, "Storage usage", analytics.storage_usage_label || "Not metered"],
    [ShieldCheck, "System health", analytics.system_health || "ok"],
    [CreditCard, "Active subscriptions", analytics.subscriptions_by_status?.active || 0],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map(([Icon, label, value]) => (
          <div key={label} className="nx-kpi">
            <Icon size={20} className="mb-4 text-brand" />
            <div className="nx-kpi-value text-lg">{value}</div>
            <div className="nx-kpi-label">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-app-muted">
        * Monthly revenue is estimated from active paid plan prices. Total revenue uses recorded tenant sales totals (mixed currencies possible). AI / SMS / Storage are not metered in the current schema.
      </p>
      <div className="grid gap-5 xl:grid-cols-2">
        <DataTable headings={["Company", "Owner", "Status", "Plan", "Users", "Expiry"]}>
          {overview.companies.slice(0, 10).map((company) => (
            <tr key={company.id} className="border-t border-app">
              <Cell>{company.name}<div className="text-xs text-app-muted">{company.country} · {company.currency}</div></Cell>
              <Cell>{company.owner_name || "—"}<div className="text-xs text-app-muted">{company.owner_email}</div></Cell>
              <Cell><span className={`rounded-full px-2 py-0.5 text-xs capitalize ${statusBadgeClass(displayStatus(company))}`}>{statusLabel(displayStatus(company))}</span></Cell>
              <Cell>{company.subscription_plan}</Cell>
              <Cell>{company.user_count}</Cell>
              <Cell className="text-xs">{fmt(company.expiry_date || company.expires_at)}</Cell>
            </tr>
          ))}
        </DataTable>
        <div className="space-y-4">
          <DataTable headings={["Time", "Actor", "Activity", "Company"]}>
            {(data.audit || []).slice(0, 10).map((row) => (
              <tr key={row.id || `${row.created_at}-${row.action}`} className="border-t border-app">
                <Cell className="text-xs">{fmt(row.created_at)}</Cell>
                <Cell>{row.user_name || "System"}</Cell>
                <Cell className="capitalize">{statusLabel(row.action)}</Cell>
                <Cell>{companyMap[row.company_id]?.name || "Platform"}</Cell>
              </tr>
            ))}
          </DataTable>
          <div className="card p-4 text-sm text-app-muted">
            Audit logs: {(data.audit || []).length} recent platform/tenant events · Health: <strong className="text-app">{analytics.system_health || "ok"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformSupport() {
  return (
    <div className="card max-w-2xl space-y-3 p-6">
      <h2 className="text-lg font-semibold">Platform Support</h2>
      <p className="text-sm text-app-muted">
        Customer and tenant support for Nexora POS Pro. Use Company Management to inspect a single tenant without crossing company boundaries.
      </p>
      <p className="text-sm">
        Support inbox:{" "}
        <a className="font-semibold text-brand underline" href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
      </p>
    </div>
  );
}

function PlatformAiGuardian() {
  return (
    <div className="card max-w-2xl space-y-3 p-6">
      <h2 className="text-lg font-semibold">AI Guardian</h2>
      <p className="text-sm text-app-muted">
        Platform-level AI oversight for anomaly review and tenant health signals. Open the Nexora AI assistant from the sidebar for interactive guidance.
        Tenant data is never mixed — always operate in one company context at a time (or use Login as Company Owner).
      </p>
    </div>
  );
}

function Subscriptions({ rows, plans, companyMap, act }) {
  const renewExpiry = () => new Date(Date.now() + 30 * 86400000).toISOString();
  return <DataTable headings={["Company", "Plan", "Status", "Trial / Expiry", "Limits", "Actions"]}>{rows.map((row) => <tr key={row.id} className="border-t border-app"><Cell>{companyMap[row.company_id]?.name || row.company_id}</Cell><Cell className="capitalize">{statusLabel(row.plan_code)}</Cell><Cell className="capitalize">{row.status}</Cell><Cell className="text-xs">{row.trial_ends_at ? `Trial: ${fmt(row.trial_ends_at)}` : `Expires: ${fmt(row.expires_at)}`}</Cell><Cell className="text-xs">{row.limits?.users} users · {row.limits?.branches} branches</Cell><Cell><div className="flex flex-wrap gap-1"><button className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => { const plan = prompt(`Plan: ${plans.map((entry) => entry.code).join(", ")}`, row.plan_code); const status = prompt("Status: active, trialing, suspended, expired, cancelled", row.status); const selected = plans.find((entry) => entry.code === plan); if (selected && status) act(api.owner.updateSubscription(row.company_id, { plan_id: selected.id, status }), "Subscription updated"); }}>Assign/Upgrade</button><button className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => act(api.owner.updateSubscription(row.company_id, { status: "suspended" }), "Subscription suspended")}>Suspend</button><button className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => act(api.owner.updateSubscription(row.company_id, { status: "active" }), "Subscription resumed")}>Resume</button><button className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => act(api.owner.updateSubscription(row.company_id, { status: "active", expires_at: renewExpiry() }), "Subscription renewed")}>Renew</button><button className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => act(api.owner.updateSubscription(row.company_id, { status: "expired" }), "Subscription expired")}>Expire</button></div></Cell></tr>)}</DataTable>;
}

function PricingPackages({ data, companies, act }) {
  return <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{data.plans.map((plan) => <div key={plan.id} className="card p-5"><div className="flex items-center justify-between"><h3 className="font-semibold">{plan.name}</h3><span className={`rounded-full px-2 py-1 text-xs ${plan.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{plan.active ? "Active" : "Inactive"}</span></div><div className="mt-3 text-2xl font-bold">{planPriceLabel(plan)}{!isContactSalesPlan(plan) && Number(plan.price_monthly) > 0 ? <span className="text-sm font-medium text-app-muted">/mo</span> : null}</div><p className="mt-2 text-sm text-app-muted">{formatLimit(plan.limits?.users)} users · {formatLimit(plan.limits?.branches)} branches · {plan.trial_days || 0}d trial{isContactSalesPlan(plan) ? " · Contact Sales" : ""}</p><ul className="mt-3 space-y-1 text-xs text-app-muted">{(plan.features || []).map((feature) => <li key={feature}>• {feature}</li>)}</ul><div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg border border-app px-3 py-1.5 text-xs" onClick={() => { const price = prompt("Monthly price", plan.price_monthly); const features = prompt("Features (comma separated)", (plan.features || []).join(", ")); if (price !== null && features !== null) act(api.owner.savePlan({ ...plan, price_monthly: Number(price), features: features.split(",").map((item) => item.trim()).filter(Boolean) }), "Package updated"); }}>Edit price & features</button><button className="rounded-lg border border-app px-3 py-1.5 text-xs" onClick={() => act(api.owner.savePlan({ ...plan, active: !plan.active }), "Package status updated")}>{plan.active ? "Deactivate" : "Activate"}</button><button className="rounded-lg border border-app px-3 py-1.5 text-xs" onClick={() => act(api.owner.savePlan({ ...plan, public_visible: plan.public_visible === false }), "Public visibility updated")}>{plan.public_visible === false ? "Show publicly" : "Hide publicly"}</button></div></div>)}</div>
    <div><h2 className="mb-3 text-lg font-semibold">Feature controls</h2><div className="grid gap-4 lg:grid-cols-2">{(data.features || []).map((feature) => <div key={feature.id} className="card p-5"><div className="flex justify-between gap-3"><div><h3 className="font-semibold">{feature.name}</h3><p className="text-sm text-app-muted">{feature.description}</p></div><button className="rounded-lg border border-app px-2.5 py-1.5 text-xs" onClick={() => act(api.owner.saveFeature({ ...feature, active: !feature.active }), "Feature status updated")}>{feature.active ? "Disable" : "Enable"}</button></div><div className="mt-4 space-y-2">{companies.slice(0, 8).map((company) => { const override = data.companyFeatureOverrides.find((row) => Number(row.company_id) === Number(company.id) && row.feature_code === feature.code); const enabled = override ? !!override.enabled : !!feature.active; return <label key={`${feature.code}-${company.id}`} className="flex items-center justify-between rounded-xl border border-app px-3 py-2 text-sm"><span>{company.name}</span><input type="checkbox" checked={enabled} onChange={(e) => act(api.owner.toggleCompanyFeature(company.id, feature.code, e.target.checked), "Company feature updated")} /></label>; })}</div></div>)}</div></div>
  </div>;
}

function Payments({ rows, companyMap }) {
  return <DataTable headings={["Company", "Plan", "Amount", "Status", "Date", "Reference"]}>{rows.map((row) => <tr key={row.id} className="border-t border-app"><Cell>{companyMap[row.company_id]?.name || "—"}</Cell><Cell>{row.plan_code || "—"}</Cell><Cell>{row.currency || "USD"} {Number(row.amount || 0).toLocaleString()}</Cell><Cell className="capitalize">{row.status}</Cell><Cell>{fmt(row.paid_at || row.created_at)}</Cell><Cell>{row.reference || row.invoice_no || "—"}</Cell></tr>)}</DataTable>;
}

function Analytics({ data, plans, subscriptions, billing }) {
  const distribution = plans.map((plan) => ({ name: plan.name, count: subscriptions.filter((row) => row.plan_code === plan.code).length }));
  const revenue = billing.filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const cards = [[Building2, "Companies", data.companies || 0], [Users, "Users", data.users || 0], [Globe2, "Branches", data.branches || 0], [CreditCard, "Subscriptions", subscriptions.length], [CircleDollarSign, "Payment total*", revenue.toLocaleString()]];
  return <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([Icon, label, value]) => <div key={label} className="nx-kpi"><Icon className="mb-4 text-brand" size={20} /><div className="nx-kpi-value">{value}</div><div className="nx-kpi-label">{label}</div></div>)}</div><div className="card"><h2 className="card-title">Plan distribution</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{distribution.map((row) => <div key={row.name} className="rounded-xl bg-app p-4"><div className="text-xl font-bold">{row.count}</div><div className="text-xs text-app-muted">{row.name}</div></div>)}</div><p className="mt-4 text-xs text-app-muted">* Payment and sales totals are not currency-normalized. Tenant sales span {data.sales_currencies?.join(", ") || "no recorded currencies"}.</p></div></div>;
}

function PlatformSettings({ settings, act }) {
  return <div className="grid gap-4 lg:grid-cols-2"><div className="card p-5"><div className="mb-3 flex items-center gap-2"><Settings2 size={18} className="text-brand" /><h3 className="font-semibold">SaaS defaults</h3></div><label className="flex items-center justify-between gap-4 rounded-xl border border-app p-3"><span><span className="block text-sm font-medium">Require verified domains</span><span className="text-xs text-app-muted">Only verified domains resolve during login.</span></span><input type="checkbox" checked={!!settings.require_verified_domains} onChange={(e) => act(api.owner.updatePlatformSettings({ require_verified_domains: e.target.checked }), "Platform settings updated")} /></label></div><div className="card p-5"><h3 className="font-semibold">Company settings boundary</h3><p className="mt-2 text-sm leading-6 text-app-muted">Store, POS, currency, tax, receipt, and barcode settings remain tenant-scoped and are not modified here.</p></div></div>;
}

function Audit({ rows, companies, companyMap }) {
  const [company, setCompany] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [date, setDate] = useState("");
  const filtered = rows.filter((row) =>
    (!company || Number(row.company_id) === Number(company))
    && (!action || String(row.action).toLowerCase().includes(action.toLowerCase()))
    && (!actor || String(row.user_name || "").toLowerCase().includes(actor.toLowerCase()))
    && (!date || String(row.created_at || "").slice(0, 10) === date)
  );
  return <div className="space-y-4"><div className="card flex flex-wrap gap-3 p-4"><select value={company} onChange={(e) => setCompany(e.target.value)} className="form-control min-h-10 rounded-xl border px-3 text-sm"><option value="">All companies</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter action…" className="form-control min-h-10 rounded-xl border px-3 text-sm" /><input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Filter actor…" className="form-control min-h-10 rounded-xl border px-3 text-sm" /><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="form-control min-h-10 rounded-xl border px-3 text-sm" /></div><DataTable headings={["Time", "Actor", "Action", "Module", "Company", "Details"]}>{filtered.map((row) => <tr key={row.id} className="border-t border-app"><Cell className="text-xs">{fmt(row.created_at)}</Cell><Cell>{row.user_name || "System"}</Cell><Cell className="capitalize">{statusLabel(row.action)}</Cell><Cell>{row.module}</Cell><Cell>{companyMap[row.company_id]?.name || "Platform"}</Cell><Cell className="max-w-sm truncate text-xs text-app-muted">{row.details}</Cell></tr>)}</DataTable></div>;
}

function Cell({ children, className = "" }) {
  return <td className={`px-4 py-3 text-sm ${className}`}>{children}</td>;
}

function DataTable({ headings, children }) {
  const empty = !children || children.length === 0;
  return <div className="card overflow-x-auto"><table className="w-full min-w-[760px]"><thead><tr className="bg-app">{headings.map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs uppercase text-app-muted">{heading}</th>)}</tr></thead><tbody>{children}{empty && <tr><td colSpan={headings.length} className="p-10 text-center text-sm text-app-muted">No records yet.</td></tr>}</tbody></table></div>;
}
