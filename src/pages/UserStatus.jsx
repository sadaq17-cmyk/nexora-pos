import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Radio, RadioTower } from "lucide-react";
import { api } from "../lib/api";
import { roleLabel } from "../lib/rbac";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";

const when = (value) => value ? new Date(value).toLocaleString() : "—";

export default function UserStatus() {
  const { formatMoney } = useEnterpriseSettings();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.users.getStatus();
      setRows(Array.isArray(result) ? result : []);
    } catch {
      setError("Could not load user activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="animate-fadein space-y-5">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">User Status</h1>
          <p className="text-sm text-app-muted">Online means this browser recorded activity within the last five minutes.</p>
        </div>
        <button onClick={load} disabled={loading} className="btn btn-secondary"><RefreshCw size={16} /> Refresh</button>
      </div>
      {error && <div className="rounded-xl border border-[#FBD5D5] bg-[#FEF6F6] p-3 text-sm text-danger">{error}</div>}
      <div className="table-container">
        <table className="w-full min-w-[1300px]">
          <thead><tr className="bg-app-panel-muted">{["User", "Role / Branch", "Account", "Presence", "Login Time", "Last Activity", "Last Sale", "Sales Today", "Sales Month", "Revenue Today", "Revenue Month"].map((label) => <th key={label} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-app-muted">{label}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.id} className="border-t border-app">
              <td className="px-4 py-3"><div className="text-sm font-semibold text-app-text">{row.name}</div><div className="font-mono text-xs text-app-muted">@{row.username}</div></td>
              <td className="px-4 py-3 text-sm"><div>{roleLabel(row.role)}</div><div className="text-xs text-app-muted">{row.branch_name}</div></td>
              <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.active ? "bg-[#E8FAEF] text-success" : "bg-[#F1F3F8] text-app-muted"}`}>{row.active ? "Active" : "Inactive"}</span></td>
              <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${row.online ? "text-success" : "text-danger"}`}>{row.online ? <RadioTower size={14} /> : <Radio size={14} />}{row.online ? "Online" : "Offline"}</span></td>
              <td className="px-4 py-3 text-xs text-app-muted">{when(row.login_at)}</td>
              <td className="px-4 py-3 text-xs text-app-muted">{when(row.last_activity_at)}</td>
              <td className="px-4 py-3 text-xs text-app-muted">{when(row.last_sale_at)}</td>
              <td className="px-4 py-3 font-mono text-sm">{row.transactions_today}</td>
              <td className="px-4 py-3 font-mono text-sm">{row.transactions_month}</td>
              <td className="px-4 py-3 font-mono text-sm">{formatMoney(row.sales_today)}</td>
              <td className="px-4 py-3 font-mono text-sm">{formatMoney(row.sales_month)}</td>
            </tr>)}
            {loading && <tr><td colSpan={11} className="py-12 text-center text-sm text-app-muted">Loading activity…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={11} className="py-12 text-center text-sm text-app-muted">No users to display.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
