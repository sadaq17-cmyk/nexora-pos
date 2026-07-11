import { useState, useEffect } from "react";
import { Plus, X, Save, Trash2, CheckCircle2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const statusColors = {
  Received: ["#12A150", "#E8FAEF"], Pending: ["#D97706", "#FEF3E2"], Ordered: ["#2563EB", "#EEF3FF"],
};

export default function Purchases() {
  const { showToast } = useToast();
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState([{ product_id: "", qty: 1, cost: "" }]);

  const load = async () => {
    const [p, s, pr] = await Promise.all([api.purchases.getAll(), api.suppliers.getAll(), api.products.getAll()]);
    setPurchases(p); setSuppliers(s); setProducts(pr); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const addLine = () => setLines((l) => [...l, { product_id: "", qty: 1, cost: "" }]);
  const removeLine = (i) => setLines((l) => l.filter((_, idx) => idx !== i));
  const updateLine = (i, field, value) => setLines((l) => l.map((line, idx) => (idx === i ? { ...line, [field]: value } : line)));

  const handleCreate = async (e) => {
    e.preventDefault();
    const items = lines
      .filter((l) => l.product_id && l.qty > 0)
      .map((l) => ({ product_id: Number(l.product_id), qty: Number(l.qty), cost: parseFloat(l.cost) || 0 }));
    if (!supplierId || items.length === 0) { showToast("Choose a supplier and at least one product"); return; }
    const result = await api.purchases.create({ supplier_id: Number(supplierId), items, status: "Pending" });
    if (result.success) {
      showToast(`Purchase order ${result.po_number} created`);
      setModalOpen(false); setSupplierId(""); setLines([{ product_id: "", qty: 1, cost: "" }]);
      await load();
    } else showToast(result.error || "Failed to create purchase order");
  };

  const markReceived = async (po) => {
    await api.purchases.receive(po.id);
    showToast(`${po.po_number} marked Received — stock updated`);
    await load();
  };

  return (
    <div className="animate-fadein">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439]">Purchases</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">Track purchase orders placed with your suppliers.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 bg-[#2563EB]">
          <Plus size={15} /> New Purchase Order
        </button>
      </div>

      <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="text-center py-10 text-sm text-[#6B7690]">Loading purchases…</div>
        ) : (
          <table className="w-full">
            <thead><tr className="bg-[#F3F6FB]">
              {["PO Number", "Supplier", "Date", "Items", "Total", "Status", "Actions"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-[#6B7690] text-left">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {purchases.map((po) => {
                const [color, bg] = statusColors[po.status] || ["#6B7690", "#F1F3F8"];
                return (
                  <tr key={po.id} className="border-t border-[#E4E9F2] hover:bg-[#F8FAFD]">
                    <td className="px-4 py-3 text-sm font-mono text-[#1B2439]">{po.po_number}</td>
                    <td className="px-4 py-3 text-sm text-[#1B2439]">{po.supplier}</td>
                    <td className="px-4 py-3 text-sm text-[#6B7690]">{String(po.created_at).slice(0, 10)}</td>
                    <td className="px-4 py-3 text-sm text-[#1B2439]">{po.item_count}</td>
                    <td className="px-4 py-3 text-sm font-semibold font-mono text-[#1B2439]">{money(po.total)}</td>
                    <td className="px-4 py-3"><span className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ color, backgroundColor: bg }}>{po.status}</span></td>
                    <td className="px-4 py-3">
                      {po.status !== "Received" && (
                        <button onClick={() => markReceived(po)} className="flex items-center gap-1 text-xs font-medium text-[#12A150] hover:underline">
                          <CheckCircle2 size={13} /> Mark Received
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {purchases.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-sm text-[#6B7690]">No purchase orders yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1B2439]">New Purchase Order</h3>
              <button onClick={() => setModalOpen(false)} className="text-[#6B7690]"><X size={18} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#1B2439] mb-1 block">Supplier</label>
                <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm">
                  <option value="">Select a supplier…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-[#1B2439] block">Items</label>
                {lines.map((line, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <select value={line.product_id} onChange={(e) => updateLine(i, "product_id", e.target.value)} className="flex-1 border border-[#E4E9F2] rounded-lg px-2 py-1.5 text-sm">
                      <option value="">Product…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="number" min={1} value={line.qty} onChange={(e) => updateLine(i, "qty", e.target.value)} placeholder="Qty" className="w-16 border border-[#E4E9F2] rounded-lg px-2 py-1.5 text-sm" />
                    <input type="number" step="0.01" value={line.cost} onChange={(e) => updateLine(i, "cost", e.target.value)} placeholder="Cost" className="w-20 border border-[#E4E9F2] rounded-lg px-2 py-1.5 text-sm" />
                    <button type="button" onClick={() => removeLine(i)} className="text-[#DC2626]"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button type="button" onClick={addLine} className="text-xs font-medium text-[#2563EB]">+ Add another item</button>
              </div>

              <button type="submit" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold bg-[#2563EB] hover:brightness-110 mt-2">
                <Save size={15} /> Create Purchase Order
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
