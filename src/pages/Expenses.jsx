import { useState, useEffect } from "react";
import { Plus, Receipt, TrendingDown, Clock, X, Save, Trash2, Paperclip, FileCheck } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import CurrencyMoneyFields from "../components/CurrencyMoneyFields";
import { ListSkeleton } from "@/components/ui/skeleton";
const emptyForm = {
  name: "",
  category: "",
  amount: "",
  expense_date: new Date().toISOString().slice(0, 10),
  receipt_path: "",
  receipt_name: "",
  currency_code: "",
  exchange_rate: 1,
  original_amount: "",
};

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="nx-kpi">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: color + "1A" }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="nx-kpi-value">{value}</div>
      <div className="nx-kpi-label">{label}</div>
    </div>
  );
}

export default function Expenses() {
  const { formatMoney: money, currency } = useEnterpriseSettings();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState({ monthTotal: 0, byCategory: [] });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [newCategory, setNewCategory] = useState("");
  const [attaching, setAttaching] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [e, s, c] = await Promise.all([
        api.expenses.getAll().catch(() => []),
        api.expenses.getSummary().catch(() => ({})),
        api.expenses.getCategories().catch(() => []),
      ]);
      setExpenses(e || []);
      setSummary({
        monthTotal: Number(s?.monthTotal ?? s?.total ?? 0),
        byCategory: Array.isArray(s?.byCategory) ? s.byCategory : [],
      });
      setCategories(c || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    const amount = parseFloat(form.original_amount || form.amount);
    if (!form.name.trim() || !amount || !form.category) { showToast("Name, category, and amount are required"); return; }
    const result = await api.expenses.create({
      ...form,
      amount,
      original_amount: amount,
      currency_code: form.currency_code || currency?.code,
      exchange_rate: form.exchange_rate,
    });
    if (result.success) {
      showToast("Expense added");
      setForm(emptyForm);
      setModalOpen(false);
      await load();
    } else showToast(result.error || "Could not add expense");
  };

  const handleDelete = async (e) => {
    if (!confirm(`Delete "${e.name}"?`)) return;
    const result = await api.expenses.delete(e.id);
    if (result.success) { showToast("Expense deleted"); await load(); }
    else showToast(result.error || "Could not delete expense");
  };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    const result = await api.expenses.createCategory(newCategory.trim());
    if (result.success) {
      setCategories((c) => [...c, { id: result.id, name: newCategory.trim() }]);
      setForm((f) => ({ ...f, category: newCategory.trim() }));
      setNewCategory("");
    } else showToast(result.error || "Could not add category");
  };

  const attachReceipt = async () => {
    setAttaching(true);
    const result = await api.expenses.attachReceipt();
    setAttaching(false);
    if (result.canceled) return;
    if (result.success) {
      setForm((f) => ({ ...f, receipt_path: result.path, receipt_name: result.fileName }));
      showToast("Receipt attached");
    } else showToast(result.error || "Could not attach receipt");
  };

  const openReceipt = async (path) => {
    const result = await api.expenses.openReceipt(path);
    if (!result.success) showToast(result.error || "Could not open receipt");
  };

  const topCategory = [...(summary.byCategory || [])].sort((a, b) => b.total - a.total)[0];

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="mt-1 text-base text-app-muted">Daily expenses, categories, and monthly summaries.</p>
        </div>
        {can("expenses", "create") && (
          <button onClick={() => setModalOpen(true)} className="btn btn-primary">
            <Plus size={15} /> Add Expense
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <StatCard icon={Receipt} label="Total This Month" value={money(summary.monthTotal)} color="#DC2626" />
        <StatCard icon={TrendingDown} label="Largest Category" value={topCategory?.category || "—"} color="#D97706" />
        <StatCard icon={Clock} label="Entries" value={expenses.length} color="#2563EB" />
      </div>

      <div className="table-container">
        {loading ? (
          <ListSkeleton rows={6} />
        ) : (
          <table className="w-full">
            <thead><tr className="bg-app-panel-muted">
              {["Expense", "Category", "Date", "Receipt", "Amount", "Actions"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-app-muted text-left">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t border-app hover:bg-app-panel-muted">
                  <td className="px-4 py-3 text-sm font-medium text-app-text">{e.name}</td>
                  <td className="px-4 py-3 text-sm text-app-text">{e.category}</td>
                  <td className="px-4 py-3 text-sm text-app-muted">{e.expense_date}</td>
                  <td className="px-4 py-3">
                    {e.receipt_path ? (
                      <button onClick={() => openReceipt(e.receipt_path)} className="flex items-center gap-1 text-xs font-medium text-brand">
                        <FileCheck size={13} /> View
                      </button>
                    ) : <span className="text-xs text-app-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold font-mono text-app-text">{money(e.amount)}</td>
                  <td className="px-4 py-3">
                    {can("expenses", "delete") && (
                      <button onClick={() => handleDelete(e)} className="p-1.5 rounded hover:bg-[#FDECEC] text-danger"><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-sm text-app-muted">No expenses recorded yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="card-title">Add Expense</h3>
              <button onClick={() => setModalOpen(false)} className="text-app-muted"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <input required placeholder="Expense name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-app rounded-lg px-3 py-2 text-sm" />

              <div>
                <select required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-app rounded-lg px-3 py-2 text-sm mb-1.5">
                  <option value="">Select category…</option>
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <div className="flex gap-1.5">
                  <input placeholder="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="flex-1 border border-app rounded-lg px-2.5 py-1.5 text-xs" />
                  <button type="button" onClick={addCategory} className="px-3 py-1.5 rounded-lg border border-app text-xs font-medium text-brand">Add</button>
                </div>
              </div>

              <CurrencyMoneyFields
                value={{
                  original_amount: form.original_amount || form.amount,
                  payment_currency: form.currency_code || currency?.code,
                  exchange_rate: form.exchange_rate,
                  payment_date: form.expense_date,
                }}
                onChange={(fx) =>
                  setForm((f) => ({
                    ...f,
                    amount: fx.original_amount,
                    original_amount: fx.original_amount,
                    currency_code: fx.payment_currency,
                    exchange_rate: fx.exchange_rate,
                    expense_date: fx.payment_date || f.expense_date,
                  }))
                }
                amountLabel="Expense amount"
                showReference={false}
                showDate={false}
              />
              <input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className="w-full border border-app rounded-lg px-3 py-2 text-sm" />

              <button type="button" onClick={attachReceipt} disabled={attaching} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-app text-sm text-app-text">
                <Paperclip size={14} /> {form.receipt_name || (attaching ? "Opening…" : "Attach receipt (optional)")}
              </button>

              <button type="submit" className="btn btn-primary w-full">
                <Save size={15} /> Save Expense
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
