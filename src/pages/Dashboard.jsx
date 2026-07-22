import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  Database,
  KeyRound,
  Server,
  Shield,
  UserCheck,
  UserX,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { api } from "../lib/api";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { getReportRange } from "../lib/reportDates";
import { useAuth } from "../context/AuthContext";
import { isOwner, isPlatformOwner, isSuperAdmin, normalizeRole, roleLabel, SYSTEM_ROLES } from "../lib/rbac";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CHART_TOOLTIP = {
  borderRadius: 8,
  borderColor: "var(--app-border)",
  fontSize: 12,
  boxShadow: "var(--shadow-card)",
  background: "var(--app-panel)",
  color: "var(--app-text)",
};

const fmtDate = (ts) =>
  new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function isOwnerDashboardRole(role) {
  return isOwner(role) || isPlatformOwner(role) || isSuperAdmin(role);
}

function MetricCard({ label, value }) {
  return (
    <div className="nx-dash-kpi">
      <div className="nx-dash-kpi-label">{label}</div>
      <div className="nx-dash-kpi-value">{value}</div>
    </div>
  );
}

function Panel({ title, meta, children, empty, emptyText = "No data yet." }) {
  return (
    <section className="nx-ledger-module">
      <div className="nx-ledger-module-head">
        <h2 className="nx-ledger-module-title">{title}</h2>
        {meta && <span className="nx-ledger-module-meta">{meta}</span>}
      </div>
      {empty ? <div className="nx-dash-empty">{emptyText}</div> : children}
    </section>
  );
}

function StatusPill({ ok, label, detail }) {
  return (
    <div className={cn("nx-status-pill", ok == null ? "is-unknown" : ok ? "is-ok" : "is-bad")}>
      <span className="nx-status-dot" aria-hidden />
      <div className="min-w-0">
        <div className="font-semibold">{label}</div>
        {detail && <div className="truncate text-[12px] text-app-muted">{detail}</div>}
      </div>
    </div>
  );
}

function OwnerStat({ icon: Icon, label, value, tone = "brand" }) {
  return (
    <div className={cn("nx-owner-stat", `tone-${tone}`)}>
      <Icon size={16} aria-hidden />
      <div>
        <div className="nx-owner-stat-value">{value}</div>
        <div className="nx-owner-stat-label">{label}</div>
      </div>
    </div>
  );
}

function HealthChip({ ok, label }) {
  const text = ok == null ? "Unknown" : ok ? "Healthy" : "Attention";
  const variant = ok == null ? "secondary" : ok ? "success" : "danger";
  return (
    <div className="nx-health-chip">
      <span>{label}</span>
      <Badge variant={variant}>{text}</Badge>
    </div>
  );
}

