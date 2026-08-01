# Inventory Management Module — Delivery Report

**Updated:** 2026-07-23  
**Schema posture:** FROZEN through 014 — additive migrations `017` + `018` + `019` only  

---

## Verdict

Enterprise Inventory Management is **Enterprise Complete** as the Inventory hub (`/inventory`), integrated with Purchases receive and Sales stock paths, including Variant SKU ledger, Serial number ledger, and true FIFO/FEFO auto-pick.

| Gate | Result |
|------|--------|
| Module (017) | Previously shipped |
| Warehouse ledger (018) | Applied (`warehouse_stock`) |
| Ledgers (019) | Applied (`product_variant_skus`, `product_serials`, `stock_lots`, `stock_lot_allocations`) |
| `npm run build` | **PASS** |
| Production deploy | **READY** — https://www.nexorapospro.com (dpl_BWvTA4Lc2wSCPZNVPu1riHg2FC9L) |

---

## Feature coverage

| Area | Status |
|------|--------|
| 1. Dashboard KPIs + movement chart | **Done** |
| 2. Product CRUD / archive / soft-delete / restore / categories / brands / units / images | **Done** |
| 2b. Variant SKU ledger | **Done / Enterprise Complete** — `product_variant_skus` (+ `products.variants` jsonb cache) |
| 3. Barcode / QR / bulk print / scanner | **Done** (`/barcode` + hub links) |
| 4. Stock In / Out / Adjust / Transfer / Physical count | **Done** |
| 5. Warehouses + branch link + transfers | **Done** — real per-warehouse qty via `warehouse_stock` (018) |
| 6. Batch / expiry on movements + product expiry | **Done** |
| 6b. True FIFO/FEFO lot consumption on sales | **Done / Enterprise Complete** — `stock_lots` + allocations; preference `none\|fifo\|fefo` (non-fefo → fifo) |
| 6c. Serial number ledger | **Done / Enterprise Complete** — `product_serials` + register on stock-in |
| 7. Alerts (low / out / over / expiry) | **Done** |
| 8. Pricing (cost / sell / wholesale / discount / tax) | **Done** |
| 9. Reports + CSV/Excel/PDF export | **Done** |
| 10. Audit + movement history | **Done** |
| 11. RBAC | **Done** |
| 12. Import / export | **Done** |
| 13. Search / filters / pagination / mobile | **Done** |

---

## Migration 018 — warehouse_stock

- Table: `warehouse_stock (company_id, warehouse_id, product_id, qty, …)` + tenant RLS
- Backfill: existing `products.stock` → primary warehouse per company
- API: stock in/out/adjust update ledger; transfers move qty between warehouses without changing company total
- UI: transfers note updated (no longer “PARTIAL ledger”)

---

## Migration 019 — variants / serials / lots

- `product_variant_skus` — Variant SKU ledger (size/color/etc.); jsonb `products.variants` remains denormalized cache
- `product_serials` — unit-level serial ledger (`available|reserved|sold|damaged|returned`)
- `stock_lots` + `stock_lot_allocations` — FIFO (`received_at`) / FEFO (`expiry_date`) auto-pick
- Stock in / purchase receive creates lots; sales / stock-out consume lots by product `stock_preference`
- `products.stock` and `warehouse_stock` remain the scalar sources of truth

### UI (Inventory hub)

- **Variants** — CRUD against ledger; optional attributes JSON
- **Serials** — register + list; optional serials on Stock In
- **Lots FIFO/FEFO** — open lots list + pick preview (`inventory.previewLotPick`)

---

## How to use

Open **Inventory** in the app (Owner/Admin/Manager with inventory permissions). Tabs: Dashboard, Products, Movements, Transfers, Counts, Stock ops, Alerts, Warehouses, Brands, Units, Variants, Serials, Lots FIFO/FEFO, Reports, History.
