import { useState, useEffect } from "react";
import { UserPlus, Phone, Mail, Star, X, Save } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Customers() {
  const { showToast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [loading, setLoading] = useState(true);

  const load = async () => { setCustomers(await api.customers.getAll()); setLoading(false); };
  useEffect(() => { load(); }, []);

  const filtered = customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Customer name is required"); return; }
    await api.customers.create(form);
    showToast("Customer added");
    setForm({ name: "", phone: "", email: "" });
    setModalOpen(false);
    await load();
  };

  return (
    <div className="animate-fadein">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439]">Customers</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">View customer profiles, spend history, and loyalty points.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 bg-[#2563EB]">
          <UserPlus size={15} /> Add Customer
        </button>
      </div>

      <input
        value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…"
        className="mb-4 px-3 py-2 rounded-lg border border-[#E4E9F2] text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
      />

      {loading ? (
        <div className="text-center py-16 text-sm text-[#6B7690]">Loading customers…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div key={c.id} className="bg-white border border-[#E4E9F2] rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-3.5">
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold bg-[#2563EB]">
                  {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
                <div>
                  <div className="font-semibold text-sm text-[#1B2439]">{c.name}</div>
                  <div className="text-xs flex items-center gap-1 text-[#6B7690]"><Star size={11} className="text-amber-400 fill-amber-400" /> {c.points || 0} points</div>
                </div>
              </div>
              <div className="space-y-1.5 mb-3.5">
                {c.phone && <div className="flex items-center gap-2 text-xs text-[#6B7690]"><Phone size={12} /> {c.phone}</div>}
                {c.email && <div className="flex items-center gap-2 text-xs text-[#6B7690]"><Mail size={12} /> {c.email}</div>}
              </div>
              <div className="flex justify-between pt-3 border-t border-[#E4E9F2]">
                <div>
                  <div className="text-xs text-[#6B7690]">Total spent</div>
                  <div className="font-semibold text-sm font-mono text-[#2563EB]">{money(c.spent || 0)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#6B7690]">Visits</div>
                  <div className="font-semibold text-sm text-[#1B2439]">{c.visits || 0}</div>
                </div>
              </div>
            </div>
          ))}
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
              <button type="submit" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold bg-[#2563EB] hover:brightness-110">
                <Save size={15} /> Save Customer
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
