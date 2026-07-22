import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Coins, History, Loader2, Plus, RefreshCw, Save, Star, ToggleLeft, ToggleRight,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  CURRENCIES,
  convertToBase,
  formatMoney,
  getCurrency,
} from "../lib/currency";
import { canAccessCurrencySettings, canManageBaseCurrency, isOwner } from "../lib/rbac";

function Toggle({ on, onClick, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="relative h-5 w-10 shrink-0 rounded-full transition duration-200 disabled:opacity-50"
      style={{ backgroundColor: on ? "var(--brand)" : "var(--app-border)" }}
    >
      <div
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all duration-200"
        style={{ left: on ? "22px" : "2px" }}
      />
    </button>
  );
}

const emptyForm = {
  code: "USD",
  name: "US Dollar",
  symbol: "$",
  decimal_places: 2,
  exchange_rate_to_base: "1",
  is_active: true,
};

export default function CurrenciesSettingsPanel() {
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const owner = isOwner(user?.role) || canManageBaseCurrency(user?.role);
  const canSettings = canAccessCurrencySettings(user?.role) && (can("currencies", "view") || can("settings", "view"));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [policy, setPolicy] = useState({
    enable_multi_currency: "true",
    admin_can_edit_rates: "false",
    report_currency: "KES",
    base_currency_code: "KES",
  });
  const [form, setForm] = useState(emptyForm);
  const [showAdd, setShowAdd] = useState(false);
  const [rateEdits, setRateEdits] = useState({});
  const [rateReasons, setRateReasons] = useState({});
  const [historyCode, setHistoryCode] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const baseCode = useMemo(
    () => rows.find((r) => r.is_base)?.code || policy.base_currency_code || "KES",
    [rows, policy.base_currency_code]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.currency.list();
      setRows(result?.currencies || []);
      if (result?.settings) setPolicy((p) => ({ ...p, ...result.settings }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canSettings) load();
  }, [canSettings, load]);

  const openHistory = async (code) => {
    setHistoryCode(code);
    setHistoryLoading(true);
    try {
      const rowsHist = await api.currency.getHistory({ code, limit: 50 });
      setHistory(Array.isArray(rowsHist) ? rowsHist : []);
    } finally {
      setHistoryLoading(false);
    }
  };

  const savePolicy = async (patch) => {
    if (!owner) {
      showToast("Only Owner can change currency policy");
      return;
    }
    setSaving(true);
    try {
      const result = await api.currency.setPolicy(patch);
      if (result?.success === false) {
        showToast(result.error || "Could not save policy");
        return;
      }
      setPolicy((p) => ({ ...p, ...(result.settings || patch) }));
      window.dispatchEvent(new CustomEvent("nexora:settings-updated", { detail: { settings: result.settings || patch } }));
      showToast("Currency policy saved");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const addCurrency = async (e) => {
    e.preventDefault();
    if (!can("currencies", "create") && !owner) {
      showToast("Permission denied");
      return;
    }
    setSaving(true);
    try {
      const result = await api.currency.create({
        ...form,
        exchange_rate_to_base: parseFloat(form.exchange_rate_to_base) || 1,
        reason: "Currency added",
      });
      if (result?.success) {
        showToast(`${form.code} added`);
        setShowAdd(false);
        setForm(emptyForm);
        await load();
      } else showToast(result?.error || "Could not add currency");
    } finally {
      setSaving(false);
    }
  };

  const saveRate = async (row) => {
    const next = parseFloat(rateEdits[row.code] ?? row.exchange_rate_to_base);
    if (!Number.isFinite(next) || next <= 0) {
      showToast("Enter a positive rate");
      return;
    }
    setSaving(true);
    try {
      const result = await api.currency.updateRate({
        code: row.code,
        exchange_rate_to_base: next,
        reason: rateReasons[row.code] || "Manual rate update",
      });
      if (result?.success) {
        showToast(`Rate updated for ${row.code}`);
        setRateEdits((m) => {
          const n = { ...m };
          delete n[row.code];
          return n;
        });
        await load();
      } else showToast(result?.error || "Could not update rate");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row) => {
    if (row.is_base) {
      showToast("Cannot deactivate base currency");
      return;
    }
    if (row.is_active && !owner) {
      showToast("Only Owner can deactivate currencies");
      return;
    }
    const result = await api.currency.update({
      id: row.id,
      is_active: !row.is_active,
    });
    if (result?.success) {
      showToast(row.is_active ? `${row.code} deactivated` : `${row.code} activated`);
      await load();
    } else showToast(result?.error || "Update failed");
  };

  const setBase = async (row) => {
    if (!owner) {
      showToast("Only Owner can set base currency");
      return;
    }
    if (!confirm(`Set ${row.code} as the company base currency? Existing rates are relative to base.`)) return;
    const result = await api.currency.setBase(row.code);
    if (result?.success) {
      showToast(`${row.code} is now the base currency`);
      window.dispatchEvent(new CustomEvent("nexora:settings-updated"));
      await load();
    } else showToast(result?.error || "Could not set base");
  };

  const setDefault = async (row) => {
    const result = await api.currency.setDefault(row.code);
    if (result?.success) {
      showToast(`${row.code} set as default`);
      await load();
    } else showToast(result?.error || "Could not set default");
  };

  const onCatalogPick = (code) => {
    const c = getCurrency(code);
    setForm((f) => ({
      ...f,
      code: c.code,
      name: c.name,
      symbol: c.symbol,
      decimal_places: c.decimals,
    }));
  };

  if (!canSettings) {
    return (
      <div className="rounded-xl border border-app bg-app-panel p-6 text-sm text-app-muted">
        Currency settings are available to Owner and Admin only.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-app-muted">
        <Loader2 size={16} className="animate-spin" /> Loading currencies…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="card-title flex items-center gap-2">
            <Coins size={18} className="text-brand" /> Multi-Currency
          </h2>
          <p className="mt-1 text-xs text-app-muted">
            Base currency: <span className="font-semibold text-app-text">{baseCode}</span>.
            Rates are “1 unit of currency = rate units of base”.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={saving}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-app-text">Policy</h3>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-app-panel-muted px-4 py-3">
          <div>
            <div className="text-sm font-medium text-app-text">Enable multi-currency</div>
            <div className="text-xs text-app-muted">Show currency pickers on payments, expenses, and reports.</div>
          </div>
          <Toggle
            on={policy.enable_multi_currency === "true" || policy.enable_multi_currency === true}
            disabled={!owner || saving}
            onClick={() =>
              savePolicy({
                enable_multi_currency:
                  policy.enable_multi_currency === "true" || policy.enable_multi_currency === true
                    ? "false"
                    : "true",
              })
            }
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-app-panel-muted px-4 py-3">
          <div>
            <div className="text-sm font-medium text-app-text">Allow Admin to edit exchange rates</div>
            <div className="text-xs text-app-muted">Owner always can. Admin needs this flag.</div>
          </div>
          <Toggle
            on={policy.admin_can_edit_rates === "true" || policy.admin_can_edit_rates === true}
            disabled={!owner || saving}
            onClick={() =>
              savePolicy({
                admin_can_edit_rates:
                  policy.admin_can_edit_rates === "true" || policy.admin_can_edit_rates === true
                    ? "false"
                    : "true",
              })
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-app-text">Report display currency</span>
            <select
              className="form-control w-full"
              value={policy.report_currency || baseCode}
              disabled={!owner || saving}
              onChange={(e) => savePolicy({ report_currency: e.target.value })}
            >
              {rows.filter((r) => r.is_active).map((r) => (
                <option key={r.code} value={r.code}>{r.code} — {r.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-app-text">Company currencies</h3>
          {(can("currencies", "create") || owner) && (
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd((v) => !v)}>
              <Plus size={14} /> Add currency
            </button>
          )}
        </div>

        {showAdd && (
          <form onSubmit={addCurrency} className="mb-4 grid gap-3 rounded-xl border border-app bg-app-panel-muted p-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium">Catalog</span>
              <select
                className="form-control w-full"
                value={form.code}
                onChange={(e) => onCatalogPick(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Name</span>
              <input className="form-control w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Symbol</span>
              <input className="form-control w-full" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Rate to {baseCode}</span>
              <input
                type="number"
                step="any"
                min="0.00000001"
                className="form-control w-full"
                value={form.exchange_rate_to_base}
                onChange={(e) => setForm({ ...form, exchange_rate_to_base: e.target.value })}
                required
              />
            </label>
            <div className="flex items-end">
              <button type="submit" className="btn btn-primary w-full" disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save currency
              </button>
            </div>
          </form>
        )}

        <table className="nx-table w-full text-sm">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Rate → {baseCode}</th>
              <th>Flags</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rateValue = rateEdits[row.code] ?? String(row.exchange_rate_to_base ?? 1);
              const sample = convertToBase(100, Number(rateValue) || 1);
              return (
                <tr key={row.id || row.code}>
                  <td className="font-mono font-semibold">
                    {row.code}
                    <div className="text-[10px] font-normal text-app-muted">{row.symbol}</div>
                  </td>
                  <td>{row.name}</td>
                  <td>
                    {row.is_base ? (
                      <span className="font-mono text-xs">1.00000000</span>
                    ) : (
                      <div className="space-y-1">
                        <input
                          type="number"
                          step="any"
                          min="0.00000001"
                          className="form-control w-full min-w-[120px] font-mono text-xs"
                          value={rateValue}
                          onChange={(e) => setRateEdits((m) => ({ ...m, [row.code]: e.target.value }))}
                          disabled={!can("currencies", "edit") && !owner}
                        />
                        <input
                          className="form-control w-full text-xs"
                          placeholder="Reason (optional)"
                          value={rateReasons[row.code] || ""}
                          onChange={(e) => setRateReasons((m) => ({ ...m, [row.code]: e.target.value }))}
                        />
                        <div className="text-[10px] text-app-muted">
                          100 {row.code} ≈ {formatMoney(sample, baseCode)}
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {row.is_base && <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-brand">BASE</span>}
                      {row.is_default && <span className="rounded bg-app-panel-muted px-1.5 py-0.5 text-[10px] font-semibold">DEFAULT</span>}
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${row.is_active ? "bg-[var(--success-soft)] text-success" : "bg-[var(--danger-soft)] text-danger"}`}>
                        {row.is_active ? "ACTIVE" : "OFF"}
                      </span>
                      {row.auto_update_enabled && <span className="rounded bg-app-panel-muted px-1.5 py-0.5 text-[10px]">AUTO</span>}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {!row.is_base && (can("currencies", "edit") || owner) && (
                        <button type="button" className="btn btn-secondary !px-2 !py-1 text-xs" disabled={saving} onClick={() => saveRate(row)}>
                          Save rate
                        </button>
                      )}
                      {!row.is_base && owner && (
                        <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => setBase(row)} title="Set as base">
                          <Star size={12} /> Base
                        </button>
                      )}
                      {row.is_active && !row.is_default && (
                        <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => setDefault(row)}>
                          Default
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleActive(row)} title={row.is_active ? "Deactivate" : "Activate"}>
                        {row.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      </button>
                      <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => openHistory(row.code)}>
                        <History size={12} /> History
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-app-muted">No currencies configured yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-app-muted">
          Auto exchange-rate updates can be toggled per currency (flag stored). Live provider fetch is stubbed — update rates manually or via API.
        </p>
      </div>

      {historyCode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog">
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl border border-app bg-app-panel p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Rate history — {historyCode}</h3>
              <button type="button" className="btn btn-ghost" onClick={() => setHistoryCode(null)}>Close</button>
            </div>
            {historyLoading ? (
              <div className="py-8 text-center text-sm text-app-muted"><Loader2 size={16} className="inline animate-spin" /> Loading…</div>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="rounded-xl border border-app px-3 py-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="font-mono">{h.old_rate ?? "—"} → {h.new_rate}</span>
                      <span className="text-app-muted">{h.created_at ? new Date(h.created_at).toLocaleString() : ""}</span>
                    </div>
                    <div className="mt-1 text-app-muted">
                      {h.changed_by_name || "System"}{h.reason ? ` · ${h.reason}` : ""}
                    </div>
                  </div>
                ))}
                {history.length === 0 && <div className="py-6 text-center text-app-muted">No rate changes recorded.</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
