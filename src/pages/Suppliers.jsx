import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Building2, Phone, Users, X, Save, Trash2, FileText, CreditCard, Pencil,
  Search, Wallet, Mail, MapPin, LayoutGrid, List, Package, Download, Printer,
  Hash, Calendar, BookOpen, Archive, RotateCcw, ArrowUpDown, FileSpreadsheet,
  ExternalLink, Activity, CheckCircle2,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import CurrencyMoneyFields from "../components/CurrencyMoneyFields";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ListSkeleton } from "@/components/ui/skeleton";
import { DEFAULT_PAGE_SIZE } from "../lib/requestCache";

const emptyForm = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  tax_number: "",
  payment_terms: "Net 30",
  credit_limit: "",
  opening_balance: "",
  notes: "",
  status: "Active",
};

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "M-Pesa", "Card", "Cheque"];
const PAYMENT_TERMS = ["COD", "Net 7", "Net 15", "Net 30", "30 Days", "Net 45", "Net 60"];
const STATUS_STYLES = {
  Active: "text-success bg-[#E8FAEF]",
  Inactive: "text-app-muted bg-[#F1F3F8]",
  Archived: "text-[#D97706] bg-[#FEF3E2]",
};

const MODULE_TABS = [
  { id: "directory", label: "Directory" },
  { id: "reports", label: "Reports" },
];

const REPORT_TABS = [
  { id: "outstanding", label: "Outstanding" },
  { id: "purchases", label: "Purchase History" },
  { id: "payments", label: "Payment History" },
  { id: "top", label: "Top Suppliers" },
];

const SORT_OPTIONS = [
  { id: "name-asc", label: "Name A–Z", key: "name", dir: 1 },
  { id: "name-desc", label: "Name Z–A", key: "name", dir: -1 },
  { id: "balance-desc", label: "Balance high", key: "balance", dir: -1 },
  { id: "balance-asc", label: "Balance low", key: "balance", dir: 1 },
  { id: "purchases-desc", label: "Purchases high", key: "total_ordered", dir: -1 },
  { id: "recent", label: "Recently active", key: "last_purchase_at", dir: -1 },
];

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="nx-kpi">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: color + "1A" }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="nx-kpi-value truncate">{value}</div>
      <div className="nx-kpi-label">{label}</div>
    </div>
  );
}

