import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Building2, CircleDollarSign, CreditCard, Globe2, Plus,
  Search, Settings2, ShieldCheck, Users,
} from "lucide-react";
import { Navigate, useLocation } from "react-router-dom";
import CompanyAccountForm from "../components/CompanyAccountForm";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../lib/api";
import { isPlatformOwner, normalizeRole, SYSTEM_ROLES } from "../lib/rbac";
import { formatLimit, isContactSalesPlan, planPriceLabel } from "../lib/saasPlans";

const ROUTE_MODULES = {
  "/platform": "dashboard",
  "/owner-management": "dashboard",
  "/platform/companies": "companies",
  "/platform/subscriptions": "subscriptions",
  "/platform/pricing": "pricing",
  "/platform/users": "users",
  "/platform/payments": "payments",
  "/platform/analytics": "analytics",
  "/platform/domains": "domains",
  "/platform/settings": "settings",
  "/platform/audit": "audit",
  "/platform/branches": "branches",
  "/platform/roles": "roles",
  "/platform/backup": "backup",
  "/platform/search": "search",
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
  const [companyStatus, setCompanyStatus] = useState("");
  const [userCompany, setUserCompany] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userStatus, setUserStatus] = useState("");
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [overviewResult, consoleResult] = await Promise.all([
      api.owner.getOverview({ search }),
      api.owner.getPlatformConsole(),
    ]);
    if (overviewResult.success) setOverview(overviewResult);
    if (consoleResult.success) setConsoleData(consoleResult);
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const companyMap = useMemo(
    () => Object.fromEntries(overview.companies.map((company) => [company.id, company])),
    [overview.companies]
  );
  const filteredCompanies = useMemo(
    () => overview.companies.filter((company) => !companyStatus || company.status === companyStatus),
    [overview.companies, companyStatus]
  );
  const filteredUsers = useMemo(
    () => overview.users.filter((member) =>
      (!userCompany || String(member.company_id) === String(userCompany))
      && (!userRole || normalizeRole(member.role) === userRole)
      && (!userStatus || (userStatus === "active") === !!member.active)
    ),
    [overview.users, userCompany, userRole, userStatus]
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
        <Companies
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
        />
      )}
      {!loading && module === "subscriptions" && <Subscriptions rows={consoleData.subscriptions} plans={consoleData.plans} companyMap={companyMap} act={act} />}
      {!loading && module === "pricing" && <PricingPackages data={consoleData} companies={overview.companies} act={act} />}
      {!loading && module === "users" && (
        <PlatformUsers
          rows={filteredUsers}
          companies={overview.companies}
          companyMap={companyMap}
          filters={{ userCompany, userRole, userStatus }}
          setters={{ setUserCompany, setUserRole, setUserStatus }}
          act={act}
          showToast={showToast}
        />
      )}
      {!loading && module === "payments" && <Payments rows={consoleData.billing} companyMap={companyMap} />}
      {!loading && module === "analytics" && <Analytics data={consoleData.analytics} plans={consoleData.plans} subscriptions={consoleData.subscriptions} billing={consoleData.billing} />}
      {!loading && module === "domains" && <Domains rows={consoleData.domains} companies={overview.companies} companyMap={companyMap} act={act} />}
      {!loading && module === "settings" && <PlatformSettings settings={consoleData.platformSettings} act={act} />}
      {!loading && module === "audit" && <Audit rows={consoleData.audit} companies={overview.companies} companyMap={companyMap} />}
      {!loading && module === "branches" && <BranchManagement branches={overview.branches} companyMap={companyMap} />}
      {!loading && module === "roles" && <PlatformRoles />}
      {!loading && module === "backup" && <PlatformBackup act={act} showToast={showToast} />}
      {!loading && module === "search" && (
        <GlobalSearch overview={overview} companyMap={companyMap} search={search} setSearch={setSearch} />
      )}
    </div>
  );
}

function titleFor(module) {
  return ({
    dashboard: "Platform Dashboard", companies: "Companies", subscriptions: "Subscriptions",
    pricing: "Pricing Packages", users: "Users", payments: "Payments", analytics: "Analytics",
    domains: "Domains", settings: "Settings", audit: "Audit Logs",
    branches: "Branch Management", roles: "Role & Permissions", backup: "Backup & Restore", search: "Global Search",
  })[module];
}

