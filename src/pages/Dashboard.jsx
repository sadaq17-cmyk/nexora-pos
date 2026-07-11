import { useState, useEffect } from "react";
import { DollarSign, Package, AlertTriangle, TrendingUp, Users } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../lib/api";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: color + "1A" }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="text-2xl font-bold font-mono text-[#1B2439]">{value}</div>
      <div className="text-xs mt-1 text-[#6B7690]">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState({ today: 0, todayCount: 0, monthRevenue: 0 });
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [trend, setTrend] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, p, c, t, r] = await Promise.all([
        api.sales.getSummary(),
        api.products.getAll(),
        api.customers.getAll(),
        api.sales.getWeeklyTrend(),
        api.sales.getRecent(6),
      ]);
      setSummary(s); setProducts(p); setCustomers(c); setTrend(t); setRecent(r);
      setLoading(false);
    })();
  }, []);

  const lowStock = products.filter((p) => p.stock <= p.reorder_level).length;
  const chartData = trend.map((d) => ({
    day: new Date(d.day).toLocaleDateString(undefined, { weekday: "short" }),
    sales: d.sales,
  }));

  return (
    <div className="animate-fadein">
      <h1 className="text-2xl font-bold text-[#1B2439] mb-1">Dashboard</h1>
      <p className="text-sm text-[#6B7690] mb-5">Live figures from your store's database.</p>

      {loading ? (
        <div className="text-center py-16 text-sm text-[#6B7690]">Loading dashboard…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <StatCard icon={DollarSign} label="Today's Sales" value={money(summary.today)} color="#2563EB" />
            <StatCard icon={Package} label="Total Products" value={products.length} color="#8B5CF6" />
            <StatCard icon={Users} label="Total Customers" value={customers.length} color="#38BDF8" />
            <StatCard icon={AlertTriangle} label="Low Stock Items" value={lowStock} color="#DC2626" />
            <StatCard icon={TrendingUp} label="This Month Revenue" value={money(summary.monthRevenue)} color="#12A150" />
            <StatCard icon={DollarSign} label="Transactions Today" value={summary.todayCount} color="#0EA5E9" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
            <div className="bg-white border border-[#E4E9F2] rounded-2xl p-5 lg:col-span-2 shadow-sm">
              <h3 className="text-sm font-semibold mb-4 text-[#1B2439]">Sales — Last 7 Days</h3>
              {chartData.length === 0 ? (
                <div className="text-center py-16 text-sm text-[#6B7690]">No sales yet this week — complete a POS sale to see it here.</div>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E9F2" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#6B7690" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#6B7690" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, borderColor: "#E4E9F2", fontSize: 13 }} />
                    <Line type="monotone" dataKey="sales" stroke="#2563EB" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white border border-[#E4E9F2] rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-3 text-[#1B2439]">Low Stock Watch</h3>
              <div className="space-y-2.5">
                {products.filter((p) => p.stock <= p.reorder_level).slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-[#1B2439]">{p.name}</span>
                    <span className="font-mono text-[#DC2626]">{p.stock} left</span>
                  </div>
                ))}
                {lowStock === 0 && <div className="text-sm text-[#6B7690]">All products are well stocked.</div>}
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-[#E4E9F2]">
              <h3 className="text-sm font-semibold text-[#1B2439]">Recent Transactions</h3>
            </div>
            {recent.length === 0 ? (
              <div className="text-center py-10 text-sm text-[#6B7690]">No transactions yet.</div>
            ) : (
              <table className="w-full">
                <thead><tr className="bg-[#F3F6FB]">
                  {["Transaction", "Customer", "Items", "Payment", "Time", "Total"].map((h, i) => (
                    <th key={h} className={`px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-[#6B7690] ${i === 5 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id} className="border-t border-[#E4E9F2]">
                      <td className="px-4 py-3 text-sm font-mono text-[#1B2439]">{t.invoice_no}</td>
                      <td className="px-4 py-3 text-sm text-[#1B2439]">{t.customer}</td>
                      <td className="px-4 py-3 text-sm text-[#1B2439]">{t.item_count}</td>
                      <td className="px-4 py-3 text-sm text-[#1B2439]">{t.payment_method}</td>
                      <td className="px-4 py-3 text-sm text-[#6B7690]">{fmtDate(t.created_at)}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold font-mono text-[#1B2439]">{money(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
