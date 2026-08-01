import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, Download, FileSpreadsheet, FileText, Printer,
  Receipt, RotateCcw, Search, TrendingDown, TrendingUp, WalletCards,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { getReportRange, REPORT_PERIODS } from "../lib/reportDates";
import { exportCsv, exportExcel, exportPdf, printReport } from "../lib/reportExport";
import { useRealtimeRefresh } from "../hooks/useRealtimeRefresh";
import { PageSkeleton } from "@/components/ui/skeleton";

const COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-5)", "var(--chart-2)", "var(--chart-4)", "var(--chart-6)"];
const TABS = [
  ["overview", "Overview"],
  ["daily", "Daily Sales"],
  ["monthly", "Monthly Sales"],
  ["pl", "Profit & Loss"],
  ["transactions", "Transactions"],
];

const emptyAnalytics = {
  range: getReportRange("today"),
  summary: {}, cards: { today: {}, month: {} }, dailyPL: {}, monthlyPL: {},
  charts: { daily: [], weekly: [], monthly: [], profit: [], hourly: [], topProducts: [], topCategories: [] },
  topProducts: [], topCategories: [], topCashier: null, dailyComparison: [], sales: [],
  options: { branches: [], cashiers: [], categories: [], products: [] },
};

const Select = ({ label, value, onChange, children }) => (
  <label className="min-w-[160px] flex-1">
    <span className="form-label">{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)} className="form-control w-full">
      {children}
    </select>
  </label>
);

function StatCard({ label, value, icon: Icon, color = "var(--brand)", hint }) {
  return (
    <article className="nx-kpi">
      <div className="mb-4 flex items-start justify-between">
        <div className="nx-stat-icon" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}><Icon size={20} /></div>
        {hint && <span className="text-[12px] text-app-muted">{hint}</span>}
      </div>
      <div className="nx-kpi-value truncate" title={String(value)}>{value}</div>
      <div className="nx-kpi-label">{label}</div>
    </article>
  );
}

function ChartCard({ title, subtitle, children, empty = false, className = "" }) {
  return (
    <section className={`card ${className}`}>
      <div className="mb-5">
        <h2 className="card-title">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-app-muted">{subtitle}</p>}
      </div>
      {empty ? <div className="flex h-[260px] items-center justify-center text-sm text-app-muted">No data for the selected filters.</div> : children}
    </section>
  );
}

function PnlPanel({ title, data, money }) {
  const rows = [
    ["Sales Revenue", data.revenue, "var(--app-text)"],
    ["Cost of Goods Sold", -data.cogs, "var(--danger)"],
    ["Gross Profit", data.grossProfit, "var(--success)"],
    ["Expenses", -data.expenses, "var(--danger)"],
    ["Net Profit", data.netProfit, data.netProfit >= 0 ? "var(--success)" : "var(--danger)"],
  ];
  return (
    <section className="card">
      <h2 className="card-title mb-5">{title}</h2>
      {rows.map(([label, value, color], index) => (
        <div key={label} className={`flex items-center justify-between py-3 ${index < rows.length - 1 ? "border-b border-app" : ""}`}>
          <span className="text-base text-app-muted">{label}</span>
          <span className="font-mono text-base font-semibold" style={{ color }}>{value < 0 ? `-${money(Math.abs(value || 0))}` : money(value || 0)}</span>
        </div>
      ))}
      <div className="mt-5 rounded-[12px] bg-app-panel-muted p-4">
        <div className="text-sm text-app-muted">Profit Margin</div>
        <div className="mt-1 font-mono text-2xl font-bold">{Number(data.profitMargin || 0).toFixed(2)}%</div>
      </div>
    </section>
  );
}

