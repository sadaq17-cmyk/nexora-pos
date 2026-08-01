import { useState, useEffect, useMemo } from "react";
import { ShieldCheck, Filter, Download, Search } from "lucide-react";
import { api } from "../lib/api";

const MODULES = ["", "auth", "products", "inventory", "customers", "suppliers", "purchases", "expenses", "sales", "settings", "users", "subscription", "roles"];

const actionColors = {
  login: ["#12A150", "#E8FAEF"],
  login_failed: ["#DC2626", "#FDECEC"],
  logout: ["#6B7690", "#F1F3F8"],
};

const ACTION_LABELS = {
  user_created: "User Created",
  user_updated: "User Updated",
  password_reset: "Password Reset",
  pin_reset: "PIN Reset",
  user_activated: "User Activated",
  user_deactivated: "User Deactivated",
  user_deleted: "User Deleted",
};

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function friendlyDetails(raw) {
  try {
    const details = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Object.entries(details || {})
      .map(([key, value]) => `${key.replace(/_/g, " ")}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
      .join(" · ");
  } catch {
    return raw;
  }
}

function parseDevice(row) {
  if (row.device || row.browser || row.os) {
    return [row.device, row.browser, row.os].filter(Boolean).join(" · ");
  }
  try {
    const details = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
    return [details?.device, details?.browser, details?.os].filter(Boolean).join(" · ") || "—";
  } catch {
    return "—";
  }
}

function parseIp(row) {
  if (row.ip) return row.ip;
  try {
    const details = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
    return details?.ip || "—";
  } catch {
    return "—";
  }
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [module, setModule] = useState("");
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (m) => {
    setLoading(true);
    try {
      const rows = await api.audit.getAll({ module: m || undefined, limit: 500 });
      setLogs(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (import.meta.env.DEV) console.error("[AuditLog] load failed", err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(module); }, [module]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((row) => {
      if (actionFilter && String(row.action || "") !== actionFilter) return false;
      if (!q) return true;
      return [
        row.user_name, row.action, row.module, row.details, row.ip, row.device, row.browser, row.os,
      ].some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [logs, query, actionFilter]);

  const actions = useMemo(() => [...new Set(logs.map((row) => row.action).filter(Boolean))].sort(), [logs]);

  const exportCsv = () => {
    const header = ["Time", "User", "Action", "Module", "IP", "Device", "Details", "Old", "New"];
    const lines = filtered.map((row) => [
      row.created_at,
      row.user_name || "System",
      row.action,
      row.module,
      parseIp(row),
      parseDevice(row),
      friendlyDetails(row.details),
      row.old_values ? JSON.stringify(row.old_values) : "",
      row.new_values ? JSON.stringify(row.new_values) : "",
    ].map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexora-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const rows = filtered.map((row) => ({
        Time: row.created_at,
        User: row.user_name || "System",
        Action: row.action,
        Module: row.module,
        IP: parseIp(row),
        Device: parseDevice(row),
        Details: friendlyDetails(row.details),
        Old: row.old_values ? JSON.stringify(row.old_values) : "",
        New: row.new_values ? JSON.stringify(row.new_values) : "",
      }));
      const sheet = XLSX.utils.json_to_sheet(rows);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Audit");
      XLSX.writeFile(book, `nexora-audit-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      exportCsv();
    }
  };

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title flex items-center gap-3"><ShieldCheck size={22} className="text-brand" /> Audit Log</h1>
          <p className="mt-1 text-base text-app-muted">Who · action · module · datetime · IP · device — with search and export.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportCsv} className="btn border border-app inline-flex items-center gap-1 text-xs"><Download size={14} /> CSV</button>
          <button type="button" onClick={exportExcel} className="btn border border-app inline-flex items-center gap-1 text-xs"><Download size={14} /> Excel</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search user, action, IP…" className="form-control w-full pl-9" />
        </div>
        <Filter size={14} className="text-app-muted" />
        <select value={module} onChange={(e) => setModule(e.target.value)} className="form-control w-auto">
          {MODULES.map((m) => <option key={m} value={m}>{m ? m[0].toUpperCase() + m.slice(1) : "All modules"}</option>)}
        </select>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="form-control w-auto">
          <option value="">All actions</option>
          {actions.map((action) => <option key={action} value={action}>{ACTION_LABELS[action] || action}</option>)}
        </select>
        <span className="text-xs text-app-muted">{filtered.length} entries</span>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="text-center py-10 text-sm text-app-muted">Loading audit log…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead><tr className="bg-app-panel-muted">
                {["Time", "User", "Action", "Module", "IP", "Device / Browser", "Details", "Change"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-app-muted text-left">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map((l) => {
                  const [color, bg] = actionColors[l.action] || ["#2563EB", "#EEF3FF"];
                  const details = friendlyDetails(l.details);
                  const change = [l.old_values ? `old: ${JSON.stringify(l.old_values)}` : "", l.new_values ? `new: ${JSON.stringify(l.new_values)}` : ""]
                    .filter(Boolean).join(" → ") || "—";
                  return (
                    <tr key={l.id} className="border-t border-app hover:bg-app-panel-muted">
                      <td className="px-4 py-2.5 text-xs font-mono text-app-muted whitespace-nowrap">{fmtDate(l.created_at)}</td>
                      <td className="px-4 py-2.5 text-sm text-app-text">{l.user_name || "System"}</td>
                      <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ color, backgroundColor: bg }}>{ACTION_LABELS[l.action] || String(l.action || "").replace(/_/g, " ")}</span></td>
                      <td className="px-4 py-2.5 text-sm text-app-muted capitalize">{l.module}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-app-muted">{parseIp(l)}</td>
                      <td className="px-4 py-2.5 text-xs text-app-muted">{parseDevice(l)}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-app-muted max-w-md truncate">{details}</td>
                      <td className="px-4 py-2.5 text-xs text-app-muted max-w-xs truncate">{change}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-sm text-app-muted">No audit entries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