function fmtDate(value) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function supplierStatus(s) {
  if (s?.deleted_at) return "Inactive";
  if (s?.archived_at || s?.status === "Archived") return "Archived";
  return s?.status || "Active";
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openPrintWindow(title, bodyHtml) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=920,height=720");
  if (!win) return null;
  win.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>
      body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#1B2439}
      h1{font-size:20px;margin:0 0 4px} .muted{color:#6B7690;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
      th,td{border-bottom:1px solid #E5E8F0;padding:8px;text-align:left}
      th{background:#F5F7FB;text-transform:uppercase;font-size:10px;letter-spacing:.04em}
      .kpis{display:flex;gap:16px;margin-top:12px;flex-wrap:wrap}
      .kpi{flex:1;min-width:120px;background:#F5F7FB;padding:10px;border-radius:8px}
      @media print{body{padding:0}}
    </style></head><body>${bodyHtml}<script>window.onload=()=>{window.print();}</script></body></html>`);
  win.document.close();
  return win;
}

function printStatement(supplier, statement, money) {
  const ledger = statement?.ledger || [];
  const rows = ledger
    .map(
      (e) =>
        `<tr>
          <td>${fmtDate(e.entry_date)}</td>
          <td>${e.entry_type || ""}</td>
          <td>${e.reference || ""}</td>
          <td>${e.description || ""}</td>
          <td style="text-align:right">${Number(e.debit) ? money(e.debit) : ""}</td>
          <td style="text-align:right">${Number(e.credit) ? money(e.credit) : ""}</td>
        </tr>`
    )
    .join("");
  openPrintWindow(
    `Supplier Statement — ${supplier.name}`,
    `<h1>${supplier.name}</h1>
    <div class="muted">${supplier.code || ""} · ${supplier.tax_number ? `Tax PIN ${supplier.tax_number} · ` : ""}${supplier.payment_terms || ""}</div>
    <div class="kpis">
      <div class="kpi"><div class="muted">Total Purchases</div><strong>${money(supplier.total_ordered)}</strong></div>
      <div class="kpi"><div class="muted">Total Paid</div><strong>${money(supplier.total_paid)}</strong></div>
      <div class="kpi"><div class="muted">Outstanding</div><strong>${money(supplier.balance)}</strong></div>
    </div>
    <table><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">No ledger entries</td></tr>'}</tbody></table>`
  );
}

function printPaymentReceipt(supplier, payment, money) {
  if (!payment) return;
  openPrintWindow(
    `Payment Receipt — ${supplier.name}`,
    `<h1>Supplier Payment Receipt</h1>
    <div class="muted">Nexora POS · ${fmtDate(payment.created_at || payment.payment_date)}</div>
    <div class="kpis">
      <div class="kpi"><div class="muted">Supplier</div><strong>${supplier.name}</strong></div>
      <div class="kpi"><div class="muted">Method</div><strong>${payment.method || "Cash"}</strong></div>
      <div class="kpi"><div class="muted">Amount</div><strong>${
        payment.payment_currency
          ? `${payment.payment_currency} ${Number(payment.original_amount ?? payment.amount).toLocaleString()}`
          : money(payment.amount)
      }</strong></div>
    </div>
    <p class="muted">Reference: ${payment.reference || payment.id || "—"}</p>
    <p class="muted">Outstanding after payment: ${money(supplier.balance)}</p>`
  );
}

function printSupplierDirectory(rows, money) {
  const body = rows
    .map(
      (s) =>
        `<tr>
          <td>${s.code || ""}</td><td>${s.name}</td><td>${s.contact_person || ""}</td>
          <td>${s.phone || ""}</td><td>${money(s.total_ordered)}</td>
          <td>${money(s.total_paid)}</td><td>${money(s.balance)}</td><td>${supplierStatus(s)}</td>
        </tr>`
    )
    .join("");
  openPrintWindow(
    "Supplier Directory",
    `<h1>Supplier Directory</h1>
    <div class="muted">Printed ${new Date().toLocaleString()}</div>
    <table><thead><tr><th>Code</th><th>Supplier</th><th>Contact</th><th>Phone</th><th>Purchases</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
    <tbody>${body || '<tr><td colspan="8">No suppliers</td></tr>'}</tbody></table>`
  );
}

async function exportSuppliersExcel(rows) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((s) => ({
      Code: s.code,
      Company: s.name,
      Contact: s.contact_person,
      Phone: s.phone,
      Email: s.email,
      Address: s.address,
      "Tax PIN": s.tax_number,
      Terms: s.payment_terms,
      "Opening Balance": s.opening_balance,
      "Credit Limit": s.credit_limit,
      Purchases: s.total_ordered,
      Paid: s.total_paid,
      Balance: s.balance,
      Status: supplierStatus(s),
      "Last Purchase": fmtDate(s.last_purchase_at),
      "Last Payment": fmtDate(s.last_payment_at),
    }))
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Suppliers");
  XLSX.writeFile(book, `suppliers-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function exportSuppliersPdf(rows, money) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.setTextColor(37, 99, 235);
  doc.text("Nexora POS — Supplier Directory", 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(90, 102, 125);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 22);
  let y = 32;
  doc.setFontSize(8);
  doc.setTextColor(27, 36, 57);
  const header = "Code | Supplier | Contact | Phone | Purchases | Paid | Balance | Status";
  doc.text(header, 14, y);
  y += 6;
  doc.setDrawColor(228, 233, 242);
  doc.line(14, y - 2, 280, y - 2);
  for (const s of rows.slice(0, 40)) {
    if (y > 190) {
      doc.addPage();
      y = 20;
    }
    const line = [
      s.code || "—",
      String(s.name || "").slice(0, 28),
      String(s.contact_person || "—").slice(0, 16),
      String(s.phone || "—").slice(0, 14),
      money(s.total_ordered),
      money(s.total_paid),
      money(s.balance),
      supplierStatus(s),
    ].join(" | ");
    doc.text(line, 14, y);
    y += 6;
  }
  if (rows.length > 40) {
    doc.text(`…and ${rows.length - 40} more (export Excel/CSV for full list)`, 14, y + 4);
  }
  doc.save(`suppliers-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export default function Suppliers() {
  const navigate = useNavigate();
  const { formatMoney: money, currency } = useEnterpriseSettings();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moduleTab, setModuleTab] = useState("directory");
  const [reportTab, setReportTab] = useState("outstanding");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [filter, setFilter] = useState("all");
  const [sortId, setSortId] = useState("name-asc");
  const [view, setView] = useState("cards");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [detailFor, setDetailFor] = useState(null);
  const [statement, setStatement] = useState(null);
  const [detailTab, setDetailTab] = useState("ledger");
  const [showDeleted, setShowDeleted] = useState(false);
  const [splitPay, setSplitPay] = useState(false);
  const [splitRows, setSplitRows] = useState([
    { amount: "", method: "Cash" },
    { amount: "", method: "M-Pesa" },
  ]);
  const [paymentFx, setPaymentFx] = useState({
    original_amount: "",
    payment_currency: "",
    exchange_rate: 1,
    reference: "",
    payment_date: new Date().toISOString().slice(0, 10),
  });
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  const load = async () => {
    setLoading(true);
    try {
      const [list, dash, reps] = await Promise.all([
        api.suppliers.getAll({ include_archived: true, include_deleted: showDeleted }).catch(() => []),
        api.suppliers.getDashboard?.().catch(() => null) || Promise.resolve(null),
        api.suppliers.getReports?.().catch(() => null) || Promise.resolve(null),
      ]);
      setSuppliers(Array.isArray(list) ? list : []);
      setDashboard(dash);
      setReports(reps);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [showDeleted]);

  const filtered = useMemo(() => {
    const sort = SORT_OPTIONS.find((s) => s.id === sortId) || SORT_OPTIONS[0];
    const rows = suppliers.filter((s) => {
      const q = debouncedSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.code || "").toLowerCase().includes(q) ||
        (s.contact_person || "").toLowerCase().includes(q) ||
        (s.phone || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q) ||
        (s.tax_number || "").toLowerCase().includes(q) ||
        (s.payment_terms || "").toLowerCase().includes(q) ||
        (s.address || "").toLowerCase().includes(q);
      if (!matchesSearch) return false;
      const st = supplierStatus(s);
      if (filter === "balance") return Number(s.balance) > 0;
      if (filter === "active") return st === "Active";
      if (filter === "inactive") return st === "Inactive";
      if (filter === "archived") return st === "Archived";
      return true;
    });
    rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (sort.key === "name") return String(av || "").localeCompare(String(bv || "")) * sort.dir;
      if (sort.key === "last_purchase_at") return String(av || "").localeCompare(String(bv || "")) * sort.dir;
      return (Number(av) - Number(bv)) * sort.dir;
    });
    return rows;
  }, [suppliers, debouncedSearch, filter, sortId]);

  const pageSize = DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const paged = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filter, sortId]);

  const stats = {
    total: dashboard?.total_suppliers ?? suppliers.filter((s) => !s.deleted_at).length,
    active:
      dashboard?.active_suppliers ??
      suppliers.filter((s) => supplierStatus(s) === "Active").length,
    balances: dashboard?.outstanding_balance ?? suppliers.reduce((sum, s) => sum + Number(s.balance || 0), 0),
    ordered: dashboard?.total_purchases ?? suppliers.reduce((sum, s) => sum + Number(s.total_ordered || 0), 0),
    paid: dashboard?.total_payments ?? suppliers.reduce((sum, s) => sum + Number(s.total_paid || 0), 0),
  };
  const recentTx = dashboard?.recent_transactions || [];

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setModalOpen(true); };
  const openEdit = (s) => {
    setForm({
      name: s.name,
      contact_person: s.contact_person || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      tax_number: s.tax_number || "",
      payment_terms: s.payment_terms || "",
      credit_limit: s.credit_limit != null ? String(s.credit_limit) : "",
      opening_balance: s.opening_balance != null ? String(s.opening_balance) : "",
      notes: s.notes || "",
      status: supplierStatus(s) === "Archived" ? "Archived" : s.status || "Active",
    });
    setEditingId(s.id);
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Company name is required"); return; }
    if (!can(editingId ? "suppliers" : "suppliers", editingId ? "edit" : "create")) {
      showToast("Permission denied");
      return;
    }
    const payload = {
      name: form.name.trim(),
      contact_person: form.contact_person.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      tax_number: form.tax_number.trim(),
      payment_terms: form.payment_terms.trim(),
      credit_limit: parseFloat(form.credit_limit) || 0,
      opening_balance: parseFloat(form.opening_balance) || 0,
      notes: form.notes.trim(),
      status: form.status || "Active",
    };
    const result = editingId
      ? await api.suppliers.update({ id: editingId, ...payload })
      : await api.suppliers.create(payload);
    if (result.success) {
      showToast(editingId ? "Supplier updated" : "Supplier added");
      setForm(emptyForm);
      setEditingId(null);
      setModalOpen(false);
      await load();
      if (detailFor && editingId === detailFor.id) {
        const updated = (await api.suppliers.getAll({ include_archived: true, include_deleted: true })).find((s) => s.id === editingId);
        if (updated) setDetailFor(updated);
      }
    } else showToast(result.error || "Could not save supplier");
  };

  const handleArchive = async (s) => {
    if (!can("suppliers", "edit")) { showToast("Permission denied"); return; }
    if (!confirm(`Archive "${s.name}"?`)) return;
    const result = await api.suppliers.archive(s.id);
    if (result.success) {
      showToast("Supplier archived");
      if (detailFor?.id === s.id) setDetailFor(result.supplier || { ...s, status: "Archived" });
      await load();
    } else showToast(result.error || "Could not archive");
  };

  const handleRestore = async (s) => {
    if (!can("suppliers", "edit")) { showToast("Permission denied"); return; }
    const result = await api.suppliers.restore(s.id);
    if (result.success) {
      showToast("Supplier restored");
      if (detailFor?.id === s.id) setDetailFor(result.supplier || { ...s, status: "Active", deleted_at: null, archived_at: null });
      await load();
    } else showToast(result.error || "Could not restore");
  };

  const handleDelete = async (s) => {
    if (!can("suppliers", "delete")) { showToast("Permission denied"); return; }
    if (!confirm(`Soft-delete "${s.name}"? Ledger history is preserved.`)) return;
    const result = await api.suppliers.delete(s.id);
    if (result.success) {
      showToast(result.soft ? "Supplier soft-deleted" : "Supplier removed");
      if (detailFor?.id === s.id) { setDetailFor(null); setStatement(null); }
      await load();
    } else showToast(result.error || "Could not remove supplier");
  };

  const openDetail = async (s, tab = "ledger") => {
    setDetailFor(s);
    setDetailTab(tab);
    setStatement(null);
    setSplitPay(false);
    const data = await api.suppliers.getStatement(s.id);
    setStatement(data);
    if (data?.supplier) setDetailFor(data.supplier);
  };

  const refreshDetail = async () => {
    if (!detailFor) return;
    await load();
    const data = await api.suppliers.getStatement(detailFor.id);
    setStatement(data);
    if (data?.supplier) setDetailFor(data.supplier);
  };

  const recordPayment = async () => {
    if (!can("suppliers", "edit")) { showToast("Permission denied"); return; }
    let payload;
    if (splitPay) {
      const splits = splitRows
        .map((r) => ({ amount: parseFloat(r.amount), method: r.method }))
        .filter((r) => r.amount > 0);
      if (!splits.length) { showToast("Enter at least one split amount"); return; }
      payload = {
        supplier_id: detailFor.id,
        splits,
        reference: paymentFx.reference || null,
        payment_date: paymentFx.payment_date,
        payment_currency: paymentFx.payment_currency || currency?.code,
        exchange_rate: paymentFx.exchange_rate,
      };
    } else {
      const amount = parseFloat(paymentFx.original_amount || paymentFx.amount);
      if (!amount || amount <= 0) { showToast("Enter a valid amount"); return; }
      payload = {
        supplier_id: detailFor.id,
        amount,
        method: paymentMethod,
        payment_currency: paymentFx.payment_currency || currency?.code,
        exchange_rate: paymentFx.exchange_rate,
        original_amount: amount,
        reference: paymentFx.reference || null,
        payment_date: paymentFx.payment_date,
      };
    }
    const result = await api.suppliers.addPayment(payload);
    if (result.success) {
      showToast(splitPay ? "Split payment recorded" : "Payment recorded");
      const pay = result.payment || result.payments?.[0];
      if (pay && can("suppliers", "print")) printPaymentReceipt(detailFor, pay, money);
      setPaymentFx({
        original_amount: "",
        payment_currency: currency?.code || "",
        exchange_rate: 1,
        reference: "",
        payment_date: new Date().toISOString().slice(0, 10),
      });
      setSplitRows([
        { amount: "", method: "Cash" },
        { amount: "", method: "M-Pesa" },
      ]);
      await refreshDetail();
    } else showToast(result.error || "Could not record payment");
  };

  const exportDirectory = async (type) => {
    if (!can("suppliers", "export") && !can("suppliers", "view")) {
      showToast("Export not permitted");
      return;
    }
    try {
      if (type === "csv") {
        downloadCsv(`suppliers-${new Date().toISOString().slice(0, 10)}.csv`, [
          ["Code", "Company", "Contact", "Phone", "Email", "Tax PIN", "Payment Terms", "Opening Balance", "Credit Limit", "Total Purchases", "Total Paid", "Balance", "Last Purchase", "Last Payment", "Status"],
          ...filtered.map((s) => [
            s.code, s.name, s.contact_person, s.phone, s.email, s.tax_number, s.payment_terms,
            s.opening_balance, s.credit_limit, s.total_ordered, s.total_paid, s.balance,
            fmtDate(s.last_purchase_at), fmtDate(s.last_payment_at), supplierStatus(s),
          ]),
        ]);
      } else if (type === "excel") {
        await exportSuppliersExcel(filtered);
      } else if (type === "pdf") {
        await exportSuppliersPdf(filtered, money);
      }
      showToast(`Suppliers exported (${type.toUpperCase()})`);
    } catch (err) {
      showToast(err?.message || "Export failed");
    }
  };

  const exportStatement = async (type = "csv") => {
    if (!detailFor || !statement) return;
    if (type === "pdf") {
      printStatement(detailFor, statement, money);
      return;
    }
    downloadCsv(`supplier-statement-${detailFor.code || detailFor.id}.csv`, [
      ["Date", "Type", "Reference", "Description", "Debit", "Credit"],
      ...(statement.ledger || []).map((e) => [
        fmtDate(e.entry_date), e.entry_type, e.reference, e.description, e.debit, e.credit,
      ]),
    ]);
    showToast("Statement exported");
  };

  const goCreatePo = (supplier) => {
    if (!can("purchases", "create")) { showToast("Purchase create not permitted"); return; }
    navigate(`/purchases?supplier_id=${supplier.id}&action=create`);
  };

  return (
    <div className="animate-fadein">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="page-title">Supplier Management</h1>
          <p className="mt-1 text-base text-app-muted">Vendors, ledgers, payments, purchase orders, and AP reports.</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {can("suppliers", "export") && (
            <>
              <button type="button" onClick={() => exportDirectory("pdf")} className="btn btn-secondary"><FileText size={15} /> PDF</button>
              <button type="button" onClick={() => exportDirectory("excel")} className="btn btn-secondary"><FileSpreadsheet size={15} /> Excel</button>
              <button type="button" onClick={() => exportDirectory("csv")} className="btn btn-secondary"><Download size={15} /> CSV</button>
            </>
          )}
          {can("suppliers", "print") && (
            <button type="button" onClick={() => printSupplierDirectory(filtered, money)} className="btn btn-secondary"><Printer size={15} /> Print</button>
          )}
          {can("suppliers", "create") && (
            <button type="button" onClick={openAdd} className="btn btn-primary"><Plus size={15} /> Add Supplier</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
        <StatCard icon={Building2} label="Total Suppliers" value={stats.total} color="#2563EB" />
        <StatCard icon={CheckCircle2} label="Active" value={stats.active} color="#12A150" />
        <StatCard icon={CreditCard} label="Outstanding Balance" value={money(stats.balances)} color="#DC2626" />
        <StatCard icon={Package} label="Total Purchases" value={money(stats.ordered)} color="#0EA5E9" />
        <StatCard icon={Wallet} label="Total Payments" value={money(stats.paid)} color="#7C3AED" />
      </div>

      {recentTx.length > 0 && (
        <div className="card mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} className="text-brand" />
            <h2 className="text-sm font-semibold text-app-text">Recent Transactions</h2>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {recentTx.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-[#F1F3F8] last:border-0">
                <div className="min-w-0">
                  <div className="text-app-text truncate">
                    <span className="text-xs uppercase tracking-wide text-app-muted mr-2">{tx.kind}</span>
                    {tx.supplier} · {tx.reference || "—"}
                  </div>
                  <div className="text-xs text-app-muted">{fmtDate(tx.date)} · {tx.status}</div>
                </div>
                <div className={`font-mono shrink-0 ${tx.kind === "payment" ? "text-success" : "text-app-text"}`}>
                  {tx.kind === "payment" ? "-" : ""}{money(tx.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="nx-segmented mb-4" aria-label="Supplier module tabs">
        {MODULE_TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setModuleTab(t.id)} className={moduleTab === t.id ? "is-active" : ""}>
            {t.label}
          </button>
        ))}
      </div>

      {moduleTab === "reports" ? (
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            {REPORT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setReportTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  reportTab === t.id ? "bg-brand text-white border-brand" : "bg-white text-app-muted border-app"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!reports ? (
            <ListSkeleton rows={5} />
          ) : (
            <div className="table-container">
              {reportTab === "outstanding" && (
                <table className="w-full min-w-[720px]">
                  <thead><tr className="bg-app-panel-muted">
                    {["Code", "Supplier", "Terms", "Credit Limit", "Outstanding", "Last PO", "Last Pay"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-xs uppercase tracking-wide text-app-muted text-left">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {(reports.outstanding || []).map((r) => (
                      <tr key={r.id} className="border-t border-app hover:bg-app-panel-muted cursor-pointer" onClick={() => openDetail(r)}>
                        <td className="px-3 py-3 font-mono text-xs">{r.code || "—"}</td>
                        <td className="px-3 py-3 text-sm font-medium">{r.name}</td>
                        <td className="px-3 py-3 text-xs">{r.payment_terms || "—"}</td>
                        <td className="px-3 py-3 font-mono text-sm">{money(r.credit_limit)}</td>
                        <td className="px-3 py-3 font-mono text-sm text-danger">{money(r.balance)}</td>
                        <td className="px-3 py-3 text-xs text-app-muted">{fmtDate(r.last_purchase_at)}</td>
                        <td className="px-3 py-3 text-xs text-app-muted">{fmtDate(r.last_payment_at)}</td>
                      </tr>
                    ))}
                    {(reports.outstanding || []).length === 0 && (
                      <tr><td colSpan={7} className="text-center py-10 text-sm text-app-muted">No outstanding balances.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              {reportTab === "purchases" && (
                <table className="w-full min-w-[800px]">
                  <thead><tr className="bg-app-panel-muted">
                    {["PO", "Supplier", "Status", "Date", "Total", "Paid", "Balance"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-xs uppercase tracking-wide text-app-muted text-left">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {(reports.purchase_history || []).map((r) => (
                      <tr key={r.id} className="border-t border-app">
                        <td className="px-3 py-3 font-mono text-xs">{r.po_number}</td>
                        <td className="px-3 py-3 text-sm">{r.supplier}</td>
                        <td className="px-3 py-3 text-xs">{r.status === "Ordered" ? "Approved / Ordered" : r.status}</td>
                        <td className="px-3 py-3 text-xs text-app-muted">{fmtDate(r.created_at)}</td>
                        <td className="px-3 py-3 font-mono text-sm">{money(r.total)}</td>
                        <td className="px-3 py-3 font-mono text-sm">{money(r.amount_paid)}</td>
                        <td className="px-3 py-3 font-mono text-sm">{money(r.balance)}</td>
                      </tr>
                    ))}
                    {(reports.purchase_history || []).length === 0 && (
                      <tr><td colSpan={7} className="text-center py-10 text-sm text-app-muted">No purchase history.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              {reportTab === "payments" && (
                <table className="w-full min-w-[720px]">
                  <thead><tr className="bg-app-panel-muted">
                    {["Date", "Supplier", "Method", "Reference", "Amount"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-xs uppercase tracking-wide text-app-muted text-left">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {(reports.payment_history || []).map((r) => (
                      <tr key={r.id} className="border-t border-app">
                        <td className="px-3 py-3 text-xs text-app-muted">{fmtDate(r.created_at)}</td>
                        <td className="px-3 py-3 text-sm">{r.supplier}</td>
                        <td className="px-3 py-3 text-xs">{r.method}</td>
                        <td className="px-3 py-3 text-xs">{r.reference || "—"}</td>
                        <td className="px-3 py-3 font-mono text-sm text-success">
                          {r.payment_currency
                            ? `${r.payment_currency} ${Number(r.original_amount ?? r.amount).toLocaleString()}`
                            : money(r.amount)}
                        </td>
                      </tr>
                    ))}
                    {(reports.payment_history || []).length === 0 && (
                      <tr><td colSpan={5} className="text-center py-10 text-sm text-app-muted">No payments recorded.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              {reportTab === "top" && (
                <table className="w-full min-w-[640px]">
                  <thead><tr className="bg-app-panel-muted">
                    {["#", "Code", "Supplier", "Orders", "Purchases", "Paid", "Balance"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-xs uppercase tracking-wide text-app-muted text-left">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {(reports.top_suppliers || []).map((r, i) => (
                      <tr key={r.id} className="border-t border-app hover:bg-app-panel-muted cursor-pointer" onClick={() => openDetail(r)}>
                        <td className="px-3 py-3 text-xs text-app-muted">{i + 1}</td>
                        <td className="px-3 py-3 font-mono text-xs">{r.code || "—"}</td>
                        <td className="px-3 py-3 text-sm font-medium">{r.name}</td>
                        <td className="px-3 py-3 text-sm">{r.order_count}</td>
                        <td className="px-3 py-3 font-mono text-sm text-brand">{money(r.total_ordered)}</td>
                        <td className="px-3 py-3 font-mono text-sm">{money(r.total_paid)}</td>
                        <td className="px-3 py-3 font-mono text-sm">{money(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code, name, contact, phone, tax…"
                className="form-control w-full pl-10"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: "all", label: "All" },
                { id: "active", label: "Active" },
                { id: "inactive", label: "Inactive" },
                { id: "archived", label: "Archived" },
                { id: "balance", label: "Outstanding" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    filter === f.id
                      ? "bg-brand text-white border-brand"
                      : "bg-white text-app-muted border-app hover:bg-app-panel-muted"
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <label className="inline-flex items-center gap-1.5 text-xs text-app-muted ml-1">
                <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
                Show deleted
              </label>
              <div className="relative">
                <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
                <select value={sortId} onChange={(e) => setSortId(e.target.value)} className="form-control pl-8 text-xs py-1.5">
                  {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex rounded-lg border border-app overflow-hidden">
                <button type="button" onClick={() => setView("cards")} className={`p-2 ${view === "cards" ? "bg-[#EEF3FF] text-brand" : "bg-white text-app-muted"}`} title="Cards">
                  <LayoutGrid size={15} />
                </button>
                <button type="button" onClick={() => setView("table")} className={`p-2 border-l border-app ${view === "table" ? "bg-[#EEF3FF] text-brand" : "bg-white text-app-muted"}`} title="Table">
                  <List size={15} />
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <ListSkeleton rows={6} />
          ) : view === "cards" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {paged.map((s) => {
                const st = supplierStatus(s);
                return (
                  <div key={s.id} className="card hover:shadow-card-hover transition-shadow">
                    <div className="flex items-center gap-3 mb-3.5">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-[#EEF3FF] shrink-0">
                        <Building2 size={19} className="text-brand" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-app-text truncate">{s.name}</div>
                        <div className="text-xs text-app-muted font-mono">{s.code || "—"}{s.payment_terms ? ` · ${s.payment_terms}` : ""}</div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${STATUS_STYLES[st] || STATUS_STYLES.Active}`}>
                        {st}
                      </span>
                    </div>
                    <div className="space-y-1.5 mb-3.5">
                      <div className="flex items-center gap-2 text-xs text-app-muted"><Users size={12} className="shrink-0" /> {s.contact_person || "—"}</div>
                      <div className="flex items-center gap-2 text-xs text-app-muted"><Phone size={12} className="shrink-0" /> {s.phone || "—"}</div>
                      {s.email && <div className="flex items-center gap-2 text-xs text-app-muted truncate"><Mail size={12} className="shrink-0" /> {s.email}</div>}
                      {s.tax_number && <div className="flex items-center gap-2 text-xs text-app-muted"><Hash size={12} className="shrink-0" /> Tax PIN {s.tax_number}</div>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-app mb-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-app-muted">Purchases</div>
                        <div className="font-semibold text-sm font-mono text-brand">{money(s.total_ordered)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wide text-app-muted">Balance</div>
                        <div className="font-semibold text-sm font-mono" style={{ color: Number(s.balance) > 0 ? "#DC2626" : "#1B2439" }}>{money(s.balance)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-app-muted">Paid</div>
                        <div className="font-mono text-xs text-app-text">{money(s.total_paid)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wide text-app-muted">Last PO</div>
                        <div className="text-xs text-app-muted">{fmtDate(s.last_purchase_at)}</div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <button type="button" onClick={() => openDetail(s)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-app text-xs font-medium text-app-text hover:bg-app-panel-muted">
                        <FileText size={12} /> Profile
                      </button>
                      {st === "Active" && can("purchases", "create") && (
                        <button type="button" onClick={() => goCreatePo(s)} className="p-1.5 rounded-lg border border-app text-brand hover:bg-[#EEF3FF]" title="New PO"><Package size={13} /></button>
                      )}
                      {can("suppliers", "edit") && st !== "Inactive" && (
                        <button type="button" onClick={() => openEdit(s)} className="p-1.5 rounded-lg border border-app text-app-muted hover:bg-app-panel-muted"><Pencil size={13} /></button>
                      )}
                      {can("suppliers", "edit") && st === "Active" && (
                        <button type="button" onClick={() => handleArchive(s)} className="p-1.5 rounded-lg border border-app text-app-muted hover:bg-app-panel-muted" title="Archive"><Archive size={13} /></button>
                      )}
                      {can("suppliers", "edit") && (st === "Archived" || st === "Inactive") && (
                        <button type="button" onClick={() => handleRestore(s)} className="p-1.5 rounded-lg border border-app text-success hover:bg-[#E8FAEF]" title="Restore"><RotateCcw size={13} /></button>
                      )}
                      {can("suppliers", "delete") && st !== "Inactive" && (
                        <button type="button" onClick={() => handleDelete(s)} className="p-1.5 rounded-lg border border-app text-danger hover:bg-[#FEF6F6]"><Trash2 size={13} /></button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && <div className="col-span-full text-center py-16 text-sm text-app-muted">No suppliers found.</div>}
            </div>
          ) : (
            <div className="table-container">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="bg-app-panel-muted">
                    {["Code", "Supplier", "Contact", "Terms", "Purchases", "Paid", "Balance", "Last PO", "Status", ""].map((h) => (
                      <th key={h || "actions"} className="px-3 py-2.5 font-medium text-xs uppercase tracking-wide text-app-muted text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s) => {
                    const st = supplierStatus(s);
                    return (
                      <tr key={s.id} className="border-t border-app hover:bg-app-panel-muted">
                        <td className="px-3 py-3 font-mono text-xs text-app-muted">{s.code || "—"}</td>
                        <td className="px-3 py-3">
                          <div className="text-sm font-medium text-app-text">{s.name}</div>
                          <div className="text-xs text-app-muted truncate max-w-[200px]">{s.tax_number ? `Tax PIN ${s.tax_number}` : s.email || "—"}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-app-muted">
                          <div>{s.contact_person || "—"}</div>
                          <div>{s.phone || "—"}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-app-text">{s.payment_terms || "—"}</td>
                        <td className="px-3 py-3 text-sm font-mono text-brand">{money(s.total_ordered)}</td>
                        <td className="px-3 py-3 text-sm font-mono text-app-text">{money(s.total_paid)}</td>
                        <td className="px-3 py-3 text-sm font-mono font-medium" style={{ color: Number(s.balance) > 0 ? "#DC2626" : "#1B2439" }}>{money(s.balance)}</td>
                        <td className="px-3 py-3 text-xs text-app-muted">{fmtDate(s.last_purchase_at)}</td>
                        <td className="px-3 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[st] || STATUS_STYLES.Active}`}>{st}</span>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openDetail(s)} className="p-1.5 rounded hover:bg-[#F1F3F8] mr-1 text-app-muted" title="Profile"><FileText size={14} /></button>
                          {st === "Active" && can("purchases", "create") && (
                            <button type="button" onClick={() => goCreatePo(s)} className="p-1.5 rounded hover:bg-[#EEF3FF] mr-1 text-brand" title="New PO"><Package size={14} /></button>
                          )}
                          {can("suppliers", "edit") && st !== "Inactive" && <button type="button" onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-[#F1F3F8] mr-1 text-app-muted"><Pencil size={14} /></button>}
                          {can("suppliers", "edit") && st === "Active" && <button type="button" onClick={() => handleArchive(s)} className="p-1.5 rounded hover:bg-[#F1F3F8] mr-1 text-app-muted" title="Archive"><Archive size={14} /></button>}
                          {can("suppliers", "edit") && (st === "Archived" || st === "Inactive") && <button type="button" onClick={() => handleRestore(s)} className="p-1.5 rounded hover:bg-[#E8FAEF] mr-1 text-success" title="Restore"><RotateCcw size={14} /></button>}
                          {can("suppliers", "delete") && st !== "Inactive" && <button type="button" onClick={() => handleDelete(s)} className="p-1.5 rounded hover:bg-[#FDECEC] text-danger"><Trash2 size={14} /></button>}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-10 text-sm text-app-muted">No suppliers found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && filtered.length > pageSize ? (
            <div className="mt-3 flex items-center justify-between gap-3 text-sm text-app-muted">
              <span>
                Showing {(pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
                <button type="button" className="btn btn-secondary" disabled={pageSafe >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 animate-fadein max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="card-title">{editingId ? "Edit Supplier" : "Add Supplier"}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-app-muted"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-app-text mb-1 block">Company name <span className="text-danger">*</span></label>
                <input required placeholder="Legal / trading name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="form-control w-full" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Contact person</label>
                  <input placeholder="Name" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="form-control w-full" />
                </div>
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Phone</label>
                  <input placeholder="+254 …" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="form-control w-full" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Email</label>
                  <input type="email" placeholder="orders@…" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="form-control w-full" />
                </div>
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Tax PIN</label>
                  <input placeholder="Optional" value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} className="form-control w-full" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-app-text mb-1 block">Address</label>
                <textarea rows={2} placeholder="Street, city, country" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="form-control w-full" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Payment terms</label>
                  <select value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} className="form-control w-full">
                    <option value="">Select…</option>
                    {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Credit limit ({currency.symbol})</label>
                  <input type="number" min="0" step="0.01" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} className="form-control w-full" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Opening balance ({currency.symbol})</label>
                  <input type="number" min="0" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} className="form-control w-full" disabled={!!editingId} />
                  {editingId ? <p className="text-[10px] text-app-muted mt-1">Opening balance is set at create time.</p> : null}
                </div>
                <div>
                  <label className="text-xs font-medium text-app-text mb-1 block">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="form-control w-full">
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-app-text mb-1 block">Notes</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="form-control w-full" placeholder="Internal notes" />
              </div>
              {!editingId && (
                <p className="text-xs text-app-muted">Supplier code will be auto-generated (SUP-#####). Opening balance seeds AP.</p>
              )}
              <button type="submit" className="btn btn-primary w-full">
                <Save size={15} /> {editingId ? "Save Changes" : "Save Supplier"}
              </button>
            </form>
          </div>
        </div>
      )}

      {detailFor && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={() => { setDetailFor(null); setStatement(null); }}>
          <div className="bg-white w-full max-w-xl h-full shadow-xl animate-slidein overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-app px-5 py-4 flex items-start justify-between z-10">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#EEF3FF] shrink-0">
                  <Building2 size={22} className="text-brand" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-app-text truncate">{detailFor.name}</h3>
                  <div className="text-xs text-app-muted mt-0.5 font-mono">{detailFor.code || "—"} · {supplierStatus(detailFor)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {can("purchases", "create") && supplierStatus(detailFor) === "Active" && (
                  <button type="button" className="p-1.5 rounded-lg text-brand hover:bg-[#EEF3FF]" title="New purchase order" onClick={() => goCreatePo(detailFor)}>
                    <ExternalLink size={16} />
                  </button>
                )}
                {can("suppliers", "print") && statement && (
                  <button type="button" className="p-1.5 rounded-lg text-app-muted hover:bg-app-panel-muted" title="Print statement" onClick={() => printStatement(detailFor, statement, money)}>
                    <Printer size={16} />
                  </button>
                )}
                {can("suppliers", "export") && statement && (
                  <button type="button" className="p-1.5 rounded-lg text-app-muted hover:bg-app-panel-muted" title="Export statement" onClick={() => exportStatement("csv")}>
                    <Download size={16} />
                  </button>
                )}
                <button type="button" onClick={() => { setDetailFor(null); setStatement(null); }} className="text-app-muted p-1"><X size={18} /></button>
              </div>
            </div>

            <div className="px-5 py-4 space-y-1.5 text-xs text-app-muted border-b border-app">
              <div className="flex items-center gap-2"><Users size={12} /> {detailFor.contact_person || "—"}</div>
              {detailFor.phone && <div className="flex items-center gap-2"><Phone size={12} /> {detailFor.phone}</div>}
              {detailFor.email && <div className="flex items-center gap-2"><Mail size={12} /> {detailFor.email}</div>}
              {detailFor.address && <div className="flex items-start gap-2"><MapPin size={12} className="mt-0.5" /> {detailFor.address}</div>}
              {detailFor.tax_number && <div className="flex items-center gap-2"><Hash size={12} /> Tax PIN {detailFor.tax_number}</div>}
              {detailFor.payment_terms && <div className="flex items-center gap-2"><Calendar size={12} /> Terms: {detailFor.payment_terms}</div>}
              {Number(detailFor.opening_balance) > 0 && <div className="flex items-center gap-2"><Wallet size={12} /> Opening {money(detailFor.opening_balance)}</div>}
              {Number(detailFor.credit_limit) > 0 && <div className="flex items-center gap-2"><CreditCard size={12} /> Credit limit {money(detailFor.credit_limit)}</div>}
              {detailFor.notes && <div className="pt-1 text-app-text">{detailFor.notes}</div>}
              <div className="flex flex-wrap gap-2 pt-2">
                {can("suppliers", "edit") && supplierStatus(detailFor) === "Active" && (
                  <button type="button" onClick={() => handleArchive(detailFor)} className="btn btn-secondary text-xs py-1"><Archive size={12} /> Archive</button>
                )}
                {can("suppliers", "edit") && ["Archived", "Inactive"].includes(supplierStatus(detailFor)) && (
                  <button type="button" onClick={() => handleRestore(detailFor)} className="btn btn-secondary text-xs py-1"><RotateCcw size={12} /> Restore</button>
                )}
                {can("suppliers", "edit") && <button type="button" onClick={() => openEdit(detailFor)} className="btn btn-secondary text-xs py-1"><Pencil size={12} /> Edit</button>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 px-5 py-4">
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-app-muted">Outstanding</div>
                <div className="font-bold font-mono text-sm mt-1" style={{ color: Number(detailFor.balance) > 0 ? "#DC2626" : "#1B2439" }}>{money(detailFor.balance)}</div>
              </div>
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-app-muted">Total purchases</div>
                <div className="font-bold font-mono text-sm text-brand mt-1">{money(detailFor.total_ordered)}</div>
              </div>
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-app-muted">Total paid</div>
                <div className="font-bold font-mono text-sm mt-1">{money(detailFor.total_paid)}</div>
              </div>
              <div className="rounded-xl bg-app-panel-muted p-3">
                <div className="text-[10px] uppercase tracking-wide text-app-muted">Last payment</div>
                <div className="font-medium text-sm mt-1">{fmtDate(detailFor.last_payment_at)}</div>
              </div>
            </div>

            <div className="px-5 flex gap-1 border-b border-app overflow-x-auto">
              {[
                { id: "ledger", label: "Ledger", icon: BookOpen },
                { id: "history", label: "Purchases", icon: Package },
                { id: "payments", label: "Payments", icon: CreditCard },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDetailTab(tab.id)}
                  className={`px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1 ${
                    detailTab === tab.id ? "border-brand text-brand" : "border-transparent text-app-muted"
                  }`}
                >
                  <tab.icon size={12} /> {tab.label}
                </button>
              ))}
            </div>

            <div className="px-5 py-4">
              {!statement ? (
                <div className="text-center py-8 text-sm text-app-muted">Loading…</div>
              ) : detailTab === "ledger" ? (
                <div className="space-y-2">
                  <div className="flex justify-end gap-2 mb-2">
                    {can("suppliers", "export") && (
                      <button type="button" className="btn btn-secondary text-xs py-1" onClick={() => exportStatement("csv")}><Download size={12} /> CSV</button>
                    )}
                    {can("suppliers", "print") && (
                      <button type="button" className="btn btn-secondary text-xs py-1" onClick={() => exportStatement("pdf")}><Printer size={12} /> PDF / Print</button>
                    )}
                  </div>
                  {(statement.ledger || []).map((e, i) => (
                    <div key={`${e.source_id || i}-${e.entry_type}`} className="flex items-start justify-between gap-3 py-2.5 border-b border-[#F1F3F8]">
                      <div className="min-w-0">
                        <div className="text-sm text-app-text">{e.description || e.entry_type}</div>
                        <div className="text-xs text-app-muted">{fmtDate(e.entry_date)} · {e.reference || e.entry_type}</div>
                      </div>
                      <div className="text-right shrink-0 font-mono text-sm">
                        {Number(e.debit) > 0 && <div className="text-app-text">{money(e.debit)}</div>}
                        {Number(e.credit) > 0 && <div className="text-success">-{money(e.credit)}</div>}
                      </div>
                    </div>
                  ))}
                  {(statement.ledger || []).length === 0 && <div className="text-sm text-app-muted py-6 text-center">No ledger entries yet.</div>}
                </div>
              ) : detailTab === "history" ? (
                <div className="space-y-2">
                  {can("purchases", "create") && supplierStatus(detailFor) === "Active" && (
                    <button type="button" onClick={() => goCreatePo(detailFor)} className="btn btn-primary w-full mb-3 text-sm">
                      <Plus size={14} /> Create Purchase Order
                    </button>
                  )}
                  {(statement.purchases || []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-[#F1F3F8]">
                      <div className="min-w-0">
                        <div className="font-mono text-sm text-app-text">{p.po_number}</div>
                        <div className="text-xs text-app-muted">
                          {fmtDate(p.created_at)} · {p.status === "Ordered" ? "Approved / Ordered" : p.status}
                          {p.invoice_no ? ` · ${p.invoice_no}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-medium text-app-text">{money(p.total)}</div>
                        {Number(p.balance) > 0 && <div className="text-[10px] text-danger">Due {money(p.balance)}</div>}
                      </div>
                    </div>
                  ))}
                  {(statement.purchases || []).length === 0 && <div className="text-sm text-app-muted py-6 text-center">No purchase orders yet.</div>}
                </div>
              ) : (
                <>
                  {can("suppliers", "edit") && !detailFor.deleted_at && (
                    <div className="mb-4 space-y-3 rounded-xl bg-app-panel-muted p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-app-text">Record payment</span>
                        <label className="inline-flex items-center gap-1.5 text-xs text-app-muted">
                          <input type="checkbox" checked={splitPay} onChange={(e) => setSplitPay(e.target.checked)} />
                          Split payment
                        </label>
                      </div>
                      <CurrencyMoneyFields value={paymentFx} onChange={setPaymentFx} />
                      {splitPay ? (
                        <div className="space-y-2">
                          {splitRows.map((row, idx) => (
                            <div key={idx} className="flex gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Amount"
                                value={row.amount}
                                onChange={(e) => {
                                  const next = [...splitRows];
                                  next[idx] = { ...next[idx], amount: e.target.value };
                                  setSplitRows(next);
                                }}
                                className="form-control flex-1"
                              />
                              <select
                                value={row.method}
                                onChange={(e) => {
                                  const next = [...splitRows];
                                  next[idx] = { ...next[idx], method: e.target.value };
                                  setSplitRows(next);
                                }}
                                className="form-control w-36"
                              >
                                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="text-xs text-brand"
                            onClick={() => setSplitRows((rows) => [...rows, { amount: "", method: "Cash" }])}
                          >
                            + Add split line
                          </button>
                        </div>
                      ) : (
                        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="border border-app rounded-lg px-3 py-2 text-sm bg-white w-full">
                          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      )}
                      <button type="button" onClick={recordPayment} className="flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#12A150] hover:brightness-110">
                        <CreditCard size={14} /> Record{can("suppliers", "print") ? " & Print" : ""}
                      </button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {(statement.payments || []).map((p) => (
                      <div key={p.id} className="flex justify-between text-sm py-2.5 border-b border-[#F1F3F8]">
                        <div>
                          <div className="text-app-text">{p.method}{p.payment_currency ? ` · ${p.payment_currency}` : ""}</div>
                          <div className="text-xs text-app-muted">
                            {fmtDate(p.created_at || p.payment_date)}
                            {p.reference ? ` · ${p.reference}` : ""}
                            {p.base_amount != null && p.payment_currency && p.payment_currency !== currency.code
                              ? ` · base ${money(p.base_amount)}`
                              : ""}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-mono text-success">
                            -{p.payment_currency
                              ? `${p.payment_currency} ${Number(p.original_amount ?? p.amount).toLocaleString()}`
                              : money(p.amount)}
                          </span>
                          {can("suppliers", "print") && (
                            <button type="button" className="block text-[10px] text-brand mt-0.5" onClick={() => printPaymentReceipt(detailFor, p, money)}>
                              Print receipt
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {(statement.payments || []).length === 0 && <div className="text-sm text-app-muted py-6 text-center">No payments recorded yet.</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
