import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Package, Search, X } from "lucide-react";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import {
  excludeDemoProducts,
  isLowStock,
  isOutOfStock,
  productSearchText,
  productSku,
} from "../lib/demoProducts";

function sortByName(products) {
  return [...products].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
  );
}

/**
 * Shared supermarket-style product picker for Purchases, Sales/POS, Adjustments, Transfers.
 *
 * @param {"id"|"product"} changeValue - what onChange receives (default product id string)
 */
export default function ProductSelector({
  products = [],
  value = "",
  onChange,
  placeholder = "Search by name, SKU, or barcode…",
  disabled = false,
  disableOutOfStock = false,
  /** Production builds filter seeded demo SKUs; DEV mock keeps fixtures for local QA. */
  excludeDemo = import.meta.env.PROD,
  className = "",
  required = false,
  id,
  allowClear = true,
  emptyLabel = "No products found",
  triggerRef = null,
  onQueryChange,
}) {
  const { formatMoney } = useEnterpriseSettings();
  const reactId = useId();
  const listId = id ? `${id}-listbox` : `${reactId}-listbox`;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const catalog = useMemo(() => {
    const base = excludeDemo ? excludeDemoProducts(products) : products;
    return sortByName(base.filter((product) => product && product.active !== 0 && product.active !== false));
  }, [products, excludeDemo]);

  const selected = useMemo(
    () => catalog.find((product) => String(product.id) === String(value)) || null,
    [catalog, value]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter((product) => productSearchText(product).includes(needle));
  }, [catalog, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
      onQueryChange?.("");
    }
  }, [open, onQueryChange]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const emitChange = (product) => {
    const nextId = product ? String(product.id) : "";
    onChange?.(nextId, product || null);
  };

  const selectProduct = (product) => {
    if (!product) return;
    if (disableOutOfStock && isOutOfStock(product)) return;
    emitChange(product);
    setOpen(false);
    setQuery("");
  };

  const clearSelection = (event) => {
    event.stopPropagation();
    emitChange(null);
    setQuery("");
    setOpen(false);
  };

  const openDropdown = () => {
    if (disabled) return;
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onInputKeyDown = (event) => {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const product = filtered[highlight];
      if (product) selectProduct(product);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`nx-product-selector ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="nx-product-selector-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={required || undefined}
        onClick={openDropdown}
      >
        {selected ? (
          <span className="nx-product-selector-summary">
            {selected.image_url ? (
              <img src={selected.image_url} alt="" className="nx-product-selector-thumb" />
            ) : (
              <span className="nx-product-selector-thumb is-placeholder" aria-hidden>
                <Package size={16} />
              </span>
            )}
            <span className="nx-product-selector-summary-text">
              <span className="nx-product-selector-summary-name">{selected.name}</span>
              <span className="nx-product-selector-summary-meta">
                {[productSku(selected) && `SKU ${productSku(selected)}`, selected.barcode && `BC ${selected.barcode}`]
                  .filter(Boolean)
                  .join(" · ") || selected.category || "Product"}
              </span>
            </span>
          </span>
        ) : (
          <span className="nx-product-selector-placeholder">{placeholder}</span>
        )}
        <span className="nx-product-selector-actions">
          {allowClear && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              className="nx-product-selector-clear"
              aria-label="Clear product"
              onClick={clearSelection}
              onKeyDown={() => {}}
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={16} className="nx-product-selector-caret" aria-hidden />
        </span>
      </button>

      {open && (
        <div className="nx-product-selector-panel" role="presentation">
          <div className="nx-product-selector-search">
            <Search size={15} aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                onQueryChange?.(next);
              }}
              onKeyDown={onInputKeyDown}
              placeholder={placeholder}
              aria-label="Search products"
              autoComplete="off"
              className="nx-product-selector-search-input"
            />
          </div>
          <ul id={listId} className="nx-product-selector-list" role="listbox" aria-label="Products">
            {filtered.length === 0 && (
              <li className="nx-product-selector-empty" role="option" aria-disabled="true">
                {emptyLabel}
              </li>
            )}
            {filtered.map((product, index) => {
              const out = isOutOfStock(product);
              const low = isLowStock(product);
              const blocked = disableOutOfStock && out;
              const sku = productSku(product) || "—";
              const barcode = product.barcode || "—";
              const isActive = String(product.id) === String(value);
              return (
                <li key={product.id} role="option" aria-selected={isActive} aria-disabled={blocked || undefined}>
                  <button
                    type="button"
                    className={[
                      "nx-product-selector-option",
                      isActive ? "is-selected" : "",
                      index === highlight ? "is-highlight" : "",
                      low ? "is-low-stock" : "",
                      out ? "is-out-of-stock" : "",
                      blocked ? "is-disabled" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={blocked}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => selectProduct(product)}
                  >
                    {product.image_url ? (
                      <img src={product.image_url} alt="" className="nx-product-selector-thumb" />
                    ) : (
                      <span className="nx-product-selector-thumb is-placeholder" aria-hidden>
                        <Package size={18} />
                      </span>
                    )}
                    <span className="nx-product-selector-card">
                      <span className="nx-product-selector-card-head">
                        <span className="nx-product-selector-card-name">{product.name}</span>
                        {out && <span className="nx-product-selector-badge is-out">Out of Stock</span>}
                        {!out && low && <span className="nx-product-selector-badge is-low">Low stock</span>}
                      </span>
                      <span className="nx-product-selector-card-line">SKU: {sku}</span>
                      <span className="nx-product-selector-card-line">Barcode: {barcode}</span>
                      <span className="nx-product-selector-card-line">Stock: {Number(product.stock) || 0}</span>
                      <span className="nx-product-selector-card-line">
                        Selling Price: {formatMoney(product.price)}
                      </span>
                      <span className="nx-product-selector-card-line">
                        Category: {product.category || "Uncategorized"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
