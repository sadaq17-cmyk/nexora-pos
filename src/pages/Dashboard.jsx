import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  Database,
  KeyRound,
  Package,
  PackageX,
  Server,
  Shield,
  ShoppingCart,
  Truck,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api } from "../lib/api";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { getReportRange } from "../lib/reportDates";
import { useAuth } from "../context/AuthContext";
import { useRealtimeRefresh } from "../hooks/useRealtimeRefresh";
import { isOwner, isPlatformOwner, isSuperAdmin, normalizeRole, roleLabel, SYSTEM_ROLES } from "../lib/rbac";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const SalesTrendChart = lazy(() =>
  import("../components/DashboardCharts").then((m) => ({ default: m.SalesTrendChart }))
);
const PurchasesTrendChart = lazy(() =>
  import("../components/DashboardCharts").then((m) => ({ default: m.PurchasesTrendChart }))
);

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

/** Always settles — never leave dashboard loaders Pending forever. */
function settle(promise, fallback, ms = 12_000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), Math.max(500, ms));
    Promise.resolve(promise).then(
      (value) => finish(value),
      () => finish(fallback)
    );
  });
}

function emptyWeekReport() {
  return { cards: { today: {}, month: {} }, charts: { daily: [] }, topProducts: [] };
}

const QUICK_ACTIONS = [
  { to: "/pos", label: "New Sale", icon: ShoppingCart, module: "pos", action: "create" },
  { to: "/products", label: "Add Product", icon: Package, module: "products", action: "create" },
  { to: "/customers", label: "Add Customer", icon: UserPlus, module: "customers", action: "create" },
  { to: "/inventory", label: "Stock Count", icon: Boxes, module: "inventory", action: "view" },
  { to: "/reports", label: "View Reports", icon: BarChart3, module: "reports", action: "view" },
];

