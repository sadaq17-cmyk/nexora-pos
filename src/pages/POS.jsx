import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode,
  Check,
  CloudUpload,
  Delete,
  HelpCircle,
  Keyboard,
  Minus,
  Package,
  Pause,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { api, isProductionDataPlane } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useOfflineSync } from "../hooks/useOfflineSync";
import { useRealtimeRefresh } from "../hooks/useRealtimeRefresh";
import {
  isBrowserOnline,
  isQueueableSaleFailure,
  saveOfflineSale,
} from "../lib/offlineSync";
import {
  ACTIVE_PAYMENT_METHODS,
  CARD_BRANDS,
  DEFAULT_PAYMENT_METHOD,
  isPaymentMethodEnabled,
  validateSalePayment,
} from "../lib/paymentMethods";
import ReceiptDocument from "../components/ReceiptDocument";
import ProductSelector from "../components/ProductSelector";
import { excludeDemoProducts } from "../lib/demoProducts";
import { resolveReceiptNumber } from "../lib/receiptCodes";
import { isCategoryActive, resolveCategoryIcon } from "../lib/categoryIcons";

const CATEGORY_COLORS = {
  Groceries: "#2563eb",
  Dairy: "#0284c7",
  Bakery: "#d97706",
  Beverages: "#7c3aed",
};

const SHORTCUTS = [
  ["Enter", "Complete sale"],
  ["F1", "Search product"],
  ["F2", "New sale"],
  ["F3", "Hold sale"],
  ["F4", "Customer"],
  ["F5", "Discount"],
  ["F6", "Cash tendered"],
  ["F7", "Reprint last receipt"],
  ["F8", "Toggle keyboard"],
  ["Esc", "Cancel / close"],
];

const OSK_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "."],
  ["Z", "X", "C", "V", "B", "N", "M", "-", "⌫", "⏎"],
];

function isTextEntry(target) {
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable
  );
}

function categoryImage(category) {
  return category?.image_url || category?.image || "";
}

