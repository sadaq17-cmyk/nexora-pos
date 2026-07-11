import { useState, useEffect } from "react";
import { ShieldCheck, Filter } from "lucide-react";
import { api } from "../lib/api";

const MODULES = ["", "auth", "products", "inventory", "customers", "suppliers", "purchases", "expenses", "sales", "settings", "users"];

const actionColors = {
  login: ["#12A150", "#E8FAEF"], login_failed: ["#DC2626", "#FDECEC"], logout: ["#6B7690", "#F1F3F8"],
};

function fmtDate(ts) {
  return new Date(ts.replace(" ", "T") + "Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [module, setModule] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (m) => {
    setLoading(true);
    const rows = await api.audit.getAll({ module: m || undefined, limit: 300 });
    setLogs(Array.isArray(rows) ? rows : []);
    setLoading(false);
  };

  useEffect(() => { load(module); }, [module]);

  return (
    <div className="animate-fadein">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439] flex items-center gap-2"><ShieldCheck size={22} className="text-[#2563EB]" /> Audit Log</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">Every tracked action: logins, sales, stock adjustments, and record changes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[#6B7690]" />
          <select value={module} onChange={(e) => setModule(e.target.value)} className="border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm">
            {MODULES.map((m) => <option key={m} value={m}>{m ? m[0].toUpperCase() + m.slice(1) : "All modules"}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="text-center py-10 text-sm text-[#6B7690]">Loading audit log…</div>
        ) : (
          <table className="w-full">
            <thead><tr className="bg-[#F3F6FB]">
              {["Time", "User", "Action", "Module", "Details"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-[#6B7690] text-left">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {logs.map((l) => {
                const [color, bg] = actionColors[l.action] || ["#2563EB", "#EEF3FF"];
                let details = l.details;
                try { details = JSON.stringify(JSON.parse(l.details)); } catch { /* plain string */ }
                return (
                  <tr key={l.id} className="border-t border-[#E4E9F2] hover:bg-[#F8FAFD]">
                    <td className="px-4 py-2.5 text-xs font-mono text-[#6B7690] whitespace-nowrap">{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-2.5 text-sm text-[#1B2439]">{l.user_name || "System"}</td>
                    <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ color, backgroundColor: bg }}>{l.action}</span></td>
                    <td className="px-4 py-2.5 text-sm text-[#6B7690] capitalize">{l.module}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-[#6B7690] max-w-md truncate">{details}</td>
                  </tr>
                );
              })}
              {logs.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-sm text-[#6B7690]">No audit entries yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