export default function Dashboard() {
  const { formatMoney: money } = useEnterpriseSettings();
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const ownerView = isOwnerDashboardRole(user?.role);

  const quickActions = useMemo(
    () => QUICK_ACTIONS.filter((item) => (typeof can === "function" ? can(item.module, item.action) : true)),
    [can]
  );

  const [summary, setSummary] = useState({ today: 0, todayCount: 0 });
  const [customerCount, setCustomerCount] = useState(0);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [trend, setTrend] = useState([]);
  const [recent, setRecent] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [todayProfit, setTodayProfit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [team, setTeam] = useState([]);
  const [cashiers, setCashiers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loginHistory, setLoginHistory] = useState([]);
  const [health, setHealth] = useState(null);
  const [license, setLicense] = useState(null);
  const [rolesMatrix, setRolesMatrix] = useState(null);
  const [companyPerf, setCompanyPerf] = useState({ monthSales: 0, monthProfit: 0, monthExpenses: 0, margin: null });
  const [payrollDash, setPayrollDash] = useState(null);
  const [extended, setExtended] = useState({
    purchasesToday: 0,
    inventoryValue: 0,
    totalProducts: 0,
    outOfStock: 0,
    totalSuppliers: 0,
    outstandingReceivables: 0,
    outstandingPayables: 0,
    topCustomers: [],
    topSuppliers: [],
    monthlyPurchases: [],
  });
  const [refreshTick, setRefreshTick] = useState(0);

  // Enterprise ERP requirement: dashboard updates instantly after any
  // transaction anywhere in the company — no manual refresh.
  useRealtimeRefresh(
    ["sales", "purchases", "products", "inventory", "suppliers", "customers", "expenses", "branches"],
    () => setRefreshTick((n) => n + 1),
    { debounceMs: 900 }
  );

  useEffect(() => {
    let cancelled = false;

    const applyCritical = (lowStockRows, customerCountResult, recentRows, weekReport) => {
      const report = weekReport && typeof weekReport === "object" && weekReport.success !== false
        ? weekReport
        : emptyWeekReport();
      setLowStockItems(Array.isArray(lowStockRows) ? lowStockRows : []);
      setCustomerCount(Number(customerCountResult?.count) || 0);
      setRecent(Array.isArray(recentRows) ? recentRows : []);
      setSummary({
        today: Number(report.cards?.today?.revenue) || 0,
        todayCount: Number(report.cards?.today?.transactions) || 0,
      });
      setTodayProfit(Number(report.cards?.today?.netProfit) || 0);
      const dailyRows = Array.isArray(report.charts?.daily) ? report.charts.daily : [];
      setTrend(
        dailyRows.map((row) => ({
          day: String(row?.date || "").slice(5),
          sales: Number(row?.sales) || 0,
        }))
      );
      setTopProducts(Array.isArray(report.topProducts) ? report.topProducts.slice(0, 8) : []);
      setCompanyPerf({
        monthSales: Number(report.cards?.month?.revenue) || 0,
        monthProfit: Number(report.cards?.month?.netProfit) || 0,
        monthExpenses: Number(report.cards?.month?.expenses) || 0,
        margin: report.cards?.month?.profitMargin ?? null,
      });
    };

    const applyExtended = (stats) => {
      const s = stats && typeof stats === "object" && stats.success !== false ? stats : null;
      setExtended({
        purchasesToday: Number(s?.purchases_today) || 0,
        inventoryValue: Number(s?.inventory_value) || 0,
        totalProducts: Number(s?.total_products) || 0,
        outOfStock: Number(s?.out_of_stock) || 0,
        totalSuppliers: Number(s?.total_suppliers) || 0,
        outstandingReceivables: Number(s?.outstanding_receivables) || 0,
        outstandingPayables: Number(s?.outstanding_payables) || 0,
        topCustomers: Array.isArray(s?.top_customers) ? s.top_customers : [],
        topSuppliers: Array.isArray(s?.top_suppliers) ? s.top_suppliers : [],
        monthlyPurchases: Array.isArray(s?.monthly_purchases) ? s.monthly_purchases : [],
      });
    };

    (async () => {
      setLoading(refreshTick === 0);
      try {
        // Phase 1 — paint KPI shell ASAP (no extended catalog scans).
        const [lowStockRows, customerCountResult, recentRows, weekReport] = await Promise.all([
          settle(api.inventory.getLowStock({ limit: 12 }), [], 10_000),
          settle(api.customers.getCount?.() ?? Promise.resolve({ count: 0 }), { count: 0 }, 8_000),
          settle(api.sales.getRecent(8), [], 10_000),
          settle(api.reports.getAnalytics(getReportRange("this_week")), null, 12_000),
        ]);
        if (cancelled) return;
        applyCritical(lowStockRows, customerCountResult, recentRows, weekReport);
      } catch (err) {
        if (import.meta.env.DEV) console.error("[Dashboard] critical load failed", err);
        if (!cancelled) applyCritical([], { count: 0 }, [], null);
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (cancelled) return;

      // Phase 2 — extended stats after first paint (skip on realtime ticks to cut noise).
      if (refreshTick === 0) {
        try {
          const extendedStats = await settle(
            api.dashboard?.getExtendedStats?.() ?? Promise.resolve(null),
            null,
            12_000
          );
          if (!cancelled) applyExtended(extendedStats);
        } catch {
          /* non-blocking */
        }
      }

      if (cancelled || !ownerView || refreshTick > 0) return;

      // Owner diagnostics load in the background — never block the KPI shell.
      // Skipped on real-time refresh ticks; only the KPI shell above needs
      // to stay instantly in sync with every transaction.
      setOwnerLoading(true);
      try {
        const [
          teamResult,
          branchRows,
          loginRows,
          healthProbe,
          subscription,
          matrix,
          payrollOverview,
        ] = await Promise.all([
          settle(api.users.getDashboard(), null, 15_000),
          settle(api.branches?.getAll?.() ?? Promise.resolve([]), [], 12_000),
          settle(api.audit.getLoginHistory(), [], 12_000),
          settle(api.health?.probe?.() ?? Promise.resolve(null), null, 18_000),
          settle(api.subscription.get(), null, 12_000),
          settle(api.permissions?.getMatrix?.() ?? Promise.resolve(null), null, 12_000),
          settle(api.payroll?.getDashboard?.() ?? Promise.resolve(null), null, 12_000),
        ]);
        if (cancelled) return;
        const teamUsers = teamResult?.success && Array.isArray(teamResult.users) ? teamResult.users : [];
        const teamCashiers = teamResult?.success && Array.isArray(teamResult.cashiers) ? teamResult.cashiers : [];
        setTeam(teamUsers);
        setCashiers(teamCashiers);
        setBranches(Array.isArray(branchRows) ? branchRows : []);
        setLoginHistory(Array.isArray(loginRows) ? loginRows.slice(0, 8) : []);
        setHealth(healthProbe && typeof healthProbe === "object" ? healthProbe : null);
        setLicense(subscription && typeof subscription === "object" ? subscription : null);
        setRolesMatrix(matrix && typeof matrix === "object" ? matrix : null);
        setPayrollDash(
          payrollOverview && typeof payrollOverview === "object" && payrollOverview.success !== false
            ? payrollOverview
            : null
        );
      } catch (err) {
        if (import.meta.env.DEV) console.error("[Dashboard] owner panel load failed", err);
      } finally {
        if (!cancelled) setOwnerLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.role, ownerView, refreshTick]);

  const safeTeam = Array.isArray(team) ? team : [];
  const safeCashiers = Array.isArray(cashiers) ? cashiers : [];
  const safeBranches = Array.isArray(branches) ? branches : [];
  const onlineCount = safeTeam.filter((m) => m?.online).length;
  const offlineCount = Math.max(0, safeTeam.length - onlineCount);
  const activeCount = safeTeam.filter((m) => m?.active !== 0 && m?.active !== false).length;
  const inactiveCount = Math.max(0, safeTeam.length - activeCount);
  const activeBranches = safeBranches.filter((b) => b?.active !== false && b?.active !== 0).length;

  const roleBreakdown = useMemo(() => {
    const counts = {};
    for (const member of safeTeam) {
      const role = normalizeRole(member?.role);
      counts[role] = (counts[role] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([role, count]) => ({ role, label: roleLabel(role), count }))
      .sort((a, b) => b.count - a.count);
  }, [safeTeam]);

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

  const monthlyPurchasesChart = useMemo(
    () =>
      extended.monthlyPurchases.map((row) => ({
        month: row.month
          ? new Date(`${row.month}-01T00:00:00`).toLocaleString(undefined, { month: "short", year: "2-digit" })
          : "",
        total: Number(row.total) || 0,
      })),
    [extended.monthlyPurchases]
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

      {/* Enterprise ERP KPIs — connected live across Purchases, Inventory, Suppliers, Customers */}
      <div className="nx-dash-kpi-row-wide" role="region" aria-label="Enterprise ERP performance">
        <MetricCard label="Today Purchases" value={money(extended.purchasesToday)} />
        <MetricCard label="Inventory Value" value={money(extended.inventoryValue)} />
        <MetricCard label="Total Products" value={extended.totalProducts} />
        <MetricCard label="Out of Stock" value={extended.outOfStock} />
        <MetricCard label="Suppliers" value={extended.totalSuppliers} />
        <MetricCard label="Receivables" value={money(extended.outstandingReceivables)} />
        <MetricCard label="Payables" value={money(extended.outstandingPayables)} />
      </div>

      {/* Quick actions */}
      {quickActions.length > 0 && (
        <Panel title="Quick Actions" meta="Shortcuts">
          <div className="nx-quick-actions">
            {quickActions.map((action) => (
              <Button
                key={action.to}
                type="button"
                variant="outline"
                className="nx-quick-action-btn"
                onClick={() => navigate(action.to)}
              >
                <action.icon size={16} aria-hidden />
                {action.label}
              </Button>
            ))}
          </div>
        </Panel>
      )}

      {/* Middle: Sales Trend | Top Selling Products */}
      <div className="nx-dash-mid-row">
        <Panel title="Sales Trend" meta="This week" empty={!trend.length} emptyText="No sales yet this week.">
          <Suspense fallback={<div className="h-[260px] animate-pulse rounded-md bg-app-border/40" aria-hidden />}>
            <SalesTrendChart data={trend} />
          </Suspense>
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

      <div className="nx-dash-mid-row">
        <Panel
          title="Monthly Purchases"
          meta="Last 6 months"
          empty={!monthlyPurchasesChart.length}
          emptyText="No purchases recorded yet."
        >
          <Suspense fallback={<div className="h-[220px] animate-pulse rounded-md bg-app-border/40" aria-hidden />}>
            <PurchasesTrendChart data={monthlyPurchasesChart} />
          </Suspense>
        </Panel>

        <Panel title="Outstanding Balances" meta="Receivables vs Payables" empty={false}>
          <div className="nx-owner-grid">
            <OwnerStat icon={Wallet} label="Receivables" value={money(extended.outstandingReceivables)} tone="success" />
            <OwnerStat icon={Truck} label="Payables" value={money(extended.outstandingPayables)} tone="warning" />
            <OwnerStat icon={PackageX} label="Out of Stock" value={extended.outOfStock} tone="danger" />
            <OwnerStat icon={Package} label="Total Products" value={extended.totalProducts} tone="accent" />
          </div>
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

      {/* Top Customers | Top Suppliers — connected live via Sales & Purchases */}
      <div className="nx-dash-bot-row">
        <Panel
          title="Top Customers"
          meta="By total spend"
          empty={!extended.topCustomers.length}
          emptyText="No customer purchases recorded yet."
        >
          <div className="nx-top-products">
            {extended.topCustomers.map((c, index) => {
              const max = Math.max(1, ...extended.topCustomers.map((x) => Number(x.revenue || 0)));
              const width = Math.max(8, (Number(c.revenue || 0) / max) * 100);
              return (
                <div key={c.id || index} className="nx-top-sell-row">
                  <div className="nx-top-sell-meta">
                    <span className="nx-top-sell-name truncate">{c.name}</span>
                    <span className="nx-top-sell-rev font-mono">{money(c.revenue)}</span>
                  </div>
                  <div className="nx-top-sell-track" aria-hidden>
                    <div className="nx-top-sell-fill" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Top Suppliers"
          meta="By purchase volume"
          empty={!extended.topSuppliers.length}
          emptyText="No purchases recorded yet."
        >
          <div className="nx-top-products">
            {extended.topSuppliers.map((s, index) => {
              const max = Math.max(1, ...extended.topSuppliers.map((x) => Number(x.total || 0)));
              const width = Math.max(8, (Number(s.total || 0) / max) * 100);
              return (
                <div key={s.id || index} className="nx-top-sell-row">
                  <div className="nx-top-sell-meta">
                    <span className="nx-top-sell-name truncate">{s.name}</span>
                    <span className="nx-top-sell-rev font-mono">{money(s.total)}</span>
                  </div>
                  <div className="nx-top-sell-track" aria-hidden>
                    <div className="nx-top-sell-fill" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
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
              {ownerLoading && (
                <div className="nx-dash-empty min-h-[48px] mb-3 text-sm text-app-muted">
                  Loading owner diagnostics…
                </div>
              )}
              <div className="nx-owner-health-band">
                <HealthChip ok={ownerLoading ? null : dbStatus.ok} label="Database" />
                <HealthChip ok={ownerLoading ? null : healthSummary.ok} label="System" />
                <HealthChip ok={ownerLoading ? null : licenseStatus.ok} label="License" />
                <HealthChip ok={ownerLoading ? null : healthSummary.ok !== false} label="Backup" />
              </div>

              <div className="nx-owner-grid">
                <OwnerStat icon={Users} label="Total Users" value={ownerLoading ? "—" : safeTeam.length} />
                <OwnerStat icon={Wifi} label="Online" value={ownerLoading ? "—" : onlineCount} tone="success" />
                <OwnerStat icon={WifiOff} label="Offline" value={ownerLoading ? "—" : offlineCount} tone="muted" />
                <OwnerStat icon={UserCheck} label="Active" value={ownerLoading ? "—" : activeCount} tone="success" />
                <OwnerStat icon={UserX} label="Inactive" value={ownerLoading ? "—" : inactiveCount} tone="warning" />
                <OwnerStat icon={Shield} label="Roles" value={ownerLoading ? "—" : configuredRoles} tone="accent" />
              </div>

              <div className="nx-owner-cards">
                <div className="nx-ledger-module">
                  <div className="nx-ledger-module-head">
                    <h3 className="nx-ledger-module-title">Branches</h3>
                    <span className="nx-ledger-module-meta">{activeBranches || safeBranches.length} active</span>
                  </div>
                  {safeBranches.length === 0 ? (
                    <div className="nx-dash-empty min-h-[80px]">No branches returned.</div>
                  ) : (
                    <div className="space-y-2">
                      {safeBranches.slice(0, 6).map((branch) => (
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
                    <h3 className="nx-ledger-module-title">Payroll &amp; HR</h3>
                    <Button type="button" variant="outline" size="sm" onClick={() => navigate("/payroll")}>
                      Open
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-app-muted">Active staff</div>
                      <div className="mt-1 font-mono text-lg font-bold">{payrollDash?.active_employees ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-app-muted">Pending leave</div>
                      <div className="mt-1 font-mono text-lg font-bold">{payrollDash?.pending_leave ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-app-muted">Latest net payroll</div>
                      <div className="mt-1 font-mono text-lg font-bold">{money(payrollDash?.latest_run?.net_total || 0)}</div>
                    </div>
                    <div>
                      <div className="text-app-muted">OT cost (latest)</div>
                      <div className="mt-1 font-mono text-lg font-bold">{money(payrollDash?.overtime_cost_latest || 0)}</div>
                    </div>
                  </div>
                  {!!payrollDash?.insights?.length && (
                    <p className="mt-3 text-xs text-app-muted">{payrollDash.insights[0]}</p>
                  )}
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

              {(safeTeam.length > 0 || safeCashiers.length > 0) && (
                <div className="table-container mt-1">
                  <div className="border-b border-app px-4 py-3">
                    <h3 className="card-title">User activity &amp; cashier performance — today</h3>
                    <p className="mt-1 text-sm text-app-muted">
                      {safeCashiers.length
                        ? `Top cashier: ${safeCashiers[0].name} · Lowest cashier: ${safeCashiers[safeCashiers.length - 1].name}`
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
                        {safeTeam.map((member, index) => (
                          <tr key={member?.id ?? index}>
                            <td className="font-mono text-sm">#{index + 1}</td>
                            <td>
                              <div className="text-sm font-medium">{member?.name}</div>
                              <div className="text-xs text-app-muted">@{member?.username}</div>
                            </td>
                            <td className={`text-xs font-semibold ${member?.online ? "text-success" : "text-danger"}`}>
                              {member?.online ? "● Online" : "● Offline"}
                            </td>
                            <td className="font-mono text-sm">{money(member?.revenue)}</td>
                            <td className="font-mono text-sm">{member?.transactions}</td>
                            <td className="font-mono text-sm text-success">{money(member?.profit)}</td>
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
