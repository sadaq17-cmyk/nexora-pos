import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus, X, Save, Trash2, CheckCircle2, RotateCcw, Building2, PackagePlus, Loader2,
  Search, CreditCard, FileText, Ban, PackageCheck, Paperclip, Eye, Printer, Mail,
  Copy, Download, BarChart3, BookOpen, LayoutDashboard, ClipboardList, ThumbsDown,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { api, isProductionDataPlane } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import ProductSelector from "../components/ProductSelector";
import CurrencyMoneyFields from "../components/CurrencyMoneyFields";
import { excludeDemoProducts } from "../lib/demoProducts";
import { readSecureImageDataUrl } from "../lib/secureImageUpload";
import { computeDueDate, formatDueDate, PAYMENT_TERMS_OPTIONS } from "../lib/paymentTerms";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const statusColors = {
  Draft: ["#6B7690", "#F1F3F8"],
  Pending: ["#D97706", "#FEF3E2"],
  Ordered: ["#2563EB", "#EEF3FF"],
  PartiallyReceived: ["#7C3AED", "#F3E8FF"],
  Received: ["#12A150", "#E8FAEF"],
  Cancelled: ["#DC2626", "#FEF2F2"],
  Rejected: ["#9F1239", "#FFE4E6"],
};

/** UI labels aligned to DB enums — "Approved" maps to Ordered. */
function statusLabel(status) {
  if (status === "Ordered") return "Approved / Ordered";
  if (status === "PartiallyReceived") return "Partial / Back Order";
  if (status === "Rejected") return "Rejected";
  return status || "—";
}

const PAYMENT_METHODS = ["Bank Transfer", "Cash", "M-Pesa", "Card", "Cheque", "Credit"];
const MODULE_TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "orders", label: "Purchase Orders", icon: ClipboardList },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "accounting", label: "Accounting", icon: BookOpen },
];

