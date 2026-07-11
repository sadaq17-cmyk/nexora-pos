import { useState, useEffect } from "react";
import { Boxes, DollarSign, AlertTriangle, Package, Plus, Minus } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

export default function Inventory() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adjustingId, setAdjustingId] = useState(null);

  const load = async () => { setProducts(await api.products.getAll()); setLoading(false); };
  useEffect(() => { load(); }, []);

  const totalUnits = products.reduce((s, p) => s + p.stock, 0);
  const totalValue = products.reduce((s, p) => s + p.stock * p.cost, 0);
  const lowStock = products.filter((p) => p.stock <= p.reorder_level);

  const adjust = async (p, delta) => {
    setAdjustingId(p.id);
    const result = await api.products.adjustStock(p.id, delta, "Manual adjustment from Inventory");
    setAdjustingId(null);
    if (!result.success) { showToast(result.error || "Could not adjust stock"); return; }
    await load();
    showToast(`${p.name} stock ${delta > 0 ? "increased" : "decreased"} by ${Math.abs(delta)}`);
  };

  return (
    <div className="animate-fadein">
      <h1 className="text-2xl font-bold text-[#1B2439] mb-1">Inventory Management</h1>
      <p className="text-sm text-[#6B7690] mb-5">Track stock levels and reorder points across your store.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard icon={Boxes} label="Total Units in Stock" value={totalUnits} color="#2563EB" />
        <StatCard icon={DollarSign} label="Inventory Value" value={money(totalValue)} color="#12A150" />
        <StatCard icon={AlertTriangle} label="Low Stock Alerts" value={lowStock.length} color="#DC2626" />
        <StatCard icon={Package} label="Total Products" value={products.length} color="#8B5CF6" />
      </div>

      {lowStock.length > 0 && (
        <div className="p-4 mb-5 flex items-center gap-3 rounded-2xl border border-[#FBD5D5] bg-[#FEF6F6]">
          <AlertTriangle size={18} className="text-[#DC2626]" />
          <div className="text-sm text-[#1B2439]">
            <span className="font-semibold">{lowStock.length} product{lowStock.length > 1 ? "s" : ""}</span> below reorder level — restock soon to avoid stockouts.
          </div>
        </div>
      )}

      <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="text-center py-10 text-sm text-[#6B7690]">Loading inventory…</div>
        ) : (
          <table className="w-full">
            <thead><tr className="bg-[#F3F6FB]">
              {["Product", "Current Stock", "Reorder Level", "Stock Level", "Quick Adjust", "Status"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-[#6B7690] text-left">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {products.map((p) => {
                const pct = Math.min(100, Math.round((p.stock / (p.reorder_level * 3 || 1)) * 100));
                const low = p.stock <= p.reorder_level;
                return (
                  <tr key={p.id} className="border-t border-[#E4E9F2]">
                    <td className="px-4 py-3 text-sm font-medium text-[#1B2439]">{p.name}</td>
                    <td className="px-4 py-3 text-sm font-mono text-[#1B2439]">{p.stock} {p.unit}s</td>
                    <td className="px-4 py-3 text-sm font-mono text-[#1B2439]">{p.reorder_level} {p.unit}s</td>
                    <td className="px-4 py-3 w-48">
                      <div className="w-full h-2 rounded-full bg-[#E4E9F2]">
                        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: low ? "#DC2626" : "#12A150" }} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {can("inventory", "edit") ? (
                        <div className="flex items-center gap-1.5">
                          <button disabled={adjustingId === p.id} onClick={() => adjust(p, -1)} className="w-7 h-7 rounded-full border border-[#E4E9F2] flex items-center justify-center disabled:opacity-40"><Minus size={12} /></button>
                          <button disabled={adjustingId === p.id} onClick={() => adjust(p, 1)} className="w-7 h-7 rounded-full border border-[#E4E9F2] flex items-center justify-center disabled:opacity-40"><Plus size={12} /></button>
                        </div>
                      ) : <span className="text-xs text-[#6B7690]">View only</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${low ? "text-[#DC2626] bg-[#FDECEC]" : "text-[#12A150] bg-[#E8FAEF]"}`}>
                        {low ? "Low Stock" : "In Stock"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
