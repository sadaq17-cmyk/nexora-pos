import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Search, Package, X, Save } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const money = (n) => `Ksh ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CATEGORY_COLORS = { Groceries: "#2563EB", Dairy: "#38BDF8", Bakery: "#F59E0B", Beverages: "#8B5CF6" };

const emptyForm = { name: "", barcode: "", category_id: "", price: "", cost: "", stock: "", reorder_level: "10", unit: "unit" };

export default function Products() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setProducts(await api.products.getAll());
    setCategories(await api.products.getCategories());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode || "").includes(search)
  );

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setModalOpen(true); };
  const openEdit = (p) => {
    setForm({
      name: p.name, barcode: p.barcode || "", category_id: p.category_id || "",
      price: p.price, cost: p.cost, stock: p.stock, reorder_level: p.reorder_level, unit: p.unit,
    });
    setEditingId(p.id);
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Product name is required"); return; }
    const payload = {
      name: form.name.trim(),
      barcode: form.barcode.trim() || null,
      category_id: form.category_id ? Number(form.category_id) : null,
      price: parseFloat(form.price) || 0,
      cost: parseFloat(form.cost) || 0,
      stock: parseInt(form.stock) || 0,
      reorder_level: parseInt(form.reorder_level) || 10,
      unit: form.unit || "unit",
    };
    if (editingId) {
      const result = await api.products.update({ id: editingId, ...payload });
      if (!result.success) { showToast(result.error || "Could not update product"); return; }
      showToast("Product updated");
    } else {
      const result = await api.products.create(payload);
      if (!result.success) { showToast(result.error || "Could not add product"); return; }
      showToast("Product added");
    }
    setModalOpen(false);
    await load();
  };

  const handleDelete = async (p) => {
    if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    const result = await api.products.delete(p.id);
    if (!result.success) { showToast(result.error || "Could not delete product"); return; }
    showToast("Product deleted");
    await load();
  };

  return (
    <div className="animate-fadein">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1B2439]">Products</h1>
          <p className="text-sm text-[#6B7690] mt-0.5">Manage your product catalog, pricing, and categories.</p>
        </div>
        {can("products", "create") && (
          <button onClick={openAdd} className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-sm font-medium hover:brightness-110 bg-[#2563EB]">
            <Plus size={15} /> Add Product
          </button>
        )}
      </div>

      <div className="relative mb-4 w-64">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7690]" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or barcode…"
          className="pl-9 pr-3 py-2 rounded-lg border border-[#E4E9F2] text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        />
      </div>

      <div className="bg-white border border-[#E4E9F2] rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="text-center py-10 text-sm text-[#6B7690]">Loading products…</div>
        ) : (
          <table className="w-full">
            <thead><tr className="bg-[#F3F6FB]">
              {["Product", "Barcode", "Category", "Cost", "Price", "Stock", "Status", "Actions"].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-[#6B7690] ${i >= 3 && i <= 5 ? "text-right" : i === 7 ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t border-[#E4E9F2] hover:bg-[#F8FAFD]">
                  <td className="px-4 py-3 text-sm font-medium flex items-center gap-2.5 text-[#1B2439]">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: (CATEGORY_COLORS[p.category] || "#2563EB") + "1A" }}>
                      <Package size={14} style={{ color: CATEGORY_COLORS[p.category] || "#2563EB" }} />
                    </div>
                    {p.name}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-[#1B2439]">{p.barcode || "—"}</td>
                  <td className="px-4 py-3 text-sm text-[#1B2439]">{p.category || "Uncategorized"}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono text-[#1B2439]">{money(p.cost)}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono font-medium text-[#1B2439]">{money(p.price)}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono text-[#1B2439]">{p.stock} {p.unit}s</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${p.stock <= p.reorder_level ? "text-[#DC2626] bg-[#FDECEC]" : "text-[#12A150] bg-[#E8FAEF]"}`}>
                      {p.stock <= p.reorder_level ? "Low Stock" : "In Stock"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {can("products", "edit") && <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-[#F1F3F8] mr-1 text-[#6B7690]"><Pencil size={14} /></button>}
                    {can("products", "delete") && <button onClick={() => handleDelete(p)} className="p-1.5 rounded hover:bg-[#FDECEC] text-[#DC2626]"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-sm text-[#6B7690]">No products found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 animate-fadein" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1B2439]">{editingId ? "Edit Product" : "Add Product"}</h3>
              <button onClick={() => setModalOpen(false)} className="text-[#6B7690]"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#1B2439] mb-1 block">Name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#1B2439] mb-1 block">Barcode</label>
                  <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1B2439] mb-1 block">Category</label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm">
                    <option value="">Uncategorized</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#1B2439] mb-1 block">Cost</label>
                  <input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1B2439] mb-1 block">Price</label>
                  <input required type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1B2439] mb-1 block">Unit</label>
                  <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#1B2439] mb-1 block">Stock</label>
                  <input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1B2439] mb-1 block">Reorder Level</label>
                  <input type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <button type="submit" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold bg-[#2563EB] hover:brightness-110 mt-2">
                <Save size={15} /> {editingId ? "Save Changes" : "Add Product"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