export default function POS() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { settings, currency, formatMoney, formatMoneyForCurrency, vatEnabled, vatRate } = useEnterpriseSettings();
  const offline = useOfflineSync({ enabled: true });
  const barcodeRef = useRef(null);
  const searchRef = useRef(null);
  const customerRef = useRef(null);
  const discountRef = useRef(null);
  const cashRef = useRef(null);
  const submittingRef = useRef(false);
  const focusTargetRef = useRef("barcode");

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState("all");
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [barcode, setBarcode] = useState("");
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [payment, setPayment] = useState(DEFAULT_PAYMENT_METHOD);
  const [cardBrand, setCardBrand] = useState("VISA");
  const [paymentRef, setPaymentRef] = useState("");
  const [cashTendered, setCashTendered] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [lastSale, setLastSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [heldSales, setHeldSales] = useState([]);
  const [applyVat, setApplyVat] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const focusBarcode = useCallback(() => {
    requestAnimationFrame(() => {
      barcodeRef.current?.focus({ preventScroll: true });
      focusTargetRef.current = "barcode";
    });
  }, []);

  const loadProducts = useCallback(async () => {
    const rows = await api.products.getAll();
    setProducts(isProductionDataPlane ? excludeDemoProducts(rows) : rows);
  }, []);
  const loadHeld = useCallback(async () => setHeldSales(await api.sales.getHeld()), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [productRows, customerRows, heldRows, categoryRows] = await Promise.all([
          api.products.getAll(),
          api.customers.getAll(),
          api.sales.getHeld(),
          api.categories.getAll(),
        ]);
        if (cancelled) return;
        setProducts(isProductionDataPlane ? excludeDemoProducts(productRows) : productRows);
        setCustomers(customerRows);
        setHeldSales(heldRows);
        setCategories((categoryRows || []).filter(isCategoryActive));
        focusBarcode();
      } catch (err) {
        if (import.meta.env.DEV) console.error("[POS] load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [focusBarcode]);

  useEffect(() => {
    if (!vatEnabled) setApplyVat(false);
  }, [vatEnabled]);

  // ERP real-time: stock/price changes from any terminal, purchase receipt,
  // or product edit must reach every open register instantly.
  useRealtimeRefresh(["products", "inventory", "purchases"], loadProducts, { debounceMs: 700 });

  // Keep barcode field ready after dialogs / non-text interactions.
  useEffect(() => {
    if (shortcutsOpen) return undefined;
    const keepFocus = () => {
      const active = document.activeElement;
      if (!isTextEntry(active) || active === barcodeRef.current) {
        focusBarcode();
      }
    };
    const timer = window.setInterval(keepFocus, 1200);
    return () => window.clearInterval(timer);
  }, [shortcutsOpen, focusBarcode]);

  useEffect(() => {
    if (!isPaymentMethodEnabled(payment)) setPayment(DEFAULT_PAYMENT_METHOD);
  }, [payment]);

  const productIndex = useMemo(
    () => new Map(products.filter((product) => product.barcode).map((product) => [String(product.barcode), product])),
    [products]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory =
        activeCategoryId === "all"
        || Number(product.category_id) === Number(activeCategoryId)
        || (activeCategoryId !== "all"
          && categories.find((c) => Number(c.id) === Number(activeCategoryId))?.name === product.category);
      if (!matchesCategory) return false;
      if (!query) return true;
      return `${product.name} ${product.sku || ""} ${product.barcode || ""} ${product.category || ""}`.toLowerCase().includes(query);
    });
  }, [products, search, activeCategoryId, categories]);

  const addToCart = useCallback((product) => {
    setCart((current) => {
      const existing = current.find((line) => line.id === product.id);
      const currentQty = existing?.qty || 0;
      if (currentQty >= Number(product.stock)) {
        showToast(`Only ${product.stock} left in stock`);
        return current;
      }
      return existing
        ? current.map((line) => (line.id === product.id ? { ...line, qty: line.qty + 1 } : line))
        : [...current, { ...product, qty: 1 }];
    });
    focusBarcode();
  }, [showToast, focusBarcode]);

  const lookupBarcode = useCallback(async (code) => {
    const normalized = String(code || "").trim();
    if (!normalized) return;
    const match = productIndex.get(normalized) || await api.products.getByBarcode(normalized);
    if (match) {
      addToCart(match);
      setBarcode("");
    } else {
      showToast("No product found for that barcode");
    }
  }, [addToCart, productIndex, showToast]);

  const handleBarcodeKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    lookupBarcode(barcode);
  };

  useBarcodeScanner(lookupBarcode, { enabled: true, allowInInputs: false });

  const changeQty = (id, delta) => setCart((current) =>
    current
      .map((line) => (line.id === id ? { ...line, qty: Math.max(0, Math.min(line.stock, line.qty + delta)) } : line))
      .filter((line) => line.qty > 0)
  );

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + Number(line.price) * line.qty, 0), [cart]);
  const discountAmt = subtotal * (discount / 100);
  const taxable = Math.max(0, subtotal - discountAmt);
  const vat = vatEnabled && applyVat ? taxable * (vatRate / 100) : 0;
  const total = taxable + vat;
  const tendered = cashTendered === "" ? total : Number(cashTendered);
  const changeDue = Math.max(0, tendered - total);

  /** Live receipt lines — discount allocated proportionally from cart % discount. */
  const receiptLines = useMemo(() => {
    const gross = subtotal > 0 ? subtotal : 1;
    return cart.map((line) => {
      const lineGross = Number(line.price) * Number(line.qty);
      const lineDiscount = (lineGross / gross) * discountAmt;
      return {
        id: line.id,
        name: line.name,
        qty: line.qty,
        stock: line.stock,
        unitPrice: Number(line.price),
        discount: lineDiscount,
        lineTotal: Math.max(0, lineGross - lineDiscount),
      };
    });
  }, [cart, subtotal, discountAmt]);

  const paymentPayload = useMemo(() => ({
    payment_method: payment,
    total,
    cash_tendered: cashTendered,
    card_brand: cardBrand,
    mpesa_reference: payment === "MPESA" ? paymentRef : "",
  }), [payment, total, cashTendered, cardBrand, paymentRef]);

  const canCompleteSale = useMemo(() => {
    if (!cart.length) return false;
    if (!isPaymentMethodEnabled(payment)) return false;
    return Boolean(validateSalePayment(paymentPayload).success);
  }, [cart.length, payment, paymentPayload]);

  const validateCart = useCallback(() => {
    if (cart.length === 0) return "Add at least one product";
    for (const line of cart) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) return `Invalid quantity for ${line.name}`;
      const latest = products.find((product) => product.id === line.id);
      if (!latest || line.qty > Number(latest.stock)) return `Insufficient stock for ${line.name}`;
    }
    const paid = validateSalePayment(paymentPayload);
    if (!paid.success) return paid.error;
    return null;
  }, [cart, products, paymentPayload]);

  /** Auto-print only when a real printer is available. Never blocks or shows printer errors. */
  const tryAutoPrintReceipt = useCallback(async () => {
    try {
      if (typeof window !== "undefined" && typeof window.api?.printReceipt === "function") {
        await window.api.printReceipt({ silent: true });
        return;
      }
      const printers = await api.settings.getPrinters().catch(() => []);
      const configured = String(settings?.printer_name || "").trim();
      const hasPrinter = (Array.isArray(printers) && printers.length > 0) || Boolean(configured);
      if (!hasPrinter) return;
      // Desktop/web with a detected printer — print without our own confirmation UI.
      requestAnimationFrame(() => {
        try {
          window.print();
        } catch {
          /* never surface printer failures */
        }
      });
    } catch {
      /* printing must never fail the sale */
    }
  }, [settings?.printer_name]);

  const completeSale = useCallback(async () => {
    if (submittingRef.current) return;
    const error = validateCart();
    if (error) {
      showToast(error);
      return;
    }
    const paid = validateSalePayment(paymentPayload);
    if (!paid.success) {
      showToast(paid.error || "Invalid payment");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const clientReference = globalThis.crypto?.randomUUID?.() || `sale-${Date.now()}-${Math.random()}`;
    const customer = customers.find((entry) => entry.id === Number(customerId));
    const completedAt = new Date();
    const snapshot = {
      items: cart.map((line) => ({ ...line })),
      subtotal,
      discountAmt,
      vat,
      vat_enabled: vatEnabled && applyVat,
      vat_rate: vatEnabled && applyVat ? vatRate : 0,
      total,
      payment: paid.payment_method,
      cash_tendered: paid.cash_tendered,
      change_due: paid.change_due,
      card_brand: paid.card_brand,
      payment_reference: paid.payment_reference,
      split_payments: [],
      customer: customer?.name || "Walk-in",
      currency_code: currency.code,
      currency_symbol: currency.symbol,
      time: completedAt.toLocaleString(),
      created_at: completedAt.toISOString(),
    };

    const salePayload = {
      client_reference: clientReference,
      customer_id: customerId || null,
      customer_name: customer?.name || "Walk-in",
      branch_id: user?.branch_id || null,
      subtotal,
      discount: discountAmt,
      vat,
      vat_enabled: snapshot.vat_enabled,
      vat_rate: snapshot.vat_rate,
      total,
      currency_code: currency.code,
      currency_symbol: currency.symbol,
      payment_method: paid.payment_method,
      cash_tendered: paid.cash_tendered,
      change_due: paid.change_due,
      card_brand: paid.card_brand,
      payment_reference: paid.payment_reference,
      split_payments: [],
      items: cart.map((line) => ({
        product_id: line.id, name: line.name, qty: line.qty, price: line.price, cost: line.cost,
      })),
    };

    const finishLocal = async (receipt, { offlineSaved = false } = {}) => {
      // Optimistic local stock so the register stays usable while offline.
      if (offlineSaved) {
        setProducts((rows) =>
          rows.map((product) => {
            const line = cart.find((entry) => Number(entry.id) === Number(product.id));
            if (!line) return product;
            return { ...product, stock: Math.max(0, Number(product.stock || 0) - Number(line.qty || 0)) };
          })
        );
      }
      setLastSale(receipt);
      setCart([]);
      setDiscount(0);
      setCustomerId("");
      setCashTendered("");
      setPaymentRef("");
      setCardBrand("VISA");
      setApplyVat(false);
      setSearch("");
      setBarcode("");
      setPayment(DEFAULT_PAYMENT_METHOD);
      showToast(
        offlineSaved
          ? `Sale saved offline · ${resolveReceiptNumber(receipt)} (will sync)`
          : `Sale ${resolveReceiptNumber(receipt)} confirmed`
      );
      focusBarcode();
      if (!offlineSaved) await loadProducts();
      void offline.refreshStats?.();
      void tryAutoPrintReceipt();
    };

    try {
      // Browser reports offline — queue locally (IndexedDB), sync when internet returns.
      if (!isBrowserOnline()) {
        const queued = await saveOfflineSale({
          client_reference: clientReference,
          payload: salePayload,
          receipt: snapshot,
          user,
        });
        await finishLocal(queued.sale, { offlineSaved: true });
        return;
      }

      const result = await api.sales.create(salePayload);
      if (!result.success) {
        if (isQueueableSaleFailure(result)) {
          const queued = await saveOfflineSale({
            client_reference: clientReference,
            payload: salePayload,
            receipt: snapshot,
            user,
          });
          await finishLocal(queued.sale, { offlineSaved: true });
          return;
        }
        showToast(result.error || "Sale failed");
        return;
      }
      const receipt = {
        ...snapshot,
        id: result.id || result.sale?.id,
        invoice_no: result.invoice_no || result.receipt_no,
        receipt_no: result.receipt_no || result.invoice_no,
        created_at: result.sale?.created_at || snapshot.created_at,
        time: new Date(result.sale?.created_at || snapshot.created_at).toLocaleString(),
        cashier_name: result.sale?.cashier_name || user?.name || "Cashier",
        cashier_username: result.sale?.cashier_username || user?.username || "unknown",
        branch_name: result.sale?.branch_name || user?.company?.branch_name || "Unknown branch",
        currency_code: result.sale?.currency_code || snapshot.currency_code,
        currency_symbol: result.sale?.currency_symbol || snapshot.currency_symbol,
        status: result.sale?.status || "Valid",
        client_reference: clientReference,
      };
      await finishLocal(receipt);
    } catch (err) {
      // Unexpected throw (e.g. IndexedDB) — try to keep the sale if we already have a client ref.
      try {
        const queued = await saveOfflineSale({
          client_reference: clientReference,
          payload: salePayload,
          receipt: snapshot,
          user,
        });
        await finishLocal(queued.sale, { offlineSaved: true });
      } catch {
        showToast(err?.message || "Sale failed");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    validateCart, paymentPayload, customers, customerId, cart, subtotal, discountAmt, vat, vatEnabled,
    applyVat, vatRate, total, currency.code, currency.symbol, user, showToast,
    loadProducts, focusBarcode, tryAutoPrintReceipt, offline.refreshStats,
  ]);

  const clearSale = useCallback((confirmFirst = true) => {
    if (confirmFirst && cart.length && !window.confirm("Cancel the current sale and clear the cart?")) return;
    setCart([]);
    setDiscount(0);
    setCustomerId("");
    setCashTendered("");
    setPaymentRef("");
    setCardBrand("VISA");
    setApplyVat(false);
    setSearch("");
    setBarcode("");
    setPayment(DEFAULT_PAYMENT_METHOD);
    focusBarcode();
  }, [cart.length, focusBarcode]);

  const holdSale = useCallback(async () => {
    if (!cart.length || submittingRef.current) return;
    const result = await api.sales.hold({
      customer_id: customerId || null,
      cart,
      discount,
      payment,
      cashTendered,
      applyVat,
      subtotal,
      discountAmt,
      vat,
      vat_rate: vatEnabled && applyVat ? vatRate : 0,
      total,
    });
    if (!result.success) return showToast(result.error || "Could not hold sale");
    showToast(`Sale held (#${result.id})`);
    clearSale(false);
    await loadHeld();
  }, [cart, customerId, discount, payment, cashTendered, applyVat, subtotal, discountAmt, vat, vatEnabled, vatRate, total, showToast, clearSale, loadHeld]);

  const resumeHeld = async (held) => {
    const released = await api.sales.releaseHeld(held.id);
    if (!released) return;
    setCart(released.cart || []);
    setDiscount(released.discount || 0);
    setCustomerId(released.customer_id ? String(released.customer_id) : "");
    setCashTendered(released.cashTendered || "");
    setPayment(released.payment || DEFAULT_PAYMENT_METHOD);
    setApplyVat(vatEnabled && !!released.applyVat);
    showToast(`Resumed held sale #${held.id}`);
    await loadHeld();
    focusBarcode();
  };

  const printReceipt = useCallback(() => {
    if (!lastSale) return;
    try {
      window.print();
    } catch {
      /* ignore printer errors */
    }
  }, [lastSale]);

  const appendOsk = (key) => {
    const target = focusTargetRef.current;
    const apply = (setter, current) => {
      if (key === "⌫") setter(String(current).slice(0, -1));
      else if (key === "⏎") {
        if (target === "barcode") lookupBarcode(barcode);
        else if (target === "cash") completeSale();
      } else setter(String(current) + key);
    };
    if (target === "search") apply(setSearch, search);
    else if (target === "cash") apply(setCashTendered, cashTendered);
    else if (target === "ref") apply(setPaymentRef, paymentRef);
    else apply(setBarcode, barcode);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      const key = event.key;
      if (key === "Escape") {
        event.preventDefault();
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (keyboardOpen) setKeyboardOpen(false);
        else clearSale(true);
        return;
      }
      const actions = {
        F1: () => { searchRef.current?.focus(); searchRef.current?.click(); focusTargetRef.current = "search"; },
        F2: () => clearSale(true),
        F3: holdSale,
        F4: () => customerRef.current?.focus(),
        F5: () => discountRef.current?.focus(),
        F6: () => { cashRef.current?.focus(); focusTargetRef.current = "cash"; },
        F7: printReceipt,
        F8: () => setKeyboardOpen((open) => !open),
      };
      if (actions[key]) {
        event.preventDefault();
        actions[key]();
        return;
      }
      if (key === "Enter" && !isTextEntry(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        completeSale();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutsOpen, keyboardOpen, clearSale, holdSale, printReceipt, completeSale]);

  const handleCashEnter = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    completeSale();
  };

  return (
    <div className="nx-pos-wrap">
      <div
        className={`nx-pos-sync-bar is-${offline.phase === "offline" || !offline.online ? "offline" : offline.phase === "syncing" ? "syncing" : "synced"}`}
        role="status"
        aria-live="polite"
      >
        <div className="nx-pos-sync-status">
          {!offline.online || offline.phase === "offline" ? (
            <WifiOff size={15} aria-hidden />
          ) : offline.phase === "syncing" ? (
            <CloudUpload size={15} aria-hidden />
          ) : (
            <Wifi size={15} aria-hidden />
          )}
          <span className="nx-pos-sync-label">{offline.label}</span>
          {offline.failed > 0 && (
            <span className="nx-pos-sync-fail">{offline.failed} failed</span>
          )}
        </div>
        <div className="nx-pos-sync-actions">
          {(offline.pending > 0 || offline.failed > 0) && offline.online && (
            <button
              type="button"
              className="nx-pos-sync-btn"
              onClick={() => (offline.failed ? offline.retryFailed() : offline.syncNow())}
              disabled={offline.phase === "syncing"}
            >
              <RefreshCw size={14} className={offline.phase === "syncing" ? "animate-spin" : ""} aria-hidden />
              {offline.failed ? "Retry sync" : "Sync now"}
            </button>
          )}
        </div>
      </div>
      <div className="nx-pos" role="region" aria-label="Point of sale terminal">
        <section className="nx-pos-catalog" aria-label="Product catalog">
          <div className="nx-pos-toolbar">
            <div className="nx-pos-scan">
              <Barcode size={18} className="nx-pos-scan-icon" aria-hidden />
              <input
                ref={barcodeRef}
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                onKeyDown={handleBarcodeKeyDown}
                onFocus={() => { focusTargetRef.current = "barcode"; }}
                placeholder="Scan barcode — always ready"
                aria-label="Barcode scanner input"
                autoComplete="off"
                className="form-control w-full"
              />
            </div>
            <div className="nx-pos-search">
              <ProductSelector
                triggerRef={searchRef}
                products={products}
                value=""
                allowClear={false}
                disableOutOfStock
                placeholder="Search & add by name, SKU, or barcode (F1)"
                onQueryChange={setSearch}
                onChange={(_id, product) => {
                  if (product) addToCart(product);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setKeyboardOpen((open) => !open)}
                className={`btn btn-secondary ${keyboardOpen ? "border-brand text-brand" : ""}`}
                aria-pressed={keyboardOpen}
                title="On-screen keyboard (F8)"
              >
                <Keyboard size={18} aria-hidden />
                <span className="hidden xl:inline">Keyboard</span>
              </button>
              <button type="button" onClick={() => setShortcutsOpen(true)} className="btn btn-secondary" aria-label="Keyboard shortcuts" title="Shortcuts">
                <HelpCircle size={18} aria-hidden />
              </button>
            </div>
          </div>

          {heldSales.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Held sales">
              {heldSales.map((held) => (
                <button
                  key={held.id}
                  type="button"
                  onClick={() => resumeHeld(held)}
                  className="min-h-9 rounded-[8px] border border-app bg-app-panel px-3 text-xs font-semibold hover:border-brand"
                >
                  Held #{held.id} · {formatMoney(held.total)}
                </button>
              ))}
            </div>
          )}

          <div className="nx-pos-categories" role="tablist" aria-label="Product categories">
            <button
              type="button"
              role="tab"
              aria-selected={activeCategoryId === "all"}
              className={`nx-cat-card ${activeCategoryId === "all" ? "is-active" : ""}`}
              onClick={() => setActiveCategoryId("all")}
            >
              <div className="nx-cat-card-media">
                <div className="nx-cat-card-placeholder" style={{ background: "var(--brand)" }}>
                  <Package size={22} aria-hidden />
                </div>
              </div>
              <span className="nx-cat-card-label">All items</span>
            </button>
            {categories.map((category) => {
              const image = categoryImage(category);
              const color = category.color || CATEGORY_COLORS[category.name] || "var(--brand)";
              const Icon = resolveCategoryIcon(category.icon);
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={Number(activeCategoryId) === Number(category.id)}
                  className={`nx-cat-card ${Number(activeCategoryId) === Number(category.id) ? "is-active" : ""}`}
                  onClick={() => setActiveCategoryId(category.id)}
                >
                  <div className="nx-cat-card-media">
                    {image ? (
                      <img src={image} alt="" />
                    ) : (
                      <div className="nx-cat-card-placeholder" style={{ background: color }}>
                        <Icon size={20} aria-hidden />
                      </div>
                    )}
                  </div>
                  <span className="nx-cat-card-label">{category.name}</span>
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-app-muted">Loading products…</div>
          ) : (
            <div className="nx-pos-grid" role="list" aria-label={`${filtered.length} products`}>
              {filtered.map((product) => {
                const out = Number(product.stock) <= 0;
                const low = !out && Number(product.stock) <= Number(product.reorder_level || 5);
                const color = CATEGORY_COLORS[product.category] || "var(--brand)";
                return (
                  <button
                    key={product.id}
                    type="button"
                    role="listitem"
                    onClick={() => addToCart(product)}
                    disabled={out}
                    className="nx-product-card"
                    aria-label={`${product.name}, ${formatMoney(product.price)}, ${out ? "out of stock" : `${product.stock} in stock`}`}
                  >
                    <div className="nx-product-thumb" style={{ background: `${color}14` }}>
                      {product.image_url ? (
                        <img src={product.image_url} alt="" />
                      ) : (
                        <Package size={28} style={{ color }} aria-hidden />
                      )}
                    </div>
                    <div className="nx-product-name">{product.name}</div>
                    <div className="nx-product-meta">{product.category || "General"}</div>
                    <div className="nx-product-footer">
                      <span className="nx-product-price">{formatMoney(product.price)}</span>
                      <span className={`nx-product-stock ${out ? "is-out" : low ? "is-low" : ""}`}>
                        {out ? "Out" : `${product.stock} left`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="nx-pos-sale" aria-label="Receipt">
          <div className="nx-pos-sale-header">
            <div className="nx-receipt-brand">
              <ReceiptText size={16} aria-hidden />
              <div>
                <div className="nx-receipt-title">RECEIPT</div>
                <div className="nx-receipt-meta">{currency.code} · {cart.length} item{cart.length === 1 ? "" : "s"}</div>
              </div>
            </div>
            {cart.length > 0 && (
              <button type="button" onClick={() => clearSale(true)} className="nx-receipt-clear" aria-label="Clear sale">
                <Trash2 size={13} aria-hidden /> Clear
              </button>
            )}
          </div>

          <div className="nx-receipt-customer">
            <select
              id="pos-customer"
              ref={customerRef}
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              className="nx-receipt-select"
              aria-label="Customer"
            >
              <option value="">Walk-in (F4)</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </div>

          <div className="nx-pos-cart" aria-live="polite">
            <div className="nx-receipt-head" aria-hidden>
              <span>Item</span>
              <span>Qty</span>
              <span>Price</span>
              <span>Disc</span>
              <span>Total</span>
              <span />
            </div>
            {receiptLines.length === 0 ? (
              <div className="nx-receipt-empty">Scan items to begin</div>
            ) : (
              receiptLines.map((line) => (
                <div key={line.id} className="nx-receipt-line">
                  <div className="nx-receipt-line-name" title={line.name}>{line.name}</div>
                  <div className="nx-receipt-qty">
                    <button type="button" onClick={() => changeQty(line.id, -1)} className="nx-qty-btn" aria-label={`Decrease ${line.name}`}>
                      <Minus size={11} />
                    </button>
                    <span>{line.qty}</span>
                    <button type="button" onClick={() => changeQty(line.id, 1)} className="nx-qty-btn" aria-label={`Increase ${line.name}`}>
                      <Plus size={11} />
                    </button>
                  </div>
                  <div className="nx-receipt-num">{formatMoney(line.unitPrice)}</div>
                  <div className="nx-receipt-num">{line.discount > 0.004 ? `-${formatMoney(line.discount)}` : "—"}</div>
                  <div className="nx-receipt-num is-strong">{formatMoney(line.lineTotal)}</div>
                  <button
                    type="button"
                    onClick={() => setCart((current) => current.filter((entry) => entry.id !== line.id))}
                    className="nx-qty-btn is-remove"
                    aria-label={`Remove ${line.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="nx-pos-sale-footer">
            <div className="nx-receipt-controls">
              <label className="nx-receipt-ctrl">
                <span>Disc % (F5)</span>
                <input
                  ref={discountRef}
                  type="number"
                  min="0"
                  max="100"
                  value={discount}
                  onChange={(event) => setDiscount(Math.max(0, Math.min(100, Number(event.target.value))))}
                  aria-label="Discount percent"
                />
              </label>
              {vatEnabled && (
                <label className="nx-receipt-ctrl is-check">
                  <input
                    type="checkbox"
                    checked={applyVat}
                    onChange={(event) => setApplyVat(event.target.checked)}
                  />
                  <span>Tax {vatRate}%</span>
                </label>
              )}
            </div>

            <div className="nx-pos-totals">
              <div className="nx-pos-total-row"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
              <div className="nx-pos-total-row"><span>Discount</span><span>-{formatMoney(discountAmt)}</span></div>
              {vatEnabled && applyVat && (
                <div className="nx-pos-total-row"><span>Tax ({vatRate}%)</span><span>{formatMoney(vat)}</span></div>
              )}
              <div className="nx-pos-total-row is-grand"><span>Grand Total</span><span>{formatMoney(total)}</span></div>
            </div>

            <div className="nx-pay-grid" role="group" aria-label="Payment methods">
              {ACTIVE_PAYMENT_METHODS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`nx-pay-btn ${payment === id ? "is-active" : ""}`}
                  onClick={() => setPayment(id)}
                  aria-pressed={payment === id}
                >
                  <Icon size={16} aria-hidden />
                  {label}
                </button>
              ))}
            </div>

            <div className="nx-receipt-tender">
              {payment === "CASH" && (
                <>
                  <input
                    id="pos-tender"
                    ref={cashRef}
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashTendered}
                    onChange={(event) => setCashTendered(event.target.value)}
                    onFocus={() => { focusTargetRef.current = "cash"; }}
                    onKeyDown={handleCashEnter}
                    placeholder={`Exact ${formatMoney(total)}`}
                    className="nx-receipt-input"
                    aria-label="Cash tendered"
                  />
                  {cashTendered !== "" && (
                    <div className={`nx-receipt-change ${Number(cashTendered) >= total ? "is-ok" : "is-short"}`}>
                      {Number(cashTendered) >= total
                        ? `Change ${formatMoney(changeDue)}`
                        : `Short ${formatMoney(total - Number(cashTendered || 0))}`}
                    </div>
                  )}
                </>
              )}
              {payment === "CARD" && (
                <div className="nx-card-brands">
                  {CARD_BRANDS.map((brand) => (
                    <button
                      key={brand.id}
                      type="button"
                      className={`nx-chip ${cardBrand === brand.id ? "is-active" : ""}`}
                      onClick={() => setCardBrand(brand.id)}
                      aria-pressed={cardBrand === brand.id}
                    >
                      {brand.label}
                    </button>
                  ))}
                </div>
              )}
              {payment === "MPESA" && (
                <input
                  value={paymentRef}
                  onChange={(event) => setPaymentRef(event.target.value)}
                  onFocus={() => { focusTargetRef.current = "ref"; }}
                  placeholder="M-Pesa ref (optional)"
                  className="nx-receipt-input"
                  aria-label="M-Pesa reference"
                />
              )}
            </div>

            <div className="nx-pos-checkout">
              <button
                type="button"
                onClick={holdSale}
                disabled={!cart.length || submitting}
                className="nx-pos-hold-btn"
                title="Hold sale"
              >
                <Pause size={15} aria-hidden /> Hold
              </button>
              <button
                type="button"
                onClick={completeSale}
                disabled={!canCompleteSale || submitting}
                className="nx-pos-complete-btn"
              >
                <Check size={18} aria-hidden />
                {submitting ? "Processing…" : "Complete Sale"}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {keyboardOpen && (
        <div className="nx-osk" role="group" aria-label="On-screen keyboard">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wide text-app-muted">Touch keyboard</span>
            <button type="button" onClick={() => setKeyboardOpen(false)} className="rounded p-1 text-app-muted hover:text-app-text" aria-label="Close keyboard">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-1.5">
            {OSK_ROWS.map((row) => (
              <div key={row.join("-")} className="nx-osk-keys">
                {row.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="nx-osk-key"
                    onClick={() => appendOsk(key)}
                    aria-label={key === "⌫" ? "Backspace" : key === "⏎" ? "Enter" : key}
                  >
                    {key === "⌫" ? <Delete size={15} /> : key}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {shortcutsOpen && (
        <div className="nx-modal-backdrop" onClick={() => setShortcutsOpen(false)}>
          <div className="nx-modal max-w-lg p-6" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Checkout shortcuts">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="section-title">Checkout shortcuts</h2>
              <button type="button" className="nx-icon-btn" onClick={() => setShortcutsOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {SHORTCUTS.map(([key, label]) => (
                <div key={key} className="rounded-[12px] bg-app-panel-muted p-4 text-sm leading-relaxed">
                  <kbd className="mr-2 font-mono font-bold text-brand">{key}</kbd>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div id="receipt-print" aria-hidden="true">
        {lastSale && <ReceiptDocument receipt={lastSale} settings={settings} formatMoneyForCurrency={formatMoneyForCurrency} print />}
      </div>
    </div>
  );
}