export default function ReportsAnalytics() {
  const { can } = useAuth();
  const { formatReportMoney, formatMoney, currency, reportCurrencyCode } = useEnterpriseSettings();
  const money = formatReportMoney || formatMoney;
  const [tab, setTab] = useState("overview");
  const [period, setPeriod] = useState("today");
  const [filters, setFilters] = useState({ ...getReportRange("today"), branch_id: "", cashier_id: "", category_id: "", product_id: "" });
  const [analytics, setAnalytics] = useState(emptyAnalytics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");

  const load = useCallback(async (nextFilters) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.reports.getAnalytics(nextFilters);
      if (!result?.summary) throw new Error(result?.error || "Reports data is unavailable.");
      setAnalytics(result);
    } catch (loadError) {
      setError(loadError.message || "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  // ERP real-time: every sale, purchase, expense, or return recalculates
  // these reports automatically — no manual refresh required.
  useRealtimeRefresh(
    ["sales", "purchases", "inventory", "expenses", "customers", "suppliers"],
    () => load(filters),
    { debounceMs: 1200 }
  );

  const setFilter = (key, value) => setFilters((current) => ({
    ...current,
    [key]: value,
    ...(key === "category_id" ? { product_id: "" } : {}),
  }));

  const setPreset = (value) => {
    setPeriod(value);
    if (value !== "custom") setFilters((current) => ({ ...current, ...getReportRange(value) }));
  };

  const resetFilters = () => {
    setPeriod("today");
    setFilters({ ...getReportRange("today"), branch_id: "", cashier_id: "", category_id: "", product_id: "" });
  };

  const products = useMemo(() => analytics.options.products.filter((product) => !filters.category_id || String(product.category_id) === String(filters.category_id)), [analytics.options.products, filters.category_id]);
  const labels = useMemo(() => ({
    branch: analytics.options.branches.find((row) => String(row.id) === String(filters.branch_id))?.name,
    cashier: analytics.options.cashiers.find((row) => String(row.id) === String(filters.cashier_id))?.name,
    currency: `${reportCurrencyCode || currency.code} ${currency.symbol}`,
  }), [analytics.options, filters, currency.code, currency.symbol, reportCurrencyCode]);
  const compactMoney = (value) => money(value, { notation: "compact", maximumFractionDigits: 1 });

  const runExport = async (type) => {
    setExporting(type);
    setError("");
    try {
      if (type === "pdf") await exportPdf(analytics, money, labels);
      if (type === "excel") await exportExcel(analytics, money, labels);
      if (type === "csv") exportCsv(analytics, money, labels);
      if (type === "print") printReport(analytics, money, labels);
    } catch (exportError) {
      setError(exportError.message || `Could not ${type} this report.`);
    } finally {
      setExporting("");
    }
  };

  const s = analytics.summary;
  const today = analytics.cards.today;
  const month = analytics.cards.month;
  const hasSales = analytics.sales.length > 0;

  const chartTick = { fontSize: 12, fill: "var(--chart-tick)" };
  const tooltipStyle = { borderRadius: 16, borderColor: "var(--app-border)", fontSize: 13, boxShadow: "var(--shadow-card)" };

  return (
    <main className="pb-8">
      <header className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3"><BarChart3 size={28} className="text-brand" /><h1 className="page-title">Reports &amp; Analytics</h1></div>
          <p className="max-w-2xl text-base text-app-muted">
            Sales, profitability and operational performance.
            Display currency: {reportCurrencyCode || currency.code} {currency.symbol}.
            Totals are stored in base; Owner can change report currency under Settings → Currencies.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("export_reports", "export") && (
            <>
              <button type="button" disabled={!!exporting || loading} onClick={() => runExport("pdf")} className="btn btn-secondary"><FileText size={16} /> PDF</button>
              <button type="button" disabled={!!exporting || loading} onClick={() => runExport("excel")} className="btn btn-secondary"><FileSpreadsheet size={16} /> Excel</button>
              <button type="button" disabled={!!exporting || loading} onClick={() => runExport("csv")} className="btn btn-secondary"><Download size={16} /> CSV</button>
            </>
          )}
          {can("print_reports", "print") && <button type="button" disabled={!!exporting || loading} onClick={() => runExport("print")} className="btn btn-primary"><Printer size={16} /> Print</button>}
        </div>
      </header>

      <section aria-label="Report filters" className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <Select label="Date range" value={period} onChange={setPreset}>
            {REPORT_PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          {period === "custom" && (
            <>
              <label className="min-w-[160px] flex-1"><span className="form-label">From</span><input type="date" value={filters.start_date} max={filters.end_date} onChange={(event) => setFilter("start_date", event.target.value)} className="form-control w-full" /></label>
              <label className="min-w-[160px] flex-1"><span className="form-label">To</span><input type="date" value={filters.end_date} min={filters.start_date} onChange={(event) => setFilter("end_date", event.target.value)} className="form-control w-full" /></label>
            </>
          )}
          <Select label="Branch" value={filters.branch_id} onChange={(value) => setFilter("branch_id", value)}><option value="">All branches</option>{analytics.options.branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select>
          <Select label="Cashier" value={filters.cashier_id} onChange={(value) => setFilter("cashier_id", value)}><option value="">All cashiers</option>{analytics.options.cashiers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select>
          <Select label="Category" value={filters.category_id} onChange={(value) => setFilter("category_id", value)}><option value="">All categories</option>{analytics.options.categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select>
          <Select label="Product" value={filters.product_id} onChange={(value) => setFilter("product_id", value)}><option value="">All products</option>{products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select>
          <button type="button" onClick={resetFilters} className="btn btn-ghost"><RotateCcw size={15} /> Reset</button>
        </div>
      </section>

      {error && <div role="alert" className="mb-6 rounded-[12px] border border-app bg-[var(--danger-soft)] px-4 py-3 text-sm text-danger">{error}</div>}

      <nav role="tablist" aria-label="Report sections" className="nx-tabs overflow-x-auto">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`nx-tab ${tab === value ? "is-active" : ""}`}>{label}</button>
        ))}
      </nav>

      {loading ? (
        <PageSkeleton rows={8} kpis={4} title={false} />
      ) : (
        <>
          {tab === "overview" && (
            <div className="space-y-6">
              <section>
                <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-app-muted">Selected period · {analytics.range.start_date} to {analytics.range.end_date}</h2>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
                  <StatCard label="Total Sales" value={money(s.revenue || 0)} icon={WalletCards} />
                  <StatCard label="Transactions" value={s.transactions || 0} icon={Receipt} color="var(--chart-3)" />
                  <StatCard label="Cash Sales" value={money(s.cashSales || 0)} icon={WalletCards} color="var(--chart-5)" />
                  <StatCard label="Discounts" value={money(s.discounts || 0)} icon={TrendingDown} color="var(--chart-4)" />
                  <StatCard label="VAT" value={money(s.vat || 0)} icon={FileText} color="var(--app-subtle)" />
                  <StatCard label="Net Profit" value={money(s.netProfit || 0)} icon={TrendingUp} color={s.netProfit >= 0 ? "var(--success)" : "var(--danger)"} />
                </div>
              </section>
              <section>
                <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-app-muted">Today</h2>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <StatCard label="Today's Sales" value={money(today.revenue || 0)} icon={WalletCards} />
                  <StatCard label="Today's Profit" value={money(today.netProfit || 0)} icon={TrendingUp} color="var(--success)" />
                  <StatCard label="Today's Expenses" value={money(today.expenses || 0)} icon={TrendingDown} color="var(--danger)" />
                  <StatCard label="Today's Transactions" value={today.transactions || 0} icon={Receipt} color="var(--chart-3)" />
                </div>
              </section>
              <section>
                <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-app-muted">This month</h2>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <StatCard label="Monthly Sales" value={money(month.revenue || 0)} icon={WalletCards} />
                  <StatCard label="Monthly Profit" value={money(month.netProfit || 0)} icon={TrendingUp} color="var(--success)" />
                  <StatCard label="Monthly Expenses" value={money(month.expenses || 0)} icon={TrendingDown} color="var(--danger)" />
                  <StatCard label="Monthly Transactions" value={month.transactions || 0} icon={Receipt} color="var(--chart-3)" />
                </div>
              </section>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <ChartCard title="Daily Sales" subtitle="Revenue across the selected period" empty={!hasSales}>
                  <ResponsiveContainer width="100%" height={280}><AreaChart data={analytics.charts.daily}><defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.28} /><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="date" tick={chartTick} /><YAxis tick={chartTick} tickFormatter={compactMoney} /><Tooltip formatter={(value) => money(value)} contentStyle={tooltipStyle} /><Area type="monotone" dataKey="sales" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#salesFill)" /></AreaChart></ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Profit Trend" subtitle="Net profit after COGS and expenses" empty={!hasSales && !s.expenses}>
                  <ResponsiveContainer width="100%" height={280}><LineChart data={analytics.charts.profit}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="date" tick={chartTick} /><YAxis tick={chartTick} tickFormatter={compactMoney} /><Tooltip formatter={(value) => money(value)} contentStyle={tooltipStyle} /><Legend /><Line type="monotone" dataKey="profit" name="Net Profit" stroke="var(--chart-2)" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="expenses" name="Expenses" stroke="var(--chart-6)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Top Selling Products" subtitle="Revenue by product" empty={!analytics.topProducts.length}>
                  <ResponsiveContainer width="100%" height={300}><BarChart data={analytics.topProducts.slice(0, 7)} layout="vertical" margin={{ left: 15 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} /><XAxis type="number" tick={chartTick} tickFormatter={compactMoney} /><YAxis type="category" dataKey="name" width={110} tick={chartTick} /><Tooltip formatter={(value) => money(value)} contentStyle={tooltipStyle} /><Bar dataKey="revenue" fill="var(--chart-1)" radius={[0, 8, 8, 0]} /></BarChart></ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Top Categories" subtitle="Share of selected sales" empty={!analytics.topCategories.length}>
                  <ResponsiveContainer width="100%" height={300}><PieChart><Pie data={analytics.topCategories} dataKey="revenue" nameKey="name" innerRadius={62} outerRadius={100} paddingAngle={3}>{analytics.topCategories.map((row, index) => <Cell key={row.id} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={(value) => money(value)} contentStyle={tooltipStyle} /><Legend /></PieChart></ResponsiveContainer>
                </ChartCard>
              </div>
            </div>
          )}

          {tab === "daily" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard label="Returns" value={money(s.returns || 0)} icon={RotateCcw} color="var(--chart-4)" />
                <StatCard label="Refunds" value={money(s.refunds || 0)} icon={TrendingDown} color="var(--danger)" />
                <StatCard label="Top Cashier" value={analytics.topCashier?.name || "No sales"} icon={Receipt} color="var(--chart-5)" hint={analytics.topCashier ? `${analytics.topCashier.transactions} sales` : ""} />
                <StatCard label="Best Category" value={analytics.topCategories[0]?.name || "No sales"} icon={BarChart3} color="var(--chart-3)" />
              </div>
              <ChartCard title="Hourly Sales" subtitle="Sales volume by local checkout hour" empty={!hasSales}>
                <ResponsiveContainer width="100%" height={320}><BarChart data={analytics.charts.hourly}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="hour" interval={2} tick={chartTick} /><YAxis tickFormatter={compactMoney} tick={chartTick} /><Tooltip formatter={(value, name) => name === "sales" ? money(value) : value} contentStyle={tooltipStyle} /><Bar dataKey="sales" fill="var(--chart-1)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Best Selling Products" empty={!analytics.topProducts.length}>
                <div className="table-container border-0 shadow-none"><table><thead><tr><th>Product</th><th className="text-right">Units</th><th className="text-right">Revenue</th></tr></thead><tbody>{analytics.topProducts.map((row) => <tr key={row.id}><td className="font-medium">{row.name}</td><td className="text-right font-mono">{row.units}</td><td className="text-right font-mono font-semibold">{money(row.revenue)}</td></tr>)}</tbody></table></div>
              </ChartCard>
            </div>
          )}

          {tab === "monthly" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard label="Monthly Revenue" value={money(month.revenue || 0)} icon={WalletCards} />
                <StatCard label="Total Orders" value={month.transactions || 0} icon={Receipt} color="var(--chart-3)" />
                <StatCard label="Gross Profit" value={money(month.grossProfit || 0)} icon={TrendingUp} color="var(--success)" />
                <StatCard label="Profit Margin" value={`${Number(month.profitMargin || 0).toFixed(2)}%`} icon={BarChart3} color="var(--chart-5)" />
              </div>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <ChartCard title="Weekly Sales" subtitle="Weekly comparison within the selected range" empty={!hasSales}><ResponsiveContainer width="100%" height={300}><BarChart data={analytics.charts.weekly}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="period" tick={chartTick} /><YAxis tickFormatter={compactMoney} tick={chartTick} /><Tooltip formatter={(value) => money(value)} contentStyle={tooltipStyle} /><Bar dataKey="sales" fill="var(--chart-1)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
                <ChartCard title="Monthly Sales" subtitle="Revenue grouped by calendar month" empty={!hasSales}><ResponsiveContainer width="100%" height={300}><AreaChart data={analytics.charts.monthly}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="period" tick={chartTick} /><YAxis tickFormatter={compactMoney} tick={chartTick} /><Tooltip formatter={(value) => money(value)} contentStyle={tooltipStyle} /><Area type="monotone" dataKey="sales" stroke="var(--chart-5)" fill="color-mix(in srgb, var(--chart-5) 20%, transparent)" strokeWidth={2.5} /></AreaChart></ResponsiveContainer></ChartCard>
              </div>
              <ChartCard title="Daily Comparison" subtitle="Revenue, expenses and net profit by day" empty={!analytics.dailyComparison.length}>
                <ResponsiveContainer width="100%" height={340}><BarChart data={analytics.dailyComparison}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="date" tick={chartTick} /><YAxis tickFormatter={compactMoney} tick={chartTick} /><Tooltip formatter={(value) => money(value)} contentStyle={tooltipStyle} /><Legend /><Bar dataKey="sales" name="Revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} /><Bar dataKey="profit" name="Net Profit" fill="var(--chart-2)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              </ChartCard>
            </div>
          )}

          {tab === "pl" && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <PnlPanel title={`Selected Period P&L · ${analytics.range.start_date} – ${analytics.range.end_date}`} data={analytics.dailyPL} money={money} />
              <PnlPanel title="Monthly P&L · Current Month" data={analytics.monthlyPL} money={money} />
              <ChartCard title="Profit Trend" subtitle="Daily net profitability" empty={!analytics.charts.profit.length}>
                <ResponsiveContainer width="100%" height={320}><AreaChart data={analytics.charts.profit}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="date" tick={chartTick} /><YAxis tickFormatter={compactMoney} tick={chartTick} /><Tooltip formatter={(value) => money(value)} contentStyle={tooltipStyle} /><Area type="monotone" dataKey="profit" stroke="var(--chart-2)" fill="color-mix(in srgb, var(--chart-2) 18%, transparent)" strokeWidth={2.5} /></AreaChart></ResponsiveContainer>
              </ChartCard>
            </div>
          )}

          {tab === "transactions" && (
            <section className="table-container">
              <div className="flex items-center justify-between border-b border-app px-5 py-4">
                <div>
                  <h2 className="card-title">Filtered Transactions</h2>
                  <p className="mt-1 text-sm text-app-muted">{analytics.sales.length} matching sales</p>
                </div>
                <Search size={18} className="text-app-muted" aria-hidden />
              </div>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      {["Invoice", "Date", "Cashier", "Payment", "Discount", "VAT", "Returns", "Total"].map((label) => (
                        <th key={label} className={label === "Total" ? "text-right" : ""}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td className="font-mono font-medium">{sale.invoice_no}</td>
                        <td className="text-app-muted">{new Date(sale.created_at).toLocaleString()}</td>
                        <td>{sale.cashier}</td>
                        <td>{sale.payment_method}</td>
                        <td className="font-mono">{money(sale.discount)}</td>
                        <td className="font-mono">{money(sale.vat)}</td>
                        <td className="font-mono">{money(sale.returns + sale.refunds)}</td>
                        <td className="text-right font-mono font-semibold">{money(sale.total)}</td>
                      </tr>
                    ))}
                    {!analytics.sales.length && (
                      <tr><td colSpan={8} className="py-16 text-center text-sm text-app-muted">No transactions match the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