function PlatformDashboard({ overview, data, companyMap }) {
  const revenueByCurrency = (data.billing || []).filter((row) => row.status === "paid").reduce((totals, row) => {
    const currency = row.currency || "USD";
    totals[currency] = (totals[currency] || 0) + Number(row.amount || 0);
    return totals;
  }, {});
  const kpis = [
    [Building2, "Companies", overview.stats.companies || 0],
    [Users, "Company users", overview.stats.users || 0],
    [CreditCard, "Active subscriptions", data.analytics.subscriptions_by_status?.active || 0],
    [Activity, "Trials", data.analytics.subscriptions_by_status?.trialing || 0],
    [CircleDollarSign, "Collected revenue", Object.entries(revenueByCurrency).map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`).join(" · ") || "No payments"],
  ];
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{kpis.map(([Icon, label, value]) => <div key={label} className="nx-kpi"><Icon size={20} className="mb-4 text-brand" /><div className="nx-kpi-value">{value}</div><div className="nx-kpi-label">{label}</div></div>)}</div>
    <div className="grid gap-5 xl:grid-cols-2">
      <DataTable headings={["Company", "Status", "Plan", "Users"]}>{overview.companies.slice(0, 8).map((company) => <tr key={company.id} className="border-t border-app"><Cell>{company.name}</Cell><Cell className="capitalize">{statusLabel(company.status)}</Cell><Cell>{company.subscription_plan}</Cell><Cell>{company.user_count}</Cell></tr>)}</DataTable>
      <DataTable headings={["Time", "Actor", "Activity", "Company"]}>{data.audit.slice(0, 8).map((row) => <tr key={row.id} className="border-t border-app"><Cell className="text-xs">{fmt(row.created_at)}</Cell><Cell>{row.user_name || "System"}</Cell><Cell className="capitalize">{statusLabel(row.action)}</Cell><Cell>{companyMap[row.company_id]?.name || "Platform"}</Cell></tr>)}</DataTable>
    </div>
  </div>;
}

function Companies({ companies, users, status, setStatus, search, setSearch, showCreate, setShowCreate, plans, load, act, showToast }) {
  return <div className="space-y-4">
    <div className="card flex flex-wrap gap-3 p-4">
      <div className="relative min-w-64 flex-1"><Search size={15} className="absolute left-3 top-3 text-app-muted" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies or owners…" className="form-control min-h-10 w-full rounded-xl border pl-9 pr-3 text-sm" /></div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="form-control min-h-10 rounded-xl border px-3 text-sm"><option value="">All statuses</option><option value="active">Active</option><option value="pending_verification">Pending verification</option><option value="inactive">Inactive</option></select>
      <button className="btn btn-primary inline-flex items-center gap-2" onClick={() => setShowCreate((value) => !value)}><Plus size={15} />Create company</button>
    </div>
    {showCreate && <CompanyAccountForm plans={plans} onCreated={(result) => { showToast(`Company ${result.company_code} created`); setShowCreate(false); load(); }} />}
    <DataTable headings={["Company", "Code / Contact", "Plan", "Users / Branches", "Owner", "Status", "Actions"]}>{companies.map((company) => {
      const owner = users.find((member) => Number(member.id) === Number(company.owner_user_id));
      return <tr key={company.id} className="border-t border-app"><Cell><strong>{company.name}</strong><div className="text-xs text-app-muted">{company.business_type} · {company.country}</div></Cell><Cell><span className="rounded bg-app px-2 py-1 font-mono text-xs">{company.code}</span><div className="mt-1 text-xs text-app-muted">{company.email || "No email"}</div></Cell><Cell>{company.subscription_plan}</Cell><Cell>{company.user_count} / {company.branch_count}</Cell><Cell>{owner?.name || "—"}<div className="text-xs text-app-muted">{owner?.email}</div></Cell><Cell className="capitalize">{statusLabel(company.status)}</Cell><Cell><div className="flex gap-2"><button className="rounded-lg border border-app px-2.5 py-1.5 text-xs" onClick={() => { const name = prompt("Company name", company.name); if (name) act(api.owner.updateCompany(company.id, { name }), "Company updated"); }}>Edit</button><button className="rounded-lg border border-app px-2.5 py-1.5 text-xs" onClick={() => confirm(`${company.status === "active" ? "Deactivate" : "Activate"} ${company.name}?`) && act(api.owner.updateCompany(company.id, { status: company.status === "active" ? "inactive" : "active" }), "Company status updated")}>{company.status === "active" ? "Deactivate" : "Activate"}</button></div></Cell></tr>;
    })}</DataTable>
  </div>;
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

function PlatformUsers({ rows, companies, companyMap, filters, setters, act, showToast }) {
  const { impersonate } = useAuth();
  const resetPassword = (member) => {
    const password = prompt(`Enter a new password (at least 8 characters) for ${member.name}:`);
    if (password === null) return;
    const confirmation = prompt("Confirm the new password:");
    if (confirmation !== password) return showToast("Passwords do not match");
    act(api.auth_admin.resetPassword(member.id, password), "Password reset");
  };
  const canImpersonate = (member) => {
    const role = normalizeRole(member.role);
    if (role === "platform_owner") return false;
    // Prefer company owners; also allow any active tenant user with a real Auth id (UUID).
    const hasAuthId = typeof member.id === "string" && member.id.includes("-");
    return hasAuthId && (role === "owner" || role === "super_admin" || role === "admin");
  };
  const loginAsOwner = async (member) => {
    if (!confirm(`Log in as ${member.name}? You will enter their company workspace.`)) return;
    if (api.owner?.recordAudit) {
      await api.owner.recordAudit("impersonate_owner", { target_user_id: member.id, company_id: member.company_id });
    }
    const result = await impersonate(member.id);
    if (!result.success) return showToast(result.error || "Impersonation failed");
    showToast(`Now viewing as ${member.name}`);
    window.location.assign("/dashboard");
  };
  return <div className="space-y-4"><div className="card flex flex-wrap gap-3 p-4"><select value={filters.userCompany} onChange={(e) => setters.setUserCompany(e.target.value)} className="form-control min-h-10 rounded-xl border px-3 text-sm"><option value="">All companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><select value={filters.userRole} onChange={(e) => setters.setUserRole(e.target.value)} className="form-control min-h-10 rounded-xl border px-3 text-sm"><option value="">All roles</option><option value="owner">Company Owners</option><option value="super_admin">Super Admins</option><option value="admin">Admins</option><option value="cashier">Cashiers</option></select><select value={filters.userStatus} onChange={(e) => setters.setUserStatus(e.target.value)} className="form-control min-h-10 rounded-xl border px-3 text-sm"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div><DataTable headings={["Name", "Email", "Type / Role", "Company", "Status", "Last login", "Action"]}>{rows.map((member) => <tr key={member.id} className="border-t border-app"><Cell>{member.name}<div className="text-xs text-app-muted">@{member.username}</div></Cell><Cell>{member.email}</Cell><Cell>{normalizeRole(member.role) === "owner" ? <strong>Company Owner</strong> : statusLabel(member.role)}</Cell><Cell>{companyMap[member.company_id]?.name || "—"}</Cell><Cell>{member.active ? "Active" : "Inactive"}</Cell><Cell className="text-xs">{fmt(member.last_login_at)}</Cell><Cell><div className="flex flex-wrap gap-1.5">{canImpersonate(member) && <button type="button" data-testid="login-as-owner" className="rounded-lg border border-brand px-2 py-1 text-xs text-brand" onClick={() => loginAsOwner(member)}>{normalizeRole(member.role) === "owner" ? "Login as owner" : "Login as user"}</button>}<button type="button" className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => confirm(`${member.active ? "Deactivate" : "Activate"} this user?`) && act(api.auth_admin.setUserActive(member.id, !member.active), "User status updated")}>Toggle status</button><button type="button" className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => resetPassword(member)}>Reset password</button></div></Cell></tr>)}</DataTable></div>;
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

function Domains({ rows, companies, companyMap, act }) {
  return <div className="space-y-4"><div className="card flex flex-wrap gap-3 p-4"><select id="domain-company" className="form-control min-h-10 rounded-xl border px-3 text-sm">{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><input id="domain-value" placeholder="pos.example.com" className="form-control min-h-10 flex-1 rounded-xl border px-3 text-sm" /><button className="btn btn-primary inline-flex items-center gap-2" onClick={() => act(api.owner.addDomain(document.getElementById("domain-company").value, document.getElementById("domain-value").value), "Domain added as pending")}><Plus size={15} />Add domain</button></div><DataTable headings={["Company", "Domain", "Status", "Primary", "Verified", "Actions"]}>{rows.map((row) => <tr key={row.id} className="border-t border-app"><Cell>{companyMap[row.company_id]?.name}</Cell><Cell className="font-mono">{row.domain}</Cell><Cell className="capitalize">{row.status}</Cell><Cell>{row.is_primary ? "Yes" : "No"}</Cell><Cell className="text-xs">{fmt(row.verified_at)}</Cell><Cell><div className="flex gap-2">{row.status !== "verified" && <button className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => act(api.owner.verifyDomain(row.id), "Domain verified")}>Verify</button>}{row.status === "verified" && !row.is_primary && <button className="rounded-lg border border-app px-2 py-1 text-xs" onClick={() => act(api.owner.setPrimaryDomain(row.id), "Primary domain updated")}>Make primary</button>}<button className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600" onClick={() => confirm("Remove this domain?") && act(api.owner.removeDomain(row.id), "Domain removed")}>Remove</button></div></Cell></tr>)}</DataTable></div>;
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

function BranchManagement({ branches, companyMap }) {
  return (
    <DataTable headings={["Company", "Branch", "Code", "Active"]}>
      {branches.map((branch) => (
        <tr key={branch.id} className="border-t border-app">
          <Cell>{companyMap[branch.company_id]?.name || branch.company_id}</Cell>
          <Cell>{branch.name}</Cell>
          <Cell><span className="font-mono text-xs">{branch.code || "—"}</span></Cell>
          <Cell>{branch.active === false ? "No" : "Yes"}</Cell>
        </tr>
      ))}
    </DataTable>
  );
}

function PlatformRoles() {
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="font-semibold">Platform role hierarchy</h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          Platform Super Admin sits above all tenant roles and manages companies, subscriptions, billing, and global settings.
          Company roles (Owner, Super Admin, Admin, Cashier, etc.) are scoped per tenant — edit them from each company&apos;s Users → Roles screen.
        </p>
      </div>
      <div className="card p-5">
        <h3 className="font-semibold">System roles</h3>
        <ul className="mt-3 space-y-2">
          {SYSTEM_ROLES.map((role) => (
            <li key={role.id} className="rounded-xl border border-app px-3 py-2 text-sm">
              <strong>{role.label}</strong>
              <span className="text-app-muted"> — {role.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PlatformBackup({ act, showToast }) {
  const handleBackup = async () => {
    if (typeof api.backup?.export === "function") {
      const result = await api.backup.export();
      showToast(result.success ? "Backup exported" : (result.error || "Backup failed"));
      return;
    }
    if (typeof api.settings?.backup === "function") {
      const result = await api.settings.backup();
      showToast(result.success ? "Backup complete" : (result.error || "Backup failed"));
      return;
    }
    await act(api.owner.updatePlatformSettings({}), "Platform backup runs per browser session — export from tenant Settings when needed");
  };
  const handleRestore = async () => {
    if (typeof api.backup?.restore === "function") {
      const result = await api.backup.restore();
      showToast(result.success ? "Restore initiated" : (result.error || "Restore requires an import UI in the browser version."));
      return;
    }
    if (typeof api.settings?.restore === "function") {
      const result = await api.settings.restore();
      showToast(result.success ? "Restore complete" : (result.error || "Restore failed"));
      return;
    }
    showToast("Restore requires importing a backup file from tenant Settings.");
  };
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="font-semibold">Platform backup</h2>
        <p className="mt-2 text-sm text-app-muted">
          Export all tenant data stored in this browser session. For company-scoped backups, use Settings → Backup &amp; Restore while impersonating a tenant.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={handleBackup}>Export backup</button>
          <button type="button" className="rounded-lg border border-app px-3 py-2 text-sm" onClick={handleRestore}>Restore</button>
        </div>
      </div>
    </div>
  );
}

function GlobalSearch({ overview, companyMap, search, setSearch }) {
  const query = search.trim().toLowerCase();
  const companies = query
    ? overview.companies.filter((company) => [company.name, company.code, company.email].some((value) => String(value || "").toLowerCase().includes(query)))
    : overview.companies.slice(0, 15);
  const users = query
    ? overview.users.filter((member) => [member.name, member.username, member.email].some((value) => String(value || "").toLowerCase().includes(query)))
    : overview.users.slice(0, 15);
  return (
    <div className="space-y-4">
      <div className="card flex gap-3 p-4">
        <div className="relative min-w-64 flex-1">
          <Search size={15} className="absolute left-3 top-3 text-app-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies and users globally…"
            className="form-control min-h-10 w-full rounded-xl border pl-9 pr-3 text-sm"
          />
        </div>
      </div>
      <DataTable headings={["Company", "Code", "Status", "Plan", "Users"]}>
        {companies.map((company) => (
          <tr key={company.id} className="border-t border-app">
            <Cell><strong>{company.name}</strong></Cell>
            <Cell><span className="font-mono text-xs">{company.code}</span></Cell>
            <Cell className="capitalize">{statusLabel(company.status)}</Cell>
            <Cell>{company.subscription_plan}</Cell>
            <Cell>{company.user_count}</Cell>
          </tr>
        ))}
      </DataTable>
      <DataTable headings={["Name", "Email", "Role", "Company", "Status"]}>
        {users.map((member) => (
          <tr key={member.id} className="border-t border-app">
            <Cell>{member.name}<div className="text-xs text-app-muted">@{member.username}</div></Cell>
            <Cell>{member.email}</Cell>
            <Cell className="capitalize">{statusLabel(member.role)}</Cell>
            <Cell>{companyMap[member.company_id]?.name || "—"}</Cell>
            <Cell>{member.active ? "Active" : "Inactive"}</Cell>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function Cell({ children, className = "" }) {
  return <td className={`px-4 py-3 text-sm ${className}`}>{children}</td>;
}

function DataTable({ headings, children }) {
  const empty = !children || children.length === 0;
  return <div className="card overflow-x-auto"><table className="w-full min-w-[760px]"><thead><tr className="bg-app">{headings.map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs uppercase text-app-muted">{heading}</th>)}</tr></thead><tbody>{children}{empty && <tr><td colSpan={headings.length} className="p-10 text-center text-sm text-app-muted">No records yet.</td></tr>}</tbody></table></div>;
}
