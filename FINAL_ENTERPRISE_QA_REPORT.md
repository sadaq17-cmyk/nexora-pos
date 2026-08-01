# Nexora POS — Final Enterprise QA Report

**Date:** 2026-07-22  
**Workspace:** `C:\Users\sadam\Downloads\nexora-pos-final\nexora-pos`  
**Method:** Systematic code/wiring audit, RBAC + subscription + FX + barcode + suppliers path review, static QA (`scripts/enterprise-qa-static.mjs`), auth-logic regression, Vite production build, Vercel prod deploy, post-deploy validate.  
**Interactive UI CRUD:** SKIP (no operator credentials in session).

---

## Executive summary

| Metric | Result |
|--------|--------|
| **Verdict** | **READY** for enterprise production (with documented PARTIAL / DEFERRED gaps) |
| Critical FAIL blockers | **0** |
| Issues found & fixed this pass | **11** |
| Static QA | **29/29 PASS** |
| Auth-logic regression | **19/19 PASS** |
| Feature smoke | **91 PASS · 0 FAIL** |
| Vite build | **PASS** (`exit 0`, ~1m 22s) |
| Deploy | **PASS** (retry after network `fetch failed`) |
| Post-deploy validate | **PASS** (`routes_ok`, `health_ok`, `bundle_safe`) |
| Production | https://www.nexorapospro.com |

Honest scope note: Payroll is **advertised** on Professional+ plans but **no Payroll module** exists in the codebase — scored **DEFERRED**, not a silent PASS. Customer-payment FX UI and POS multi-currency tender remain **DEFERRED** per `MULTI_CURRENCY_REPORT.md`.

---

## Module matrix

| Module | Status | Evidence |
|--------|--------|----------|
| Dashboard | **PASS** | Route `/dashboard`; `reports.getAnalytics` + slim `getLowStock` / `customers.getCount`; owner health panels; try/finally load |
| POS | **PASS** | `/pos`; `sales.create`; barcode field + `useBarcodeScanner`; cashier create RBAC |
| Products | **PASS** | CRUD + barcode field + link to Barcode page; paginated/debounced list; load fail-safe |
| Inventory | **PASS** | Overview, stock in/out/adjust, brands, units, warehouses, transfers, expiry; load fail-safe |
| Customers | **PASS** | CRUD + payments + statement tabs; API `customers.*`; FX UI deferred |
| Suppliers | **PASS** | CRUD + payments + ledger/statement/purchase/payment history drawer |
| Supplier Payments | **PASS** | UI + `suppliers.addPayment` + FX fields (`CurrencyMoneyFields`) |
| Supplier Statements | **PASS** | `suppliers.getStatement` + print/export |
| Supplier Ledger | **PASS** | Ledger tab; API `getLedger` → statement; `supplier_ledger_v` with fallback |
| Purchases | **PASS** | Create PO; payments with FX; search/skeleton |
| Purchase Receiving | **PASS** | UI `purchases.approve`; API `canPurchaseAction` + `purchases.receive` |
| Expenses | **PASS** | CRUD + categories + FX money fields; load fail-safe |
| Payroll | **DEFERRED** | Featured on Professional/Enterprise plans; **no** page/API/route |
| Reports | **PASS** | `/reports` + analytics builder + sales/purchase/expense/inventory reports |
| Notifications | **PASS** | `/notifications` + header bell; `notifications.list` |
| Users & Management | **PASS** | `/users` + admin-* APIs; Owner/Admin manage; Manager cannot |
| Roles & Permissions | **PASS** | `/roles`; matrix get/update; Admin `roles.edit` only (no create/delete) |
| Multi Currency | **PARTIAL** | Settings currencies + Purchases/Suppliers/Expenses/Reports wired; POS tender + customer payment FX deferred |
| Subscription | **PASS** | 7-day trial; KES 5500/10000/15000/25000; owner-only post-expiry lock; activate unlocks |
| Billing | **PASS** | Company billing via `/subscription` (+ renew portal); platform `/platform/payments` |
| Barcode System | **PARTIAL** | Dedicated `/barcode` generate/print; POS scan; Products codes; Inventory display-only; receive optional barcode |
| Audit Logs | **PASS** | `/audit` + `audit.getAll` / login history |
| Branches | **PASS** | CRUD + plan limit enforcement |
| Warehouses | **PASS** | Inventory → Warehouses tab + `warehouses.*` APIs |
| Settings | **PASS** | Store/tax/payment/security/currencies/backup export |

**Static script:** Passed **29/29**.

---

## RBAC matrix (Owner / Admin / Manager / Staff)

Roles mapped: **Owner** = `owner`, **Admin** = `admin`, **Manager** = `branch_manager`, **Staff** = `cashier` (aliases `staff`/`employee` → cashier). Sources: `src/lib/rbac.js`, `permissionMiddleware.js`, `Layout.jsx` sidebar, `ProtectedRoute`, API gates in `_posData.js`.

