import { useState, useEffect } from "react";
import { Plus, Building2, Phone, Users, X, Save, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const emptyForm = { name: "", contact_person: "", phone: "", category: "", status: "Active" };

export default function Suppliers() {
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = async () => { setSuppliers(await api.suppliers.getAll()); setLoading(false); };
  useEffect(() => { load(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Supplier name is required"); return; }
    await api.suppliers.create(form);
    showToast("Supplier added");
    setForm(emptyForm);
    setModalOpen(false);
    await load();
  };

  const handleDelete = async (s) => {
    if (!confirm(`Remove "${s.name}"?`)) return;
    await api.suppliers.delete(s.id);
    showToast("Supplier removed");
    await load();
  };

  return (
    <div className="animate-fadein">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439]">Suppliers</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">Manage the vendors that stock your shelves.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 bg-[#2563EB]">
          <Plus size={15} /> Add Supplier
        </button>
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
              <div className="pt-3 border-t border-[#E4E9F2] flex justify-between items-center">
                <div>
                  <div className="text-xs text-[#6B7690]">Purchase orders</div>
                  <div className="font-semibold text-sm text-[#1B2439]">{s.order_count}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#6B7690]">Total ordered</div>
                  <div className="font-semibold text-sm font-mono text-[#2563EB]">{money(s.total_ordered)}</div>
                </div>
                <button onClick={() => handleDelete(s)} className="p-1.5 rounded hover:bg-[#FDECEC] text-[#DC2626]"><Trash2 size={14} /></button>
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
              <h3 className="font-semibold text-[#1B2439]">Add Supplier</h3>
              <button onClick={() => setModalOpen(false)} className="text-[#6B7690]"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <input required placeholder="Supplier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Contact person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Category (e.g. Beverages)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <button type="submit" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold bg-[#2563EB] hover:brightness-110">
                <Save size={15} /> Save Supplier
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
