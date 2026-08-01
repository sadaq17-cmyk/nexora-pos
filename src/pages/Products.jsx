import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2, Search, Package, X, Save, Barcode, Image as ImageIcon, Boxes, Archive, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { readSecureImageDataUrl } from "../lib/secureImageUpload";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useRealtimeRefresh } from "../hooks/useRealtimeRefresh";
import { ListSkeleton } from "@/components/ui/skeleton";
import { DEFAULT_PAGE_SIZE } from "../lib/requestCache";

const CATEGORY_COLORS = { Groceries: "#2563EB", Dairy: "#38BDF8", Bakery: "#F59E0B", Beverages: "#8B5CF6" };

const emptyForm = {
  name: "",
  barcode: "",
  category_id: "",
  brand_id: "",
  unit_id: "",
  price: "",
  cost: "",
  wholesale_price: "",
  min_selling_price: "",
  discount_percent: "",
  tax_inclusive: false,
  stock: "",
  reorder_level: "10",
  max_stock: "0",
  image_url: "",
  track_batches: false,
  default_expiry_days: "",
  expiry_date: "",
  stock_preference: "none",
  variants: [],
};

export default function Products() {
  const { formatMoney: money, currency } = useEnterpriseSettings();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [productRows, categoryRows, brandRows, unitRows] = await Promise.all([
        api.products.getAll().catch(() => []),
        api.products.getCategories().catch(() => []),
        api.brands?.getAll?.().catch(() => []) || Promise.resolve([]),
        api.units?.getAll?.().catch(() => []) || Promise.resolve([]),
      ]);
      setProducts(productRows || []);
      setCategories(categoryRows || []);
      setBrands(brandRows || []);
      setUnits(unitRows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // ERP real-time: a purchase, sale, or stock adjustment anywhere in the
  // company must refresh this product list automatically.
  useRealtimeRefresh(["products", "inventory", "purchases", "sales"], load);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode || "").includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.brand || "").toLowerCase().includes(q)
    );
  }, [products, debouncedSearch]);

  const pageSize = DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const paged = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setModalOpen(true);
  };

  const openEdit = (p) => {
    setForm({
      name: p.name,
      barcode: p.barcode || "",
      category_id: p.category_id || "",
      brand_id: p.brand_id || "",
      unit_id: p.unit_id || "",
      price: p.price,
      cost: p.cost,
      wholesale_price: p.wholesale_price ?? "",
      min_selling_price: p.min_selling_price ?? "",
      avg_cost: p.avg_cost ?? "",
      last_cost: p.last_cost ?? "",
      discount_percent: p.discount_percent ?? "",
      tax_inclusive: !!p.tax_inclusive,
      stock: p.stock,
      reorder_level: p.reorder_level,
      max_stock: p.max_stock ?? 0,
      image_url: p.image_url || "",
      track_batches: !!p.track_batches,
      default_expiry_days: p.default_expiry_days || "",
      expiry_date: p.expiry_date ? String(p.expiry_date).slice(0, 10) : "",
      stock_preference: p.stock_preference || "none",
      variants: Array.isArray(p.variants) ? p.variants.map((v) => ({ ...v })) : [],
    });
    setEditingId(p.id);
    setModalOpen(true);
  };

  const addVariant = () => {
    setForm((current) => ({
      ...current,
      variants: [...current.variants, { name: "", sku: "", barcode: "", price: current.price || "", cost: current.cost || "", stock: 0 }],
    }));
  };

  const updateVariant = (index, key, value) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, i) => (i === index ? { ...variant, [key]: value } : variant)),
    }));
  };

  const removeVariant = (index) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.filter((_, i) => i !== index),
    }));
  };

  const handleImageFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readSecureImageDataUrl(file, { maxBytes: 700 * 1024 });
      setForm((current) => ({ ...current, image_url: dataUrl }));
    } catch (uploadError) {
      showToast(uploadError?.message || "Image too large for local storage — keep under ~700KB or use a URL");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("Product name is required");
      return;
    }
    if (form.cost === "" || parseFloat(form.cost) < 0) {
      showToast("Cost Price is required and cannot be negative");
      return;
    }
    if (form.price === "" || parseFloat(form.price) <= 0) {
      showToast("Selling Price is required and must be greater than zero");
      return;
    }
    const selectedUnit = units.find((u) => u.id === Number(form.unit_id));
    const payload = {
      name: form.name.trim(),
      barcode: form.barcode.trim() || null,
      category_id: form.category_id ? Number(form.category_id) : null,
      brand_id: form.brand_id ? Number(form.brand_id) : null,
      unit_id: form.unit_id ? Number(form.unit_id) : null,
      unit: selectedUnit?.abbreviation || "unit",
      price: parseFloat(form.price) || 0,
      cost: parseFloat(form.cost) || 0,
      wholesale_price: parseFloat(form.wholesale_price) || 0,
      min_selling_price: parseFloat(form.min_selling_price) || 0,
      discount_percent: parseFloat(form.discount_percent) || 0,
      tax_inclusive: !!form.tax_inclusive,
      stock: parseInt(form.stock, 10) || 0,
      reorder_level: parseInt(form.reorder_level, 10) || 10,
      max_stock: parseInt(form.max_stock, 10) || 0,
      image_url: form.image_url || "",
      track_batches: !!form.track_batches,
      default_expiry_days: form.default_expiry_days ? Number(form.default_expiry_days) : null,
      expiry_date: form.expiry_date || null,
      stock_preference: form.stock_preference || "none",
      variants: (form.variants || [])
        .filter((v) => v.name?.trim())
        .map((v) => ({
          id: v.id,
          name: v.name.trim(),
          sku: v.sku || "",
          barcode: v.barcode || null,
          price: parseFloat(v.price) || parseFloat(form.price) || 0,
          cost: parseFloat(v.cost) || parseFloat(form.cost) || 0,
          stock: parseInt(v.stock, 10) || 0,
        })),
    };
    if (editingId) {
      const result = await api.products.update({ id: editingId, ...payload });
      if (!result.success) {
        showToast(result.error || "Could not update product");
        return;
      }
      showToast("Product updated");
    } else {
      const result = await api.products.create(payload);
      if (!result.success) {
        showToast(result.error || "Could not add product");
        return;
      }
      showToast("Product added");
    }
    setModalOpen(false);
    await load();
  };

  const handleDelete = async (p) => {
    if (!confirm(`Soft-delete "${p.name}"? Sales/purchase history is preserved.`)) return;
    const result = await api.products.delete(p.id);
    if (!result.success) {
      showToast(result.error || "Could not delete product");
      return;
    }
    showToast(result.soft ? "Product soft-deleted" : "Product deleted");
    await load();
  };

  const handleArchive = async (p) => {
    const result = await api.products.archive?.(p.id);
    if (!result?.success) {
      showToast(result?.error || "Could not archive");
      return;
    }
    showToast("Product archived");
    await load();
  };

  const handleRestore = async (p) => {
    const result = await api.products.restore?.(p.id);
    if (!result?.success) {
      showToast(result?.error || "Could not restore");
      return;
    }
    showToast("Product restored");
    await load();
  };

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="mt-1 text-base text-app-muted">Catalog with brands, units, images, batches, and variants.</p>
        </div>
        <div className="flex items-center gap-2">
          {can("inventory", "view") && (
            <Link to="/inventory" className="btn btn-secondary">
              <Boxes size={15} /> Inventory
            </Link>
          )}
          {can("barcode", "view") && (
            <Link
              to="/barcode"
              className="btn btn-secondary"
            >
              <Barcode size={15} /> Barcodes
            </Link>
          )}
          {can("products", "create") && (
            <button onClick={openAdd} className="btn btn-primary">
              <Plus size={15} /> Add Product
            </button>
          )}
        </div>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products or barcode…"
          className="form-control w-full max-w-sm pl-10"
        />
      </div>

      <div className="table-container">
        {loading ? (
          <ListSkeleton rows={8} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-app-panel-muted">
                {["Product", "Brand", "Barcode", "Category", "Cost", "Price", "Margin", "Stock", "Status", "Actions"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-app-muted ${i >= 4 && i <= 7 ? "text-right" : i === 9 ? "text-right" : "text-left"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr key={p.id} className="border-t border-app hover:bg-app-panel-muted">
                  <td className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-app-text">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
                    ) : (
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${CATEGORY_COLORS[p.category] || "#2563EB"}1A` }}
                      >
                        <Package size={14} style={{ color: CATEGORY_COLORS[p.category] || "#2563EB" }} />
                      </div>
                    )}
                    <div>
                      <div>{p.name}</div>
                      {(p.variants?.length || 0) > 0 && (
                        <div className="text-xs text-app-muted">{p.variants.length} variant{p.variants.length > 1 ? "s" : ""}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-app-text">{p.brand || "—"}</td>
                  <td className="px-4 py-3 font-mono text-sm text-app-text">{p.barcode || "—"}</td>
                  <td className="px-4 py-3 text-sm text-app-text">{p.category || "Uncategorized"}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-app-text">{money(p.cost)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-medium text-app-text">{money(p.price)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-app-muted">
                    {Number(p.price) > 0 ? `${(((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-app-text">
                    {p.stock} {p.unit}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        p.stock <= p.reorder_level ? "bg-[#FDECEC] text-danger" : "bg-[#E8FAEF] text-success"
                      }`}
                    >
                      {p.stock <= p.reorder_level ? "Low Stock" : "In Stock"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {can("products", "edit") && (
                      <button onClick={() => openEdit(p)} className="mr-1 rounded p-1.5 text-app-muted hover:bg-[#F1F3F8]">
                        <Pencil size={14} />
                      </button>
                    )}
                    {can("products", "edit") && !p.archived_at && !p.deleted_at && (
                      <button onClick={() => handleArchive(p)} className="mr-1 rounded p-1.5 text-app-muted hover:bg-[#F1F3F8]" title="Archive">
                        <Archive size={14} />
                      </button>
                    )}
                    {can("products", "edit") && (p.archived_at || p.deleted_at) && (
                      <button onClick={() => handleRestore(p)} className="mr-1 rounded p-1.5 text-success hover:bg-[#E8FAEF]" title="Restore">
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {can("products", "delete") && !p.deleted_at && (
                      <button onClick={() => handleDelete(p)} className="rounded p-1.5 text-danger hover:bg-[#FDECEC]">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-sm text-app-muted">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setModalOpen(false)}>
          <div className="animate-fadein max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="card-title">{editingId ? "Edit Product" : "Add Product"}</h3>
              <button onClick={() => setModalOpen(false)} className="text-app-muted">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="form-label">Name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Barcode</label>
                  <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 font-mono text-sm" />
                </div>
                <div>
                  <label className="form-label">Category</label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm">
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Brand</label>
                  <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm">
                    <option value="">No brand</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Unit</label>
                  <select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm">
                    <option value="">Select unit</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.abbreviation})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Cost price — used by Purchases ({currency.code} {currency.symbol}) *</label>
                  <input required type="number" step="0.01" min="0" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Selling price — used by Sales/POS ({currency.code} {currency.symbol}) *</label>
                  <input required type="number" step="0.01" min="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Wholesale price (optional)</label>
                  <input type="number" step="0.01" value={form.wholesale_price} onChange={(e) => setForm({ ...form, wholesale_price: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Minimum selling price (optional)</label>
                  <input type="number" step="0.01" value={form.min_selling_price} onChange={(e) => setForm({ ...form, min_selling_price: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" placeholder="Floor price for discounts" />
                </div>
                <div>
                  <label className="form-label">Profit margin</label>
                  <div className="flex h-[38px] items-center rounded-lg border border-app bg-app-panel-muted px-3 text-sm font-medium text-app-text">
                    {(() => {
                      const c = parseFloat(form.cost) || 0;
                      const s = parseFloat(form.price) || 0;
                      const margin = s > 0 ? ((s - c) / s) * 100 : 0;
                      return `${margin.toFixed(1)}%`;
                    })()}
                  </div>
                </div>
              </div>

              {editingId && (
                <div className="grid grid-cols-3 gap-3 rounded-lg bg-app-panel-muted p-3 text-xs text-app-muted">
                  <div>
                    <div className="uppercase tracking-wide">Average cost</div>
                    <div className="mt-0.5 font-mono text-sm text-app-text">{money(form.avg_cost || 0)}</div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wide">Last purchase cost</div>
                    <div className="mt-0.5 font-mono text-sm text-app-text">{money(form.last_cost || 0)}</div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wide">Inventory value</div>
                    <div className="mt-0.5 font-mono text-sm text-app-text">
                      {money((parseFloat(form.stock) || 0) * (parseFloat(form.avg_cost || form.cost) || 0))}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Discount %</label>
                  <input type="number" step="0.01" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Reorder level</label>
                  <input type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Max stock (overstock)</label>
                  <input type="number" value={form.max_stock} onChange={(e) => setForm({ ...form, max_stock: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input id="tax_inclusive" type="checkbox" checked={form.tax_inclusive} onChange={(e) => setForm({ ...form, tax_inclusive: e.target.checked })} />
                <label htmlFor="tax_inclusive" className="text-sm text-app-text">
                  Selling price is tax-inclusive
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Opening stock</label>
                  <input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" disabled={!!editingId} />
                  {editingId && <div className="mt-1 text-[11px] text-app-muted">Use Inventory hub for stock movements.</div>}
                </div>
                <div>
                  <label className="form-label">Default expiry days</label>
                  <input type="number" value={form.default_expiry_days} onChange={(e) => setForm({ ...form, default_expiry_days: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" placeholder="Optional" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Product expiry date</label>
                  <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Stock preference</label>
                  <select value={form.stock_preference} onChange={(e) => setForm({ ...form, stock_preference: e.target.value })} className="w-full rounded-lg border border-app px-3 py-2 text-sm">
                    <option value="none">None</option>
                    <option value="fifo">FIFO (preference)</option>
                    <option value="fefo">FEFO (preference)</option>
                  </select>
                  <div className="mt-1 text-[11px] text-app-muted">Hint only — no lot ledger enforcement.</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input id="track_batches" type="checkbox" checked={form.track_batches} onChange={(e) => setForm({ ...form, track_batches: e.target.checked })} />
                <label htmlFor="track_batches" className="text-sm text-app-text">
                  Track batch numbers / expiry for this product
                </label>
              </div>

              <div>
                <label className="form-label">Product image</label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    value={form.image_url?.startsWith("data:") ? "" : form.image_url}
                    onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                    placeholder="Image URL"
                    className="min-w-[220px] flex-1 rounded-lg border border-app px-3 py-2 text-sm"
                  />
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-app px-3 py-2 text-sm text-app-muted hover:text-app-text">
                    <ImageIcon size={14} /> Upload
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
                  </label>
                  {form.image_url && <img src={form.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />}
                </div>
              </div>

              <div className="rounded-xl border border-app p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-medium text-app-text">Variants</div>
                  <button type="button" onClick={addVariant} className="text-xs font-medium text-brand">
                    + Add variant
                  </button>
                </div>
                {form.variants.length === 0 && <div className="text-xs text-app-muted">Optional — e.g. size or flavour options.</div>}
                <div className="space-y-2">
                  {form.variants.map((variant, index) => (
                    <div key={index} className="grid grid-cols-6 gap-2">
                      <input placeholder="Name" value={variant.name} onChange={(e) => updateVariant(index, "name", e.target.value)} className="col-span-2 rounded-lg border border-app px-2 py-1.5 text-xs" />
                      <input placeholder="SKU" value={variant.sku} onChange={(e) => updateVariant(index, "sku", e.target.value)} className="rounded-lg border border-app px-2 py-1.5 text-xs" />
                      <input placeholder={`${currency.code} ${currency.symbol}`} title={`Variant price (${currency.code} ${currency.symbol})`} type="number" value={variant.price} onChange={(e) => updateVariant(index, "price", e.target.value)} className="rounded-lg border border-app px-2 py-1.5 text-xs" />
                      <input placeholder="Stock" type="number" value={variant.stock} onChange={(e) => updateVariant(index, "stock", e.target.value)} className="rounded-lg border border-app px-2 py-1.5 text-xs" />
                      <button type="button" onClick={() => removeVariant(index)} className="rounded-lg border border-[#FBD5D5] text-xs text-danger">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" className="btn btn-primary mt-2 w-full">
                <Save size={15} /> {editingId ? "Save Changes" : "Add Product"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
