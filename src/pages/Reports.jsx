import { lazy, Suspense, useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { api } from "../lib/api";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { useRealtimeRefresh } from "../hooks/useRealtimeRefresh";

const ReportsAnalytics = lazy(() => import("./ReportsAnalytics"));
const PIE_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-2)", "var(--chart-6)"];

const TABS = [
  { id: "overview", label: "Overview" }, { id: "sales", label: "Sales" }, { id: "purchases", label: "Purchases" },
  { id: "pl", label: "Profit & Loss" }, { id: "inventory", label: "Inventory" }, { id: "lowstock", label: "Low Stock" },
  { id: "customers", label: "Customers" }, { id: "suppliers", label: "Suppliers" },
];

function Th({ children }) { return <th>{children}</th>; }
function Td({ children, className = "" }) { return <td className={className}>{children}</td>; }

function LegacyReports() {
  const { formatMoney: money } = useEnterpriseSettings();
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  const [revExp, setRevExp] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [categorySales, setCategorySales] = useState([]);
  const [profit, setProfit] = useState({ revenue: 0, cost: 0, profit: 0 });

  const [salesReport, setSalesReport] = useState({ rows: [], totals: {} });
  const [purchaseReport, setPurchaseReport] = useState({ rows: [], total: 0 });
  const [pl, setPl] = useState(null);
  const [inventory, setInventory] = useState({ rows: [], totalValue: 0 });
  const [lowStock, setLowStock] = useState([]);
  const [customerReport, setCustomerReport] = useState([]);
  const [supplierReport, setSupplierReport] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);

  // ERP real-time: refresh every legacy report tab automatically.
  useRealtimeRefresh(
    ["sales", "purchases", "inventory", "expenses", "customers", "suppliers"],
    () => setRefreshTick((n) => n + 1),
    { debounceMs: 1200 }
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(refreshTick === 0);
      // Drop duplicate profit endpoints from the initial fan-out (getProfitLoss === getProfitSummary).
      const [re, tp, cs, ps, sr, pr, inv, ls, cr, sup] = await Promise.all([
        api.reports.getRevenueVsExpenses(),
        api.reports.getTopProducts(5),
        api.reports.getCategorySales(),
        api.reports.getProfitSummary(),
        api.reports.getSalesReport({}),
        api.reports.getPurchaseReport({}),
        api.reports.getInventoryReport(),
        api.reports.getLowStockReport(),
        api.reports.getCustomerReport(),
        api.reports.getSupplierReport(),
      ]);
      if (cancelled) return;
      setRevExp(re); setTopProducts(tp); setCategorySales(cs); setProfit(ps);
      setSalesReport(sr); setPurchaseReport(pr); setPl(ps); setInventory(inv); setLowStock(ls);
      setCustomerReport(cr); setSupplierReport(sup);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshTick]);

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Operational Reports</h1>
          <p className="nx-page-lead">Every report, straight from your database.</p>
        </div>
      </div>

      <div className="nx-tabs overflow-x-auto" role="tablist" aria-label="Operational report tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`nx-tab ${tab === t.id ? "is-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-app-muted">Crunching numbers…</div>
      ) : (
        <>
          {tab === "overview" && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-2">
                <div className="nx-kpi">
                  <div className="nx-kpi-label">Revenue this month</div>
                  <div className="nx-kpi-value">{money(profit.revenue)}</div>
                </div>
                <div className="nx-kpi">
                  <div className="nx-kpi-label">Cost of goods sold</div>
                  <div className="nx-kpi-value">{money(profit.cost)}</div>
                </div>
                <div className="nx-kpi">
                  <div className="nx-kpi-label">Gross profit</div>
                  <div className="nx-kpi-value text-success">{money(profit.profit)}</div>
                </div>
              </div>

              <div className="card">
                <h3 className="card-title mb-5">Revenue vs Expenses</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={revExp}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 16, borderColor: "var(--app-border)", fontSize: 13, boxShadow: "var(--shadow-card)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="revenue" fill="var(--chart-1)" radius={[6, 6, 0, 0]} name="Revenue" />
                    <Bar dataKey="expenses" fill="var(--app-subtle)" radius={[6, 6, 0, 0]} name="Expenses" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3 className="card-title mb-5">Best Selling Products</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topProducts} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "var(--chart-tick)" }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 16, borderColor: "var(--app-border)", fontSize: 13, boxShadow: "var(--shadow-card)" }} />
                    <Bar dataKey="revenue" fill="var(--chart-5)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card lg:col-span-2">
                <h3 className="card-title mb-5">Sales by Category</h3>
                {categorySales.length === 0 ? (
                  <div className="py-16 text-center text-sm text-app-muted">No category sales data yet.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={categorySales} dataKey="value" nameKey="name" outerRadius={95} label={(e) => e.name}>
                        {categorySales.map((c, i) => <Cell key={c.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => money(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {tab === "sales" && (
            <div className="table-container">
              <div className="flex justify-between border-b border-app px-5 py-4 text-sm">
                <span className="text-app-muted">{salesReport.rows.length} sales</span>
                <span className="font-mono font-semibold">Total: {money(salesReport.totals.total)}</span>
              </div>
              <table>
                <thead><tr><Th>Invoice</Th><Th>Customer</Th><Th>Payment</Th><Th>Date</Th><Th>Total</Th></tr></thead>
                <tbody>
                  {salesReport.rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-mono">{r.invoice_no}</Td><Td>{r.customer}</Td><Td>{r.payment_method}</Td>
                      <Td className="text-app-muted">{String(r.created_at).slice(0, 10)}</Td><Td className="font-mono font-medium">{money(r.total)}</Td>
                    </tr>
                  ))}
                  {salesReport.rows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-sm text-app-muted">No sales recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "purchases" && (
            <div className="table-container">
              <div className="flex justify-between border-b border-app px-5 py-4 text-sm">
                <span className="text-app-muted">{purchaseReport.rows.length} purchase orders</span>
                <span className="font-mono font-semibold">Total: {money(purchaseReport.total)}</span>
              </div>
              <table>
                <thead><tr><Th>PO Number</Th><Th>Supplier</Th><Th>Status</Th><Th>Date</Th><Th>Total</Th></tr></thead>
                <tbody>
                  {purchaseReport.rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-mono">{r.po_number}</Td><Td>{r.supplier}</Td><Td>{r.status}</Td>
                      <Td className="text-app-muted">{String(r.created_at).slice(0, 10)}</Td><Td className="font-mono font-medium">{money(r.total)}</Td>
                    </tr>
                  ))}
                  {purchaseReport.rows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-sm text-app-muted">No purchases recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "pl" && pl && (
            <div className="card max-w-lg">
              <h3 className="card-title mb-5">Profit &amp; Loss — {pl.month}</h3>
              {[["Revenue", pl.revenue, "var(--app-text)"], ["Cost of Goods Sold", -pl.cogs, "var(--danger)"], ["Gross Profit", pl.grossProfit, "var(--success)"], ["Operating Expenses", -pl.expenses, "var(--danger)"]].map(([label, val, color]) => (
                <div key={label} className="flex justify-between border-b border-app py-3 text-base">
                  <span className="text-app-muted">{label}</span>
                  <span className="font-mono font-medium" style={{ color }}>{val < 0 ? `-${money(Math.abs(val))}` : money(val)}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between pt-4 text-lg font-bold">
                <span>Net Profit</span>
                <span className="font-mono" style={{ color: pl.netProfit >= 0 ? "var(--success)" : "var(--danger)" }}>{money(pl.netProfit)}</span>
              </div>
            </div>
          )}

          {tab === "inventory" && (
            <div className="table-container">
              <div className="flex justify-between border-b border-app px-5 py-4 text-sm">
                <span className="text-app-muted">{inventory.rows.length} products</span>
                <span className="font-mono font-semibold">Stock value: {money(inventory.totalValue)}</span>
              </div>
              <table>
                <thead><tr><Th>Product</Th><Th>Category</Th><Th>Stock</Th><Th>Unit Cost</Th><Th>Stock Value</Th></tr></thead>
                <tbody>
                  {inventory.rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-medium">{r.name}</Td><Td>{r.category || "—"}</Td><Td className="font-mono">{r.stock}</Td>
                      <Td className="font-mono">{money(r.cost)}</Td><Td className="font-mono font-medium">{money(r.stock_value)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "lowstock" && (
            <div className="table-container">
              {lowStock.length > 0 && (
                <div className="flex items-center gap-2 border-b border-app px-5 py-4 text-sm font-semibold text-danger">
                  <AlertTriangle size={16} /> {lowStock.length} product{lowStock.length > 1 ? "s" : ""} at or below reorder level
                </div>
              )}
              <table>
                <thead><tr><Th>Product</Th><Th>Category</Th><Th>Stock</Th><Th>Reorder Level</Th></tr></thead>
                <tbody>
                  {lowStock.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-medium">{r.name}</Td><Td>{r.category || "—"}</Td>
                      <Td className="font-mono text-danger">{r.stock}</Td><Td className="font-mono">{r.reorder_level}</Td>
                    </tr>
                  ))}
                  {lowStock.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-sm text-app-muted">All products are well stocked.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "customers" && (
            <div className="table-container">
              <table>
                <thead><tr><Th>Customer</Th><Th>Visits</Th><Th>Total Spent</Th><Th>Balance Owed</Th><Th>Points</Th></tr></thead>
                <tbody>
                  {customerReport.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-medium">{r.name}</Td><Td>{r.visits}</Td>
                      <Td className="font-mono">{money(r.spent)}</Td>
                      <Td className={`font-mono ${r.balance > 0 ? "text-danger" : ""}`}>{money(r.balance)}</Td>
                      <Td>{r.points}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "suppliers" && (
            <div className="table-container">
              <table>
                <thead><tr><Th>Supplier</Th><Th>Category</Th><Th>Orders</Th><Th>Total Ordered</Th><Th>Balance Owed</Th></tr></thead>
                <tbody>
                  {supplierReport.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-medium">{r.name}</Td><Td>{r.category || "—"}</Td><Td>{r.order_count}</Td>
                      <Td className="font-mono">{money(r.total_ordered)}</Td>
                      <Td className={`font-mono ${r.balance > 0 ? "text-danger" : ""}`}>{money(r.balance)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Reports() {
  const [workspace, setWorkspace] = useState("analytics");
  return (
    <div className="animate-fadein">
      <div className="nx-segmented mb-6" aria-label="Report workspace">
        <button type="button" onClick={() => setWorkspace("analytics")} className={workspace === "analytics" ? "is-active" : ""}>Analytics Dashboard</button>
        <button type="button" onClick={() => setWorkspace("legacy")} className={workspace === "legacy" ? "is-active" : ""}>Operational Reports</button>
      </div>
      <Suspense fallback={<div className="card p-10 text-center text-sm text-app-muted">Loading reports…</div>}>
        {workspace === "analytics" ? <ReportsAnalytics /> : <LegacyReports />}
      </Suspense>
    </div>
  );
}
