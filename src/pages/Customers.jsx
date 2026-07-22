import { useState, useEffect, useMemo } from "react";
import {
  UserPlus, Phone, Mail, Star, X, Save, CreditCard, FileText, Trash2, Pencil,
  Search, Users, Wallet, MapPin, LayoutGrid, List, Plus, Minus,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ListSkeleton } from "@/components/ui/skeleton";
import { DEFAULT_PAGE_SIZE } from "../lib/requestCache";
const emptyForm = { name: "", phone: "", email: "", address: "", credit_limit: "0" };
const PAYMENT_METHODS = ["Cash", "M-Pesa", "Card", "Bank Transfer"];

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="nx-kpi">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: color + "1A" }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="nx-kpi-value truncate">{value}</div>
      <div className="nx-kpi-label">{label}</div>
    </div>
  );
}

function initials(name) {
  return String(name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function Customers() {
  const { formatMoney: money, formatMoneyForCurrency, currency } = useEnterpriseSettings();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("cards");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [detailFor, setDetailFor] = useState(null);
  const [statement, setStatement] = useState(null);
  const [detailTab, setDetailTab] = useState("history");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [pointsDelta, setPointsDelta] = useState("10");

  const load = async () => {
    setLoading(true);
    try {
      setCustomers(await api.customers.getAll().catch(() => []));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => customers.filter((c) => {
    const q = debouncedSearch.toLowerCase().trim();
    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.address || "").toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (filter === "credit") return Number(c.credit_limit) > 0;
    if (filter === "balance") return Number(c.balance) > 0;
    if (filter === "loyalty" || filter === "points") return Number(c.points) > 0;
    return true;
  }), [customers, debouncedSearch, filter]);

  const pageSize = DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const paged = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filter]);

  const stats = {
    total: customers.length,
    points: customers.reduce((s, c) => s + Number(c.points || 0), 0),
    outstanding: customers.reduce((s, c) => s + Number(c.balance || 0), 0),
    spent: customers.reduce((s, c) => s + Number(c.spent || 0), 0),
  };

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setModalOpen(true); };
  const openEdit = (c) => {
    setForm({
      name: c.name,
      phone: c.phone || "",
      email: c.email || "",
      address: c.address || "",
      credit_limit: String(c.credit_limit || 0),
    });
    setEditingId(c.id);
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Customer name is required"); return; }
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      credit_limit: parseFloat(form.credit_limit) || 0,
    };
    const result = editingId
      ? await api.customers.update({ id: editingId, ...payload })
      : await api.customers.create(payload);
    if (result.success) {
      showToast(editingId ? "Customer updated" : "Customer added");
      setForm(emptyForm);
      setEditingId(null);
      setModalOpen(false);
      await load();
      if (detailFor && editingId === detailFor.id) {
        const updated = (await api.customers.getAll()).find((c) => c.id === editingId);
        if (updated) setDetailFor(updated);
      }
    } else showToast(result.error || "Could not save customer");
  };

  const handleDelete = async (c) => {
    if (!confirm(`Delete "${c.name}"? This can't be undone.`)) return;
    const result = await api.customers.delete(c.id);
    if (result.success) {
      showToast("Customer deleted");
      if (detailFor?.id === c.id) { setDetailFor(null); setStatement(null); }
      await load();
    } else showToast(result.error || "Could not delete customer");
  };

  const openDetail = async (c, tab = "history") => {
    setDetailFor(c);
    setDetailTab(tab);
    setStatement(null);
    setPaymentAmount("");
    setPointsDelta("10");
    const data = await api.customers.getStatement(c.id);
    setStatement(data);
    if (data?.customer) setDetailFor(data.customer);
  };

  const refreshDetail = async () => {
    if (!detailFor) return;
    await load();
    const data = await api.customers.getStatement(detailFor.id);
    setStatement(data);
    if (data?.customer) setDetailFor(data.customer);
  };

  const recordPayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) { showToast("Enter a valid amount"); return; }
    const result = await api.customers.addPayment({
      customer_id: detailFor.id,
      amount,
      method: paymentMethod,
    });
    if (result.success) {
      showToast("Payment recorded");
      setPaymentAmount("");
      await refreshDetail();
    } else showToast(result.error || "Could not record payment");
  };

  const adjustPoints = async (delta) => {
    const result = await api.customers.adjustPoints({
      customer_id: detailFor.id,
      delta,
      note: delta > 0 ? "Manual points credit" : "Manual points debit",
    });
    if (result.success) {
      showToast(`Loyalty points ${delta > 0 ? "added" : "removed"}`);
      await refreshDetail();
    } else showToast(result.error || "Could not adjust points");
  };

  return (
    <div className="animate-fadein">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="mt-1 text-base text-app-muted">Credit accounts, loyalty points, and purchase history.</p>
        </div>
        {can("customers", "create") && (
          <button onClick={openAdd} className="btn btn-primary shrink-0">
            <UserPlus size={15} /> Add Customer
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <StatCard icon={Users} label="Total Customers" value={stats.total} color="#2563EB" />
        <StatCard icon={Star} label="Loyalty Points" value={stats.points.toLocaleString()} color="#F59E0B" />
        <StatCard icon={Wallet} label="Credit Outstanding" value={money(stats.outstanding)} color="#DC2626" />
        <StatCard icon={CreditCard} label="Lifetime Spent" value={money(stats.spent)} color="#12A150" />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email, address…"
            className="form-control w-full pl-10"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "all", label: "All" },
            { id: "credit", label: "Credit enabled" },
            { id: "balance", label: "Outstanding" },
            { id: "loyalty", label: "With points" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filter === f.id
                  ? "bg-brand text-white border-brand"
                  : "bg-white text-app-muted border-app hover:bg-app-panel-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="flex rounded-lg border border-app overflow-hidden ml-auto sm:ml-0">
            <button onClick={() => setView("cards")} className={`p-2 ${view === "cards" ? "bg-[#EEF3FF] text-brand" : "bg-white text-app-muted"}`} title="Cards">
              <LayoutGrid size={15} />
            </button>
            <button onClick={() => setView("table")} className={`p-2 border-l border-app ${view === "table" ? "bg-[#EEF3FF] text-brand" : "bg-white text-app-muted"}`} title="Table">
              <List size={15} />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={6} />
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {paged.map((c) => {
            const overLimit = c.credit_limit > 0 && c.balance > c.credit_limit;
            return (
              <div key={c.id} className="card hover:shadow-card-hover transition-shadow">
                <div className="flex items-center gap-3 mb-3.5">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold bg-brand shrink-0">
                    {initials(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-app-text truncate">{c.name}</div>
                    <div className="text-xs flex items-center gap-1 text-app-muted">
                      <Star size={11} className="text-amber-400 fill-amber-400" /> {c.points || 0} points · {c.visits || 0} visits
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5 mb-3.5">
                  {c.phone && <div className="flex items-center gap-2 text-xs text-app-muted"><Phone size={12} className="shrink-0" /> {c.phone}</div>}
                  {c.email && <div className="flex items-center gap-2 text-xs text-app-muted truncate"><Mail size={12} className="shrink-0" /> {c.email}</div>}
                  {c.address && <div className="flex items-start gap-2 text-xs text-app-muted"><MapPin size={12} className="shrink-0 mt-0.5" /> {c.address}</div>}
                </div>
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-app mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-app-muted">Spent</div>
                    <div className="font-semibold text-xs font-mono text-brand">{money(c.spent)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-app-muted">Limit</div>
                    <div className="font-semibold text-xs font-mono text-app-text">{c.credit_limit > 0 ? money(c.credit_limit) : "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-app-muted">Balance</div>
                    <div className="font-semibold text-xs font-mono" style={{ color: overLimit ? "#DC2626" : "#1B2439" }}>{money(c.balance)}</div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => openDetail(c)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-app text-xs font-medium text-app-text hover:bg-app-panel-muted">
                    <FileText size={12} /> Details
                  </button>
                  {can("customers", "edit") && (
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg border border-app text-app-muted hover:bg-app-panel-muted"><Pencil size={13} /></button>
                  )}
                  {can("customers", "delete") && (
                    <button onClick={() => handleDelete(c)} className="p-1.5 rounded-lg border border-app text-danger hover:bg-[#FEF6F6]"><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="col-span-full text-center py-16 text-sm text-app-muted">No customers found.</div>}
        </div>
      ) : (
        <div className="table-container">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-app-panel-muted">
                {["Customer", "Contact", "Points", "Credit limit", "Balance", "Spent", "Actions"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-app-muted ${i >= 2 && i <= 5 ? "text-right" : i === 6 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => {
                const overLimit = c.credit_limit > 0 && c.balance > c.credit_limit;
                return (
                  <tr key={c.id} className="border-t border-app hover:bg-app-panel-muted">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold bg-brand">{initials(c.name)}</div>
                        <div>
                          <div className="text-sm font-medium text-app-text">{c.name}</div>
                          <div className="text-xs text-app-muted truncate max-w-[180px]">{c.address || "No address"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-app-muted">
                      <div>{c.phone || "—"}</div>
                      <div className="truncate max-w-[160px]">{c.email || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-app-text">{c.points || 0}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-app-text">{c.credit_limit > 0 ? money(c.credit_limit) : "—"}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono font-medium" style={{ color: overLimit ? "#DC2626" : "#1B2439" }}>{money(c.balance)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono text-brand">{money(c.spent)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openDetail(c)} className="p-1.5 rounded hover:bg-[#F1F3F8] mr-1 text-app-muted" title="Details"><FileText size={14} /></button>
                      {can("customers", "edit") && <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-[#F1F3F8] mr-1 text-app-muted"><Pencil size={14} /></button>}
                      {can("customers", "delete") && <button onClick={() => handleDelete(c)} className="p-1.5 rounded hover:bg-[#FDECEC] text-danger"><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-sm text-app-muted">No customers found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length > pageSize ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-app-muted">
          <span>
            Showing {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <button type="button" className="btn btn-secondary" disabled={pageSafe >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              Next
            </button>
          </div>
        </div>
      ) : null}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 animate-fadein" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="card-title">{editingId ? "Edit Customer" : "Add Customer"}</h3>
              <button onClick={() => setModalOpen(false)} className="text-app-muted"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-app-text mb-1 block">Full name</label>
                <input required placeholder="Customer name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-app rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Phone</label>
                  <input placeholder="+254 …" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-app rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Email</label>
                  <input type="email" placeholder="email@…" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-app rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-app-text mb-1 block">Address</label>
                <input placeholder="Street, city" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full border border-app rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-app-text mb-1 block">Credit limit ({currency.code} {currency.symbol})</label>
                <input type="number" min="0" step="0.01" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} className="w-full border border-app rounded-lg px-3 py-2 text-sm" />
              </div>
              <button type="submit" className="btn btn-primary w-full">
                <Save size={15} /> {editingId ? "Save Changes" : "Save Customer"}
              </button>
            </form>
          </div>
        </div>
      )}

      {detailFor && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={() => { setDetailFor(null); setStatement(null); }}>
          <div className="bg-white w-full max-w-lg h-full shadow-xl animate-slidein overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-app px-5 py-4 flex items-start justify-between z-10">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold bg-brand shrink-0">
                  {initials(detailFor.name)}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-app-text truncate">{detailFor.name}</h3>
                  <div className="text-xs text-app-muted flex items-center gap-1 mt-0.5">
                    <Star size={11} className="text-amber-400 fill-amber-400" /> {detailFor.points || 0} points
                  </div>
                </div>
              </div>
              <button onClick={() => { setDetailFor(null); setStatement(null); }} className="text-app-muted p-1"><X size={18} /></button>
            </div>

            <div className="px-5 py-4 space-y-1.5 text-xs text-app-muted border-b border-app">
              {detailFor.phone && <div className="flex items-center gap-2"><Phone size={12} /> {detailFor.phone}</div>}
              {detailFor.email && <div className="flex items-center gap-2"><Mail size={12} /> {detailFor.email}</div>}
              {detailFor.address && <div className="flex items-start gap-2"><MapPin size={12} className="mt-0.5" /> {detailFor.address}</div>}
            </div>

            <div className="grid grid-cols-3 gap-3 px-5 py-4">
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-app-muted">Balance</div>
                <div className="font-bold font-mono text-sm text-app-text mt-1">{money(detailFor.balance)}</div>
              </div>
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-app-muted">Credit limit</div>
                <div className="font-bold font-mono text-sm text-app-text mt-1">{detailFor.credit_limit > 0 ? money(detailFor.credit_limit) : "—"}</div>
              </div>
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-app-muted">Total spent</div>
                <div className="font-bold font-mono text-sm text-brand mt-1">{money(detailFor.spent)}</div>
              </div>
            </div>

            <div className="px-5 flex gap-1 border-b border-app">
              {[
                { id: "history", label: "Purchases" },
                { id: "payments", label: "Payments" },
                { id: "loyalty", label: "Loyalty" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setDetailTab(tab.id)}
                  className={`px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    detailTab === tab.id ? "border-brand text-brand" : "border-transparent text-app-muted"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="px-5 py-4">
              {!statement ? (
                <div className="text-center py-8 text-sm text-app-muted">Loading…</div>
              ) : detailTab === "history" ? (
                <div className="space-y-2">
                  {statement.sales.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-[#F1F3F8]">
                      <div className="min-w-0">
                        <div className="font-mono text-sm text-app-text">{s.invoice_no}</div>
                        <div className="text-xs text-app-muted">{String(s.created_at || "").slice(0, 10)} · {s.payment_method}</div>
                      </div>
                      <div className="font-mono text-sm font-medium text-app-text shrink-0">{formatMoneyForCurrency(s.total, s.currency_code)}</div>
                    </div>
                  ))}
                  {statement.sales.length === 0 && <div className="text-sm text-app-muted py-6 text-center">No purchases yet.</div>}
                </div>
              ) : detailTab === "payments" ? (
                <>
                  {can("customers", "edit") && (
                    <div className="flex flex-col sm:flex-row gap-2 mb-4 p-3 rounded-xl bg-app-panel-muted">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={`Amount (${currency.code} ${currency.symbol})`}
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className="flex-1 border border-app rounded-lg px-3 py-2 text-sm bg-white"
                      />
                      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="border border-app rounded-lg px-3 py-2 text-sm bg-white">
                        {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <button onClick={recordPayment} className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#12A150] hover:brightness-110">
                        <CreditCard size={14} /> Record
                      </button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {statement.payments.map((p) => (
                      <div key={p.id} className="flex justify-between text-sm py-2.5 border-b border-[#F1F3F8]">
                        <div>
                          <div className="text-app-text">{p.method}</div>
                          <div className="text-xs text-app-muted">{String(p.created_at).slice(0, 10)}</div>
                        </div>
                        <span className="font-mono text-success">-{money(p.amount)}</span>
                      </div>
                    ))}
                    {statement.payments.length === 0 && <div className="text-sm text-app-muted py-6 text-center">No payments recorded yet.</div>}
                  </div>
                </>
              ) : (
                <div>
                  <div className="rounded-xl border border-app p-4 mb-4 text-center">
                    <div className="text-xs text-app-muted mb-1">Current loyalty balance</div>
                    <div className="text-3xl font-bold font-mono text-app-text flex items-center justify-center gap-2">
                      <Star size={22} className="text-amber-400 fill-amber-400" />
                      {detailFor.points || 0}
                    </div>
                    <div className="text-xs text-app-muted mt-2">{detailFor.visits || 0} store visits</div>
                  </div>
                  {can("customers", "edit") && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => adjustPoints(-(parseInt(pointsDelta, 10) || 0))} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-app text-sm font-medium text-danger hover:bg-[#FEF6F6]">
                        <Minus size={14} /> Remove
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={pointsDelta}
                        onChange={(e) => setPointsDelta(e.target.value)}
                        className="w-20 border border-app rounded-lg px-3 py-2 text-sm text-center font-mono"
                      />
                      <button onClick={() => adjustPoints(parseInt(pointsDelta, 10) || 0)} className="btn btn-primary flex-1">
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
