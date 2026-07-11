import { useState, useEffect } from "react";
import { TrendingUp } from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { api } from "../lib/api";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PIE_COLORS = ["#2563EB", "#38BDF8", "#F59E0B", "#8B5CF6", "#12A150", "#DC2626"];

export default function Reports() {
  const [revExp, setRevExp] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [categorySales, setCategorySales] = useState([]);
  const [profit, setProfit] = useState({ revenue: 0, cost: 0, profit: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [re, tp, cs, ps] = await Promise.all([
        api.reports.getRevenueVsExpenses(),
        api.reports.getTopProducts(5),
        api.reports.getCategorySales(),
        api.reports.getProfitSummary(),
      ]);
      setRevExp(re); setTopProducts(tp); setCategorySales(cs); setProfit(ps);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="animate-fadein">
      <h1 className="text-2xl font-bold text-[#1B2439] mb-1">Reports</h1>
      <p className="text-sm text-[#6B7690] mb-5">Analyze sales performance and profitability, straight from your database.</p>

      {loading ? (
        <div className="text-center py-16 text-sm text-[#6B7690]">Crunching numbers…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-[#EEF3FF]"><TrendingUp size={18} className="text-[#2563EB]" /></div>
              <div className="text-2xl font-bold font-mono text-[#1B2439]">{money(profit.revenue)}</div>
              <div className="text-xs mt-1 text-[#6B7690]">Revenue this month</div>
            </div>
            <div className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-[#FEF3E2]"><TrendingUp size={18} className="text-[#D97706]" /></div>
              <div className="text-2xl font-bold font-mono text-[#1B2439]">{money(profit.cost)}</div>
              <div className="text-xs mt-1 text-[#6B7690]">Cost of goods sold</div>
            </div>
            <div className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-[#E8FAEF]"><TrendingUp size={18} className="text-[#12A150]" /></div>
              <div className="text-2xl font-bold font-mono text-[#1B2439]">{money(profit.profit)}</div>
              <div className="text-xs mt-1 text-[#6B7690]">Gross profit this month</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-[#E4E9F2] rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-4 text-[#1B2439]">Revenue vs Expenses</h3>
              {revExp.length === 0 ? (
                <div className="text-center py-16 text-sm text-[#6B7690]">Not enough data yet — record sales and expenses to see this chart.</div>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
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
              )}
            </div>

            <div className="bg-white border border-[#E4E9F2] rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-4 text-[#1B2439]">Top Selling Products</h3>
              {topProducts.length === 0 ? (
                <div className="text-center py-16 text-sm text-[#6B7690]">Complete some POS sales to see your top products.</div>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={topProducts} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E9F2" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "#6B7690" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#6B7690" }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, borderColor: "#E4E9F2", fontSize: 13 }} />
                    <Bar dataKey="revenue" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
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
        </>
      )}
    </div>
  );
}
