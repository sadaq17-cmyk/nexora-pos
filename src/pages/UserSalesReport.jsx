import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { roleLabel } from "../lib/rbac";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";

const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["this_week", "This Week"], ["this_month", "This Month"], ["custom", "Custom Date"]];
const dateOnly = (date) => date.toISOString().slice(0, 10);
const lastSale = (value) => value ? new Date(value).toLocaleString() : "—";

export default function UserSalesReport() {
  const { formatMoney } = useEnterpriseSettings();
  const [filters, setFilters] = useState({ preset: "today", start_date: dateOnly(new Date()), end_date: dateOnly(new Date()) });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.reports.getUserSales(filters);
      setRows(result?.rows || []);
    } catch {
      setError("Could not load user sales.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    const headings = ["User", "Username", "Role", "Transactions", "Gross Sales", "Net Revenue", "Discount", "Profit", "Average Sale", "Last Sale", "Working Hours"];
    const values = rows.map((row) => [row.name, row.username, roleLabel(row.role), row.total_transactions, row.total_sales, row.total_revenue, row.total_discount, row.total_profit, row.average_sale, row.last_sale_at || "", row.working_hours]);
    const csv = [headings, ...values].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexora-user-sales-${filters.preset}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fadein space-y-5">
      <div className="nx-page-header">
        <div><h1 className="page-title">User Sales Report</h1><p className="text-sm text-app-muted">Gross Sales is pre-discount; Net Revenue includes discount and VAT effects.</p></div>
        <div className="flex gap-2"><button onClick={load} className="btn btn-secondary"><RefreshCw size={16} /> Refresh</button><button onClick={exportCsv} disabled={!rows.length} className="btn btn-primary"><Download size={16} /> CSV</button></div>
      </div>
      <div className="card flex flex-wrap gap-2">
        {PRESETS.map(([id, label]) => <button key={id} onClick={() => setFilters((current) => ({ ...current, preset: id }))} className={`min-h-10 rounded-xl px-4 text-sm font-medium ${filters.preset === id ? "bg-brand text-white" : "bg-app-panel-muted text-app-muted"}`}>{label}</button>)}
        {filters.preset === "custom" && <><input aria-label="Start date" type="date" value={filters.start_date} onChange={(event) => setFilters((current) => ({ ...current, start_date: event.target.value }))} className="min-h-10 rounded-xl border border-app px-3 text-sm" /><input aria-label="End date" type="date" value={filters.end_date} onChange={(event) => setFilters((current) => ({ ...current, end_date: event.target.value }))} className="min-h-10 rounded-xl border border-app px-3 text-sm" /></>}
      </div>
      {error && <div className="rounded-xl border border-[#FBD5D5] bg-[#FEF6F6] p-3 text-sm text-danger">{error}</div>}
      <div className="table-container">
        <table className="w-full min-w-[1250px]">
          <thead><tr className="bg-app-panel-muted">{["User", "Transactions", "Gross Sales", "Net Revenue", "Discount", "Profit", "Average Sale", "Last Sale", "Working Hours"].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-app-muted">{heading}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.user_id} className="border-t border-app"><td className="px-4 py-3"><div className="text-sm font-semibold">{row.name}</div><div className="text-xs text-app-muted">@{row.username} · {roleLabel(row.role)}</div></td><td className="px-4 py-3 font-mono text-sm">{row.total_transactions}</td><td className="px-4 py-3 font-mono text-sm">{formatMoney(row.total_sales)}</td><td className="px-4 py-3 font-mono text-sm">{formatMoney(row.total_revenue)}</td><td className="px-4 py-3 font-mono text-sm">{formatMoney(row.total_discount)}</td><td className={`px-4 py-3 font-mono text-sm ${row.total_profit >= 0 ? "text-success" : "text-danger"}`}>{formatMoney(row.total_profit)}</td><td className="px-4 py-3 font-mono text-sm">{formatMoney(row.average_sale)}</td><td className="px-4 py-3 text-xs text-app-muted">{lastSale(row.last_sale_at)}</td><td className="px-4 py-3 font-mono text-sm">{row.working_hours ? `${row.working_hours.toFixed(2)} h` : "—"}</td></tr>)}
            {loading && <tr><td colSpan={9} className="py-12 text-center text-sm text-app-muted">Loading report…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={9} className="py-12 text-center text-sm text-app-muted">No users found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
