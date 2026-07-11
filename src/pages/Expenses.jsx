import { useState, useEffect } from "react";
import { Plus, Receipt, TrendingDown, Clock, X, Save, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const emptyForm = { name: "", category: "", amount: "", expense_date: new Date().toISOString().slice(0, 10) };

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: color + "1A" }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="text-2xl font-bold font-mono text-[#1B2439]">{value}</div>
      <div className="text-xs mt-1 text-[#6B7690]">{label}</div>
    </div>
  );
}

export default function Expenses() {
  const { showToast } = useToast();
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({ monthTotal: 0, byCategory: [] });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const [e, s] = await Promise.all([api.expenses.getAll(), api.expenses.getSummary()]);
    setExpenses(e); setSummary(s); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) { showToast("Name and amount are required"); return; }
    await api.expenses.create({ ...form, amount: parseFloat(form.amount) });
    showToast("Expense added");
    setForm(emptyForm);
    setModalOpen(false);
    await load();
  };

  const handleDelete = async (e) => {
    if (!confirm(`Delete "${e.name}"?`)) return;
    await api.expenses.delete(e.id);
    showToast("Expense deleted");
    await load();
  };

  const topCategory = [...summary.byCategory].sort((a, b) => b.total - a.total)[0];

  return (
    <div className="animate-fadein">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439]">Expenses</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">Track operating costs for this month.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 bg-[#2563EB]">
          <Plus size={15} /> Add Expense
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <StatCard icon={Receipt} label="Total This Month" value={money(summary.monthTotal)} color="#DC2626" />
        <StatCard icon={TrendingDown} label="Largest Category" value={topCategory?.category || "—"} color="#D97706" />
        <StatCard icon={Clock} label="Entries" value={expenses.length} color="#2563EB" />
      </div>

      <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="text-center py-10 text-sm text-[#6B7690]">Loading expenses…</div>
        ) : (
          <table className="w-full">
            <thead><tr className="bg-[#F3F6FB]">
              {["Expense", "Category", "Date", "Amount", "Actions"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-[#6B7690] text-left">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t border-[#E4E9F2] hover:bg-[#F8FAFD]">
                  <td className="px-4 py-3 text-sm font-medium text-[#1B2439]">{e.name}</td>
                  <td className="px-4 py-3 text-sm text-[#1B2439]">{e.category}</td>
                  <td className="px-4 py-3 text-sm text-[#6B7690]">{e.expense_date}</td>
                  <td className="px-4 py-3 text-sm font-semibold font-mono text-[#1B2439]">{money(e.amount)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(e)} className="p-1.5 rounded hover:bg-[#FDECEC] text-[#DC2626]"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-sm text-[#6B7690]">No expenses recorded yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1B2439]">Add Expense</h3>
              <button onClick={() => setModalOpen(false)} className="text-[#6B7690]"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <input required placeholder="Expense name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input required type="number" step="0.01" placeholder="Amount (Ksh)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <button type="submit" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold bg-[#2563EB] hover:brightness-110">
                <Save size={15} /> Save Expense
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
