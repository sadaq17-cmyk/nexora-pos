import { useState, useEffect } from "react";
import { Plus, Building2, Phone, Users, X, Save, Trash2, FileText, CreditCard, Pencil } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const money = (n) => `Ksh ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const emptyForm = { name: "", contact_person: "", phone: "", category: "", status: "Active" };

export default function Suppliers() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [statementFor, setStatementFor] = useState(null);
  const [statement, setStatement] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");

  const load = async () => { setSuppliers(await api.suppliers.getAll()); setLoading(false); };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setModalOpen(true); };
  const openEdit = (s) => {
    setForm({ name: s.name, contact_person: s.contact_person || "", phone: s.phone || "", category: s.category || "", status: s.status || "Active" });
    setEditingId(s.id);
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Supplier name is required"); return; }
    const result = editingId
      ? await api.suppliers.update({ id: editingId, ...form })
      : await api.suppliers.create(form);
    if (result.success) {
      showToast(editingId ? "Supplier updated" : "Supplier added");
      setForm(emptyForm);
      setEditingId(null);
      setModalOpen(false);
      await load();
    } else showToast(result.error || "Could not save supplier");
  };

  const handleDelete = async (s) => {
    if (!confirm(`Remove "${s.name}"?`)) return;
    const result = await api.suppliers.delete(s.id);
    if (result.success) { showToast("Supplier removed"); await load(); }
    else showToast(result.error || "Could not remove supplier");
  };

  const openStatement = async (s) => {
    setStatementFor(s);
    setStatement(null);
    setStatement(await api.suppliers.getStatement(s.id));
  };

  const recordPayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) { showToast("Enter a valid amount"); return; }
    const result = await api.suppliers.addPayment({ supplier_id: statementFor.id, amount, method: "Bank Transfer" });
    if (result.success) {
      showToast("Payment recorded");
      setPaymentAmount("");
      await load();
      setStatement(await api.suppliers.getStatement(statementFor.id));
    } else showToast(result.error || "Could not record payment");
  };

  return (
    <div className="animate-fadein">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439]">Suppliers</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">Balances, payments, and purchase history for every vendor.</p>
        </div>
        {can("suppliers", "create") && (
          <button onClick={openAdd} className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 bg-[#2563EB]">
            <Plus size={15} /> Add Supplier
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-[#6B7690]">Loading suppliers…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {suppliers.map((s) => (
            <div key={s.id} className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3.5">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-[#EEF3FF]">
                  <Building2 size={19} className="text-[#2563EB]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[#1B2439] truncate">{s.name}</div>
                  <div className="text-xs text-[#6B7690]">{s.category}</div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium text-[#12A150] bg-[#E8FAEF]">{s.status}</span>
              </div>
              <div className="space-y-1.5 mb-3.5">
                <div className="flex items-center gap-2 text-xs text-[#6B7690]"><Users size={12} /> {s.contact_person || "—"}</div>
                <div className="flex items-center gap-2 text-xs text-[#6B7690]"><Phone size={12} /> {s.phone || "—"}</div>
              </div>
              <div className="pt-3 border-t border-[#E4E9F2] flex justify-between items-center mb-3">
                <div>
                  <div className="text-xs text-[#6B7690]">Total ordered</div>
                  <div className="font-semibold text-sm font-mono text-[#2563EB]">{money(s.total_ordered)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#6B7690]">Balance owed</div>
                  <div className="font-semibold text-sm font-mono" style={{ color: s.balance > 0 ? "#DC2626" : "#1B2439" }}>{money(s.balance)}</div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => openStatement(s)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-[#E4E9F2] text-xs font-medium text-[#1B2439]">
                  <FileText size={12} /> Statement
                </button>
                {can("suppliers", "edit") && (
                  <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg border border-[#E4E9F2] text-[#6B7690]"><Pencil size={13} /></button>
                )}
                {can("suppliers", "delete") && (
                  <button onClick={() => handleDelete(s)} className="p-1.5 rounded-lg border border-[#E4E9F2] text-[#DC2626]"><Trash2 size={13} /></button>
                )}
              </div>
            </div>
          ))}
          {suppliers.length === 0 && <div className="col-span-full text-center py-16 text-sm text-[#6B7690]">No suppliers yet.</div>}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1B2439]">{editingId ? "Edit Supplier" : "Add Supplier"}</h3>
              <button onClick={() => setModalOpen(false)} className="text-[#6B7690]"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <input required placeholder="Supplier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Contact person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Category (e.g. Beverages)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <button type="submit" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold bg-[#2563EB] hover:brightness-110">
                <Save size={15} /> {editingId ? "Save Changes" : "Save Supplier"}
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
                  <span className="font-bold font-mono text-[#1B2439]">{money(statement.supplier.balance)}</span>
                </div>

                {can("suppliers", "edit") && (
                  <div className="flex gap-2 mb-4">
                    <input type="number" placeholder="Payment amount" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="flex-1 border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
                    <button onClick={recordPayment} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#12A150]">
                      <CreditCard size={14} /> Record Payment
                    </button>
                  </div>
                )}

                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6B7690] mb-2">Purchase Orders</h4>
                <div className="space-y-1 mb-4">
                  {statement.purchases.map((p) => (
                    <div key={p.id} className="flex justify-between text-sm py-1 border-b border-[#F1F3F8]">
                      <span className="font-mono text-[#1B2439]">{p.po_number}</span>
                      <span className="text-[#6B7690]">{p.status}</span>
                      <span className="font-mono text-[#1B2439]">{money(p.total)}</span>
                    </div>
                  ))}
                  {statement.purchases.length === 0 && <div className="text-xs text-[#6B7690]">No purchase orders yet.</div>}
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
