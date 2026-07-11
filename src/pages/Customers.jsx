import { useState, useEffect } from "react";
import { UserPlus, Phone, Mail, Star, X, Save, CreditCard, FileText, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const money = (n) => `Ksh ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const emptyForm = { name: "", phone: "", email: "", credit_limit: "0" };

export default function Customers() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [statementFor, setStatementFor] = useState(null);
  const [statement, setStatement] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");

  const load = async () => { setCustomers(await api.customers.getAll()); setLoading(false); };
  useEffect(() => { load(); }, []);

  const filtered = customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Customer name is required"); return; }
    const result = await api.customers.create({ ...form, credit_limit: parseFloat(form.credit_limit) || 0 });
    if (result.success) {
      showToast("Customer added");
      setForm(emptyForm);
      setModalOpen(false);
      await load();
    } else showToast(result.error || "Could not add customer");
  };

  const handleDelete = async (c) => {
    if (!confirm(`Delete "${c.name}"? This can't be undone.`)) return;
    const result = await api.customers.delete(c.id);
    if (result.success) { showToast("Customer deleted"); await load(); }
    else showToast(result.error || "Could not delete customer");
  };

  const openStatement = async (c) => {
    setStatementFor(c);
    setStatement(null);
    const data = await api.customers.getStatement(c.id);
    setStatement(data);
  };

  const recordPayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) { showToast("Enter a valid amount"); return; }
    const result = await api.customers.addPayment({ customer_id: statementFor.id, amount, method: "Cash" });
    if (result.success) {
      showToast("Payment recorded");
      setPaymentAmount("");
      await load();
      const data = await api.customers.getStatement(statementFor.id);
      setStatement(data);
    } else showToast(result.error || "Could not record payment");
  };

  return (
    <div className="animate-fadein">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439]">Customers</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">Credit accounts, loyalty points, and purchase history.</p>
        </div>
        {can("customers", "create") && (
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 bg-[#2563EB]">
            <UserPlus size={15} /> Add Customer
          </button>
        )}
      </div>

      <input
        value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…"
        className="mb-4 px-3 py-2 rounded-lg border border-[#E4E9F2] text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
      />

      {loading ? (
        <div className="text-center py-16 text-sm text-[#6B7690]">Loading customers…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const overLimit = c.credit_limit > 0 && c.balance > c.credit_limit;
            return (
              <div key={c.id} className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-3.5">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold bg-[#2563EB]">
                    {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-[#1B2439] truncate">{c.name}</div>
                    <div className="text-xs flex items-center gap-1 text-[#6B7690]"><Star size={11} className="text-amber-400 fill-amber-400" /> {c.points || 0} points</div>
                  </div>
                </div>
                <div className="space-y-1.5 mb-3.5">
                  {c.phone && <div className="flex items-center gap-2 text-xs text-[#6B7690]"><Phone size={12} /> {c.phone}</div>}
                  {c.email && <div className="flex items-center gap-2 text-xs text-[#6B7690]"><Mail size={12} /> {c.email}</div>}
                </div>
                <div className="flex justify-between pt-3 border-t border-[#E4E9F2] mb-3">
                  <div>
                    <div className="text-xs text-[#6B7690]">Total spent</div>
                    <div className="font-semibold text-sm font-mono text-[#2563EB]">{money(c.spent)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[#6B7690]">Credit balance</div>
                    <div className="font-semibold text-sm font-mono" style={{ color: overLimit ? "#DC2626" : "#1B2439" }}>{money(c.balance)}</div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => openStatement(c)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-[#E4E9F2] text-xs font-medium text-[#1B2439]">
                    <FileText size={12} /> Statement
                  </button>
                  {can("customers", "delete") && (
                    <button onClick={() => handleDelete(c)} className="p-1.5 rounded-lg border border-[#E4E9F2] text-[#DC2626]"><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="col-span-full text-center py-16 text-sm text-[#6B7690]">No customers found.</div>}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1B2439]">Add Customer</h3>
              <button onClick={() => setModalOpen(false)} className="text-[#6B7690]"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <input required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <div>
                <label className="text-xs font-medium text-[#1B2439] mb-1 block">Credit limit (Ksh)</label>
                <input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              </div>
              <button type="submit" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold bg-[#2563EB] hover:brightness-110">
                <Save size={15} /> Save Customer
              </button>
            </form>
          </div>
        </div>
      )}

      {statementFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setStatementFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1B2439]">{statementFor.name} — Statement</h3>
              <button onClick={() => setStatementFor(null)} className="text-[#6B7690]"><X size={18} /></button>
            </div>
            {!statement ? (
              <div className="text-center py-8 text-sm text-[#6B7690]">Loading…</div>
            ) : (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-[#F3F6FB] mb-4">
                  <span className="text-sm text-[#6B7690]">Current balance owed</span>
                  <span className="font-bold font-mono text-[#1B2439]">{money(statement.customer.balance)}</span>
                </div>

                {can("customers", "edit") && (
                  <div className="flex gap-2 mb-4">
                    <input type="number" placeholder="Payment amount" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="flex-1 border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
                    <button onClick={recordPayment} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#12A150]">
                      <CreditCard size={14} /> Record Payment
                    </button>
                  </div>
                )}

                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6B7690] mb-2">Purchases</h4>
                <div className="space-y-1 mb-4">
                  {statement.sales.map((s) => (
                    <div key={s.id} className="flex justify-between text-sm py-1 border-b border-[#F1F3F8]">
                      <span className="font-mono text-[#1B2439]">{s.invoice_no}</span>
                      <span className="text-[#6B7690]">{s.payment_method}</span>
                      <span className="font-mono text-[#1B2439]">{money(s.total)}</span>
                    </div>
                  ))}
                  {statement.sales.length === 0 && <div className="text-xs text-[#6B7690]">No purchases yet.</div>}
                </div>

                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6B7690] mb-2">Payments</h4>
                <div className="space-y-1">
                  {statement.payments.map((p) => (
                    <div key={p.id} className="flex justify-between text-sm py-1 border-b border-[#F1F3F8]">
                      <span className="text-[#6B7690]">{String(p.created_at).slice(0, 10)}</span>
                      <span className="text-[#6B7690]">{p.method}</span>
                      <span className="font-mono text-[#12A150]">-{money(p.amount)}</span>
                    </div>
                  ))}
                  {statement.payments.length === 0 && <div className="text-xs text-[#6B7690]">No payments recorded yet.</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
