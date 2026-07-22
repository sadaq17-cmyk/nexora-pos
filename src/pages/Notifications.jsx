import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Filter, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { isAdmin, isOwner } from "../lib/rbac";

const TYPE_LABELS = {
  low_stock: "Low stock",
  purchase: "Purchases",
  supplier_due: "Supplier due",
  subscription: "Subscription",
  staff: "Staff",
  login_failed: "Failed logins",
  sales: "Sales",
  system: "System",
};

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function Notifications() {
  const { user } = useAuth();
  const [result, setResult] = useState({ items: [], unread: 0 });
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const elevated = isOwner(user?.role) || isAdmin(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.notifications?.list?.().catch(() => ({ items: [], unread: 0 }));
    setResult({
      items: Array.isArray(data?.items) ? data.items : [],
      unread: Number(data?.unread || 0),
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return result.items;
    return result.items.filter((item) => item.type === typeFilter);
  }, [result.items, typeFilter]);

  const types = useMemo(() => {
    const set = new Set(result.items.map((item) => item.type).filter(Boolean));
    return [...set];
  }, [result.items]);

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <Bell size={22} className="text-brand" /> Notification Center
          </h1>
          <p className="mt-1 text-base text-app-muted">
            Operational alerts for stock, purchases, staff, subscription, and security.
            {!elevated && " Contact Owner/Admin for account-level alerts."}
          </p>
        </div>
        <button type="button" onClick={load} className="btn border border-app inline-flex items-center gap-2">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Filter size={14} className="text-app-muted" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="form-control w-auto">
          <option value="all">All types</option>
          {types.map((type) => (
            <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
          ))}
        </select>
        <span className="text-xs text-app-muted">{result.unread} unread · {filtered.length} shown</span>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="py-12 text-center text-sm text-app-muted">Loading notifications…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-app-muted">No notifications right now.</div>
        ) : (
          <ul className="divide-y divide-[var(--app-border)]">
            {filtered.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-app">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                      {TYPE_LABELS[item.type] || item.type || "Alert"}
                    </span>
                    <span className="text-sm font-semibold text-app-text">{item.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-app-muted">{item.body}</p>
                  <time className="mt-1 block text-[11px] text-app-muted">{fmt(item.created_at)}</time>
                </div>
                {item.href && (
                  <Link to={item.href} className="btn btn-ghost text-xs">Open</Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
