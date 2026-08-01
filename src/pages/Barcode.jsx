import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Barcode as BarcodeIcon,
  Search,
  Printer,
  Wand2,
  Download,
  CheckSquare,
  Square,
  Package,
  Boxes,
  ScanLine,
  Pencil,
  X,
  Save,
  RefreshCw,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import BarcodePreview from "../components/BarcodePreview";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";

const LABEL_SIZES = [
  { id: "50x25", label: "50 × 25 mm" },
  { id: "40x30", label: "40 × 30 mm" },
  { id: "100x50", label: "100 × 50 mm" },
  { id: "shelf", label: "Shelf talker" },
];

function Stat({ icon: Icon, label, value, color }) {
  return (
    <div className="nx-kpi">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}1A` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="nx-kpi-value">{value}</div>
      <div className="nx-kpi-label">{label}</div>
    </div>
  );
}

export default function BarcodePage() {
  const { formatMoney: money, currency } = useEnterpriseSettings();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState({ products: [], total: 0, withBarcode: 0, missing: 0, format: "EAN-13", prefix: "89" });
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | missing | assigned
  const [selected, setSelected] = useState(() => new Set());
  const [labelSize, setLabelSize] = useState("50x25");
  const [previewLabels, setPreviewLabels] = useState([]);
  const [printPayload, setPrintPayload] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const [assignCode, setAssignCode] = useState("");
  const [scanHighlight, setScanHighlight] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, stg] = await Promise.all([api.barcode.listStatus(), api.settings.getAll()]);
      setStatus(st);
      setSettings(stg);
      const idsParam = searchParams.get("ids");
      if (idsParam) {
        const ids = idsParam
          .split(",")
          .map((x) => Number(x))
          .filter(Boolean);
        if (ids.length) setSelected(new Set(ids));
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("[Barcode] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    load();
  }, [load]);

  const format = settings.barcode_format || status.format || "EAN-13";

  const filtered = useMemo(() => {
    let rows = status.products || [];
    if (filter === "missing") rows = rows.filter((p) => !p.barcode);
    if (filter === "assigned") rows = rows.filter((p) => !!p.barcode);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode && String(p.barcode).toLowerCase().includes(q)) ||
          (p.warehouse && p.warehouse.toLowerCase().includes(q))
      );
    }
    return rows;
  }, [status.products, filter, query]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectFiltered = () => {
    setSelected(new Set(filtered.filter((p) => p.barcode).map((p) => p.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const handleScan = useCallback(
    async (code) => {
      const results = await api.barcode.search(code);
      const exact = results.find((p) => String(p.barcode) === code) || results[0];
      if (!exact) {
        showToast(`No product for barcode ${code}`);
        return;
      }
      setQuery(code);
      setFilter("all");
      setScanHighlight(exact.id);
      setSelected(new Set([exact.id]));
      showToast(`Found: ${exact.name}`);
      setTimeout(() => setScanHighlight(null), 2500);
    },
    [showToast]
  );

  useBarcodeScanner(handleScan, { enabled: can("barcode", "view"), allowInInputs: false });

  const generateOne = async (product) => {
    if (!can("barcode", "create")) return;
    setBusy(true);
    const result = await api.barcode.generate(product.id);
    setBusy(false);
    if (!result?.success) {
      showToast(result?.error || "Could not generate barcode");
      return;
    }
    showToast(result.reused ? "Barcode already assigned" : `Generated ${result.barcode}`);
    await load();
  };

  const generateMissing = async () => {
    if (!can("barcode", "create")) return;
    setBusy(true);
    const missingIds = (status.products || []).filter((p) => !p.barcode).map((p) => p.id);
    const result = await api.barcode.generateBulk(missingIds);
    setBusy(false);
    if (!result) {
      showToast("Permission denied or generate failed");
      return;
    }
    showToast(`Generated ${result.generated?.length || 0} barcode(s)`);
    await load();
  };

  const generateSelected = async () => {
    if (!can("barcode", "create")) return;
    const ids = [...selected];
    if (!ids.length) {
      showToast("Select products first");
      return;
    }
    setBusy(true);
    const result = await api.barcode.generateBulk(ids);
    setBusy(false);
    showToast(`Generated ${result?.generated?.length || 0}, skipped ${result?.skipped?.length || 0}`);
    await load();
  };

  const openAssign = (product) => {
    setAssignModal(product);
    setAssignCode(product.barcode || "");
  };

  const saveAssign = async (e) => {
    e.preventDefault();
    if (!can("barcode", "create") || !assignModal) return;
    setBusy(true);
    const result = await api.barcode.assign(assignModal.id, assignCode);
    setBusy(false);
    if (!result?.success) {
      showToast(result?.error || "Could not assign barcode");
      return;
    }
    showToast("Barcode assigned");
    setAssignModal(null);
    await load();
  };

  const loadLabelPreview = async (ids) => {
    const targetIds = ids?.length ? ids : [...selected].filter((id) => status.products.find((p) => p.id === id)?.barcode);
    if (!targetIds.length) {
      showToast("Select products that have barcodes");
      return null;
    }
    const data = await api.barcode.getLabelData(targetIds, labelSize);
    if (!data?.labels?.length) {
      showToast("No printable labels (missing barcodes or permission)");
      return null;
    }
    setPreviewLabels(data.labels);
    return data;
  };

  const printLabels = async () => {
    if (!can("barcode", "print")) {
      showToast("Print permission required");
      return;
    }
    const data = await loadLabelPreview();
    if (!data) return;
    setPrintPayload(data);
    requestAnimationFrame(() => {
      window.print();
    });
  };

  const exportCsv = () => {
    if (!can("barcode", "export")) {
      showToast("Export permission required");
      return;
    }
    const rows = filtered.filter((p) => p.barcode);
    const header = `id,name,barcode,price (${currency.code} ${currency.symbol}),warehouse,category\n`;
    const body = rows
      .map((p) => [p.id, `"${p.name.replace(/"/g, '""')}"`, p.barcode, `"${money(p.price).replace(/"/g, '""')}"`, `"${(p.warehouse || "").replace(/"/g, '""')}"`, `"${(p.category || "").replace(/"/g, '""')}"`].join(","))
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexora-barcodes.csv";
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length} barcodes`);
  };

  const selectedCount = selected.size;
  const printableSelected = [...selected].filter((id) => status.products.find((p) => p.id === id)?.barcode).length;

  return (
    <div className="animate-fadein">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Barcode Management</h1>
          <p className="mt-1 text-base text-app-muted">
            Generate, assign, scan, and print labels · Format {format} · Prefix {settings.barcode_prefix || status.prefix}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Link to="/inventory" className="inline-flex items-center gap-1 rounded-lg border border-app bg-white px-2.5 py-1.5 text-app-muted hover:text-brand">
              <Boxes size={13} /> Inventory
            </Link>
            <Link to="/products" className="inline-flex items-center gap-1 rounded-lg border border-app bg-white px-2.5 py-1.5 text-app-muted hover:text-brand">
              <Package size={13} /> Products
            </Link>
            <span className="inline-flex items-center gap-1 rounded-lg border border-[#DBEAFE] bg-[#EFF6FF] px-2.5 py-1.5 text-brand">
              <ScanLine size={13} /> USB scanner ready — scan anywhere on this page
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("barcode", "create") && (
            <button
              disabled={busy || status.missing === 0}
              onClick={generateMissing}
              className="btn btn-primary"
            >
              <Wand2 size={15} /> Generate missing
            </button>
          )}
          {can("barcode", "print") && (
            <button
              disabled={!printableSelected}
              onClick={printLabels}
              className="inline-flex items-center gap-1.5 rounded-lg border border-app bg-white px-3 py-2 text-sm font-medium text-app-text hover:bg-app-panel-muted disabled:opacity-40"
            >
              <Printer size={15} /> Print labels
            </button>
          )}
          {can("barcode", "export") && (
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-app bg-white px-3 py-2 text-sm font-medium text-app-text hover:bg-app-panel-muted"
            >
              <Download size={15} /> Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={Package} label="Products" value={status.total} color="#2563EB" />
        <Stat icon={BarcodeIcon} label="With barcode" value={status.withBarcode} color="#12A150" />
        <Stat icon={RefreshCw} label="Missing barcode" value={status.missing} color="#DC2626" />
        <Stat icon={CheckSquare} label="Selected" value={selectedCount} color="#0D9488" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && query.trim()) {
                const rows = await api.barcode.search(query.trim());
                if (rows?.length === 1) {
                  setScanHighlight(rows[0].id);
                  setSelected(new Set([rows[0].id]));
                }
              }
            }}
            placeholder="Search name or barcode…"
            className="form-control w-full pl-10"
          />
        </div>
        <div className="flex rounded-lg border border-app bg-white p-0.5 text-sm">
          {[
            { id: "all", label: "All" },
            { id: "assigned", label: "Assigned" },
            { id: "missing", label: "Missing" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`rounded-md px-3 py-1.5 ${filter === tab.id ? "bg-brand text-white" : "text-app-muted hover:bg-app-panel-muted"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select
          value={labelSize}
          onChange={(e) => setLabelSize(e.target.value)}
          className="rounded-lg border border-app bg-white px-3 py-2 text-sm"
        >
          {LABEL_SIZES.map((s) => (
            <option key={s.id} value={s.id}>
              Label: {s.label}
            </option>
          ))}
        </select>
        <button onClick={selectFiltered} className="text-sm text-brand hover:underline">
          Select printable in view
        </button>
        {selectedCount > 0 && (
          <button onClick={clearSelection} className="text-sm text-app-muted hover:underline">
            Clear selection
          </button>
        )}
        {can("barcode", "create") && selectedCount > 0 && (
          <button
            disabled={busy}
            onClick={generateSelected}
            className="inline-flex items-center gap-1 text-sm text-brand hover:underline disabled:opacity-40"
          >
            <Wand2 size={14} /> Generate for selected
          </button>
        )}
        {can("barcode", "print") && printableSelected > 0 && (
          <button
            onClick={async () => {
              await loadLabelPreview();
            }}
            className="text-sm text-brand hover:underline"
          >
            Preview labels
          </button>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="table-container">
          {loading ? (
            <div className="py-10 text-center text-sm text-app-muted">Loading barcodes…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="bg-app-panel-muted">
                    <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-app-muted">Sel</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-app-muted">Product</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-app-muted">Barcode</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-app-muted">Warehouse</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-app-muted">Price</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-app-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const isSel = selected.has(p.id);
                    const highlighted = scanHighlight === p.id;
                    return (
                      <tr
                        key={p.id}
                        className={`border-t border-app ${highlighted ? "bg-[#DBEAFE]" : "hover:bg-app-panel-muted"}`}
                      >
                        <td className="px-3 py-3">
                          <button type="button" onClick={() => toggleSelect(p.id)} className="text-brand" aria-label="Select">
                            {isSel ? <CheckSquare size={18} /> : <Square size={18} className="text-[#C9D2E3]" />}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-sm font-medium text-app-text">
                          {p.name}
                          {p.brand ? <div className="text-xs font-normal text-app-muted">{p.brand}</div> : null}
                        </td>
                        <td className="px-3 py-3">
                          {p.barcode ? (
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-sm text-app-text">{p.barcode}</span>
                              <BarcodePreview value={p.barcode} format={format} height={36} width={1.2} displayValue={false} />
                            </div>
                          ) : (
                            <span className="rounded-full bg-[#FEF6F6] px-2 py-0.5 text-xs font-medium text-danger">Missing</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm text-app-muted">{p.warehouse || "—"}</td>
                        <td className="px-3 py-3 text-right font-mono text-sm text-app-text">{money(p.price)}</td>
                        <td className="px-3 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            {can("barcode", "create") && !p.barcode && (
                              <button
                                disabled={busy}
                                onClick={() => generateOne(p)}
                                className="rounded-lg px-2 py-1.5 text-xs font-medium text-brand hover:bg-[#EFF6FF]"
                                title="Generate"
                              >
                                <Wand2 size={14} />
                              </button>
                            )}
                            {can("barcode", "create") && (
                              <button
                                onClick={() => openAssign(p)}
                                className="rounded-lg px-2 py-1.5 text-xs text-app-muted hover:bg-[#F1F3F8]"
                                title="Assign custom"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {can("barcode", "print") && p.barcode && (
                              <button
                                onClick={async () => {
                                  setSelected(new Set([p.id]));
                                  const data = await api.barcode.getLabelData([p.id], labelSize);
                                  if (data?.labels?.length) {
                                    setPreviewLabels(data.labels);
                                    setPrintPayload(data);
                                    requestAnimationFrame(() => window.print());
                                  }
                                }}
                                className="rounded-lg px-2 py-1.5 text-xs text-app-muted hover:bg-[#F1F3F8]"
                                title="Print"
                              >
                                <Printer size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-sm text-app-muted">
                        No products match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="nx-kpi">
            <h3 className="mb-1 font-semibold text-app-text">Label preview</h3>
            <p className="mb-3 text-xs text-app-muted">
              Size {LABEL_SIZES.find((s) => s.id === labelSize)?.label}. Use browser Print → Save as PDF for downloads.
            </p>
            {previewLabels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-app bg-[#F8FAFD] px-3 py-8 text-center text-xs text-app-muted">
                Select products and click Preview labels
              </div>
            ) : (
              <div className="max-h-[420px] space-y-3 overflow-y-auto">
                {previewLabels.map((label) => (
                  <div key={`${label.product_id}-${label.barcode}`} className="rounded-xl border border-app p-3">
                    <div className="text-[10px] uppercase tracking-wide text-app-muted">{label.store_name}</div>
                    <div className="truncate text-sm font-semibold text-app-text">{label.name}</div>
                    <div className="text-xs text-app-muted">{label.warehouse}</div>
                    <BarcodePreview value={label.barcode} format={label.format || format} height={44} width={1.4} />
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-mono text-xs text-app-text">{label.barcode}</span>
                      <span className="font-mono text-sm font-semibold text-brand">{label.price_label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setAssignModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 animate-fadein" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="card-title">Assign barcode — {assignModal.name}</h3>
              <button onClick={() => setAssignModal(null)} className="text-app-muted">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveAssign} className="space-y-3">
              <div>
                <label className="form-label">Barcode</label>
                <input
                  autoFocus
                  value={assignCode}
                  onChange={(e) => setAssignCode(e.target.value)}
                  className="form-control w-full font-mono"
                  placeholder="Scan or type custom code"
                />
              </div>
              {assignCode && (
                <div className="rounded-xl border border-app bg-[#F8FAFD] p-3">
                  <BarcodePreview value={assignCode} format={format} height={48} />
                </div>
              )}
              <button
                type="submit"
                disabled={busy || !assignCode.trim()}
                className="btn btn-primary w-full"
              >
                <Save size={15} /> Save barcode
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Print-only label sheet */}
      <div id="barcode-labels-print" aria-hidden="true">
        {printPayload?.labels?.map((label) => (
          <div
            key={`print-${label.product_id}-${label.barcode}`}
            className={`barcode-label barcode-label--${printPayload.size?.id || labelSize}`}
          >
            <div className="barcode-label__store">{label.store_name}</div>
            <div className="barcode-label__name">{label.name}</div>
            <div className="barcode-label__meta">{label.warehouse}{label.brand ? ` · ${label.brand}` : ""}</div>
            <div className="barcode-label__svg">
              <BarcodePreview value={label.barcode} format={label.format || format} height={printPayload.size?.id === "100x50" ? 56 : 40} width={1.5} displayValue={false} />
            </div>
            <div className="barcode-label__footer">
              <span className="barcode-label__code">{label.barcode}</span>
              <span className="barcode-label__price">{label.price_label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
