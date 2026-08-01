# Nexora POS — Enterprise Performance Optimization Report

**Date:** 2026-07-22  
**Scope:** Dashboard, Products, Inventory, Sales, Purchases, Suppliers, Customers, Expenses, Reports, Users, Notifications, Settings, Branches, Subscription, Audit Logs  
**Migration:** `supabase/migrations/013_performance_indexes.sql`

---

## Before (findings)

| Area | Issue |
|------|--------|
| API `listScoped` | Unbounded `select("*")` for products, customers, suppliers, purchases, expenses, branches |
| Dashboard | Loaded full products + full customers just for KPI count / low-stock list |
| Layout notifications | Sequential waterfall: `products.getAll` → `purchases.getAll` → subscription → audit |
| Inventory page | Triple-fetched product catalog (`getStats` + `getAll` + `getLowStock`) |
| Reports analytics | Loaded entire sales + sale_items + products + expenses history |
| Sales create / PO receive | N+1 per-line stock reads/writes |
| Frontend | No TTL cache, no in-flight dedupe, no request timeout/retry, no skeletons, no search debounce, no list pagination UI |
| DB | Missing composite indexes on `company_id` + search/filter columns for major tables |

Route-level `React.lazy` was already in place.

---

## After (what changed)

### Shared utilities
- `src/lib/requestCache.js` — in-memory TTL cache + in-flight dedupe + debounce helper
- `src/hooks/useDebouncedValue.js` — 250ms search debounce
- `src/components/ui/skeleton.jsx` — page / list / dashboard skeletons
- `src/lib/authApi.js` — 28s timeout, AbortSignal, retry (up to 2) on transient network/5xx errors

### API layer (`api/_posData.js`)
- `listScoped` supports slim column sets, soft caps (2000), `limit`/`offset`, and OR `ilike` search
- List endpoints use narrow selects (products, customers, suppliers, purchases, expenses, sales, audit, brands, units, warehouses, categories, branches)
- `customers.getCount` — head count for dashboard KPI (no full download)
- `inventory.getStats` / `getLowStock` — slim columns; low-stock no longer calls `products.getAll`
- `notifications.list` — parallel slim queries (not full getAll waterfall)
- `reports.getAnalytics` — date-bounded sales/expenses + batched `sale_items` by sale id
- `sales.getSummary` / `getWeeklyTrend` — month/week date filters instead of all-time scans
- `sales.getRecent` — one batched `sale_items` query instead of N queries
- `sales.create` — batch stock validation + parallel stock updates + bulk `sale_items` insert
- `purchases.receive` — batch product fetch + parallel stock/movement/item updates
- `purchases.getAll` — parallel purchases+suppliers; slim supplier lookup (`id,name`)
- `audit.getAll` — module filter in SQL; configurable limit
- `backup.export` — parallel table reads

### Frontend API client (`src/lib/supabaseApi.js`)
- Cached reads for lookups (branches, categories, brands, units, currencies, settings) and short-TTL lists
- Cache invalidation on mutations (products, sales, purchases, suppliers, etc.)
- `getAll(params)` / `getCount` / `getLowStock(params)` passthrough

### Pages
- **Dashboard:** stats via `inventory.getLowStock` + `customers.getCount` + analytics (no full catalog); skeleton UI
- **Products / Suppliers / Customers:** debounced search, page size 40, list skeletons
- **Purchases:** debounced search, list skeleton
- **Inventory:** removed redundant `getLowStock` fetch; derive from loaded products; skeleton
- **Expenses / Reports:** skeletons instead of infinite spinner text
- **Users:** optimistic activate/deactivate/suspend/unlock
- **App:** route Suspense fallback uses skeleton placeholder

### Database
- Additive indexes in `013_performance_indexes.sql` for company-scoped search/filter on products, customers, suppliers, purchases, sales, sale_items, expenses, audit_log, categories, branches, stock_movements

---

## Expected impact (feel targets)

| Surface | Before | After (design intent) |
|---------|--------|------------------------|
| Dashboard | Multi full-table loads | Slim aggregates + date-bounded analytics → toward **&lt;1s** |
| Products / Suppliers / Customers / Purchases | Full `*` payloads, no pagination UI | Slim columns + client page 40 + debounce → **&lt;500ms feel** |
| Reports | Full history analytics | Date-windowed queries → toward **&lt;2s** |
| Global search (list filters) | Immediate full-array filter thrash | 250ms debounce → **&lt;300ms** interaction feel |
| Drawers / modals | Unchanged open path | Instant (no new blocking fetches on open) |
| Checkout / receive | O(n) round-trips | Batched / parallel writes |

---

## Deferred / follow-ups

1. True server-side pagination with total counts returned as `{ rows, total }` for very large tenants (&gt;2k SKUs)
2. SQL aggregate RPCs for inventory stats / sales summary (avoid even slim full-catalog scans)
3. Payroll module — not present in codebase; nothing to optimize
4. React Query / SWR adoption if cache needs grow beyond in-memory TTL
5. `admin-list-users` still pages Auth users then filters by company (platform-scale bottleneck)

---

## Verification

- `npm run build` — **green** (local Vite production build)
- Migration apply: `npx supabase db push --linked` — **applied** `013_performance_indexes.sql` (existing company_id indexes skipped via IF NOT EXISTS)
- Deploy: `npx vercel --prod --yes` — **READY**
  - Production: https://nexora-lzegyah07-nexoraposapp.vercel.app
  - Alias: https://www.nexorapospro.com
  - Inspect: https://vercel.com/nexoraposapp/nexora-pos/AvJb8FPgLouAk7LBwNfNC5pynxqx