| Capability | Owner | Admin | Manager | Staff (Cashier) |
|------------|-------|-------|---------|-----------------|
| Dashboard view | ✓ | ✓ | ✓ | ✗ |
| POS checkout | ✓ | ✓ | ✓ | ✓ |
| Products CRUD | ✓ | ✓ | ✓ (delete ✓) | view only |
| Inventory / warehouses | ✓ | ✓ | ✓ (no delete) | ✗ |
| Barcode generate/print | ✓ | ✓ | ✓ | view + create (scan) |
| Purchases create | ✓ | ✓ | ✓ | ✗ |
| Purchase receive (`approve`) | ✓ | ✓ | ✓ | ✗ default |
| Suppliers / Customers | ✓ | ✓ | ✓ (no delete) | ✗ |
| Expenses | ✓ | ✓ | ✗ | ✗ |
| Reports / export / print | ✓ | ✓ | ✓ | ✗ |
| Users manage | ✓ | ✓ (Managers+Staff only) | ✗ | ✗ |
| Roles edit | ✓ | view+edit (no create/delete) | ✗ | ✗ |
| Settings | ✓ | ✓ | ✗ | ✗ |
| Currencies (base/deactivate) | ✓ | view/create/edit rates* | ✗ | ✗ |
| Subscription / Billing | ✓ | ✗ | ✗ | ✗ |
| Backup / Restore | ✓ | ✗ | ✗ | ✗ |
| Audit logs | ✓ | ✓ | ✗ | ✗ |
| Branches | ✓ | ✓ | ✗ | ✗ |

\*Admin cannot set base currency or deactivate; rate edit may require Owner policy `admin_can_edit_rates`.

| Check | Result |
|-------|--------|
| Sidebar filtered by `can(module,"view")` | **PASS** |
| Route guards (`ProtectedRoute` + module) | **PASS** |
| API permission middleware map | **PASS** (incl. `purchases.receive` → approve; `subscription.changePlan` → edit) |
| Server purchase/subscription role gates | **PASS** |
| Manager cannot manage users | **PASS** (`MANAGER_MANAGEABLE_ROLES=[]`) |
| Admin cannot create Admin/Owner | **PASS** |

---

## Subscription

| Requirement | Status | Evidence |
|-------------|--------|----------|
| 7-day trial | **PASS** | `DEFAULT_TRIAL_DAYS = 7`; signup `free_trial`; auth-logic asserts |
| 4 KES packages | **PASS** | Starter **5500**, Business **10000**, Professional **15000**, Enterprise **25000** — `subscriptionPlans.js` + `_saasPlans.js` |
| Expiry detection | **PASS** | `companies.checkAccess` uses `expires_at` / `trial_ends_at` |
| Auto lock (owner-only post-trial) | **PASS** | Staff signed out (`STAFF_SUBSCRIPTION_LOCKED`); Owner kept with `subscriptionLocked` → `/subscription/renew` |
| Auto unlock on activation | **PASS** | `subscription.changePlan`/`update` sets `status: active` + new `expires_at`; `refreshSessionGate` clears lock |
| Missing subscription-row hole | **FIXED** | checkAccess now falls back to `companies.trial_ends_at` / `plan_code` |

---

## Multi-currency

| Surface | Status |
|---------|--------|
| Settings → Currencies | **PASS** |
| Purchases payments | **PASS** (FX fields + base AP update) |
| Supplier payments | **PASS** |
| Expenses | **PASS** |
| Reports display currency | **PASS** (`formatReportMoney` / report_currency) |
| Sales / POS tender picker | **DEFERRED** |
| Customer payments FX UI | **DEFERRED** (columns exist; form not upgraded) |
| Payroll FX | **DEFERRED** (no payroll module) |

Overall: **PARTIAL** (wired where modules exist; deferred items documented earlier and still honest).

---

## Barcode

| Area | Status | Notes |
|------|--------|-------|
| `/barcode` generate / bulk / print labels | **PASS** | |
| Products barcode field + search | **PASS** | |
| POS scan (`useBarcodeScanner` + lookup) | **PASS** | |
| Inventory | **PARTIAL** | Displays barcode on variants; no scan-to-locate |
| Purchase receiving | **PARTIAL** | Optional barcode / auto-barcode on new lines; no hardware scan flow |

Overall: **PARTIAL**.

---

## Suppliers domain

| Feature | Status | Path |
|---------|--------|------|
| Statement | **PASS** | Detail drawer + print/CSV; `suppliers.getStatement` |
| Ledger | **PASS** | Ledger tab; `supplier_ledger_v` + derived fallback |
| Purchase history | **PASS** | Purchases tab in statement; `getPurchaseHistory` |
| Payment history | **PASS** | Payments tab + `addPayment` with FX |

---

## Performance

| Item | Status |
|------|--------|
| Lazy routes + Suspense | **PASS** |
| List TTL cache / debounce / page size 40 | **PASS** (Products/Suppliers/Customers/Purchases) |
| Dashboard slim fetches | **PASS** |
| Infinite-load on API failure | **FIXED** this pass (Inventory, Products, Suppliers, Customers, Purchases, Expenses, Dashboard) |
| True server pagination `{rows,total}` | **DEFERRED** (soft caps remain) |
| Payroll optimize | N/A (module absent) |

