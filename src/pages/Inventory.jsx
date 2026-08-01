import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useRealtimeRefresh } from "../hooks/useRealtimeRefresh";
import {
  Boxes,
  DollarSign,
  AlertTriangle,
  Package,
  Plus,
  Minus,
  Warehouse,
  Tag,
  Ruler,
  Layers,
  Clock,
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  LayoutDashboard,
  ArrowRightLeft,
  ClipboardList,
  BarChart3,
  History,
  Barcode,
  Search,
  Download,
  Upload,
  RotateCcw,
  Archive,
  Trash2,
  PackageX,
  PackageCheck,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { api, isProductionDataPlane } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import ProductSelector from "../components/ProductSelector";
import { excludeDemoProducts } from "../lib/demoProducts";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { DEFAULT_PAGE_SIZE } from "../lib/requestCache";
import {
  downloadCsv,
  downloadExcel,
  downloadPdf,
  parseProductImportRows,
  productLifecycle,
} from "../lib/inventoryExport";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "products", label: "Products", icon: Package },
  { id: "movements", label: "Movements", icon: History },
  { id: "transfers", label: "Transfers", icon: ArrowRightLeft },
  { id: "counts", label: "Counts", icon: ClipboardList },
  { id: "stock-in", label: "Stock In", icon: ArrowDownToLine },
  { id: "stock-out", label: "Stock Out", icon: ArrowUpFromLine },
  { id: "adjust", label: "Adjust", icon: SlidersHorizontal },
  { id: "alerts", label: "Alerts", icon: AlertTriangle },
  { id: "warehouses", label: "Warehouses", icon: Warehouse },
  { id: "brands", label: "Brands", icon: Tag },
  { id: "units", label: "Units", icon: Ruler },
  { id: "variants", label: "Variants", icon: Layers },
  { id: "serials", label: "Serials", icon: Tag },
  { id: "lots", label: "Lots FIFO/FEFO", icon: Package },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "history", label: "History", icon: Clock },
];

