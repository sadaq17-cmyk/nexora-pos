import { useState, useEffect } from "react";
import { TrendingUp, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { api } from "../lib/api";

const money = (n) => `Ksh ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PIE_COLORS = ["#2563EB", "#38BDF8", "#F59E0B", "#8B5CF6", "#12A150", "#DC2626"];

const TABS = [
  { id: "overview", label: "Overview" }, { id: "sales", label: "Sales" }, { id: "purchases", label: "Purchases" },
  { id: "pl", label: "Profit & Loss" }, { id: "inventory", label: "Inventory" }, { id: "lowstock", label: "Low Stock" },
  { id: "customers", label: "Customers" }, { id: "suppliers", label: "Suppliers" },
];

function Th({ children }) { return <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-[#6B7690] text-left">{children}</th>; }
function Td({ children, className = "" }) { return <td className={`px-3 py-2 text-sm text-[#1B2439] ${className}`}>{children}</td>; }

export default function Reports() {
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

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [re, tp, cs, ps, sr, pr, plr, inv, ls, cr, sup] = await Promise.all([
        api.reports.getRevenueVsExpenses(), api.reports.getTopProducts(5), api.reports.getCategorySales(), api.reports.getProfitSummary(),
        api.reports.getSalesReport({}), api.reports.getPurchaseReport({}), api.reports.getProfitLoss({}),
        api.reports.getInventoryReport(), api.reports.getLowStockReport(), api.reports.getCustomerReport(), api.reports.getSupplierReport(),
      ]);
      setRevExp(re); setTopProducts(tp); setCategorySales(cs); setProfit(ps);
      setSalesReport(sr); setPurchaseReport(pr); setPl(plr); setInventory(inv); setLowStock(ls);
      setCustomerReport(cr); setSupplierReport(sup);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="animate-fadein">
      <h1 className="text-2xl font-bold text-[#1B2439] mb-1">Reports</h1>
      <p className="text-sm text-[#6B7690] mb-4">Every report, straight from your database.</p>

      <div className="flex gap-1.5 mb-5 border-b border-[#E4E9F2] overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="px-3.5 py-2.5 text-sm font-medium relative -mb-px whitespace-nowrap"
            style={{ color: tab === t.id ? "#2563EB" : "#6B7690", borderBottom: tab === t.id ? "2px solid #2563EB" : "2px solid transparent" }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-[#6B7690]">Crunching numbers…</div>
      ) : (
        <>
          {tab === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="grid grid-cols-3 gap-4 lg:col-span-2">
                <div className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm">
                  <div className="text-xs text-[#6B7690] mb-1">Revenue this month</div>
                  <div className="text-xl font-bold font-mono text-[#1B2439]">{money(profit.revenue)}</div>
                </div>
                <div className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm">
                  <div className="text-xs text-[#6B7690] mb-1">Cost of goods sold</div>
                  <div className="text-xl font-bold font-mono text-[#1B2439]">{money(profit.cost)}</div>
                </div>
                <div className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm">
                  <div className="text-xs text-[#6B7690] mb-1">Gross profit</div>
                  <div className="text-xl font-bold font-mono text-[#12A150]">{money(profit.profit)}</div>
                </div>
              </div>

              <div className="bg-white border border-[#E4E9F2] rounded-2xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold mb-4 text-[#1B2439]">Revenue vs Expenses</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={revExp}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E9F2" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6B7690" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#6B7690" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, borderColor: "#E4E9F2", fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} name="Revenue" />
                    <Bar dataKey="expenses" fill="#94A3B8" radius={[4, 4, 0, 0]} name="Expenses" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white border border-[#E4E9F2] rounded-2xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold mb-4 text-[#1B2439]">Best Selling Products</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topProducts} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E9F2" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "#6B7690" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#6B7690" }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, borderColor: "#E4E9F2", fontSize: 13 }} />
                    <Bar dataKey="revenue" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white border border-[#E4E9F2] rounded-2xl p-5 shadow-sm lg:col-span-2">
                <h3 className="text-sm font-semibold mb-4 text-[#1B2439]">Sales by Category</h3>
                {categorySales.length === 0 ? (
                  <div className="text-center py-16 text-sm text-[#6B7690]">No category sales data yet.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={categorySales} dataKey="value" nameKey="name" outerRadius={85} label={(e) => e.name}>
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
            <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-[#E4E9F2] flex justify-between text-sm">
                <span className="text-[#6B7690]">{salesReport.rows.length} sales</span>
                <span className="font-semibold font-mono text-[#1B2439]">Total: {money(salesReport.totals.total)}</span>
              </div>
              <table className="w-full">
                <thead><tr className="bg-[#F3F6FB]"><Th>Invoice</Th><Th>Customer</Th><Th>Payment</Th><Th>Date</Th><Th>Total</Th></tr></thead>
                <tbody>
                  {salesReport.rows.map((r) => (
                    <tr key={r.id} className="border-t border-[#E4E9F2]">
                      <Td className="font-mono">{r.invoice_no}</Td><Td>{r.customer}</Td><Td>{r.payment_method}</Td>
                      <Td className="text-[#6B7690]">{String(r.created_at).slice(0, 10)}</Td><Td className="font-mono font-medium">{money(r.total)}</Td>
                    </tr>
                  ))}
                  {salesReport.rows.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-sm text-[#6B7690]">No sales recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "purchases" && (
            <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-[#E4E9F2] flex justify-between text-sm">
                <span className="text-[#6B7690]">{purchaseReport.rows.length} purchase orders</span>
                <span className="font-semibold font-mono text-[#1B2439]">Total: {money(purchaseReport.total)}</span>
              </div>
              <table className="w-full">
                <thead><tr className="bg-[#F3F6FB]"><Th>PO Number</Th><Th>Supplier</Th><Th>Status</Th><Th>Date</Th><Th>Total</Th></tr></thead>
                <tbody>
                  {purchaseReport.rows.map((r) => (
                    <tr key={r.id} className="border-t border-[#E4E9F2]">
                      <Td className="font-mono">{r.po_number}</Td><Td>{r.supplier}</Td><Td>{r.status}</Td>
                      <Td className="text-[#6B7690]">{String(r.created_at).slice(0, 10)}</Td><Td className="font-mono font-medium">{money(r.total)}</Td>
                    </tr>
                  ))}
                  {purchaseReport.rows.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-sm text-[#6B7690]">No purchases recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "pl" && pl && (
            <div className="bg-white border border-[#E4E9F2] rounded-2xl p-6 shadow-sm max-w-md">
              <h3 className="text-sm font-semibold text-[#1B2439] mb-4">Profit &amp; Loss — {pl.month}</h3>
              {[["Revenue", pl.revenue, "#1B2439"], ["Cost of Goods Sold", -pl.cogs, "#DC2626"], ["Gross Profit", pl.grossProfit, "#12A150"], ["Operating Expenses", -pl.expenses, "#DC2626"]].map(([label, val, color]) => (
                <div key={label} className="flex justify-between py-2 border-b border-[#F1F3F8] text-sm">
                  <span className="text-[#6B7690]">{label}</span>
                  <span className="font-mono font-medium" style={{ color }}>{val < 0 ? `-${money(Math.abs(val))}` : money(val)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-3 mt-1 text-base font-bold">
                <span className="text-[#1B2439]">Net Profit</span>
                <span className="font-mono" style={{ color: pl.netProfit >= 0 ? "#12A150" : "#DC2626" }}>{money(pl.netProfit)}</span>
              </div>
            </div>
          )}

          {tab === "inventory" && (
            <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-[#E4E9F2] flex justify-between text-sm">
                <span className="text-[#6B7690]">{inventory.rows.length} products</span>
                <span className="font-semibold font-mono text-[#1B2439]">Stock value: {money(inventory.totalValue)}</span>
              </div>
              <table className="w-full">
                <thead><tr className="bg-[#F3F6FB]"><Th>Product</Th><Th>Category</Th><Th>Stock</Th><Th>Unit Cost</Th><Th>Stock Value</Th></tr></thead>
                <tbody>
                  {inventory.rows.map((r) => (
                    <tr key={r.id} className="border-t border-[#E4E9F2]">
                      <Td className="font-medium">{r.name}</Td><Td>{r.category || "—"}</Td><Td className="font-mono">{r.stock}</Td>
                      <Td className="font-mono">{money(r.cost)}</Td><Td className="font-mono font-medium">{money(r.stock_value)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "lowstock" && (
            <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
              {lowStock.length > 0 && (
                <div className="px-4 py-3 border-b border-[#E4E9F2] flex items-center gap-2 text-sm text-[#DC2626]">
                  <AlertTriangle size={15} /> {lowStock.length} product{lowStock.length > 1 ? "s" : ""} at or below reorder level
                </div>
              )}
              <table className="w-full">
                <thead><tr className="bg-[#F3F6FB]"><Th>Product</Th><Th>Category</Th><Th>Stock</Th><Th>Reorder Level</Th></tr></thead>
                <tbody>
                  {lowStock.map((r) => (
                    <tr key={r.id} className="border-t border-[#E4E9F2]">
                      <Td className="font-medium">{r.name}</Td><Td>{r.category || "—"}</Td>
                      <Td className="font-mono text-[#DC2626]">{r.stock}</Td><Td className="font-mono">{r.reorder_level}</Td>
                    </tr>
                  ))}
                  {lowStock.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-sm text-[#6B7690]">All products are well stocked.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "customers" && (
            <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full">
                <thead><tr className="bg-[#F3F6FB]"><Th>Customer</Th><Th>Visits</Th><Th>Total Spent</Th><Th>Balance Owed</Th><Th>Points</Th></tr></thead>
                <tbody>
                  {customerReport.map((r) => (
                    <tr key={r.id} className="border-t border-[#E4E9F2]">
                      <Td className="font-medium">{r.name}</Td><Td>{r.visits}</Td>
                      <Td className="font-mono">{money(r.spent)}</Td>
                      <Td className="font-mono" style={{ color: r.balance > 0 ? "#DC2626" : "#1B2439" }}>{money(r.balance)}</Td>
                      <Td>{r.points}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "suppliers" && (
            <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full">
                <thead><tr className="bg-[#F3F6FB]"><Th>Supplier</Th><Th>Category</Th><Th>Orders</Th><Th>Total Ordered</Th><Th>Balance Owed</Th></tr></thead>
                <tbody>
                  {supplierReport.map((r) => (
                    <tr key={r.id} className="border-t border-[#E4E9F2]">
                      <Td className="font-medium">{r.name}</Td><Td>{r.category || "—"}</Td><Td>{r.order_count}</Td>
                      <Td className="font-mono">{money(r.total_ordered)}</Td>
                      <Td className="font-mono" style={{ color: r.balance > 0 ? "#DC2626" : "#1B2439" }}>{money(r.balance)}</Td>
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