Spot-check vs `PERFORMANCE_OPTIMIZATION_REPORT.md`: prior wins retained; worst regression class (spinner forever on throw) closed on primary list pages.

---

## Security

| Area | Status | Evidence |
|------|--------|----------|
| Auth gate (verify email, inactive, locked, MFA hooks) | **PASS** | `AuthContext.gateAfterSignIn` |
| Inactive API reject | **PASS** | `api/pos.js` `INACTIVE` |
| CSRF origin + rate limit + bearer | **PASS** | `api/pos.js` |
| Security headers | **PASS** | post-deploy / vercel.json |
| RLS on key tables | **PASS** | Migrations `001`, `002`, `004` (+ later additive) — sample: products, sales, suppliers, company_subscriptions |
| Audit logging | **PASS** | `writeAudit` paths + `/audit` UI |
| Notifications center | **PASS** | Operational alerts feed |
| Service-role not in client bundle | **PASS** | `bundle_safe=true` |

---

## Issues found & fixed (this pass)

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | High | `subscription.changePlan` unmapped in client RBAC (any role could invoke client method; server still owner-gated) | Mapped `changePlan` + `requestRenewal` → `subscription.edit` |
| 2 | High | `companies.checkAccess` returned `ok:true` when subscription row missing (lock bypass) | Fallback to company `trial_ends_at` / `plan_code` |
| 3–9 | Medium | List pages could infinite-spin if a fetch threw before `setLoading(false)` | try/finally + `.catch` on Inventory, Products, Suppliers, Customers, Purchases, Expenses, Dashboard |
| 10 | Low | `saasPlans.js` Node ESM re-export lacked `.js` (auth-logic import fail) | `from "./subscriptionPlans.js"` |
| 11 | Low | `auth-logic-test.mjs` asserted obsolete Contact-Sales Enterprise + Manager user-mgmt | Aligned to KES packages + current RBAC matrix |

---

## Remaining known gaps

1. **Payroll** — marketed; not implemented (DEFERRED).
2. **Customer payment FX UI** — DB columns ready; form still single-currency (DEFERRED).
3. **POS multi-currency tender** — sales stamp company currency (DEFERRED).
4. **Inventory / receiving hardware barcode scan** — codes supported; dedicated scan UX incomplete (PARTIAL).
5. **True server-side pagination** for >2k SKU tenants (DEFERRED).
6. **Interactive E2E with live credentials** — SKIP this session.
7. **Live FX rate feed** — manual rates only.

None of the above are treated as deploy blockers for the current enterprise POS surface.

---

## Build + deploy status

| Step | Result |
|------|--------|
| `npm run build` | **PASS** — Vite 5.4.21, built in ~1m 22s |
| `node scripts/enterprise-qa-static.mjs` | **29/29 PASS** |
| `node scripts/auth-logic-test.mjs` | **19 PASS** |
| `node scripts/feature-smoke.mjs` | **91 PASS** |
| `npx vercel --prod --yes` (1st) | Network `fetch failed` |
| `npx vercel --prod --yes` (retry) | **READY** |
| Deploy ID | `dpl_6keoUujAbpk351LiNNXTvFCVvo84` |
| Deployment URL | https://nexora-asq0qmelp-nexoraposapp.vercel.app |
| Production alias | https://www.nexorapospro.com |
| Inspect | https://vercel.com/nexoraposapp/nexora-pos/6keoUujAbpk351LiNNXTvFCVvo84 |
| `post-deploy-validate.mjs` | `routes_ok=true` · `chunks_ok=true` · `bundle_safe=true` · `health_ok=true failed=none` |

**Git commit:** not created (not requested).

---

## How to manually verify

1. **Owner login** → Dashboard KPIs populate; sidebar shows Plan, Users, Roles, Audit.
2. **Admin login** → Ops modules OK; no Subscription; cannot manage Owner/Admin peers.
3. **Manager login** → Catalog/stock/purchases/customers/reports; no Users/Settings/Subscription.
4. **Cashier login** → POS only (+ product lookup / barcode scan).
5. **Subscription** → Expire trial in DB or wait; staff blocked; owner lands on `/subscription/renew`; activate Starter → unlock to dashboard.
6. **Suppliers** → Open vendor → Ledger / Purchases / Payments tabs; record FX payment; print statement.
7. **Barcode** → `/barcode` generate + print; POS scan adds line.
8. **Multi-currency** → Settings → Currencies enable; pay a PO in USD; confirm base outstanding drops; Reports currency switch.
9. **Health** → `POST /api/pos` `health.probe` → all critical tables `ok:true`.

---

## Final readiness

| Gate | Result |
|------|--------|
| Critical modules wired | **PASS** |
| RBAC Owner/Admin/Manager/Staff | **PASS** |
| Subscription lock/unlock | **PASS** |
| Build green | **PASS** |
| Deploy + health | **PASS** |
| Documented PARTIAL/DEFERRED only | **Yes** |

### Verdict: **READY**