function StatCard({ icon: Icon, label, value, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`nx-kpi text-left ${onClick ? "cursor-pointer hover:ring-1 hover:ring-brand/30" : "cursor-default"}`}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}1A` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="nx-kpi-value">{value}</div>
      <div className="nx-kpi-label">{label}</div>
    </button>
  );
}

function Panel({ title, children, actions }) {
  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="card-title">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "form-control w-full";

const emptyMove = {
  product_id: "",
  variant_id: "",
  warehouse_id: "",
  qty: 1,
  batch_number: "",
  expiry_date: "",
  serial_numbers: "",
  note: "",
};

export default function Inventory() {
  const { formatMoney: money } = useEnterpriseSettings();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "dashboard";
  const [tab, setTab] = useState(TABS.some((t) => t.id === initialTab) ? initialTab : "dashboard");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({});
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [brands, setBrands] = useState([]);
  const [units, setUnits] = useState([]);
  const [movements, setMovements] = useState([]);
  const [warehouseStock, setWarehouseStock] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [reports, setReports] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [counts, setCounts] = useState([]);
  const [moveForm, setMoveForm] = useState(emptyMove);
  const [transferForm, setTransferForm] = useState({
    product_id: "",
    from_warehouse_id: "",
    to_warehouse_id: "",
    qty: 1,
    note: "",
  });
  const [brandForm, setBrandForm] = useState({ name: "" });
  const [unitForm, setUnitForm] = useState({ name: "", abbreviation: "" });
  const [whForm, setWhForm] = useState({ name: "", code: "", branch_id: "", address: "" });
  const [adjustingId, setAdjustingId] = useState(null);
  const [productSearch, setProductSearch] = useState("");
  const debouncedProductSearch = useDebouncedValue(productSearch, 250);
  const [productFilter, setProductFilter] = useState("active");
  const [productPage, setProductPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [countLines, setCountLines] = useState([]);
  const [countWarehouse, setCountWarehouse] = useState("");
  const [countNotes, setCountNotes] = useState("");
  const [reportSection, setReportSection] = useState("valuation");
  const [movementTypeFilter, setMovementTypeFilter] = useState("");
  const [ledgerVariants, setLedgerVariants] = useState([]);
  const [serialRows, setSerialRows] = useState([]);
  const [openLots, setOpenLots] = useState([]);
  const [variantForm, setVariantForm] = useState({
    product_id: "",
    name: "",
    sku: "",
    barcode: "",
    price: "",
    cost: "",
    attributes: "",
  });
  const [serialForm, setSerialForm] = useState({
    product_id: "",
    warehouse_id: "",
    serial_numbers: "",
  });
  const [lotPickForm, setLotPickForm] = useState({
    product_id: "",
    warehouse_id: "",
    qty: 1,
    preference: "auto",
  });
  const [lotPickPreview, setLotPickPreview] = useState(null);
  const [editingVariantId, setEditingVariantId] = useState(null);

  const canEdit = can("inventory", "edit");
  const canCreate = can("inventory", "create");
  const canApprove = can("inventory", "approve");
  const canSetMainWarehouse = can("inventory", "delete");
  const canProductCreate = can("products", "create");
  const canProductEdit = can("products", "edit");
  const canProductDelete = can("products", "delete");
  const canBrandCreate = can("brands", "create");
  const canBrandEdit = can("brands", "edit");
  const canBrandDelete = can("brands", "delete");
  const canExport = can("inventory", "export") || can("export_reports", "view") || can("reports", "view");
  const canPrintBarcode = can("barcode", "print") || can("barcode", "view");

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === Number(moveForm.product_id)),
    [products, moveForm.product_id]
  );

  const switchTab = (id) => {
    setTab(id);
    setSearchParams(id === "dashboard" ? {} : { tab: id });
  };

  const load = async () => {
    setLoading(true);
    try {
      const includeArchived = productFilter === "archived" || productFilter === "all";
      const includeDeleted = productFilter === "deleted" || productFilter === "all";
      const [
        statsRow,
        productRows,
        branchRows,
        warehouseRows,
        brandRows,
        unitRows,
        movementRows,
        stockRows,
        expiringRows,
        transferRows,
        chartRows,
        countRows,
        variantLedgerRows,
        serialLedgerRows,
        lotRows,
      ] = await Promise.all([
        api.inventory.getStats().catch(() => ({})),
        api.products.getAll({ include_archived: includeArchived, include_deleted: includeDeleted }).catch(() => []),
        api.branches.getAll().catch(() => []),
        api.warehouses.getAll().catch(() => []),
        api.brands.getAll().catch(() => []),
        api.units.getAll().catch(() => []),
        api.inventory.getMovements({ limit: 200 }).catch(() => []),
        api.inventory.getWarehouseStock().catch(() => []),
        api.inventory.getExpiring(30).catch(() => []),
        api.inventory.getTransfers().catch(() => []),
        api.inventory.getMovementChart?.(30).catch(() => []) || Promise.resolve([]),
        api.inventory.getCounts?.().catch(() => []) || Promise.resolve([]),
        api.inventory.listVariantSkus?.().catch(() => []) || Promise.resolve([]),
        api.inventory.listSerials?.({ limit: 200 }).catch(() => []) || Promise.resolve([]),
        api.inventory.listOpenLots?.({ limit: 200 }).catch(() => []) || Promise.resolve([]),
      ]);
      const catalog = isProductionDataPlane ? excludeDemoProducts(productRows || []) : productRows || [];
      setStats(statsRow || {});
      setProducts(catalog);
      setBranches(branchRows || []);
      setWarehouses(warehouseRows || []);
      setBrands(brandRows || []);
      setUnits(unitRows || []);
      setMovements(movementRows || []);
      setWarehouseStock(stockRows || []);
      setLowStock(
        catalog
          .filter((p) => !p.deleted_at && !p.archived_at && Number(p.stock) <= Number(p.reorder_level || 0))
          .map((p) => ({ ...p, deficit: Math.max(0, Number(p.reorder_level || 0) - Number(p.stock)) }))
      );
      setExpiring(expiringRows || []);
      setTransfers(transferRows || []);
      setChartData(chartRows || []);
      setCounts(countRows || []);
      setLedgerVariants(variantLedgerRows || []);
      setSerialRows(serialLedgerRows || []);
      setOpenLots(lotRows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productFilter]);

  // ERP real-time: purchases, sales, returns, transfers, and adjustments all
  // move stock — keep the inventory hub in sync automatically.
  useRealtimeRefresh(["inventory", "products", "purchases", "sales"], load, { debounceMs: 1200 });

  // Default the transfer source to the Main Store — the primary transfer
  // direction is out of the Main Store into a branch/store warehouse.
  useEffect(() => {
    if (!warehouses.length || transferForm.from_warehouse_id) return;
    const main = warehouses.find((w) => w.is_main);
    if (main) setTransferForm((f) => ({ ...f, from_warehouse_id: String(main.id) }));
  }, [warehouses, transferForm.from_warehouse_id]);

  useEffect(() => {
    if (tab === "reports" && !reports) {
      api.inventory.getReports?.().then((r) => setReports(r || {})).catch(() => setReports({}));
    }
    if (tab === "history") {
      api.inventory.getAudit?.().then((r) => setAuditRows(r || [])).catch(() => setAuditRows([]));
    }
  }, [tab, reports]);

  const filteredProducts = useMemo(() => {
    const q = debouncedProductSearch.toLowerCase().trim();
    return products.filter((p) => {
      if (productFilter === "active" && (p.archived_at || p.deleted_at)) return false;
      if (productFilter === "archived" && !p.archived_at) return false;
      if (productFilter === "deleted" && !p.deleted_at) return false;
      if (!q) return true;
      return (
        String(p.name || "").toLowerCase().includes(q) ||
        String(p.barcode || "").includes(q) ||
        String(p.sku || "").toLowerCase().includes(q) ||
        String(p.brand || "").toLowerCase().includes(q)
      );
    });
  }, [products, debouncedProductSearch, productFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / DEFAULT_PAGE_SIZE));
  const pageSafe = Math.min(productPage, pageCount);
  const pagedProducts = filteredProducts.slice((pageSafe - 1) * DEFAULT_PAGE_SIZE, pageSafe * DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setProductPage(1);
  }, [debouncedProductSearch, productFilter]);

  const outStock = useMemo(
    () => products.filter((p) => !p.deleted_at && !p.archived_at && Number(p.stock) <= 0),
    [products]
  );
  const overstock = useMemo(
    () =>
      products.filter(
        (p) => !p.deleted_at && !p.archived_at && Number(p.max_stock) > 0 && Number(p.stock) >= Number(p.max_stock)
      ),
    [products]
  );

  const filteredMovements = useMemo(() => {
    if (!movementTypeFilter) return movements;
    return movements.filter((m) => String(m.type || "").toLowerCase().includes(movementTypeFilter.toLowerCase()));
  }, [movements, movementTypeFilter]);

  const submitMovement = async (mode) => {
    const serials = String(moveForm.serial_numbers || "")
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      product_id: Number(moveForm.product_id),
      variant_id: moveForm.variant_id ? Number(moveForm.variant_id) : null,
      warehouse_id: Number(moveForm.warehouse_id) || null,
      qty: Number(moveForm.qty),
      batch_number: moveForm.batch_number || null,
      expiry_date: moveForm.expiry_date || null,
      note: moveForm.note || "",
      serial_numbers: serials.length ? serials.join("\n") : undefined,
      serials: serials.length ? serials : undefined,
    };
    if (!payload.product_id || !payload.qty) {
      showToast("Product and quantity are required");
      return;
    }
    if (!payload.warehouse_id && warehouses.length) {
      showToast("Select a warehouse");
      return;
    }
    let result;
    if (mode === "in") result = await api.inventory.stockIn(payload);
    else if (mode === "out") result = await api.inventory.stockOut(payload);
    else result = await api.inventory.adjust(payload);

    if (!result?.success) {
      showToast(result?.error || "Stock movement failed");
      return;
    }
    showToast(mode === "in" ? "Stock received" : mode === "out" ? "Stock issued" : "Stock adjusted");
    setMoveForm({ ...emptyMove, warehouse_id: moveForm.warehouse_id });
    await load();
  };

  const productNameById = (id) => products.find((p) => p.id === Number(id))?.name || `Product #${id}`;

  const resetVariantForm = () => {
    setEditingVariantId(null);
    setVariantForm({ product_id: "", name: "", sku: "", barcode: "", price: "", cost: "", attributes: "" });
  };

  const saveVariantSku = async (event) => {
    event.preventDefault();
    if (!variantForm.product_id || !String(variantForm.name || "").trim()) {
      showToast("Product and variant name are required");
      return;
    }
    let attributes = {};
    if (String(variantForm.attributes || "").trim()) {
      try {
        attributes = JSON.parse(variantForm.attributes);
        if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
          showToast("Attributes must be a JSON object");
          return;
        }
      } catch {
        showToast("Invalid attributes JSON");
        return;
      }
    }
    const result = await api.inventory.upsertVariantSku({
      id: editingVariantId || undefined,
      product_id: Number(variantForm.product_id),
      name: variantForm.name.trim(),
      sku: variantForm.sku || null,
      barcode: variantForm.barcode || null,
      price: variantForm.price === "" ? null : Number(variantForm.price),
      cost: variantForm.cost === "" ? 0 : Number(variantForm.cost),
      attributes,
    });
    if (!result?.success) {
      showToast(result?.error || "Could not save variant SKU");
      return;
    }
    showToast(editingVariantId ? "Variant updated" : "Variant created");
    resetVariantForm();
    await load();
  };

  const editVariantSku = (row) => {
    setEditingVariantId(row.id);
    setVariantForm({
      product_id: String(row.product_id || ""),
      name: row.name || "",
      sku: row.sku || "",
      barcode: row.barcode || "",
      price: row.price == null ? "" : String(row.price),
      cost: row.cost == null ? "" : String(row.cost),
      attributes: row.attributes && typeof row.attributes === "object" ? JSON.stringify(row.attributes) : "",
    });
    switchTab("variants");
  };

  const submitSerials = async (event) => {
    event.preventDefault();
    const serials = String(serialForm.serial_numbers || "")
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!serialForm.product_id || !serials.length) {
      showToast("Product and at least one serial are required");
      return;
    }
    const result = await api.inventory.registerSerials({
      product_id: Number(serialForm.product_id),
      warehouse_id: serialForm.warehouse_id ? Number(serialForm.warehouse_id) : null,
      serials,
    });
    if (!result?.success) {
      showToast(result?.error || "Could not register serials");
      return;
    }
    showToast(`Registered ${result.inserted || serials.length} serial(s)`);
    setSerialForm({ product_id: "", warehouse_id: "", serial_numbers: "" });
    await load();
  };

  const runLotPickPreview = async (event) => {
    event.preventDefault();
    if (!lotPickForm.product_id || !Number(lotPickForm.qty)) {
      showToast("Product and quantity are required");
      return;
    }
    const result = await api.inventory.previewLotPick({
      product_id: Number(lotPickForm.product_id),
      warehouse_id: lotPickForm.warehouse_id ? Number(lotPickForm.warehouse_id) : null,
      qty: Number(lotPickForm.qty),
      preference: lotPickForm.preference || "auto",
    });
    if (!result) {
      showToast("Could not preview lot pick");
      return;
    }
    setLotPickPreview(result);
    if (result.shortfall > 0) {
      showToast(`Shortfall of ${result.shortfall} — insufficient open lots`);
    }
  };

  const quickAdjust = async (product, delta) => {
    setAdjustingId(product.id);
    const result = await api.products.adjustStock(product.id, delta, "Quick adjust from Inventory");
    setAdjustingId(null);
    if (!result?.success) {
      showToast(result?.error || "Could not adjust stock");
      return;
    }
    await load();
    showToast(`${product.name} ${delta > 0 ? "+" : ""}${delta}`);
  };

  const submitTransfer = async (event) => {
    event.preventDefault();
    if (!transferForm.product_id) {
      showToast("Select a product to transfer");
      return;
    }
    const fromWh = warehouses.find((w) => w.id === Number(transferForm.from_warehouse_id));
    const toWh = warehouses.find((w) => w.id === Number(transferForm.to_warehouse_id));
    const result = await api.inventory.transferStock({
      product_id: Number(transferForm.product_id),
      from_warehouse_id: Number(transferForm.from_warehouse_id),
      to_warehouse_id: Number(transferForm.to_warehouse_id),
      from_branch_id: fromWh?.branch_id,
      to_branch_id: toWh?.branch_id,
      qty: Number(transferForm.qty),
      note: transferForm.note,
    });
    if (!result?.success) {
      showToast(result?.error || "Transfer failed");
      return;
    }
    showToast("Stock transferred");
    setTransferForm({ product_id: "", from_warehouse_id: "", to_warehouse_id: "", qty: 1, note: "" });
    await load();
  };

  const saveBrand = async (event) => {
    event.preventDefault();
    const result = await api.brands.create({ name: brandForm.name });
    if (!result?.success) {
      showToast(result?.error || "Could not create brand");
      return;
    }
    setBrandForm({ name: "" });
    showToast("Brand created");
    await load();
  };

  const saveUnit = async (event) => {
    event.preventDefault();
    const result = await api.units.create(unitForm);
    if (!result?.success) {
      showToast(result?.error || "Could not create unit");
      return;
    }
    setUnitForm({ name: "", abbreviation: "" });
    showToast("Unit created");
    await load();
  };

  const saveWarehouse = async (event) => {
    event.preventDefault();
    const result = await api.warehouses.create({
      ...whForm,
      branch_id: Number(whForm.branch_id) || branches[0]?.id,
    });
    if (!result?.success) {
      showToast(result?.error || "Could not create warehouse");
      return;
    }
    setWhForm({ name: "", code: "", branch_id: "", address: "" });
    showToast("Warehouse created");
    await load();
  };

  const setMainWarehouse = async (wh) => {
    const result = await api.warehouses.setMain(wh.id);
    if (!result?.success) {
      showToast(result?.error || "Could not set Main Store");
      return;
    }
    showToast(`${wh.name} is now the Main Store`);
    await load();
  };

  const archiveProduct = async (p) => {
    const result = await api.products.archive(p.id);
    if (!result?.success) showToast(result?.error || "Archive failed");
    else {
      showToast("Product archived");
      await load();
    }
  };

  const restoreProduct = async (p) => {
    const result = await api.products.restore(p.id);
    if (!result?.success) showToast(result?.error || "Restore failed");
    else {
      showToast("Product restored");
      await load();
    }
  };

  const softDeleteProduct = async (p) => {
    if (!confirm(`Soft-delete "${p.name}"? History is preserved.`)) return;
    const result = await api.products.delete(p.id);
    if (!result?.success) showToast(result?.error || "Delete failed");
    else {
      showToast(result.soft ? "Product soft-deleted" : "Product removed");
      await load();
    }
  };

  const exportInventory = async (format) => {
    const rows = filteredProducts.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      category: p.category,
      brand: p.brand,
      stock: p.stock,
      reorder_level: p.reorder_level,
      max_stock: p.max_stock,
      cost: p.cost,
      price: p.price,
      wholesale_price: p.wholesale_price,
      stock_value: Number(p.stock) * Number(p.cost || 0),
      expiry_date: p.expiry_date || "",
      status: productLifecycle(p),
    }));
    if (format === "csv") downloadCsv(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    else if (format === "excel") await downloadExcel(`inventory-${new Date().toISOString().slice(0, 10)}.xlsx`, { Inventory: rows });
    else
      await downloadPdf(
        "Inventory Export",
        rows.slice(0, 40).map((r) => `${r.name} · stock ${r.stock} · value ${r.stock_value}`)
      );
  };

  const importProducts = async (file) => {
    if (!file) return;
    try {
      let rows = [];
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const book = XLSX.read(buf, { type: "array" });
        const sheet = book.Sheets[book.SheetNames[0]];
        rows = parseProductImportRows(XLSX.utils.sheet_to_json(sheet));
      } else {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) {
          showToast("CSV has no data rows");
          return;
        }
        const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
        rows = parseProductImportRows(
          lines.slice(1).map((line) => {
            const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
            const obj = {};
            headers.forEach((h, i) => {
              obj[h] = cols[i];
            });
            return obj;
          })
        );
      }
      const result = await api.products.import(rows);
      if (!result?.success) {
        showToast(result?.error || "Import failed");
        return;
      }
      showToast(`Import done — created ${result.created}, updated ${result.updated}, failed ${result.failed}`);
      await load();
    } catch (err) {
      showToast(err?.message || "Import failed");
    }
  };

  const initCountFromCatalog = () => {
    const lines = products
      .filter((p) => !p.archived_at && !p.deleted_at)
      .slice(0, 200)
      .map((p) => ({
        product_id: p.id,
        name: p.name,
        system_qty: Number(p.stock) || 0,
        counted_qty: Number(p.stock) || 0,
        note: "",
      }));
    setCountLines(lines);
  };

  const submitCount = async () => {
    if (!countLines.length) {
      showToast("Add count lines first");
      return;
    }
    const result = await api.inventory.createCount({
      warehouse_id: countWarehouse ? Number(countWarehouse) : null,
      notes: countNotes,
      lines: countLines.map((l) => ({
        product_id: l.product_id,
        system_qty: Number(l.system_qty),
        counted_qty: Number(l.counted_qty),
        note: l.note,
      })),
    });
    if (!result?.success) {
      showToast(result?.error || "Could not create count");
      return;
    }
    showToast("Stock count saved as draft");
    setCountLines([]);
    setCountNotes("");
    await load();
  };

  const postCount = async (id) => {
    if (!confirm("Post this count? Variances will adjust on-hand stock.")) return;
    const result = await api.inventory.postCount(id);
    if (!result?.success) showToast(result?.error || "Post failed");
    else {
      showToast("Count posted");
      await load();
    }
  };

  const variantRows = useMemo(() => {
    if (ledgerVariants.length) {
      return ledgerVariants.map((v) => ({
        ...v,
        product_name: productNameById(v.product_id),
        source: "ledger",
      }));
    }
    return products.flatMap((product) =>
      (product.variants || []).map((variant) => ({
        ...variant,
        product_id: product.id,
        product_name: product.name,
        source: "json",
      }))
    );
  }, [ledgerVariants, products]);

  const selectedLedgerVariants = useMemo(
    () => ledgerVariants.filter((v) => Number(v.product_id) === Number(moveForm.product_id) && v.active !== false),
    [ledgerVariants, moveForm.product_id]
  );

  const reportRows = useMemo(() => {
    if (!reports) return [];
    const map = {
      valuation: reports.valuation,
      movements: reports.movements,
      dead_stock: reports.dead_stock,
      fast_moving: reports.fast_moving,
      expired: reports.expired,
      low_stock: reports.low_stock,
      overstock: reports.overstock,
      adjustments: reports.adjustments,
    };
    return map[reportSection] || [];
  }, [reports, reportSection]);

  const MovementForm = ({ mode }) => (
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Product">
        <ProductSelector
          products={products.filter((p) => !p.archived_at && !p.deleted_at)}
          value={moveForm.product_id}
          onChange={(productId) => setMoveForm((f) => ({ ...f, product_id: productId, variant_id: "" }))}
          placeholder="Select product…"
          disableOutOfStock={mode === "out"}
        />
      </Field>
      <Field label="Variant (optional)">
        <select
          className={inputClass}
          value={moveForm.variant_id}
          onChange={(e) => setMoveForm((f) => ({ ...f, variant_id: e.target.value }))}
        >
          <option value="">No variant</option>
          {(selectedLedgerVariants.length
            ? selectedLedgerVariants
            : selectedProduct?.variants || []
          ).map((v) => (
            <option key={v.id || v.name} value={v.id}>
              {v.name}
              {v.sku ? ` (${v.sku})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Warehouse">
        <select
          className={inputClass}
          value={moveForm.warehouse_id}
          onChange={(e) => setMoveForm((f) => ({ ...f, warehouse_id: e.target.value }))}
        >
          <option value="">Select warehouse</option>
          {warehouses.filter((w) => w.active !== false).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={mode === "adjust" ? "Qty (+/-)" : "Quantity"}>
        <input
          type="number"
          className={inputClass}
          value={moveForm.qty}
          onChange={(e) => setMoveForm((f) => ({ ...f, qty: e.target.value }))}
          min={mode === "adjust" ? undefined : 1}
        />
      </Field>
      <Field label="Batch number">
        <input
          className={inputClass}
          value={moveForm.batch_number}
          onChange={(e) => setMoveForm((f) => ({ ...f, batch_number: e.target.value }))}
          placeholder="Optional"
        />
      </Field>
      <Field label="Expiry date">
        <input
          type="date"
          className={inputClass}
          value={moveForm.expiry_date}
          onChange={(e) => setMoveForm((f) => ({ ...f, expiry_date: e.target.value }))}
        />
      </Field>
      {mode === "in" && (
        <div className="md:col-span-3">
          <Field label="Serial numbers (optional)">
            <textarea
              className={inputClass}
              rows={2}
              value={moveForm.serial_numbers}
              onChange={(e) => setMoveForm((f) => ({ ...f, serial_numbers: e.target.value }))}
              placeholder="One per line, or comma-separated — registered into serial ledger on receive"
            />
          </Field>
        </div>
      )}
      <div className="md:col-span-2">
        <Field label="Note">
          <input
            className={inputClass}
            value={moveForm.note}
            onChange={(e) => setMoveForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Reference / reason"
          />
        </Field>
      </div>
      <div className="flex items-end">
        <button type="button" onClick={() => submitMovement(mode)} className="btn btn-primary w-full">
          {mode === "in" ? "Receive stock" : mode === "out" ? "Issue stock" : "Apply adjustment"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Inventory Management</h1>
          <p className="nx-page-lead">
            Enterprise stock control — dashboard, products, movements, transfers, counts, alerts, and reports.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPrintBarcode && (
            <Link to="/barcode" className="btn btn-secondary inline-flex items-center gap-1">
              <Barcode size={14} /> Barcodes
            </Link>
          )}
          {can("products", "view") && (
            <Link to="/products" className="btn btn-secondary inline-flex items-center gap-1">
              <Package size={14} /> Catalog
            </Link>
          )}
          {canExport && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => exportInventory("csv")}>
                <Download size={14} /> CSV
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => exportInventory("excel")}>
                <Download size={14} /> Excel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="nx-tabs mb-4 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => switchTab(id)}
            className={`nx-tab flex shrink-0 items-center gap-2 ${tab === id ? "is-active" : ""}`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton rows={8} />
      ) : (
        <>
          {tab === "dashboard" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
                <StatCard icon={Package} label="Total Products" value={stats.totalSkus || stats.sku_count || 0} color="#2563EB" onClick={() => switchTab("products")} />
                <StatCard icon={AlertTriangle} label="Low Stock" value={stats.lowStockCount || stats.low_stock_count || 0} color="#DC2626" onClick={() => switchTab("alerts")} />
                <StatCard icon={PackageX} label="Out of Stock" value={stats.outOfStockCount || stats.out_of_stock_count || outStock.length} color="#B91C1C" onClick={() => switchTab("alerts")} />
                <StatCard icon={Boxes} label="Overstock" value={stats.overstockCount || stats.overstock_count || overstock.length} color="#7C3AED" onClick={() => switchTab("alerts")} />
                <StatCard icon={Clock} label="Expiring Soon" value={stats.expiringSoonCount || stats.expiring_soon_count || 0} color="#D97706" onClick={() => switchTab("alerts")} />
                <StatCard icon={AlertTriangle} label="Expired" value={stats.expiredCount || stats.expired_count || 0} color="#991B1B" onClick={() => switchTab("alerts")} />
                <StatCard icon={DollarSign} label="Inventory Value" value={money(stats.inventoryValue || stats.stockValue || stats.stock_value || 0)} color="#12A150" />
                <StatCard icon={PackageCheck} label="Total Units" value={stats.totalUnits || stats.total_units || 0} color="#0D9488" />
              </div>

              <Panel title="Stock movement (30 days)">
                <div className="h-64 w-full">
                  {chartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-app-muted">No movement data yet.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E4E9F2" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="in" name="In" fill="#12A150" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="out" name="Out" fill="#DC2626" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="adjust" name="Adjust" fill="#2563EB" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Panel>

              {(lowStock.length > 0 || expiring.length > 0 || outStock.length > 0) && (
                <div className="flex items-start gap-3 rounded-2xl border border-[#FBD5D5] bg-[#FEF6F6] p-4">
                  <AlertTriangle size={18} className="mt-0.5 text-danger" />
                  <div className="text-sm text-app-text">
                    <span className="font-semibold">{lowStock.length} low</span>
                    {" · "}
                    <span className="font-semibold">{outStock.length} out</span>
                    {" · "}
                    <span className="font-semibold">{expiring.length} expiry</span> alerts need attention.
                    <button type="button" className="ml-2 text-brand underline" onClick={() => switchTab("alerts")}>
                      View alerts
                    </button>
                  </div>
                </div>
              )}

              <Panel title="Recent stock movements" actions={<button type="button" className="text-sm text-brand" onClick={() => switchTab("movements")}>View all</button>}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-app text-left text-xs uppercase text-app-muted">
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">Product</th>
                        <th className="py-2 pr-3">Warehouse</th>
                        <th className="py-2 pr-3">Qty</th>
                        <th className="py-2 pr-3">Batch</th>
                        <th className="py-2">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.slice(0, 10).map((m) => (
                        <tr key={m.id} className="border-t border-app text-sm">
                          <td className="py-2 pr-3 capitalize">{m.type}</td>
                          <td className="py-2 pr-3">{m.product_name}</td>
                          <td className="py-2 pr-3 text-app-muted">{m.warehouse_name}</td>
                          <td className="py-2 pr-3 font-mono">{Math.abs(m.qty)}</td>
                          <td className="py-2 pr-3 font-mono text-app-muted">{m.batch_number || "—"}</td>
                          <td className="py-2 text-app-muted">{m.created_at ? new Date(m.created_at).toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                      {movements.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-sm text-app-muted">
                            No movements yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}

          {tab === "products" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
                  <input
                    className="form-control w-full pl-9"
                    placeholder="Search name, SKU, barcode…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>
                <select className="form-control w-auto" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="deleted">Deleted</option>
                  <option value="all">All</option>
                </select>
                {canProductCreate && (
                  <>
                    <Link to="/products" className="btn btn-primary inline-flex items-center gap-1">
                      <Plus size={14} /> Add / Edit
                    </Link>
                    <label className="btn btn-secondary inline-flex cursor-pointer items-center gap-1">
                      <Upload size={14} /> Import
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) importProducts(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </>
                )}
                {canExport && (
                  <button type="button" className="btn btn-secondary" onClick={() => exportInventory("csv")}>
                    <Download size={14} /> Export
                  </button>
                )}
                {canPrintBarcode && selectedIds.length > 0 && (
                  <Link to={`/barcode?ids=${selectedIds.join(",")}`} className="btn btn-secondary">
                    <Barcode size={14} /> Print selected ({selectedIds.length})
                  </Link>
                )}
              </div>

              <div className="table-container overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="bg-app-panel-muted">
                      <th className="px-3 py-2.5 text-left">
                        <input
                          type="checkbox"
                          checked={pagedProducts.length > 0 && pagedProducts.every((p) => selectedIds.includes(p.id))}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds((ids) => [...new Set([...ids, ...pagedProducts.map((p) => p.id)])]);
                            else setSelectedIds((ids) => ids.filter((id) => !pagedProducts.some((p) => p.id === id)));
                          }}
                        />
                      </th>
                      {["Product", "SKU", "Stock", "Cost / Sell", "Wholesale", "Expiry", "Status", "Actions"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-app-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedProducts.map((p) => (
                      <tr key={p.id} className="border-t border-app">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(p.id)}
                            onChange={(e) =>
                              setSelectedIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)))
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-sm font-medium">
                          {p.name}
                          <div className="text-xs text-app-muted">{p.category || "—"} · {p.brand || "—"}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{p.sku || "—"}</td>
                        <td className="px-3 py-2 font-mono text-sm">
                          {p.stock} {p.unit}
                          {canEdit && !p.deleted_at && (
                            <div className="mt-1 flex gap-1">
                              <button type="button" disabled={adjustingId === p.id} className="rounded border border-app p-0.5" onClick={() => quickAdjust(p, -1)}>
                                <Minus size={11} />
                              </button>
                              <button type="button" disabled={adjustingId === p.id} className="rounded border border-app p-0.5" onClick={() => quickAdjust(p, 1)}>
                                <Plus size={11} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <div className="font-mono">{money(p.cost)}</div>
                          <div className="font-mono text-app-muted">{money(p.price)}{p.tax_inclusive ? " incl." : ""}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-sm">{money(p.wholesale_price || 0)}</td>
                        <td className="px-3 py-2 text-xs text-app-muted">{p.expiry_date || "—"}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-app-panel-muted px-2 py-0.5 text-xs">{productLifecycle(p)}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {canProductEdit && p.archived_at && !p.deleted_at && (
                            <button type="button" className="mr-1 text-success" title="Restore" onClick={() => restoreProduct(p)}>
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {canProductEdit && !p.archived_at && !p.deleted_at && (
                            <button type="button" className="mr-1 text-app-muted" title="Archive" onClick={() => archiveProduct(p)}>
                              <Archive size={14} />
                            </button>
                          )}
                          {canProductDelete && !p.deleted_at && (
                            <button type="button" className="text-danger" title="Soft delete" onClick={() => softDeleteProduct(p)}>
                              <Trash2 size={14} />
                            </button>
                          )}
                          {canProductEdit && p.deleted_at && (
                            <button type="button" className="text-success" title="Restore" onClick={() => restoreProduct(p)}>
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {pagedProducts.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-sm text-app-muted">
                          No products match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-sm text-app-muted">
                <span>
                  Page {pageSafe} / {pageCount} · {filteredProducts.length} products
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-secondary" disabled={pageSafe <= 1} onClick={() => setProductPage((p) => p - 1)}>
                    Prev
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={pageSafe >= pageCount} onClick={() => setProductPage((p) => p + 1)}>
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "movements" && (
            <Panel
              title="Stock movements"
              actions={
                <select className="form-control w-auto" value={movementTypeFilter} onChange={(e) => setMovementTypeFilter(e.target.value)}>
                  <option value="">All types</option>
                  <option value="in">In</option>
                  <option value="out">Out</option>
                  <option value="adjust">Adjust</option>
                  <option value="transfer">Transfer</option>
                  <option value="count">Count</option>
                </select>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-app text-left text-xs uppercase text-app-muted">
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 pr-3">Warehouse</th>
                      <th className="py-2 pr-3">Qty</th>
                      <th className="py-2 pr-3">Batch</th>
                      <th className="py-2 pr-3">Expiry</th>
                      <th className="py-2 pr-3">Note</th>
                      <th className="py-2">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMovements.map((m) => (
                      <tr key={m.id} className="border-t border-app text-sm">
                        <td className="py-2 pr-3 capitalize">{m.type}</td>
                        <td className="py-2 pr-3">{m.product_name}</td>
                        <td className="py-2 pr-3 text-app-muted">{m.warehouse_name}</td>
                        <td className="py-2 pr-3 font-mono">{Math.abs(m.qty)}</td>
                        <td className="py-2 pr-3 font-mono text-app-muted">{m.batch_number || "—"}</td>
                        <td className="py-2 pr-3 text-app-muted">{m.expiry_date || "—"}</td>
                        <td className="py-2 pr-3 text-app-muted">{m.note || "—"}</td>
                        <td className="py-2 text-app-muted">{m.created_at ? new Date(m.created_at).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {tab === "transfers" && (
            <div className="space-y-5">
              {canEdit && (
                <Panel title="Stock Transfer (Main Store ⇄ warehouse)">
                  <form onSubmit={submitTransfer} className="grid gap-3 md:grid-cols-5">
                    <div className="md:col-span-2">
                      <ProductSelector
                        products={products.filter((p) => !p.archived_at && !p.deleted_at)}
                        value={transferForm.product_id}
                        onChange={(productId) => setTransferForm((f) => ({ ...f, product_id: productId }))}
                        placeholder="Select product…"
                        disableOutOfStock={false}
                        required
                      />
                    </div>
                    <select
                      required
                      className={inputClass}
                      value={transferForm.from_warehouse_id}
                      onChange={(e) => setTransferForm((f) => ({ ...f, from_warehouse_id: e.target.value }))}
                    >
                      <option value="">From warehouse</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                          {w.is_main ? " (Main Store)" : ""}
                        </option>
                      ))}
                    </select>
                    <select
                      required
                      className={inputClass}
                      value={transferForm.to_warehouse_id}
                      onChange={(e) => setTransferForm((f) => ({ ...f, to_warehouse_id: e.target.value }))}
                    >
                      <option value="">To warehouse</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                          {w.is_main ? " (Main Store)" : ""}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input
                        required
                        type="number"
                        min={1}
                        className="w-20 rounded-lg border border-app px-3 py-2 text-sm"
                        value={transferForm.qty}
                        onChange={(e) => setTransferForm((f) => ({ ...f, qty: e.target.value }))}
                      />
                      <button type="submit" className="btn btn-primary flex-1">
                        Transfer
                      </button>
                    </div>
                  </form>
                  <p className="mt-3 text-xs text-app-muted">
                    Deducts from the source warehouse and adds to the destination in real time. Every transfer must touch
                    the Main Store on one side — stock only ever reaches another warehouse/store this way, never directly
                    from Purchases. Company-wide total stock is unchanged.
                  </p>
                </Panel>
              )}
              <Panel title="Transfer history">
                <div className="space-y-1 text-sm">
                  {transfers.map((t) => (
                    <div key={t.id} className="rounded-lg border border-app px-3 py-2">
                      #{t.id}: qty {t.qty} · WH {t.from_warehouse_id || t.from_branch_id || "—"} → {t.to_warehouse_id || t.to_branch_id || "—"}
                      <span className="ml-2 text-xs text-app-muted">{t.created_at ? new Date(t.created_at).toLocaleString() : ""}</span>
                    </div>
                  ))}
                  {transfers.length === 0 && <div className="text-app-muted">No transfers yet.</div>}
                </div>
              </Panel>
            </div>
          )}

          {tab === "counts" && (
            <div className="space-y-5">
              {(canCreate || canEdit) && (
                <Panel
                  title="Physical stock count"
                  actions={
                    <button type="button" className="btn btn-secondary" onClick={initCountFromCatalog}>
                      Load catalog
                    </button>
                  }
                >
                  <div className="mb-3 grid gap-3 md:grid-cols-3">
                    <select className={inputClass} value={countWarehouse} onChange={(e) => setCountWarehouse(e.target.value)}>
                      <option value="">Warehouse (optional)</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <input className={inputClass} placeholder="Notes" value={countNotes} onChange={(e) => setCountNotes(e.target.value)} />
                    <button type="button" className="btn btn-primary" onClick={submitCount} disabled={!countLines.length}>
                      Save draft count
                    </button>
                  </div>
                  {countLines.length > 0 && (
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-app text-left text-xs uppercase text-app-muted">
                            <th className="py-2">Product</th>
                            <th className="py-2">System</th>
                            <th className="py-2">Counted</th>
                            <th className="py-2">Variance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {countLines.map((l, idx) => (
                            <tr key={l.product_id} className="border-t border-app">
                              <td className="py-1.5">{l.name}</td>
                              <td className="py-1.5 font-mono">{l.system_qty}</td>
                              <td className="py-1.5">
                                <input
                                  type="number"
                                  className="form-control w-24"
                                  value={l.counted_qty}
                                  onChange={(e) =>
                                    setCountLines((rows) =>
                                      rows.map((r, i) => (i === idx ? { ...r, counted_qty: e.target.value } : r))
                                    )
                                  }
                                />
                              </td>
                              <td className="py-1.5 font-mono">{Number(l.counted_qty) - Number(l.system_qty)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              )}
              <Panel title="Saved counts">
                <div className="space-y-2">
                  {counts.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-app px-3 py-2 text-sm">
                      <div>
                        Count #{c.id} · {c.status}
                        <div className="text-xs text-app-muted">{c.counted_at ? new Date(c.counted_at).toLocaleString() : ""}</div>
                      </div>
                      {c.status === "draft" && canApprove && (
                        <button type="button" className="btn btn-primary" onClick={() => postCount(c.id)}>
                          Post & adjust
                        </button>
                      )}
                    </div>
                  ))}
                  {counts.length === 0 && <div className="text-sm text-app-muted">No counts yet. Requires migration 017.</div>}
                </div>
              </Panel>
            </div>
          )}

          {tab === "stock-in" && (
            <Panel title="Stock In">
              {canCreate || canEdit ? <MovementForm mode="in" /> : <p className="text-sm text-app-muted">No permission to receive stock.</p>}
            </Panel>
          )}

          {tab === "stock-out" && (
            <Panel title="Stock Out">
              {canEdit ? <MovementForm mode="out" /> : <p className="text-sm text-app-muted">No permission to issue stock.</p>}
            </Panel>
          )}

          {tab === "adjust" && (
            <Panel title="Stock Adjustment">
              {canEdit ? (
                <>
                  <p className="mb-4 text-sm text-app-muted">Positive qty increases stock; negative decreases.</p>
                  <MovementForm mode="adjust" />
                </>
              ) : (
                <p className="text-sm text-app-muted">No permission to adjust stock.</p>
              )}
            </Panel>
          )}

          {tab === "alerts" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title={`Low stock (${lowStock.length})`}>
                <div className="space-y-2">
                  {lowStock.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-xl border border-app px-3 py-2.5 text-sm">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-app-muted">
                          Reorder at {p.reorder_level} · short by {p.deficit}
                        </div>
                      </div>
                      <span className="font-mono text-danger">{p.stock}</span>
                    </div>
                  ))}
                  {lowStock.length === 0 && <div className="text-sm text-app-muted">All products above reorder level.</div>}
                </div>
              </Panel>
              <Panel title={`Out of stock (${outStock.length})`}>
                <div className="space-y-2">
                  {outStock.map((p) => (
                    <div key={p.id} className="flex justify-between rounded-xl border border-app px-3 py-2.5 text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="font-mono text-danger">0</span>
                    </div>
                  ))}
                  {outStock.length === 0 && <div className="text-sm text-app-muted">No out-of-stock items.</div>}
                </div>
              </Panel>
              <Panel title={`Overstock (${overstock.length})`}>
                <div className="space-y-2">
                  {overstock.map((p) => (
                    <div key={p.id} className="flex justify-between rounded-xl border border-app px-3 py-2.5 text-sm">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-app-muted">Max {p.max_stock}</div>
                      </div>
                      <span className="font-mono">{p.stock}</span>
                    </div>
                  ))}
                  {overstock.length === 0 && <div className="text-sm text-app-muted">No overstock (set max stock on products).</div>}
                </div>
              </Panel>
              <Panel title={`Expiry tracking (${expiring.length})`}>
                <div className="space-y-2">
                  {expiring.map((lot) => (
                    <div key={`${lot.id}-${lot.batch_number}`} className="flex items-center justify-between rounded-xl border border-app px-3 py-2.5 text-sm">
                      <div>
                        <div className="font-medium">{lot.product_name}</div>
                        <div className="text-xs text-app-muted">
                          {lot.warehouse_name} · Batch {lot.batch_number || "—"} · Qty {lot.qty}
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${lot.status === "expired" ? "bg-[#FDECEC] text-danger" : "bg-[#FEF3C7] text-[#D97706]"}`}>
                        {lot.expiry_date}
                      </span>
                    </div>
                  ))}
                  {expiring.length === 0 && <div className="text-sm text-app-muted">No lots expiring in the next 30 days.</div>}
                </div>
              </Panel>
            </div>
          )}

          {tab === "warehouses" && (
            <div className="space-y-5">
              <div className="rounded-lg border border-app bg-app-panel-muted px-4 py-3 text-xs text-app-muted">
                <strong className="text-app">Main Store</strong> is the central warehouse that receives every approved
                purchase. Every other warehouse/store only ever gets stock via a Stock Transfer out of (or back into) the
                Main Store — never directly from Purchases.
              </div>
              {canCreate && (
                <Panel title="Add warehouse">
                  <form onSubmit={saveWarehouse} className="grid gap-3 md:grid-cols-4">
                    <input required className={inputClass} placeholder="Name" value={whForm.name} onChange={(e) => setWhForm((f) => ({ ...f, name: e.target.value }))} />
                    <input className={inputClass} placeholder="Code" value={whForm.code} onChange={(e) => setWhForm((f) => ({ ...f, code: e.target.value }))} />
                    <select required className={inputClass} value={whForm.branch_id} onChange={(e) => setWhForm((f) => ({ ...f, branch_id: e.target.value }))}>
                      <option value="">Branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn btn-primary">
                      Add warehouse
                    </button>
                  </form>
                </Panel>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {warehouses.map((wh) => {
                  const stock = warehouseStock.filter((r) => r.warehouse_id === wh.id);
                  const unitsCount = stock.reduce((s, r) => s + Number(r.qty), 0);
                  const value = stock.reduce((s, r) => s + Number(r.value || 0), 0);
                  const branchName = branches.find((b) => b.id === wh.branch_id)?.name || "—";
                  return (
                    <div key={wh.id} className={`card ${wh.is_main ? "ring-2 ring-brand" : ""}`}>
                      <div className="mb-3 flex items-start justify-between">
                        <div>
                          <div className="card-title flex items-center gap-2">
                            {wh.name}
                            {wh.is_main && (
                              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                                Main Store
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-app-muted">
                            {wh.code} · {branchName}
                          </div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${wh.active !== false ? "bg-[#E8FAEF] text-success" : "bg-app-panel-muted text-app-muted"}`}>
                          {wh.active !== false ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-app-muted">Units on hand</div>
                          <div className="font-mono font-semibold">{unitsCount}</div>
                        </div>
                        <div>
                          <div className="text-xs text-app-muted">Stock value</div>
                          <div className="font-mono font-semibold">{money(value)}</div>
                        </div>
                      </div>
                      {!wh.is_main && canSetMainWarehouse && (
                        <button
                          type="button"
                          className="btn btn-secondary mt-3 w-full"
                          onClick={() => setMainWarehouse(wh)}
                        >
                          Set as Main Store
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "brands" && (
            <div className="space-y-5">
              {canBrandCreate && (
                <Panel title="Add brand">
                  <form onSubmit={saveBrand} className="flex flex-wrap gap-3">
                    <input required className={`${inputClass} max-w-sm`} placeholder="Brand name" value={brandForm.name} onChange={(e) => setBrandForm({ name: e.target.value })} />
                    <button type="submit" className="btn btn-primary">
                      Add brand
                    </button>
                  </form>
                </Panel>
              )}
              <div className="table-container">
                <table className="w-full">
                  <thead>
                    <tr className="bg-app-panel-muted">
                      {["Brand", "Products", "Status", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-app-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {brands.map((brand) => (
                      <tr key={brand.id} className="border-t border-app">
                        <td className="px-4 py-3 text-sm font-medium">{brand.name}</td>
                        <td className="px-4 py-3 font-mono text-sm">{products.filter((p) => Number(p.brand_id) === brand.id).length}</td>
                        <td className="px-4 py-3 text-sm">{brand.active !== false ? "Active" : "Inactive"}</td>
                        <td className="px-4 py-3 text-sm">
                          {canBrandEdit && (
                            <button
                              type="button"
                              className="mr-2 text-brand"
                              onClick={async () => {
                                await api.brands.update({ id: brand.id, active: brand.active === false });
                                await load();
                              }}
                            >
                              {brand.active === false ? "Activate" : "Deactivate"}
                            </button>
                          )}
                          {canBrandDelete && (
                            <button
                              type="button"
                              className="text-danger"
                              onClick={async () => {
                                const result = await api.brands.delete(brand.id);
                                if (!result?.success) showToast(result?.error || "Could not delete");
                                else {
                                  showToast("Brand deleted");
                                  await load();
                                }
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "units" && (
            <div className="space-y-5">
              {canCreate && (
                <Panel title="Add unit">
                  <form onSubmit={saveUnit} className="flex flex-wrap gap-3">
                    <input required className={`${inputClass} max-w-xs`} placeholder="Name" value={unitForm.name} onChange={(e) => setUnitForm((f) => ({ ...f, name: e.target.value }))} />
                    <input required className={`${inputClass} max-w-[140px]`} placeholder="Abbr" value={unitForm.abbreviation} onChange={(e) => setUnitForm((f) => ({ ...f, abbreviation: e.target.value }))} />
                    <button type="submit" className="btn btn-primary">
                      Add unit
                    </button>
                  </form>
                </Panel>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {units.map((unit) => (
                  <div key={unit.id} className="nx-kpi">
                    <div className="card-title">{unit.name}</div>
                    <div className="mt-1 font-mono text-sm text-app-muted">{unit.abbreviation}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "variants" && (
            <div className="space-y-5">
              {canProductEdit && (
                <Panel title={editingVariantId ? "Edit variant SKU" : "Add variant SKU"}>
                  <form onSubmit={saveVariantSku} className="grid gap-3 md:grid-cols-3">
                    <Field label="Product">
                      <ProductSelector
                        products={products.filter((p) => !p.archived_at && !p.deleted_at)}
                        value={variantForm.product_id}
                        onChange={(productId) => setVariantForm((f) => ({ ...f, product_id: productId }))}
                        placeholder="Select product…"
                      />
                    </Field>
                    <Field label="Name">
                      <input
                        required
                        className={inputClass}
                        value={variantForm.name}
                        onChange={(e) => setVariantForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Size M / Red"
                      />
                    </Field>
                    <Field label="SKU">
                      <input
                        className={inputClass}
                        value={variantForm.sku}
                        onChange={(e) => setVariantForm((f) => ({ ...f, sku: e.target.value }))}
                        placeholder="Optional unique SKU"
                      />
                    </Field>
                    <Field label="Barcode">
                      <input
                        className={inputClass}
                        value={variantForm.barcode}
                        onChange={(e) => setVariantForm((f) => ({ ...f, barcode: e.target.value }))}
                      />
                    </Field>
                    <Field label="Price">
                      <input
                        type="number"
                        step="0.01"
                        className={inputClass}
                        value={variantForm.price}
                        onChange={(e) => setVariantForm((f) => ({ ...f, price: e.target.value }))}
                      />
                    </Field>
                    <Field label="Cost">
                      <input
                        type="number"
                        step="0.01"
                        className={inputClass}
                        value={variantForm.cost}
                        onChange={(e) => setVariantForm((f) => ({ ...f, cost: e.target.value }))}
                      />
                    </Field>
                    <div className="md:col-span-3">
                      <Field label='Attributes JSON (optional)'>
                        <input
                          className={inputClass}
                          value={variantForm.attributes}
                          onChange={(e) => setVariantForm((f) => ({ ...f, attributes: e.target.value }))}
                          placeholder='{"size":"M","color":"Red"}'
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2 md:col-span-3">
                      <button type="submit" className="btn btn-primary">
                        {editingVariantId ? "Update variant" : "Add variant"}
                      </button>
                      {editingVariantId && (
                        <button type="button" className="btn btn-secondary" onClick={resetVariantForm}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>
                </Panel>
              )}
              <Panel
                title={`Variant SKU ledger (${variantRows.filter((v) => v.source === "ledger").length || variantRows.length})`}
              >
                {variantRows.length === 0 ? (
                  <div className="text-sm text-app-muted">
                    No variant SKUs yet. Create them here — products.variants JSON remains a denormalized cache.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-app text-left text-xs uppercase text-app-muted">
                          <th className="py-2 pr-3">Product</th>
                          <th className="py-2 pr-3">Variant</th>
                          <th className="py-2 pr-3">SKU</th>
                          <th className="py-2 pr-3">Barcode</th>
                          <th className="py-2 pr-3">Price</th>
                          <th className="py-2 pr-3">Cost</th>
                          <th className="py-2 pr-3">Stock</th>
                          <th className="py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variantRows.map((v) => (
                          <tr key={`${v.source}-${v.product_id}-${v.id || v.name}`} className="border-t border-app text-sm">
                            <td className="py-2 pr-3">{v.product_name}</td>
                            <td className="py-2 pr-3 font-medium">{v.name}</td>
                            <td className="py-2 pr-3 font-mono text-app-muted">{v.sku || "—"}</td>
                            <td className="py-2 pr-3 font-mono text-app-muted">{v.barcode || "—"}</td>
                            <td className="py-2 pr-3 font-mono">{money(v.price)}</td>
                            <td className="py-2 pr-3 font-mono">{money(v.cost)}</td>
                            <td className="py-2 pr-3 font-mono">{v.stock ?? "—"}</td>
                            <td className="py-2">
                              {v.source === "ledger" && canProductEdit && (
                                <button type="button" className="btn btn-secondary" onClick={() => editVariantSku(v)}>
                                  Edit
                                </button>
                              )}
                              {v.source === "json" && (
                                <span className="text-xs text-app-muted">JSON cache</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === "serials" && (
            <div className="space-y-5">
              {canCreate && (
                <Panel title="Register serial numbers">
                  <form onSubmit={submitSerials} className="grid gap-3 md:grid-cols-3">
                    <Field label="Product">
                      <ProductSelector
                        products={products.filter((p) => !p.archived_at && !p.deleted_at)}
                        value={serialForm.product_id}
                        onChange={(productId) => setSerialForm((f) => ({ ...f, product_id: productId }))}
                        placeholder="Select product…"
                      />
                    </Field>
                    <Field label="Warehouse">
                      <select
                        className={inputClass}
                        value={serialForm.warehouse_id}
                        onChange={(e) => setSerialForm((f) => ({ ...f, warehouse_id: e.target.value }))}
                      >
                        <option value="">Optional</option>
                        {warehouses.filter((w) => w.active !== false).map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="md:col-span-3">
                      <Field label="Serial numbers">
                        <textarea
                          required
                          className={inputClass}
                          rows={3}
                          value={serialForm.serial_numbers}
                          onChange={(e) => setSerialForm((f) => ({ ...f, serial_numbers: e.target.value }))}
                          placeholder="One per line, or comma-separated"
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-3">
                      <button type="submit" className="btn btn-primary">
                        Register serials
                      </button>
                    </div>
                  </form>
                </Panel>
              )}
              <Panel title={`Serial ledger (${serialRows.length})`}>
                {serialRows.length === 0 ? (
                  <div className="text-sm text-app-muted">
                    No serials registered. Add them here or include serials when receiving stock.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-app text-left text-xs uppercase text-app-muted">
                          <th className="py-2 pr-3">Serial</th>
                          <th className="py-2 pr-3">Product</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">Warehouse</th>
                          <th className="py-2">Received</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serialRows.map((s) => (
                          <tr key={s.id} className="border-t border-app">
                            <td className="py-2 pr-3 font-mono font-medium">{s.serial_number}</td>
                            <td className="py-2 pr-3">{productNameById(s.product_id)}</td>
                            <td className="py-2 pr-3 capitalize">{s.status || "—"}</td>
                            <td className="py-2 pr-3 text-app-muted">
                              {warehouses.find((w) => w.id === Number(s.warehouse_id))?.name || "—"}
                            </td>
                            <td className="py-2 text-app-muted">
                              {s.received_at ? new Date(s.received_at).toLocaleString() : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === "lots" && (
            <div className="space-y-5">
              <Panel title="FIFO / FEFO pick preview">
                <form onSubmit={runLotPickPreview} className="grid gap-3 md:grid-cols-4">
                  <Field label="Product">
                    <ProductSelector
                      products={products.filter((p) => !p.archived_at && !p.deleted_at)}
                      value={lotPickForm.product_id}
                      onChange={(productId) => setLotPickForm((f) => ({ ...f, product_id: productId }))}
                      placeholder="Select product…"
                    />
                  </Field>
                  <Field label="Warehouse">
                    <select
                      className={inputClass}
                      value={lotPickForm.warehouse_id}
                      onChange={(e) => setLotPickForm((f) => ({ ...f, warehouse_id: e.target.value }))}
                    >
                      <option value="">All warehouses</option>
                      {warehouses.filter((w) => w.active !== false).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Qty to pick">
                    <input
                      type="number"
                      min={1}
                      className={inputClass}
                      value={lotPickForm.qty}
                      onChange={(e) => setLotPickForm((f) => ({ ...f, qty: e.target.value }))}
                    />
                  </Field>
                  <Field label="Preference">
                    <select
                      className={inputClass}
                      value={lotPickForm.preference}
                      onChange={(e) => setLotPickForm((f) => ({ ...f, preference: e.target.value }))}
                    >
                      <option value="auto">Auto (product setting)</option>
                      <option value="fifo">FIFO</option>
                      <option value="fefo">FEFO</option>
                    </select>
                  </Field>
                  <div className="md:col-span-4">
                    <button type="submit" className="btn btn-primary">
                      Preview auto-pick
                    </button>
                  </div>
                </form>
                {lotPickPreview && (
                  <div className="mt-4 space-y-2">
                    <div className="text-sm text-app-muted">
                      Mode: <span className="font-medium uppercase text-app">{lotPickPreview.preference}</span>
                      {lotPickPreview.shortfall > 0
                        ? ` · Shortfall ${lotPickPreview.shortfall}`
                        : " · Fully covered"}
                    </div>
                    {(lotPickPreview.plan || []).length === 0 ? (
                      <div className="text-sm text-app-muted">No open lots for this product.</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-app text-left text-xs uppercase text-app-muted">
                            <th className="py-2 pr-3">Lot</th>
                            <th className="py-2 pr-3">Batch</th>
                            <th className="py-2 pr-3">Expiry</th>
                            <th className="py-2 pr-3">Received</th>
                            <th className="py-2 pr-3">Pick qty</th>
                            <th className="py-2">Unit cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lotPickPreview.plan.map((p) => (
                            <tr key={p.lot_id} className="border-t border-app">
                              <td className="py-2 pr-3 font-mono">#{p.lot_id}</td>
                              <td className="py-2 pr-3">{p.batch_number || "—"}</td>
                              <td className="py-2 pr-3">{p.expiry_date || "—"}</td>
                              <td className="py-2 pr-3 text-app-muted">
                                {p.received_at ? new Date(p.received_at).toLocaleDateString() : "—"}
                              </td>
                              <td className="py-2 pr-3 font-mono">{p.qty}</td>
                              <td className="py-2 font-mono">{money(p.unit_cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </Panel>
              <Panel title={`Open lots (${openLots.length})`}>
                {openLots.length === 0 ? (
                  <div className="text-sm text-app-muted">
                    No open lots. Stock in / purchase receive creates lots automatically (migration 019).
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-app text-left text-xs uppercase text-app-muted">
                          <th className="py-2 pr-3">Lot</th>
                          <th className="py-2 pr-3">Product</th>
                          <th className="py-2 pr-3">Batch</th>
                          <th className="py-2 pr-3">Remaining</th>
                          <th className="py-2 pr-3">Received</th>
                          <th className="py-2 pr-3">Expiry</th>
                          <th className="py-2">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openLots.map((lot) => (
                          <tr key={lot.id} className="border-t border-app">
                            <td className="py-2 pr-3 font-mono">#{lot.id}</td>
                            <td className="py-2 pr-3">{productNameById(lot.product_id)}</td>
                            <td className="py-2 pr-3">{lot.batch_number || "—"}</td>
                            <td className="py-2 pr-3 font-mono">
                              {lot.qty_remaining} / {lot.qty_received}
                            </td>
                            <td className="py-2 pr-3 text-app-muted">
                              {lot.received_at ? new Date(lot.received_at).toLocaleDateString() : "—"}
                            </td>
                            <td className="py-2 pr-3">{lot.expiry_date || "—"}</td>
                            <td className="py-2 font-mono">{money(lot.unit_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === "reports" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  ["valuation", "Valuation"],
                  ["movements", "Movement"],
                  ["dead_stock", "Dead Stock"],
                  ["fast_moving", "Fast Moving"],
                  ["expired", "Expired"],
                  ["low_stock", "Low Stock"],
                  ["overstock", "Overstock"],
                  ["adjustments", "Adjustments"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`btn ${reportSection === id ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setReportSection(id)}
                  >
                    {label}
                  </button>
                ))}
                {canExport && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => downloadCsv(`inventory-${reportSection}.csv`, reportRows)}
                      disabled={!reportRows.length}
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => downloadExcel(`inventory-${reportSection}.xlsx`, { [reportSection]: reportRows })}
                      disabled={!reportRows.length}
                    >
                      Excel
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        downloadPdf(
                          `Inventory ${reportSection}`,
                          reportRows.slice(0, 40).map((r) => JSON.stringify(r).slice(0, 100))
                        )
                      }
                      disabled={!reportRows.length}
                    >
                      PDF
                    </button>
                  </>
                )}
              </div>
              <Panel title={`${reportSection.replace(/_/g, " ")} (${reportRows.length})`}>
                {!reports ? (
                  <ListSkeleton rows={4} />
                ) : (
                  <div className="max-h-[480px] overflow-auto">
                    <pre className="whitespace-pre-wrap text-xs text-app-muted">{JSON.stringify(reportRows.slice(0, 100), null, 2)}</pre>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === "history" && (
            <Panel title="Inventory & product audit">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-app text-left text-xs uppercase text-app-muted">
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">User</th>
                      <th className="py-2 pr-3">Action</th>
                      <th className="py-2 pr-3">Module</th>
                      <th className="py-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((a) => (
                      <tr key={a.id} className="border-t border-app">
                        <td className="py-2 pr-3 text-app-muted">{a.created_at ? new Date(a.created_at).toLocaleString() : "—"}</td>
                        <td className="py-2 pr-3">{a.user_name || "—"}</td>
                        <td className="py-2 pr-3">{a.action}</td>
                        <td className="py-2 pr-3">{a.module}</td>
                        <td className="py-2 text-xs text-app-muted">{typeof a.details === "string" ? a.details : JSON.stringify(a.details || {})}</td>
                      </tr>
                    ))}
                    {auditRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-app-muted">
                          No audit entries.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