function StatCard({ icon: Icon, label, value, color = "#2563EB" }) {
  return (
    <div className="rounded-xl border border-app bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-app-muted">{label}</div>
          <div className="mt-1 font-mono text-lg font-bold text-app-text">{value}</div>
        </div>
        <div className="rounded-lg p-2" style={{ backgroundColor: `${color}18`, color }}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportPurchasesExcel(rows) {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((p) => ({
      PO: p.po_number,
      Supplier: p.supplier,
      Invoice: p.invoice_no || "",
      Status: statusLabel(p.status),
      Date: String(p.created_at || "").slice(0, 10),
      Due: p.due_date || "",
      Total: Number(p.total) || 0,
      Paid: Number(p.amount_paid) || 0,
      Balance: Number(p.balance) || 0,
      Tax: Number(p.tax_total) || 0,
    }))
  );
  XLSX.utils.book_append_sheet(book, sheet, "Purchases");
  XLSX.writeFile(book, `purchases-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function exportPurchasesPdf(rows, money) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Nexora POS — Purchase Orders", 14, 16);
  doc.setFontSize(9);
  let y = 26;
  doc.text("PO | Supplier | Status | Total | Balance", 14, y);
  y += 6;
  for (const p of rows.slice(0, 40)) {
    doc.text(
      `${p.po_number} | ${(p.supplier || "").slice(0, 24)} | ${statusLabel(p.status)} | ${money(p.total)} | ${money(p.balance)}`,
      14,
      y
    );
    y += 5;
    if (y > 190) break;
  }
  doc.save(`purchases-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function printPaymentReceipt(po, payment, money) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=480,height=640");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Receipt ${po.po_number}</title>
    <style>body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#1B2439}
    h1{font-size:18px;margin:0 0 8px}.muted{color:#6B7690;font-size:12px}
    .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E5E8F0;font-size:13px}</style></head><body>
    <h1>Supplier Payment Receipt</h1>
    <div class="muted">PO ${po.po_number} · ${String(payment.created_at || payment.payment_date || "").slice(0, 10)}</div>
    <div class="row"><span>Supplier</span><strong>${po.supplier || "—"}</strong></div>
    <div class="row"><span>Method</span><strong>${payment.method || "—"}</strong></div>
    <div class="row"><span>Reference</span><strong>${payment.reference || "—"}</strong></div>
    <div class="row"><span>Amount</span><strong>${money(payment.amount)}</strong></div>
    <script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

const emptyLine = () => ({
  product_id: "",
  qty: 1,
  cost: "",
  discount: "0",
  tax: "0",
});

const emptySupplierForm = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  tax_number: "",
  payment_terms: "Net 30",
  notes: "",
};

const emptyProductForm = {
  name: "",
  sku: "",
  barcode: "",
  category_id: "",
  brand_id: "",
  unit_id: "",
  cost: "",
  price: "",
  initial_qty: "1",
  reorder_level: "10",
  tax_rate: "0",
  image_url: "",
};

function lineTotals(line) {
  const qty = Number(line.qty) || 0;
  const cost = parseFloat(line.cost) || 0;
  const discount = parseFloat(line.discount) || 0;
  const taxPct = parseFloat(line.tax) || 0;
  const base = Math.max(0, qty * cost - discount);
  const taxAmt = base * (taxPct / 100);
  return { base, taxAmt, total: base + taxAmt };
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-app-text">
        {label}{required ? <span className="text-danger"> *</span> : null}
      </label>
      {children}
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children, wide = false, z = 50 }) {
  const close = typeof onClose === "function" ? onClose : () => {};
  return (
    <div className="nx-modal-backdrop" style={{ zIndex: z }} onClick={close}>
      <div
        className={`nx-modal ${wide ? "max-w-3xl" : "max-w-lg"} p-5`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="card-title">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-xs text-app-muted">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={close} className="rounded-lg p-1 text-app-muted hover:bg-app-panel-muted" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

async function readInvoiceAttachment(file) {
  const maxBytes = 4 * 1024 * 1024;
  if (!file) throw new Error("No file selected.");
  if (file.size > maxBytes) throw new Error("Attachment must be 4 MB or smaller.");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (isPdf) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read PDF."));
      reader.readAsDataURL(file);
    });
  }
  return readSecureImageDataUrl(file, { maxBytes });
}

function printPurchaseOrder(po, items, money, supplier = null) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!win) return;
  const rows = (items || [])
    .map(
      (it) =>
        `<tr>
          <td>${it.product_name || it.name || `#${it.product_id}`}</td>
          <td style="text-align:right">${Number(it.qty_ordered ?? it.qty) || 0}</td>
          <td style="text-align:right">${money(it.cost)}</td>
          <td style="text-align:right">${money((Number(it.qty_ordered ?? it.qty) || 0) * (Number(it.cost) || 0))}</td>
        </tr>`
    )
    .join("");
  win.document.write(`<!doctype html><html><head><title>PO ${po.po_number}</title>
    <style>
      body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#1B2439}
      h1{font-size:20px;margin:0 0 4px}.muted{color:#6B7690;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
      th,td{border-bottom:1px solid #E5E8F0;padding:8px;text-align:left}
      th{background:#F5F7FB;text-transform:uppercase;font-size:10px}
      .meta{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px}
    </style></head><body>
    <h1>Purchase Order ${po.po_number}</h1>
    <div class="muted">Status: ${statusLabel(po.status)} · ${String(po.created_at || "").slice(0, 10)}</div>
    <div class="meta">
      <div><strong>Supplier</strong><br>${supplier?.name || po.supplier || "—"}<br>${supplier?.email || ""}<br>${supplier?.phone || ""}</div>
      <div><strong>Totals</strong><br>Total: ${money(po.total)}<br>Paid: ${money(po.amount_paid || 0)}<br>Balance: ${money(po.balance ?? Math.max(0, Number(po.total) - Number(po.amount_paid || 0)))}</div>
    </div>
    ${po.notes ? `<p class="muted">Notes: ${po.notes}</p>` : ""}
    <table><thead><tr><th>Item</th><th>Qty</th><th>Cost</th><th>Line</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No lines</td></tr>'}</tbody></table>
    <script>window.onload=()=>{window.print();}</script>
  </body></html>`);
  win.document.close();
}

function emailPurchaseOrder(po, supplier = null) {
  const to = supplier?.email || "";
  const subject = encodeURIComponent(`Purchase Order ${po.po_number}`);
  const body = encodeURIComponent(
    [
      `Dear ${supplier?.contact_person || supplier?.name || "Supplier"},`,
      "",
      `Please find our purchase order ${po.po_number}.`,
      `Status: ${statusLabel(po.status)}`,
      `Total: ${po.total}`,
      po.notes ? `Notes: ${po.notes}` : "",
      "",
      "Regards,",
      "Nexora POS",
    ]
      .filter(Boolean)
      .join("\n")
  );
  window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
}

function NewSupplierDialog({ open, onClose, onCreated }) {
  const { showToast } = useToast();
  const [form, setForm] = useState(emptySupplierForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptySupplierForm);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("Supplier name is required");
      return;
    }
    setSaving(true);
    try {
      const result = await api.suppliers.create({
        name: form.name.trim(),
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        tax_number: form.tax_number.trim() || null,
        payment_terms: form.payment_terms.trim() || null,
        notes: form.notes.trim() || null,
        status: "Active",
      });
      if (!result?.success) {
        showToast(result?.error || "Could not create supplier");
        return;
      }
      const supplier = result.supplier || { id: result.id, ...form, name: form.name.trim(), status: "Active" };
      showToast(`Supplier “${supplier.name}” created`);
      onCreated(supplier);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="New Supplier"
      subtitle="Create a supplier without leaving the purchase order."
      onClose={saving ? undefined : onClose}
      z={60}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Supplier Name" required>
          <input required value={form.name} onChange={set("name")} className="form-control w-full" placeholder="e.g. Acme Distributors" disabled={saving} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact Person">
            <input value={form.contact_person} onChange={set("contact_person")} className="form-control w-full" disabled={saving} />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={set("phone")} className="form-control w-full" disabled={saving} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input type="email" value={form.email} onChange={set("email")} className="form-control w-full" disabled={saving} />
          </Field>
          <Field label="Tax Number">
            <input value={form.tax_number} onChange={set("tax_number")} className="form-control w-full" placeholder="Optional VAT / TIN" disabled={saving} />
          </Field>
        </div>
        <Field label="Payment Terms">
          <select value={form.payment_terms} onChange={set("payment_terms")} className="form-control w-full" disabled={saving}>
            <option value="">Select…</option>
            {PAYMENT_TERMS_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Address">
          <textarea value={form.address} onChange={set("address")} rows={2} className="form-control w-full" disabled={saving} />
        </Field>
        <Field label="Notes">
          <textarea value={form.notes} onChange={set("notes")} rows={2} className="form-control w-full" placeholder="Optional internal notes" disabled={saving} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? "Saving…" : "Save Supplier"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function NewProductDialog({ open, onClose, onCreated, categories, brands, units, currency }) {
  const { showToast } = useToast();
  const [form, setForm] = useState(emptyProductForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptyProductForm);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleImageFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readSecureImageDataUrl(file, { maxBytes: 700 * 1024 });
      setForm((f) => ({ ...f, image_url: dataUrl }));
    } catch (err) {
      showToast(err?.message || "Image too large — keep under ~700KB");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("Product name is required");
      return;
    }
    const purchaseQty = Math.max(1, parseInt(form.initial_qty, 10) || 1);
    const selectedUnit = units.find((u) => Number(u.id) === Number(form.unit_id));
    setSaving(true);
    try {
      const result = await api.products.create({
        name: form.name.trim(),
        sku: form.sku.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        auto_barcode: !form.barcode.trim(),
        category_id: form.category_id ? Number(form.category_id) : null,
        brand_id: form.brand_id ? Number(form.brand_id) : null,
        unit_id: form.unit_id ? Number(form.unit_id) : null,
        unit: selectedUnit?.abbreviation || "pcs",
        cost: parseFloat(form.cost) || 0,
        price: parseFloat(form.price) || 0,
        reorder_level: parseInt(form.reorder_level, 10) || 0,
        tax_rate: parseFloat(form.tax_rate) || 0,
        image_url: form.image_url || "",
        stock: 0,
        from_purchase: true,
        defer_stock: true,
      });
      if (!result?.success) {
        showToast(result?.error || "Could not create product");
        return;
      }
      const product = result.product || {
        id: result.id,
        name: form.name.trim(),
        cost: parseFloat(form.cost) || 0,
        price: parseFloat(form.price) || 0,
        tax_rate: parseFloat(form.tax_rate) || 0,
        stock: 0,
      };
      showToast(`Product “${product.name}” created — stock updates when PO is received`);
      onCreated({
        product,
        qty: purchaseQty,
        cost: parseFloat(form.cost) || 0,
        tax: parseFloat(form.tax_rate) || 0,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Add New Product"
      subtitle="Product is saved to the catalog; inventory increases only when this purchase is received."
      onClose={saving ? undefined : onClose}
      wide
      z={60}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Product Name" required>
          <input required value={form.name} onChange={set("name")} className="form-control w-full" disabled={saving} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <input value={form.sku} onChange={set("sku")} className="form-control w-full font-mono" placeholder="Auto if empty" disabled={saving} />
          </Field>
          <Field label="Barcode">
            <input value={form.barcode} onChange={set("barcode")} className="form-control w-full font-mono" placeholder="Auto if empty" disabled={saving} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Category">
            <select value={form.category_id} onChange={set("category_id")} className="form-control w-full" disabled={saving}>
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Brand">
            <select value={form.brand_id} onChange={set("brand_id")} className="form-control w-full" disabled={saving}>
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Unit">
            <select value={form.unit_id} onChange={set("unit_id")} className="form-control w-full" disabled={saving}>
              <option value="">pcs</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={`Purchase Price (${currency.symbol})`} required>
            <input required type="number" step="0.01" min="0" value={form.cost} onChange={set("cost")} className="form-control w-full" disabled={saving} />
          </Field>
          <Field label={`Selling Price (${currency.symbol})`}>
            <input type="number" step="0.01" min="0" value={form.price} onChange={set("price")} className="form-control w-full" disabled={saving} />
          </Field>
          <Field label="Initial Purchase Qty" required>
            <input required type="number" min="1" value={form.initial_qty} onChange={set("initial_qty")} className="form-control w-full" disabled={saving} />
          </Field>
          <Field label="Minimum Stock">
            <input type="number" min="0" value={form.reorder_level} onChange={set("reorder_level")} className="form-control w-full" disabled={saving} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax (%)">
            <input type="number" step="0.01" min="0" value={form.tax_rate} onChange={set("tax_rate")} className="form-control w-full" disabled={saving} />
          </Field>
          <Field label="Product Image">
            <div className="flex items-center gap-2">
              <input type="file" accept="image/*" onChange={handleImageFile} className="form-control w-full text-xs" disabled={saving} />
              {form.image_url ? <img src={form.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" /> : null}
            </div>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}
            {saving ? "Saving…" : "Save & Add to Order"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export default function Purchases() {
  const { formatMoney: money, currency } = useEnterpriseSettings();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [moduleTab, setModuleTab] = useState("orders");
  const [reportTab, setReportTab] = useState("outstanding");
  const [purchases, setPurchases] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [reports, setReports] = useState(null);
  const [journal, setJournal] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [units, setUnits] = useState([]);
  const [branches, setBranches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [statusFilter, setStatusFilter] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDateOverride, setDueDateOverride] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [amountPaidOnCreate, setAmountPaidOnCreate] = useState("");
  const [createStatus, setCreateStatus] = useState("Pending");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [discountTotal, setDiscountTotal] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [otherCharges, setOtherCharges] = useState("0");
  const [lines, setLines] = useState([emptyLine()]);
  const [savingPo, setSavingPo] = useState(false);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [productDialogLine, setProductDialogLine] = useState(null);

  const [returnFor, setReturnFor] = useState(null);
  const [returnLine, setReturnLine] = useState({ product_id: "", qty: 1, cost: "", reason: "" });
  const [purchaseItems, setPurchaseItems] = useState([]);

  const [detailFor, setDetailFor] = useState(null);
  const [detailItems, setDetailItems] = useState([]);
  const [detailPayments, setDetailPayments] = useState([]);
  const [detailAudit, setDetailAudit] = useState([]);
  const [detailTab, setDetailTab] = useState("lines");

  const [receiveFor, setReceiveFor] = useState(null);
  const [receiveLines, setReceiveLines] = useState([]);
  const [receiving, setReceiving] = useState(false);

  const [payFor, setPayFor] = useState(null);
  const [payFx, setPayFx] = useState({
    original_amount: "",
    payment_currency: "",
    exchange_rate: 1,
    reference: "",
    payment_date: new Date().toISOString().slice(0, 10),
  });
  const [payMethod, setPayMethod] = useState("Bank Transfer");
  const [paying, setPaying] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const categoriesPromise = (async () => {
        try {
          if (api.products.getCategories) return await api.products.getCategories();
          if (api.categories?.getAll) return await api.categories.getAll();
          return [];
        } catch {
          return [];
        }
      })();
      const [p, s, pr, cats, brandRows, unitRows, branchRows, whRows, dash, reps, journ] = await Promise.all([
        api.purchases.getAll().catch(() => []),
        api.suppliers.getAll().catch(() => []),
        api.products.getAll().catch(() => []),
        categoriesPromise,
        api.brands?.getAll?.().catch(() => []) || Promise.resolve([]),
        api.units?.getAll?.().catch(() => []) || Promise.resolve([]),
        api.branches?.getAll?.().catch(() => []) || Promise.resolve([]),
        api.warehouses?.getAll?.().catch(() => []) || Promise.resolve([]),
        api.purchases.getDashboard?.().catch(() => null) || Promise.resolve(null),
        api.purchases.getReports?.().catch(() => null) || Promise.resolve(null),
        api.purchases.getJournal?.().catch(() => []) || Promise.resolve([]),
      ]);
      setPurchases(p || []);
      setSuppliers(s || []);
      setProducts(isProductionDataPlane ? excludeDemoProducts(pr || []) : pr || []);
      setCategories(cats || []);
      setBrands(brandRows || []);
      setUnits(unitRows || []);
      setBranches(branchRows || []);
      setWarehouses(whRows || []);
      setDashboard(dash);
      setReports(reps);
      setJournal(Array.isArray(journ) ? journ : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = (presetSupplierId = "") => {
    setEditingId(null);
    setSupplierId(presetSupplierId ? String(presetSupplierId) : "");
    setInvoiceNo("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setDueDateOverride("");
    setNotes("");
    setAttachmentUrl("");
    setAmountPaidOnCreate("");
    setCreateStatus("Pending");
    setBranchId("");
    setWarehouseId("");
    setDiscountTotal("0");
    setShipping("0");
    setOtherCharges("0");
    setLines([emptyLine()]);
    setModalOpen(true);
  };

  // Deep-link from Supplier profile: /purchases?supplier_id=X&action=create
  useEffect(() => {
    const action = searchParams.get("action");
    const sid = searchParams.get("supplier_id");
    if (action === "create" && can("purchases", "create")) {
      openCreate(sid || "");
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      next.delete("supplier_id");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, can]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return purchases.filter((po) => {
      if (statusFilter !== "all" && po.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(po.po_number || "").toLowerCase().includes(q) ||
        String(po.supplier || "").toLowerCase().includes(q) ||
        String(po.invoice_no || "").toLowerCase().includes(q) ||
        String(po.notes || "").toLowerCase().includes(q)
      );
    });
  }, [purchases, debouncedSearch, statusFilter]);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => String(s.id) === String(supplierId)) || null,
    [suppliers, supplierId]
  );

  const previewDueDate = useMemo(() => {
    if (!selectedSupplier) return null;
    return computeDueDate(selectedSupplier.payment_terms || "Net 30");
  }, [selectedSupplier]);

  const orderLinesTotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineTotals(line).total, 0),
    [lines]
  );
  const orderTotal = useMemo(() => {
    const disc = parseFloat(discountTotal) || 0;
    const ship = parseFloat(shipping) || 0;
    const other = parseFloat(otherCharges) || 0;
    return Math.max(0, orderLinesTotal - disc + ship + other);
  }, [orderLinesTotal, discountTotal, shipping, otherCharges]);

  const addLine = () => setLines((l) => [...l, emptyLine()]);
  const removeLine = (i) => setLines((l) => (l.length <= 1 ? l : l.filter((_, idx) => idx !== i)));
  const updateLine = (i, patch) => setLines((l) => l.map((line, idx) => (idx === i ? { ...line, ...patch } : line)));

  const onSelectProduct = (index, productId, product) => {
    updateLine(index, {
      product_id: productId,
      cost: product?.cost != null && product.cost !== "" ? String(product.cost) : "",
      tax: product?.tax_rate != null ? String(product.tax_rate) : lines[index]?.tax || "0",
    });
  };

  const handleSupplierCreated = (supplier) => {
    setSuppliers((list) => {
      if (list.some((s) => Number(s.id) === Number(supplier.id))) {
        return list.map((s) => (Number(s.id) === Number(supplier.id) ? { ...s, ...supplier } : s));
      }
      return [supplier, ...list];
    });
    setSupplierId(String(supplier.id));
  };

  const handleProductCreated = ({ product, qty, cost, tax }) => {
    setProducts((list) => {
      if (list.some((p) => Number(p.id) === Number(product.id))) {
        return list.map((p) => (Number(p.id) === Number(product.id) ? { ...p, ...product } : p));
      }
      return [product, ...list];
    });
    const index = productDialogLine;
    if (index == null) return;
    updateLine(index, {
      product_id: String(product.id),
      qty,
      cost: String(cost ?? product.cost ?? ""),
      tax: String(tax ?? product.tax_rate ?? 0),
      discount: "0",
    });
  };

  const handleAttachment = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readInvoiceAttachment(file);
      setAttachmentUrl(dataUrl);
      showToast("Invoice attached");
    } catch (err) {
      showToast(err?.message || "Could not attach file");
    }
  };

  const buildItems = () =>
    lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) => ({
        product_id: Number(l.product_id),
        qty: Number(l.qty),
        cost: parseFloat(l.cost) || 0,
        discount: parseFloat(l.discount) || 0,
        tax: parseFloat(l.tax) || 0,
      }));

  const validateLines = (items) => {
    if (!supplierId) {
      showToast("Select or create a supplier first");
      return false;
    }
    if (items.length === 0) {
      showToast("Add at least one product line");
      return false;
    }
    for (const item of items) {
      if (item.cost < 0 || item.discount < 0 || item.tax < 0) {
        showToast("Costs, discounts, and tax cannot be negative");
        return false;
      }
      const base = item.qty * item.cost;
      if (item.discount > base) {
        showToast("Discount cannot exceed line subtotal");
        return false;
      }
    }
    const deposit = parseFloat(amountPaidOnCreate) || 0;
    if (deposit < 0) {
      showToast("Amount paid cannot be negative");
      return false;
    }
    if (deposit > orderTotal + 0.001) {
      showToast("Amount paid cannot exceed purchase total");
      return false;
    }
    return true;
  };

  const buildPayload = (status) => ({
    supplier_id: Number(supplierId),
    invoice_no: invoiceNo.trim() || null,
    invoice_date: invoiceDate || null,
    due_date: dueDateOverride || undefined,
    items: buildItems(),
    status,
    notes: notes.trim() || null,
    attachment_url: attachmentUrl || null,
    amount_paid: editingId ? undefined : parseFloat(amountPaidOnCreate) || 0,
    payment_method: "Cash",
    branch_id: branchId ? Number(branchId) : undefined,
    warehouse_id: warehouseId ? Number(warehouseId) : null,
    discount_total: parseFloat(discountTotal) || 0,
    shipping: parseFloat(shipping) || 0,
    other_charges: parseFloat(otherCharges) || 0,
    client_reference:
      editingId
        ? undefined
        : typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `po-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });

  const submitPurchase = async (status) => {
    const items = buildItems();
    if (!validateLines(items)) return;
    setSavingPo(true);
    try {
      const payload = buildPayload(status);
      const result = editingId
        ? await api.purchases.update({ id: editingId, ...payload })
        : await api.purchases.create(payload);
      if (result?.success) {
        showToast(
          editingId
            ? `Purchase order updated`
            : status === "Draft"
              ? `Draft ${result.po_number || ""} saved`
              : `Purchase order ${result.po_number || result.purchase?.po_number || ""} created`
        );
        setModalOpen(false);
        await load();
      } else {
        showToast(result?.error || "Failed to save purchase order");
      }
    } finally {
      setSavingPo(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    await submitPurchase(createStatus === "Draft" ? "Draft" : createStatus || "Pending");
  };

  const openEdit = async (po) => {
    if (!["Draft", "Pending", "Ordered"].includes(po.status)) {
      showToast("Only Draft / Pending / Approved POs can be edited");
      return;
    }
    const items = await api.purchases.getItems(po.id);
    setEditingId(po.id);
    setSupplierId(String(po.supplier_id || ""));
    setInvoiceNo(po.invoice_no || "");
    setInvoiceDate(po.invoice_date || String(po.created_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10));
    setDueDateOverride(po.due_date ? String(po.due_date).slice(0, 10) : "");
    setNotes(po.notes || "");
    setAttachmentUrl(po.attachment_url || "");
    setAmountPaidOnCreate("");
    setCreateStatus(po.status === "Ordered" ? "Ordered" : po.status || "Pending");
    setBranchId(po.branch_id ? String(po.branch_id) : "");
    setWarehouseId(po.warehouse_id ? String(po.warehouse_id) : "");
    setDiscountTotal(String(po.discount_total ?? 0));
    setShipping(String(po.shipping ?? 0));
    setOtherCharges(String(po.other_charges ?? 0));
    setLines(
      (items || []).length
        ? items.map((it) => ({
            product_id: String(it.product_id),
            qty: it.qty_ordered ?? it.qty ?? 1,
            cost: String(it.cost ?? ""),
            discount: String(it.discount ?? 0),
            tax: String(it.tax ?? 0),
          }))
        : [emptyLine()]
    );
    setModalOpen(true);
  };

  const openDetail = async (po) => {
    setDetailFor(po);
    setDetailTab("lines");
    const [items, payments, audit] = await Promise.all([
      api.purchases.getItems(po.id),
      api.purchases.getPayments?.(po.id) || Promise.resolve([]),
      api.purchases.getAudit?.({ id: po.id }).catch(() => []) || Promise.resolve([]),
    ]);
    setDetailItems(items || []);
    setDetailPayments(payments || []);
    setDetailAudit(audit || []);
  };

  const openReceive = async (po) => {
    const items = await api.purchases.getItems(po.id);
    setReceiveFor(po);
    setReceiveLines(
      (items || []).map((it) => {
        const ordered = Number(it.qty_ordered ?? it.qty) || 0;
        const received = Number(it.qty_received) || 0;
        return {
          product_id: it.product_id,
          product_name: it.product_name,
          qty_ordered: ordered,
          qty_received: received,
          qty_to_receive: Math.max(0, ordered - received),
          qty_damaged: 0,
          batch_no: it.batch_no || "",
          serial_no: it.serial_no || "",
          expiry_date: it.expiry_date || "",
          mfg_date: it.mfg_date || "",
          line_notes: it.line_notes || "",
        };
      })
    );
  };

  const submitReceive = async (receiveAll = false) => {
    if (!receiveFor) return;
    setReceiving(true);
    try {
      const payload = receiveAll
        ? { id: receiveFor.id, receive_all: true, warehouse_id: receiveFor.warehouse_id || null }
        : {
            id: receiveFor.id,
            receive_all: false,
            warehouse_id: receiveFor.warehouse_id || null,
            lines: receiveLines
              .filter((l) => Number(l.qty_to_receive) > 0 || Number(l.qty_damaged) > 0)
              .map((l) => ({
                product_id: l.product_id,
                qty_received: Number(l.qty_to_receive) || 0,
                qty_damaged: Number(l.qty_damaged) || 0,
                batch_no: l.batch_no || null,
                serial_no: l.serial_no || null,
                expiry_date: l.expiry_date || null,
                mfg_date: l.mfg_date || null,
                line_notes: l.line_notes || null,
              })),
          };
      const result = await api.purchases.receive(payload);
      if (result?.success) {
        showToast(
          result.status === "PartiallyReceived"
            ? `${receiveFor.po_number} partially received — back order remains`
            : `${receiveFor.po_number} fully received — stock & avg cost updated`
        );
        setReceiveFor(null);
        await load();
        if (detailFor?.id === receiveFor.id) await openDetail({ ...receiveFor, status: result.status });
      } else {
        showToast(result?.error || "Could not receive this order");
      }
    } finally {
      setReceiving(false);
    }
  };

  const openPay = (po) => {
    setPayFor(po);
    setPayFx({
      original_amount: "",
      payment_currency: currency?.code || "KES",
      exchange_rate: 1,
      reference: "",
      payment_date: new Date().toISOString().slice(0, 10),
    });
    setPayMethod("Bank Transfer");
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    if (!payFor) return;
    const amount = parseFloat(payFx.original_amount || payFx.amount);
    if (!amount || amount <= 0) {
      showToast("Enter a valid payment amount");
      return;
    }
    setPaying(true);
    try {
      const result = await api.purchases.addPayment({
        purchase_id: payFor.id,
        amount,
        method: payMethod,
        payment_currency: payFx.payment_currency || currency?.code,
        exchange_rate: payFx.exchange_rate,
        original_amount: amount,
        reference: payFx.reference || null,
        payment_date: payFx.payment_date,
        invoice_currency: payFor.currency_code || currency?.code,
      });
      if (result?.success) {
        showToast("Payment recorded");
        setPayFor(null);
        await load();
        if (detailFor?.id === payFor.id) await openDetail(payFor);
      } else {
        showToast(result?.error || "Could not record payment");
      }
    } finally {
      setPaying(false);
    }
  };

  const cancelPurchase = async (po) => {
    if (!confirm(`Cancel ${po.po_number}?`)) return;
    const result = await api.purchases.cancel(po.id);
    if (result?.success) {
      showToast("Purchase cancelled");
      await load();
      if (detailFor?.id === po.id) setDetailFor(null);
    } else {
      showToast(result?.error || "Could not cancel");
    }
  };

  const markOrdered = async (po) => {
    const result = await api.purchases.updateStatus(po.id, "Ordered");
    if (result?.success) {
      showToast(`${po.po_number} marked Approved / Ordered`);
      await load();
    } else showToast(result?.error || "Could not update status");
  };

  const rejectPurchase = async (po) => {
    const reason = window.prompt(`Reject ${po.po_number}? Enter reason:`, "Rejected by approver");
    if (reason == null) return;
    const result = await api.purchases.updateStatus(po.id, "Rejected", { rejection_reason: reason });
    if (result?.success) {
      showToast(`${po.po_number} rejected`);
      await load();
      if (detailFor?.id === po.id) setDetailFor(null);
    } else showToast(result?.error || "Could not reject");
  };

  const duplicatePurchase = async (po) => {
    const result = await api.purchases.duplicate(po.id);
    if (result?.success) {
      showToast(`Draft copy created: ${result.po_number || ""}`);
      setModuleTab("orders");
      await load();
    } else showToast(result?.error || "Could not duplicate");
  };

  const submitDraft = async (po) => {
    const result = await api.purchases.updateStatus(po.id, "Pending");
    if (result?.success) {
      showToast(`${po.po_number} submitted for approval`);
      await load();
    } else showToast(result?.error || "Could not submit draft");
  };

  const openReturn = async (po) => {
    setReturnFor(po);
    setReturnLine({ product_id: "", qty: 1, cost: "", reason: "" });
    setPurchaseItems(await api.purchases.getItems(po.id));
  };

  const submitReturn = async (e) => {
    e.preventDefault();
    if (!returnLine.product_id || !returnLine.qty) {
      showToast("Choose a product and quantity");
      return;
    }
    const result = await api.purchases.createReturn({
      purchase_id: returnFor.id,
      product_id: Number(returnLine.product_id),
      qty: Number(returnLine.qty),
      cost: parseFloat(returnLine.cost) || 0,
      reason: returnLine.reason,
    });
    if (result?.success) {
      showToast(
        result.credit_note != null
          ? `Return recorded — credit note ${money(result.credit_note)}`
          : "Return recorded — stock and supplier balance updated"
      );
      setReturnFor(null);
      await load();
    } else {
      showToast(result?.error || "Could not record return");
    }
  };

  const canReceive = (po) =>
    can("purchases", "approve") &&
    !["Received", "Cancelled", "Draft", "Rejected"].includes(po.status);

  const canPay = (po) =>
    can("purchases", "edit") &&
    !["Cancelled", "Draft", "Rejected"].includes(po.status) &&
    Number(po.balance ?? Number(po.total) - Number(po.amount_paid || 0)) > 0;

  const canCancel = (po) =>
    can("purchases", "edit") &&
    ["Draft", "Pending", "Ordered"].includes(po.status);

  const canReject = (po) =>
    can("purchases", "edit") &&
    ["Draft", "Pending", "Ordered"].includes(po.status);

  const kpi = {
    total: dashboard?.total_purchases ?? purchases.filter((p) => !["Cancelled", "Rejected"].includes(p.status)).length,
    pending: dashboard?.pending_pos ?? purchases.filter((p) => ["Draft", "Pending", "Ordered"].includes(p.status)).length,
    received: dashboard?.received_orders ?? purchases.filter((p) => ["Received", "PartiallyReceived"].includes(p.status)).length,
    outstanding: dashboard?.outstanding_balance ?? purchases.reduce((s, p) => s + Math.max(0, Number(p.balance) || 0), 0),
    today: dashboard?.purchase_value_today ?? 0,
  };
  const monthlyChart = dashboard?.monthly || [];
  const branchName = (id) => branches.find((b) => Number(b.id) === Number(id))?.name || (id ? `#${id}` : "—");

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Purchase Management</h1>
          <p className="mt-1 text-base text-app-muted">
            Dashboard · PO workflow · GRN · Payments · Returns · AP accounting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {moduleTab === "orders" && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => exportPurchasesExcel(filtered).catch(() => showToast("Excel export failed"))}>
                <Download size={14} /> Excel
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => exportPurchasesPdf(filtered, money).catch(() => showToast("PDF export failed"))}>
                <FileText size={14} /> PDF
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  downloadCsv(
                    `purchases-${new Date().toISOString().slice(0, 10)}.csv`,
                    filtered.map((p) => ({
                      po_number: p.po_number,
                      supplier: p.supplier,
                      status: statusLabel(p.status),
                      total: p.total,
                      balance: p.balance,
                      due_date: p.due_date || "",
                    }))
                  )
                }
              >
                CSV
              </button>
            </>
          )}
          {can("purchases", "create") && (
            <button type="button" onClick={() => { setModuleTab("orders"); openCreate(); }} className="btn btn-primary">
              <Plus size={15} /> New Purchase Order
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-app">
        {MODULE_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setModuleTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px ${
                moduleTab === tab.id ? "border-brand text-brand" : "border-transparent text-app-muted hover:text-app-text"
              }`}
            >
              <Icon size={15} /> {tab.label}
            </button>
          );
        })}
      </div>

      {moduleTab === "dashboard" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard icon={ClipboardList} label="Total Purchases" value={kpi.total} color="#2563EB" />
            <StatCard icon={FileText} label="Pending POs" value={kpi.pending} color="#D97706" />
            <StatCard icon={PackageCheck} label="Received Orders" value={kpi.received} color="#12A150" />
            <StatCard icon={CreditCard} label="Outstanding Balances" value={money(kpi.outstanding)} color="#DC2626" />
            <StatCard icon={BarChart3} label="Purchase Value Today" value={money(kpi.today)} color="#7C3AED" />
          </div>
          <div className="rounded-xl border border-app bg-white p-4">
            <h3 className="card-title mb-3">Monthly Purchase Value</h3>
            <div className="h-64 w-full">
              {monthlyChart.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E8F0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Bar dataKey="total" fill="#2563EB" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-app-muted">No purchase data yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {moduleTab === "reports" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              { id: "outstanding", label: "Outstanding" },
              { id: "supplier", label: "By Supplier" },
              { id: "branch", label: "By Branch" },
              { id: "payments", label: "Payments" },
              { id: "returns", label: "Returns" },
              { id: "vat", label: "VAT / Tax" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setReportTab(t.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                  reportTab === t.id ? "border-brand bg-brand text-white" : "border-app bg-white text-app-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => {
                const rows =
                  reportTab === "outstanding"
                    ? reports?.outstanding || []
                    : reportTab === "supplier"
                      ? reports?.by_supplier || []
                      : reportTab === "branch"
                        ? reports?.by_branch || []
                        : reportTab === "payments"
                          ? reports?.payments || []
                          : reportTab === "returns"
                            ? reports?.returns || []
                            : reports?.vat || [];
                downloadCsv(`purchase-${reportTab}.csv`, rows);
              }}
            >
              <Download size={13} /> Export CSV
            </button>
          </div>
          <div className="table-container">
            {reportTab === "outstanding" && (
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="bg-app-panel-muted">
                    {["PO", "Supplier", "Due", "Total", "Paid", "Balance", "Status"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs uppercase text-app-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(reports?.outstanding || []).map((r) => (
                    <tr key={r.id} className="border-t border-app">
                      <td className="px-3 py-2 font-mono text-sm">{r.po_number}</td>
                      <td className="px-3 py-2 text-sm">{r.supplier}</td>
                      <td className="px-3 py-2 font-mono text-sm">{formatDueDate(r.due_date)}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.total)}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.amount_paid)}</td>
                      <td className="px-3 py-2 font-mono text-sm text-danger">{money(r.balance)}</td>
                      <td className="px-3 py-2 text-sm">{statusLabel(r.status)}</td>
                    </tr>
                  ))}
                  {!(reports?.outstanding || []).length && (
                    <tr><td colSpan={7} className="py-8 text-center text-sm text-app-muted">No outstanding balances.</td></tr>
                  )}
                </tbody>
              </table>
            )}
            {reportTab === "supplier" && (
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="bg-app-panel-muted">
                    {["Supplier", "Orders", "Total", "Paid", "Balance", "Tax"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs uppercase text-app-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(reports?.by_supplier || []).map((r) => (
                    <tr key={r.supplier_id || r.supplier} className="border-t border-app">
                      <td className="px-3 py-2 text-sm">{r.supplier}</td>
                      <td className="px-3 py-2 font-mono text-sm">{r.orders}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.total)}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.paid)}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.balance)}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {reportTab === "branch" && (
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="bg-app-panel-muted">
                    {["Branch", "Orders", "Total", "Balance"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs uppercase text-app-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(reports?.by_branch || []).map((r) => (
                    <tr key={r.branch_id || "none"} className="border-t border-app">
                      <td className="px-3 py-2 text-sm">{branchName(r.branch_id)}</td>
                      <td className="px-3 py-2 font-mono text-sm">{r.orders}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.total)}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {reportTab === "payments" && (
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="bg-app-panel-muted">
                    {["Date", "PO", "Method", "Amount", "Reference"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs uppercase text-app-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(reports?.payments || []).map((r) => (
                    <tr key={r.id} className="border-t border-app">
                      <td className="px-3 py-2 text-sm">{String(r.created_at || r.payment_date || "").slice(0, 10)}</td>
                      <td className="px-3 py-2 font-mono text-sm">#{r.purchase_id}</td>
                      <td className="px-3 py-2 text-sm">{r.method}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.base_amount ?? r.amount)}</td>
                      <td className="px-3 py-2 text-sm text-app-muted">{r.reference || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {reportTab === "returns" && (
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="bg-app-panel-muted">
                    {["Date", "PO", "Product", "Qty", "Cost", "Reason"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs uppercase text-app-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(reports?.returns || []).map((r) => (
                    <tr key={r.id} className="border-t border-app">
                      <td className="px-3 py-2 text-sm">{String(r.created_at || "").slice(0, 10)}</td>
                      <td className="px-3 py-2 font-mono text-sm">#{r.purchase_id}</td>
                      <td className="px-3 py-2 text-sm">#{r.product_id}</td>
                      <td className="px-3 py-2 font-mono text-sm">{r.qty}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.cost)}</td>
                      <td className="px-3 py-2 text-sm text-app-muted">{r.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {reportTab === "vat" && (
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="bg-app-panel-muted">
                    {["PO", "Invoice", "Date", "Supplier", "Subtotal", "VAT", "Total"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs uppercase text-app-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(reports?.vat || []).map((r) => (
                    <tr key={r.id} className="border-t border-app">
                      <td className="px-3 py-2 font-mono text-sm">{r.po_number}</td>
                      <td className="px-3 py-2 font-mono text-sm">{r.invoice_no || "—"}</td>
                      <td className="px-3 py-2 text-sm">{String(r.invoice_date || "").slice(0, 10)}</td>
                      <td className="px-3 py-2 text-sm">{r.supplier}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.subtotal)}</td>
                      <td className="px-3 py-2 font-mono text-sm">{money(r.tax_total)}</td>
                      <td className="px-3 py-2 font-mono text-sm font-semibold">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {moduleTab === "accounting" && (
        <div className="space-y-3">
          <p className="text-sm text-app-muted">
            Lightweight AP journal entries posted on receive / pay / return (Inventory ↔ Accounts Payable). Not a full ERP GL.
          </p>
          <div className="table-container">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-app-panel-muted">
                  {["Date", "Account", "Debit", "Credit", "Ref", "Memo"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs uppercase text-app-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(journal.length ? journal : reports?.accounting || []).map((j) => (
                  <tr key={j.id} className="border-t border-app">
                    <td className="px-3 py-2 text-sm">{String(j.created_at || "").slice(0, 19).replace("T", " ")}</td>
                    <td className="px-3 py-2 text-sm font-medium">{j.account}</td>
                    <td className="px-3 py-2 font-mono text-sm">{Number(j.debit) ? money(j.debit) : "—"}</td>
                    <td className="px-3 py-2 font-mono text-sm">{Number(j.credit) ? money(j.credit) : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-app-muted">{j.ref_type} #{j.ref_id}</td>
                    <td className="px-3 py-2 text-sm text-app-muted">{j.memo || "—"}</td>
                  </tr>
                ))}
                {!(journal.length || reports?.accounting?.length) && (
                  <tr><td colSpan={6} className="py-8 text-center text-sm text-app-muted">No journal entries yet — receive or pay a PO to post.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {moduleTab === "orders" && (
      <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO, supplier, invoice…"
            className="form-control w-full pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {["all", "Draft", "Pending", "Ordered", "PartiallyReceived", "Received", "Rejected", "Cancelled"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                statusFilter === s ? "border-brand bg-brand text-white" : "border-app bg-white text-app-muted"
              }`}
            >
              {s === "all" ? "All" : statusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <ListSkeleton rows={8} />
        ) : (
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="bg-app-panel-muted">
                {["PO Number", "Supplier", "Invoice", "Date", "Due", "Total", "Paid", "Balance", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-app-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((po) => {
                const [color, bg] = statusColors[po.status] || ["#6B7690", "#F1F3F8"];
                const balance = Number(po.balance ?? Number(po.total) - Number(po.amount_paid || 0));
                const due = formatDueDate(po.due_date);
                const dueSoon = po.due_date && balance > 0 && String(po.due_date).slice(0, 10) <= new Date().toISOString().slice(0, 10);
                return (
                  <tr key={po.id} className="border-t border-app hover:bg-app-panel-muted">
                    <td className="px-3 py-3 font-mono text-sm text-app-text">{po.po_number}</td>
                    <td className="px-3 py-3 text-sm text-app-text">{po.supplier}</td>
                    <td className="px-3 py-3 font-mono text-sm text-app-muted">{po.invoice_no || "—"}</td>
                    <td className="px-3 py-3 text-sm text-app-muted">{String(po.created_at).slice(0, 10)}</td>
                    <td className={`px-3 py-3 font-mono text-sm ${dueSoon ? "text-danger font-semibold" : "text-app-muted"}`}>{due}</td>
                    <td className="px-3 py-3 font-mono text-sm font-semibold text-app-text">{money(po.total)}</td>
                    <td className="px-3 py-3 font-mono text-sm text-app-muted">{money(po.amount_paid || 0)}</td>
                    <td className="px-3 py-3 font-mono text-sm font-medium" style={{ color: balance > 0 ? "#DC2626" : "#12A150" }}>{money(balance)}</td>
                    <td className="px-3 py-3">
                      <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ color, backgroundColor: bg }}>
                        {statusLabel(po.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => openDetail(po)} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                          <Eye size={12} /> View
                        </button>
                        {["Draft", "Pending", "Ordered"].includes(po.status) && can("purchases", "edit") && (
                          <button type="button" onClick={() => openEdit(po)} className="text-xs font-medium text-app-text hover:underline">Edit</button>
                        )}
                        {can("purchases", "create") && (
                          <button type="button" onClick={() => duplicatePurchase(po)} className="flex items-center gap-1 text-xs font-medium text-app-muted hover:underline">
                            <Copy size={12} /> Dup
                          </button>
                        )}
                        {po.status === "Draft" && can("purchases", "edit") && (
                          <button type="button" onClick={() => submitDraft(po)} className="text-xs font-medium text-brand hover:underline">Submit</button>
                        )}
                        {po.status === "Pending" && can("purchases", "edit") && (
                          <button type="button" onClick={() => markOrdered(po)} className="text-xs font-medium text-brand hover:underline">Approve</button>
                        )}
                        {canReject(po) && (
                          <button type="button" onClick={() => rejectPurchase(po)} className="flex items-center gap-1 text-xs font-medium text-danger hover:underline">
                            <ThumbsDown size={12} /> Reject
                          </button>
                        )}
                        {canReceive(po) && (
                          <button type="button" onClick={() => openReceive(po)} className="flex items-center gap-1 text-xs font-medium text-success hover:underline">
                            <CheckCircle2 size={13} /> Receive
                          </button>
                        )}
                        {canPay(po) && (
                          <button type="button" onClick={() => openPay(po)} className="flex items-center gap-1 text-xs font-medium text-app-text hover:underline">
                            <CreditCard size={12} /> Pay
                          </button>
                        )}
                        {["Received", "PartiallyReceived"].includes(po.status) && can("returns", "create") && (
                          <button type="button" onClick={() => openReturn(po)} className="flex items-center gap-1 text-xs font-medium text-danger hover:underline">
                            <RotateCcw size={13} /> Return
                          </button>
                        )}
                        {canCancel(po) && (
                          <button type="button" onClick={() => cancelPurchase(po)} className="flex items-center gap-1 text-xs font-medium text-danger hover:underline">
                            <Ban size={12} /> Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-sm text-app-muted">No purchase orders found.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      </>
      )}

      {modalOpen && (
        <ModalShell
          title={editingId ? "Edit Purchase Order" : "New Purchase Order"}
          subtitle="Supplier, invoice fields, branch/warehouse, then lines. Draft or submit."
          onClose={savingPo ? undefined : () => setModalOpen(false)}
          wide
        >
          <form onSubmit={handleCreate} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
            <div className="rounded-xl border border-app bg-app-panel-muted/50 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
                <Building2 size={14} /> 1. Supplier
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <Field label="Supplier" required>
                  <select
                    required
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="form-control w-full"
                    disabled={savingPo}
                  >
                    <option value="">Select a supplier…</option>
                    {suppliers.filter((s) => (s.status || "Active") === "Active").map((s) => (
                      <option key={s.id} value={s.id}>{s.code ? `${s.code} — ` : ""}{s.name}</option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="btn btn-secondary w-full whitespace-nowrap"
                    onClick={() => setSupplierDialogOpen(true)}
                    disabled={savingPo}
                  >
                    <Plus size={14} /> New Supplier
                  </button>
                </div>
                <Field label="Supplier invoice #">
                  <input
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="Unique per supplier"
                    className="form-control w-full"
                    disabled={savingPo}
                  />
                </Field>
              </div>
              {selectedSupplier && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-lg border border-dashed border-app bg-white/60 p-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-app-muted">Payment terms</div>
                    <div className="mt-0.5 text-sm font-semibold text-app-text">
                      {selectedSupplier.payment_terms || "Net 30 (default)"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-app-muted">Due date (auto)</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-brand">
                      {formatDueDate(previewDueDate)}
                    </div>
                  </div>
                  <div className="text-xs text-app-muted self-end">
                    Generated from supplier terms when you create the purchase.
                  </div>
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Invoice date">
                  <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="form-control w-full" disabled={savingPo} />
                </Field>
                <Field label="Due date (override)">
                  <input type="date" value={dueDateOverride} onChange={(e) => setDueDateOverride(e.target.value)} className="form-control w-full" disabled={savingPo} />
                </Field>
                <Field label="Status">
                  <select value={createStatus} onChange={(e) => setCreateStatus(e.target.value)} className="form-control w-full" disabled={savingPo || !!editingId}>
                    <option value="Draft">Draft</option>
                    <option value="Pending">Pending (submit for approval)</option>
                    <option value="Ordered">Approved / Ordered</option>
                  </select>
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Branch">
                  <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="form-control w-full" disabled={savingPo}>
                    <option value="">Default / caller branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Warehouse (receive into)">
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="form-control w-full" disabled={savingPo}>
                    <option value="">Optional</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ""}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={`Header discount (${currency.symbol})`}>
                  <input type="number" min="0" step="0.01" value={discountTotal} onChange={(e) => setDiscountTotal(e.target.value)} className="form-control w-full" disabled={savingPo} />
                </Field>
                <Field label={`Shipping (${currency.symbol})`}>
                  <input type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} className="form-control w-full" disabled={savingPo} />
                </Field>
                <Field label={`Other charges (${currency.symbol})`}>
                  <input type="number" min="0" step="0.01" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} className="form-control w-full" disabled={savingPo} />
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {!editingId && (
                  <Field label={`Deposit / amount paid (${currency.symbol})`}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={amountPaidOnCreate}
                      onChange={(e) => setAmountPaidOnCreate(e.target.value)}
                      className="form-control w-full"
                      disabled={savingPo}
                    />
                  </Field>
                )}
                <Field label="Attach invoice (PDF/image)">
                  <input type="file" accept="image/*,application/pdf" onChange={handleAttachment} className="form-control w-full text-xs" disabled={savingPo} />
                </Field>
              </div>
              {attachmentUrl && (
                <div className="mt-2 flex items-center gap-2 text-xs text-success">
                  <Paperclip size={12} /> Invoice attached
                  <button type="button" className="text-danger underline" onClick={() => setAttachmentUrl("")}>Remove</button>
                </div>
              )}
              <div className="mt-3">
                <Field label="Purchase notes">
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="form-control w-full" placeholder="Optional notes" disabled={savingPo} />
                </Field>
              </div>
            </div>

            <div className="rounded-xl border border-app p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
                  <PackagePlus size={14} /> 2. Purchase items
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase text-app-muted">Lines {money(orderLinesTotal)}</div>
                  <span className="font-mono text-sm font-semibold text-app-text">Grand {money(orderTotal)}</span>
                </div>
              </div>

              <div className="space-y-3">
                {lines.map((line, i) => {
                  const totals = lineTotals(line);
                  return (
                    <div key={i} className="rounded-lg border border-app bg-app-panel-muted/30 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="min-w-[220px] flex-1">
                          <ProductSelector
                            products={products}
                            value={line.product_id}
                            onChange={(productId, product) => onSelectProduct(i, productId, product)}
                            placeholder="Select existing product…"
                            disableOutOfStock={false}
                            excludeDemo={isProductionDataPlane}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setProductDialogLine(i)}
                          disabled={savingPo}
                        >
                          <PackagePlus size={14} /> Add New Product
                        </button>
                        {lines.length > 1 && (
                          <button type="button" onClick={() => removeLine(i)} className="rounded-lg p-2 text-danger hover:bg-[#FDECEC]" aria-label="Remove line">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <Field label="Qty">
                          <input type="number" min={1} value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} className="form-control w-full" disabled={savingPo} />
                        </Field>
                        <Field label={`Price (${currency.symbol})`}>
                          <input type="number" step="0.01" min="0" value={line.cost} onChange={(e) => updateLine(i, { cost: e.target.value })} className="form-control w-full" disabled={savingPo} />
                        </Field>
                        <Field label={`Discount (${currency.symbol})`}>
                          <input type="number" step="0.01" min="0" value={line.discount} onChange={(e) => updateLine(i, { discount: e.target.value })} className="form-control w-full" disabled={savingPo} />
                        </Field>
                        <Field label="Tax (%)">
                          <input type="number" step="0.01" min="0" value={line.tax} onChange={(e) => updateLine(i, { tax: e.target.value })} className="form-control w-full" disabled={savingPo} />
                        </Field>
                        <Field label="Line total">
                          <div className="form-control flex w-full items-center font-mono text-sm font-semibold">
                            {money(totals.total)}
                          </div>
                        </Field>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={addLine} className="mt-3 text-xs font-medium text-brand" disabled={savingPo}>
                + Add another item
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {!editingId && (
                <button
                  type="button"
                  className="btn btn-secondary flex-1"
                  disabled={savingPo || !supplierId}
                  onClick={() => submitPurchase("Draft")}
                >
                  {savingPo ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                  Save Draft
                </button>
              )}
              <button type="submit" className="btn btn-primary flex-1" disabled={savingPo || !supplierId}>
                {savingPo ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {savingPo
                  ? "Saving…"
                  : editingId
                    ? "Save Changes"
                    : createStatus === "Ordered"
                      ? "Create as Approved / Ordered"
                      : "Create Purchase Order"}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      <NewSupplierDialog
        open={supplierDialogOpen}
        onClose={() => setSupplierDialogOpen(false)}
        onCreated={handleSupplierCreated}
      />

      <NewProductDialog
        open={productDialogLine != null}
        onClose={() => setProductDialogLine(null)}
        onCreated={handleProductCreated}
        categories={categories}
        brands={brands}
        units={units}
        currency={currency}
      />

      {detailFor && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDetailFor(null)}>
          <div className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl animate-slidein" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-app bg-white px-5 py-4">
              <div>
                <h3 className="font-semibold text-app-text font-mono">{detailFor.po_number}</h3>
                <p className="text-xs text-app-muted mt-0.5">{detailFor.supplier} · {statusLabel(detailFor.status)}</p>
              </div>
              <div className="flex items-center gap-1">
                {can("purchases", "print") && (
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-app-muted hover:bg-app-panel-muted"
                    title="Print PO"
                    onClick={() => {
                      const supplier = suppliers.find((s) => Number(s.id) === Number(detailFor.supplier_id));
                      printPurchaseOrder(detailFor, detailItems, money, supplier);
                    }}
                  >
                    <Printer size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-app-muted hover:bg-app-panel-muted"
                  title="Email PO"
                  onClick={() => {
                    const supplier = suppliers.find((s) => Number(s.id) === Number(detailFor.supplier_id));
                    emailPurchaseOrder(detailFor, supplier);
                  }}
                >
                  <Mail size={16} />
                </button>
                <button type="button" onClick={() => setDetailFor(null)} className="text-app-muted"><X size={18} /></button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 px-5 py-4">
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase text-app-muted">Total</div>
                <div className="font-mono text-sm font-bold">{money(detailFor.total)}</div>
              </div>
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase text-app-muted">Paid</div>
                <div className="font-mono text-sm font-bold">{money(detailFor.amount_paid || 0)}</div>
              </div>
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase text-app-muted">Balance</div>
                <div className="font-mono text-sm font-bold text-danger">
                  {money(detailFor.balance ?? Number(detailFor.total) - Number(detailFor.amount_paid || 0))}
                </div>
              </div>
            </div>
            {(detailFor.notes || detailFor.attachment_url || detailFor.invoice_no) && (
              <div className="space-y-1 border-b border-app px-5 pb-4 text-xs text-app-muted">
                {detailFor.payment_terms && <div>Terms: <span className="font-medium text-app-text">{detailFor.payment_terms}</span></div>}
                {detailFor.due_date && <div>Due date: <span className="font-mono font-semibold text-app-text">{formatDueDate(detailFor.due_date)}</span></div>}
                {detailFor.invoice_no && <div>Invoice: <span className="font-mono text-app-text">{detailFor.invoice_no}</span></div>}
                {detailFor.notes && <div>Notes: <span className="text-app-text">{detailFor.notes}</span></div>}
                {detailFor.attachment_url && (
                  <a href={detailFor.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                    <Paperclip size={12} /> View attached invoice
                  </a>
                )}
              </div>
            )}
            <div className="flex gap-1 border-b border-app px-5">
              {[
                { id: "lines", label: "Lines" },
                { id: "payments", label: "Payments" },
                { id: "audit", label: "Audit" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDetailTab(tab.id)}
                  className={`px-3 py-2.5 text-xs font-medium border-b-2 -mb-px ${
                    detailTab === tab.id ? "border-brand text-brand" : "border-transparent text-app-muted"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="px-5 py-4">
              {detailTab === "lines" ? (
                <div className="space-y-2">
                  {detailItems.map((it) => (
                    <div key={it.id} className="flex justify-between gap-3 border-b border-[#F1F3F8] py-2 text-sm">
                      <div>
                        <div className="text-app-text">{it.product_name}</div>
                        <div className="text-xs text-app-muted">
                          Ordered {it.qty_ordered ?? it.qty} · Received {it.qty_received || 0}
                          {it.back_order > 0 ? ` · Back order ${it.back_order}` : ""}
                          {it.qty_damaged ? ` · Damaged ${it.qty_damaged}` : ""}
                          {" · "}{money(it.cost)} ea
                        </div>
                        {(it.batch_no || it.serial_no || it.expiry_date) && (
                          <div className="text-[10px] text-app-muted">
                            {[it.batch_no && `Batch ${it.batch_no}`, it.serial_no && `S/N ${it.serial_no}`, it.expiry_date && `Exp ${it.expiry_date}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                      <div className="font-mono">{money(it.line_total ?? lineTotals({ qty: it.qty, cost: it.cost, discount: it.discount, tax: it.tax }).total)}</div>
                    </div>
                  ))}
                  {detailItems.length === 0 && <div className="py-6 text-center text-sm text-app-muted">No lines.</div>}
                </div>
              ) : detailTab === "payments" ? (
                <div className="space-y-2">
                  {detailPayments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 border-b border-[#F1F3F8] py-2 text-sm">
                      <div>
                        <div>{p.method}</div>
                        <div className="text-xs text-app-muted">{String(p.created_at).slice(0, 10)} {p.reference ? `· ${p.reference}` : ""}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-success">-{money(p.amount)}</span>
                        <button
                          type="button"
                          className="rounded p-1 text-app-muted hover:bg-app-panel-muted"
                          title="Print receipt"
                          onClick={() => printPaymentReceipt(detailFor, p, money)}
                        >
                          <Printer size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {detailPayments.length === 0 && <div className="py-6 text-center text-sm text-app-muted">No payments yet.</div>}
                </div>
              ) : (
                <div className="space-y-2">
                  {detailAudit.map((a) => (
                    <div key={a.id} className="border-b border-[#F1F3F8] py-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium text-app-text">{a.action}</span>
                        <span className="text-xs text-app-muted">{String(a.created_at || "").slice(0, 19).replace("T", " ")}</span>
                      </div>
                      <div className="text-xs text-app-muted">{a.user_name || "—"}</div>
                    </div>
                  ))}
                  {detailAudit.length === 0 && <div className="py-6 text-center text-sm text-app-muted">No audit entries for this PO.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {receiveFor && (
        <ModalShell
          title={`GRN — ${receiveFor.po_number}`}
          subtitle="Partial receive leaves back orders. Damaged qty is noted but not stocked. Batch/serial/expiry optional."
          onClose={receiving ? undefined : () => setReceiveFor(null)}
          wide
        >
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {receiveLines.map((line, i) => (
              <div key={`${line.product_id}-${i}`} className="space-y-2 rounded-lg border border-app p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="col-span-2 sm:col-span-1">
                    <div className="text-xs text-app-muted">Product</div>
                    <div className="text-sm font-medium">{line.product_name}</div>
                    <div className="text-[10px] text-app-muted">Back order {Math.max(0, line.qty_ordered - line.qty_received)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-app-muted">Ordered</div>
                    <div className="font-mono text-sm">{line.qty_ordered}</div>
                  </div>
                  <div>
                    <div className="text-xs text-app-muted">Already recv.</div>
                    <div className="font-mono text-sm">{line.qty_received}</div>
                  </div>
                  <div>
                    <label className="text-xs text-app-muted">Receive now</label>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, line.qty_ordered - line.qty_received)}
                      value={line.qty_to_receive}
                      onChange={(e) =>
                        setReceiveLines((rows) =>
                          rows.map((r, idx) => (idx === i ? { ...r, qty_to_receive: e.target.value } : r))
                        )
                      }
                      className="form-control w-full"
                      disabled={receiving}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Field label="Damaged">
                    <input
                      type="number"
                      min={0}
                      value={line.qty_damaged}
                      onChange={(e) =>
                        setReceiveLines((rows) =>
                          rows.map((r, idx) => (idx === i ? { ...r, qty_damaged: e.target.value } : r))
                        )
                      }
                      className="form-control w-full"
                      disabled={receiving}
                    />
                  </Field>
                  <Field label="Batch / Lot">
                    <input
                      value={line.batch_no}
                      onChange={(e) =>
                        setReceiveLines((rows) =>
                          rows.map((r, idx) => (idx === i ? { ...r, batch_no: e.target.value } : r))
                        )
                      }
                      className="form-control w-full"
                      disabled={receiving}
                    />
                  </Field>
                  <Field label="Serial">
                    <input
                      value={line.serial_no}
                      onChange={(e) =>
                        setReceiveLines((rows) =>
                          rows.map((r, idx) => (idx === i ? { ...r, serial_no: e.target.value } : r))
                        )
                      }
                      className="form-control w-full"
                      placeholder="Optional text"
                      disabled={receiving}
                    />
                  </Field>
                  <Field label="Expiry">
                    <input
                      type="date"
                      value={line.expiry_date || ""}
                      onChange={(e) =>
                        setReceiveLines((rows) =>
                          rows.map((r, idx) => (idx === i ? { ...r, expiry_date: e.target.value } : r))
                        )
                      }
                      className="form-control w-full"
                      disabled={receiving}
                    />
                  </Field>
                  <Field label="Mfg date">
                    <input
                      type="date"
                      value={line.mfg_date || ""}
                      onChange={(e) =>
                        setReceiveLines((rows) =>
                          rows.map((r, idx) => (idx === i ? { ...r, mfg_date: e.target.value } : r))
                        )
                      }
                      className="form-control w-full"
                      disabled={receiving}
                    />
                  </Field>
                  <Field label="Notes">
                    <input
                      value={line.line_notes}
                      onChange={(e) =>
                        setReceiveLines((rows) =>
                          rows.map((r, idx) => (idx === i ? { ...r, line_notes: e.target.value } : r))
                        )
                      }
                      className="form-control w-full"
                      placeholder="Damaged / expired note"
                      disabled={receiving}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn btn-secondary flex-1" disabled={receiving} onClick={() => submitReceive(false)}>
              {receiving ? <Loader2 size={15} className="animate-spin" /> : <PackageCheck size={15} />}
              Receive Selected
            </button>
            <button type="button" className="btn btn-primary flex-1" disabled={receiving} onClick={() => submitReceive(true)}>
              {receiving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Receive All Remaining
            </button>
          </div>
        </ModalShell>
      )}

      {payFor && (
        <ModalShell title={`Payment — ${payFor.po_number}`} onClose={paying ? undefined : () => setPayFor(null)}>
          <p className="mb-3 text-xs text-app-muted">
            Outstanding: <span className="font-mono font-semibold text-app-text">
              {money(payFor.balance ?? Number(payFor.total) - Number(payFor.amount_paid || 0))}
            </span>
            {payFor.currency_code ? ` · Invoice ${payFor.currency_code}` : ""}
          </p>
          <form onSubmit={submitPayment} className="space-y-3">
            <CurrencyMoneyFields
              value={payFx}
              onChange={setPayFx}
              disabled={paying}
              invoiceCurrency={payFor.currency_code || currency?.code}
            />
            <Field label="Method">
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="form-control w-full" disabled={paying}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <button type="submit" className="btn btn-primary w-full" disabled={paying}>
              {paying ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
              Record Payment
            </button>
          </form>
        </ModalShell>
      )}

      {returnFor && (
        <ModalShell title={`Return Items — ${returnFor.po_number}`} onClose={() => setReturnFor(null)}>
          <form onSubmit={submitReturn} className="space-y-3">
            <select
              required
              value={returnLine.product_id}
              onChange={(e) => {
                const item = purchaseItems.find((it) => String(it.product_id) === e.target.value);
                setReturnLine({
                  ...returnLine,
                  product_id: e.target.value,
                  cost: item ? String(item.cost) : returnLine.cost,
                });
              }}
              className="form-control w-full"
            >
              <option value="">Product on this order…</option>
              {purchaseItems.map((it) => (
                <option key={it.id} value={it.product_id}>
                  {it.product_name} (recv {it.qty_received || it.qty})
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input
                required
                type="number"
                min={1}
                placeholder="Qty to return"
                value={returnLine.qty}
                onChange={(e) => setReturnLine({ ...returnLine, qty: e.target.value })}
                className="form-control w-full"
              />
              <input
                type="number"
                step="0.01"
                placeholder={`Unit cost (${currency.code} ${currency.symbol})`}
                value={returnLine.cost}
                onChange={(e) => setReturnLine({ ...returnLine, cost: e.target.value })}
                className="form-control w-full"
              />
            </div>
            <input
              placeholder="Reason (e.g. damaged, wrong item)"
              value={returnLine.reason}
              onChange={(e) => setReturnLine({ ...returnLine, reason: e.target.value })}
              className="form-control w-full"
            />
            <button type="submit" className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#DC2626] py-2.5 text-sm font-semibold text-white hover:brightness-110">
              <RotateCcw size={15} /> Record Return
            </button>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