export default function Dashboard() {
  const { formatMoney: money } = useEnterpriseSettings();
  const { user } = useAuth();
  const navigate = useNavigate();
  const ownerView = isOwnerDashboardRole(user?.role);

  const [summary, setSummary] = useState({ today: 0, todayCount: 0 });
  const [customerCount, setCustomerCount] = useState(0);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [trend, setTrend] = useState([]);
  const [recent, setRecent] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [todayProfit, setTodayProfit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [team, setTeam] = useState([]);
  const [cashiers, setCashiers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loginHistory, setLoginHistory] = useState([]);
  const [health, setHealth] = useState(null);
  const [license, setLicense] = useState(null);
  const [rolesMatrix, setRolesMatrix] = useState(null);
  const [companyPerf, setCompanyPerf] = useState({ monthSales: 0, monthProfit: 0, monthExpenses: 0, margin: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ownerFetches = ownerView
          ? [
              api.users.getDashboard().catch(() => null),
              api.branches?.getAll?.().catch(() => []) ?? Promise.resolve([]),
              api.audit.getLoginHistory().catch(() => []),
              api.health?.probe?.().catch(() => null) ?? Promise.resolve(null),
              api.subscription.get().catch(() => null),
              api.permissions?.getMatrix?.().catch(() => null) ?? Promise.resolve(null),
            ]
          : [
              Promise.resolve(null),
              Promise.resolve([]),
              Promise.resolve([]),
              Promise.resolve(null),
              Promise.resolve(null),
              Promise.resolve(null),
            ];

        const [
          lowStockRows,
          customerCountResult,
          recentRows,
          weekReport,
          teamResult,
          branchRows,
          loginRows,
          healthProbe,
          subscription,
          matrix,
        ] = await Promise.all([
          api.inventory.getLowStock({ limit: 12 }).catch(() => []),
          api.customers.getCount?.().catch(() => ({ count: 0 })) ?? Promise.resolve({ count: 0 }),
          api.sales.getRecent(8).catch(() => []),
          api.reports.getAnalytics(getReportRange("this_week")).catch(() => null),
          ...ownerFetches,
        ]);

        if (cancelled) return;

        const report = weekReport || { cards: { today: {}, month: {} }, charts: { daily: [] }, topProducts: [] };

        setLowStockItems(Array.isArray(lowStockRows) ? lowStockRows : []);
        setCustomerCount(Number(customerCountResult?.count) || 0);
        setRecent(Array.isArray(recentRows) ? recentRows : []);
        setSummary({
          today: report.cards?.today?.revenue || 0,
          todayCount: report.cards?.today?.transactions || 0,
        });
        setTodayProfit(report.cards?.today?.netProfit || 0);
        setTrend((report.charts?.daily || []).map((row) => ({
          day: row.date?.slice(5),
          sales: row.sales,
        })));
        setTopProducts((report.topProducts || []).slice(0, 8));
        setCompanyPerf({
          monthSales: report.cards?.month?.revenue || 0,
          monthProfit: report.cards?.month?.netProfit || 0,
          monthExpenses: report.cards?.month?.expenses || 0,
          margin: report.cards?.month?.profitMargin,
        });
        setTeam(teamResult?.success ? teamResult.users : []);
        setCashiers(teamResult?.success ? teamResult.cashiers : []);
        setBranches(Array.isArray(branchRows) ? branchRows : []);
        setLoginHistory(Array.isArray(loginRows) ? loginRows.slice(0, 8) : []);
        setHealth(healthProbe);
        setLicense(subscription);
        setRolesMatrix(matrix);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.role, ownerView]);

  const onlineCount = team.filter((m) => m.online).length;
  const offlineCount = Math.max(0, team.length - onlineCount);
  const activeCount = team.filter((m) => m.active !== 0 && m.active !== false).length;
  const inactiveCount = Math.max(0, team.length - activeCount);
  const activeBranches = branches.filter((b) => b.active !== false && b.active !== 0).length;

  const roleBreakdown = useMemo(() => {
    const counts = {};
    for (const member of team) {
      const role = normalizeRole(member.role);
      counts[role] = (counts[role] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([role, count]) => ({ role, label: roleLabel(role), count }))
      .sort((a, b) => b.count - a.count);
  }, [team]);

  const configuredRoles = useMemo(() => {
    if (rolesMatrix && typeof rolesMatrix === "object") {
      const keys = Object.keys(rolesMatrix.permission_matrix || rolesMatrix).filter((key) => !["success", "error", "code"].includes(key));
      if (keys.length) return keys.length;
    }
    return SYSTEM_ROLES.filter((r) => r.id !== "platform_owner").length;
  }, [rolesMatrix]);

  const healthSummary = useMemo(() => {
    const checks = health?.checks;
    if (!checks || typeof checks !== "object") {
      return { ok: null, detail: health?.success === false ? "Probe unavailable" : "Not checked", failed: [] };
    }
    const entries = Object.entries(checks);
    const failed = entries.filter(([, value]) => value && value.ok === false);
    const passed = entries.filter(([, value]) => value && value.ok === true).length;
    return {
      ok: failed.length === 0,
      detail: failed.length ? `${failed.length} issue(s)` : `${passed}/${entries.length} tables OK`,
      failed: failed.slice(0, 4).map(([name]) => name),
    };
  }, [health]);

  const dbStatus = useMemo(() => {
    if (!health?.checks) return { ok: null, detail: "Awaiting probe" };
    const critical = ["products", "sales", "customers", "companies", "company_settings"];
    const bad = critical.filter((table) => health.checks[table] && health.checks[table].ok === false);
    if (bad.length) return { ok: false, detail: `Missing: ${bad.join(", ")}` };
    const known = critical.filter((table) => health.checks[table]);
    if (!known.length) return { ok: null, detail: "No critical table checks" };
    return { ok: true, detail: `${known.length} critical tables OK` };
  }, [health]);

  const licenseStatus = useMemo(() => {
    if (!license) return { ok: null, detail: "No subscription data" };
    const status = String(license.status || license.subscription_status || "").toLowerCase();
    const plan = license.plan || license.plan_code || license.plan_name || "—";
    if (!status && !license.plan_code && !license.plan) return { ok: null, detail: "Status unknown" };
    const ok = !status || ["active", "trialing", "trial"].includes(status);
    return { ok, detail: `${plan} · ${status || "unknown"}` };
  }, [license]);

  const maxTopRevenue = useMemo(
    () => Math.max(1, ...topProducts.map((item) => Number(item.revenue || 0))),
    [topProducts]
  );

  const businessInsights = useMemo(() => {
    const insights = [];
    const weekSales = trend.reduce((sum, row) => sum + Number(row.sales || 0), 0);
    const half = Math.max(1, Math.floor(trend.length / 2));
    const first = trend.slice(0, half).reduce((sum, row) => sum + Number(row.sales || 0), 0);
    const second = trend.slice(half).reduce((sum, row) => sum + Number(row.sales || 0), 0);
    if (first > 0) {
      const pct = ((second - first) / first) * 100;
      insights.push({
        id: "sales-trend",
        tone: pct >= 0 ? "success" : "warning",
        title: pct >= 0 ? "Sales trending up" : "Sales softening",
        body: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs earlier this week (${money(weekSales)} total).`,
      });
    } else if (weekSales > 0) {
      insights.push({
        id: "sales-start",
        tone: "brand",
        title: "Sales activity started",
        body: `${money(weekSales)} recorded this week across ${summary.todayCount || recent.length} recent orders.`,
      });
    }
    if (topProducts[0]) {
      insights.push({
        id: "top-product",
        tone: "brand",
        title: "Top product",
        body: `${topProducts[0].name || topProducts[0].product_name} leads with ${money(topProducts[0].revenue)}.`,
      });
    }
    if (lowStockItems.length) {
      const worst = [...lowStockItems].sort((a, b) => Number(a.stock) - Number(b.stock))[0];
      insights.push({
        id: "restock",
        tone: "warning",
        title: "Restock recommended",
        body: `${lowStockItems.length} SKU(s) at/below reorder. Priority: ${worst?.name} (${worst?.stock} on hand).`,
      });
    }
    if (license && !licenseStatus.ok) {
      insights.push({
        id: "sub-warn",
        tone: "danger",
        title: "Subscription attention",
        body: licenseStatus.detail || "Review plan status and renewal.",
      });
    }
    if (!insights.length) {
      insights.push({
        id: "steady",
        tone: "muted",
        title: "Operations steady",
        body: "No urgent signals yet. Keep recording sales and stock movements for richer insights.",
      });
    }
    return insights.slice(0, 5);
  }, [trend, topProducts, lowStockItems, license, licenseStatus, money, summary.todayCount, recent.length]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="animate-fadein nx-ledger">
      {/* Top: 4 KPIs */}
      <div className="nx-dash-kpi-row" role="region" aria-label="Today performance">
        <MetricCard label="Today Sales" value={money(summary.today)} />
        <MetricCard label="Orders" value={summary.todayCount} />
        <MetricCard label="Profit" value={money(todayProfit)} />
        <MetricCard label="Customers" value={customerCount} />
      </div>

      {/* Middle: Sales Trend | Top Selling Products */}
      <div className="nx-dash-mid-row">
        <Panel title="Sales Trend" meta="This week" empty={!trend.length} emptyText="No sales yet this week.">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="nxSalesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--app-border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--app-muted)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--app-muted)" width={48} />
              <Tooltip contentStyle={CHART_TOOLTIP} />
              <Area type="monotone" dataKey="sales" stroke="var(--brand)" fill="url(#nxSalesFill)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="AI Business Insights" meta="Rule-based" empty={!businessInsights.length}>
          <ul className="nx-insights-list">
            {businessInsights.map((insight) => (
              <li key={insight.id} className={cn("nx-insight-item", `tone-${insight.tone}`)}>
                <div className="text-sm font-semibold text-app-text">{insight.title}</div>
                <div className="mt-1 text-sm text-app-muted">{insight.body}</div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="nx-dash-bot-row">
        <Panel title="Top Selling Products" meta="By revenue" empty={!topProducts.length} emptyText="No product sales data yet.">
          <div className="nx-top-products">
            {topProducts.map((item, index) => {
              const revenue = Number(item.revenue || 0);
              const width = Math.max(8, (revenue / maxTopRevenue) * 100);
              return (
                <div key={item.id || item.name || index} className="nx-top-sell-row">
                  <div className="nx-top-sell-meta">
                    <span className="nx-top-sell-name truncate">{item.name}</span>
                    <span className="nx-top-sell-rev font-mono">{money(revenue)}</span>
                  </div>
                  <div className="nx-top-sell-track" aria-hidden>
                    <div className="nx-top-sell-fill" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Recent Transactions" meta={`${recent.length} latest`} empty={!recent.length} emptyText="No transactions yet.">
          <ul className="nx-tx-list">
            {recent.map((sale) => (
              <li key={sale.id}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">Invoice {sale.invoice_no || sale.receipt_no || sale.id}</div>
                  <div className="truncate text-xs text-app-muted">
                    {sale.customer || "Walk-in"} · {fmtDate(sale.created_at)}
                  </div>
                </div>
                <div className="shrink-0 font-mono text-sm font-semibold">{money(sale.total)}</div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Bottom: Low Stock */}
      <div className="nx-dash-bot-row">
        <Panel
          title="Low Stock"
          meta={`${lowStockItems.length} item${lowStockItems.length === 1 ? "" : "s"}`}
          empty={lowStockItems.length === 0}
          emptyText="All products are well stocked."
        >
          <ul className="nx-stock-list">
            {lowStockItems.slice(0, 8).map((product) => {
              const stock = Number(product.stock) || 0;
              const out = stock <= 0;
              return (
                <li key={product.id}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{product.name}</div>
                    <div className="text-xs text-app-muted">
                      {stock} on hand · min {Number(product.reorder_level) || 0}
                    </div>
                  </div>
                  <Badge variant={out ? "danger" : "warning"}>{out ? "Out" : "Low"}</Badge>
                </li>
              );
            })}
          </ul>
          {lowStockItems.length > 0 && (
            <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => navigate("/inventory")}>
              <AlertTriangle size={14} aria-hidden /> Open inventory
            </Button>
          )}
        </Panel>
      </div>

      {ownerView && (
        <section className="nx-owner-ledger" aria-label="Owner control center">
          <button
            type="button"
            className="nx-owner-toggle"
            aria-expanded={ownerOpen}
            onClick={() => setOwnerOpen((open) => !open)}
          >
            <div>
              <h2 className="card-title">Owner controls</h2>
              <p className="text-sm text-app-muted">System health, licensing, and team presence</p>
            </div>
            <ChevronDown size={18} className={cn("transition-transform", ownerOpen && "rotate-180")} aria-hidden />
          </button>

          {ownerOpen && (
            <>
              <div className="nx-owner-health-band">
                <HealthChip ok={dbStatus.ok} label="Database" />
                <HealthChip ok={healthSummary.ok} label="System" />
                <HealthChip ok={licenseStatus.ok} label="License" />
                <HealthChip ok={healthSummary.ok !== false} label="Backup" />
              </div>

              <div className="nx-owner-grid">
                <OwnerStat icon={Users} label="Total Users" value={team.length} />
                <OwnerStat icon={Wifi} label="Online" value={onlineCount} tone="success" />
                <OwnerStat icon={WifiOff} label="Offline" value={offlineCount} tone="muted" />
                <OwnerStat icon={UserCheck} label="Active" value={activeCount} tone="success" />
                <OwnerStat icon={UserX} label="Inactive" value={inactiveCount} tone="warning" />
                <OwnerStat icon={Shield} label="Roles" value={configuredRoles} tone="accent" />
              </div>

              <div className="nx-owner-cards">
                <div className="nx-ledger-module">
                  <div className="nx-ledger-module-head">
                    <h3 className="nx-ledger-module-title">Branches</h3>
                    <span className="nx-ledger-module-meta">{activeBranches || branches.length} active</span>
                  </div>
                  {branches.length === 0 ? (
                    <div className="nx-dash-empty min-h-[80px]">No branches returned.</div>
                  ) : (
                    <div className="space-y-2">
                      {branches.slice(0, 6).map((branch) => (
                        <div key={branch.id} className="flex items-center justify-between rounded-[8px] border border-app px-3 py-2 text-sm">
                          <span className="inline-flex items-center gap-2 font-medium">
                            <Building2 size={14} className="text-app-muted" aria-hidden />
                            {branch.name}
                          </span>
                          <Badge variant={branch.active === false || branch.active === 0 ? "danger" : "success"}>
                            {branch.active === false || branch.active === 0 ? "Inactive" : "Active"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="nx-ledger-module">
                  <div className="nx-ledger-module-head">
                    <h3 className="nx-ledger-module-title">Company performance</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-app-muted">Month sales</div>
                      <div className="mt-1 font-mono text-lg font-bold">{money(companyPerf.monthSales)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-app-muted">Month profit</div>
                      <div className="mt-1 font-mono text-lg font-bold text-success">{money(companyPerf.monthProfit)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-app-muted">Expenses</div>
                      <div className="mt-1 font-mono text-lg font-bold">{money(companyPerf.monthExpenses)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-app-muted">Margin</div>
                      <div className="mt-1 font-mono text-lg font-bold">
                        {Number.isFinite(companyPerf.margin) ? `${Number(companyPerf.margin).toFixed(1)}%` : "—"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="nx-ledger-module">
                  <div className="nx-ledger-module-head">
                    <h3 className="nx-ledger-module-title">System &amp; license</h3>
                  </div>
                  <div className="space-y-2">
                    <StatusPill
                      ok={healthSummary.ok}
                      label={healthSummary.ok == null ? "Unknown" : healthSummary.ok ? "Healthy" : "Degraded"}
                      detail={healthSummary.detail}
                    />
                    <StatusPill
                      ok={dbStatus.ok}
                      label={dbStatus.ok == null ? "Database" : dbStatus.ok ? "Connected" : "Issues"}
                      detail={dbStatus.detail}
                    />
                    <StatusPill
                      ok={licenseStatus.ok}
                      label={licenseStatus.ok == null ? "License" : licenseStatus.ok ? "Licensed" : "Attention"}
                      detail={licenseStatus.detail}
                    />
                  </div>
                  <div className="mt-3 inline-flex items-center gap-2 text-xs text-app-muted">
                    <Database size={14} aria-hidden />
                    <KeyRound size={14} aria-hidden />
                    Health probe · subscription
                  </div>
                </div>
              </div>

              {roleBreakdown.length > 0 && (
                <div className="nx-ledger-module">
                  <div className="nx-ledger-module-head">
                    <h3 className="nx-ledger-module-title">Role mix</h3>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {roleBreakdown.slice(0, 6).map((row) => (
                      <div key={row.role} className="rounded-[8px] border border-app px-3 py-2 text-sm">
                        <span className="text-app-muted">{row.label}</span>
                        <span className="ml-2 font-mono font-semibold">{row.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(team.length > 0 || cashiers.length > 0) && (
                <div className="table-container mt-1">
                  <div className="border-b border-app px-4 py-3">
                    <h3 className="card-title">User activity &amp; cashier performance — today</h3>
                    <p className="mt-1 text-sm text-app-muted">
                      {cashiers.length
                        ? `Top cashier: ${cashiers[0].name} · Lowest cashier: ${cashiers[cashiers.length - 1].name}`
                        : "No cashier accounts available."}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px]">
                      <thead>
                        <tr>
                          {["Rank", "User", "Presence", "Sales", "Transactions", "Profit"].map((heading) => (
                            <th key={heading} className="text-left">{heading}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {team.map((member, index) => (
                          <tr key={member.id}>
                            <td className="font-mono text-sm">#{index + 1}</td>
                            <td>
                              <div className="text-sm font-medium">{member.name}</div>
                              <div className="text-xs text-app-muted">@{member.username}</div>
                            </td>
                            <td className={`text-xs font-semibold ${member.online ? "text-success" : "text-danger"}`}>
                              {member.online ? "● Online" : "● Offline"}
                            </td>
                            <td className="font-mono text-sm">{money(member.revenue)}</td>
                            <td className="font-mono text-sm">{member.transactions}</td>
                            <td className="font-mono text-sm text-success">{money(member.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="nx-ledger-module mt-1">
                <div className="nx-ledger-module-head">
                  <h3 className="nx-ledger-module-title">Login history</h3>
                </div>
                {loginHistory.length === 0 ? (
                  <div className="nx-dash-empty min-h-[80px]">No login events in audit log.</div>
                ) : (
                  <ul className="nx-activity-list">
                    {loginHistory.map((row) => (
                      <li key={row.id || `${row.created_at}-${row.action}`}>
                        <Server size={14} className="text-app-muted" aria-hidden />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{row.action || "login"}</div>
                          <div className="truncate text-xs text-app-muted">{row.user_name || row.details || row.module || "auth"}</div>
                        </div>
                        <time className="shrink-0 text-[11px] text-app-muted">{row.created_at ? fmtDate(row.created_at) : "—"}</time>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
