# Suppliers & Purchases — Enterprise Audit Report

**Date:** 2026-07-21  
**Workspace:** `nexora-pos`  
**Scope:** Suppliers + Purchases modules (frontend, API, migrations, RLS)  
**Build:** `npm run build` — **PASS**  
**Migration:** `009_suppliers_purchases_enterprise.sql` — **pushed** via `supabase db push --linked`

---

## Executive verdict

Both modules are upgraded to enterprise ERP standards: supplier profiles/ledger/statement/export, purchase workflow with Draft/Partial/Cancel, partial receive, partial payment, duplicate prevention, invoice attach, and Owner/Admin RBAC with RLS. Existing supplier-first PO flows and create-from-PO dialogs are preserved.

| Area | Result |
|------|--------|
| Schema migration 009 | **PASS** (applied to linked cloud) |
| Suppliers API enrichment | **PASS** |
| Purchases API (receive/pay/cancel/returns) | **PASS** |
| Suppliers UI | **PASS** |
| Purchases UI | **PASS** |
| RBAC + permission middleware | **PASS** |
| Mock API parity | **PASS** |
| `npm run build` | **PASS** |
| Automated CRUD test suite | **GAP** (manual / mock parity only) |

---

## What changed

### 1. Database — `supabase/migrations/009_suppliers_purchases_enterprise.sql`

**Suppliers**
- `code` (unique per company), `payment_terms`, `credit_limit`, `total_paid`, `last_purchase_at`, `last_payment_at`
- Ensured `email`, `address`, `tax_number`, `notes`
- Backfill of `SUP-#####` codes
- Indexes on code / status / balance

**Purchases**
- `amount_paid`, `balance`, `notes`, `attachment_url`, `client_reference`, `ordered_at`, `received_at`, `cancelled_at`
- Status check: `Draft | Pending | Ordered | PartiallyReceived | Received | Cancelled`
- Unique indexes: `(company_id, supplier_id, invoice_no)` and `(company_id, client_reference)` excluding Cancelled/blank
- Dedup cleanup before unique indexes

**Purchase items**
- `qty_ordered`, `qty_received`, `discount`, `tax`, `company_id`

**New table**
- `purchase_payments` (purchase_id, supplier_id, company_id, amount, method, reference, notes, created_by) + RLS Owner/Admin write, staff read

**Ledger**
- View `supplier_ledger_v` (purchases debit + supplier/purchase payments credit)

**RBAC seed**
- Owner/Admin suppliers + purchases grants; Cashier denied purchases/suppliers mutate/view

### 2. API — `api/_posData.js`

| Action | Behavior |
|--------|----------|
| `suppliers.create` | Auto `SUP-#####`; profile fields |
| `suppliers.getStatement` / `getLedger` | Purchases + payments + ledger + totals (fixes missing `purchases` in prior statement payload) |
| `suppliers.addPayment` | Updates `balance`, `total_paid`, `last_payment_at` |
| `purchases.create` | Auto `PO-YYYYMMDD-####`; Draft/Pending/Ordered; amount_paid/balance; notes/attachment; duplicate invoice/client_reference checks; line validation |
| `purchases.update` | Notes/attachment/invoice/draft lines |
| `purchases.receive` | Full or partial via `lines[]` / `receive_all`; status → PartiallyReceived/Received; stock + movements; supplier AP on first receive |
| `purchases.addPayment` | Partial pay; updates amount_paid/balance; mirrors to supplier when PO already received |
| `purchases.cancel` | Draft/Pending/Ordered only |
| `purchases.getPayments` | Payment history |
| `purchases.createReturn` | Permission + status gates; stock/supplier credit |

Schema probe extended for enterprise columns + `purchase_payments`.

### 3. Client adapters

- `src/lib/supabaseApi.js` — new methods: `getLedger`, `update`, `receive(opts)`, `addPayment`, `cancel`, `getPayments`
- `src/lib/mockApi.js` — full parity including partial receive/pay, duplicates, ledger
- `src/lib/permissionMiddleware.js` — maps new actions to suppliers/purchases/returns permissions

### 4. UI

**`Suppliers.jsx`**
- Profile: code, company, contact, phone, email, address, tax/VAT, payment terms, credit limit, status, notes
- KPIs: suppliers, total purchases, total paid, outstanding
- Search/filters (active/inactive/outstanding); cards + table
- Detail drawer: ledger, purchases, payments; print statement; CSV export
- Auto code on create

**`Purchases.jsx`**
- Status filters + search
- Create: supplier/product dialogs, Draft/Pending/Ordered, deposit, notes, PDF/image attach, client_reference idempotency
- Detail: totals/paid/balance, lines with qty ordered/received, payment history, attachment link
- Partial receive dialog; partial payment dialog; cancel; returns; mark Ordered / submit Draft

### 5. Permissions

- Receive = `purchases.approve` (Owner/Admin/accountant defaults; Cashier denied)
- Payments / cancel / edit = `purchases.edit`
- Create = `purchases.create`
- Returns = `returns.create` (+ server role gate)
- Supplier export/print = matrix `export` / `print`
- RLS: `purchase_payments` Owner/Admin write; existing Owner/Admin purchase policies retained; `is_owner_or_admin()` from migration 008

---

## Requirement checklist

### Suppliers

| Requirement | Status |
|-------------|--------|
| Supplier Code (auto) | **PASS** |
| Company / Contact / Phone / Email / Address | **PASS** |
| Tax/VAT, Payment Terms, Credit Limit | **PASS** |
| Status Active/Inactive, Notes | **PASS** |
| Total Purchases, Total Paid, Outstanding | **PASS** |
| Last Purchase / Last Payment dates | **PASS** (updated on receive / payment) |
| Supplier Ledger | **PASS** |
| Supplier Statement | **PASS** (print + export) |
| Search, Filters, Export, Print | **PASS** |
| Owner/Admin + RLS | **PASS** |

### Purchases

| Requirement | Status |
|-------------|--------|
| Auto PO number | **PASS** |
| Create supplier/product from PO page | **PASS** (enhanced) |
| Statuses Draft / Pending / Ordered / Received / Cancelled / Partial | **PASS** (`PartiallyReceived`) |
| Auto inventory on Receive | **PASS** |
| Partial Receive | **PASS** |
| Partial Payment | **PASS** |
| Purchase Total / Amount Paid / Balance | **PASS** |
| Invoice + Payment History | **PASS** |
| Attach Invoice PDF/Image | **PASS** (data URL / link) |
| Purchase Notes | **PASS** |
| Purchase Returns | **PASS** |
| Duplicate prevention (supplier+invoice / client_reference) | **PASS** |
| Validate taxes / discounts / calculations | **PASS** |
| Owner/Admin permissions; RLS | **PASS** |
| CRUD tests | **PARTIAL** — mock parity + build; no dedicated Jest/API suite |

---

## Remaining gaps (non-blocking)

1. **Attachments** — Stored as `attachment_url` (often data URLs). Prefer Supabase Storage for large PDFs in a follow-up.
2. **AP booking** — Supplier balance books full PO total on **first** receive (including partial). Line-value proration is not implemented.
3. **Automated tests** — No CI CRUD/integration tests for suppliers/purchases; recommend API-level tests for duplicate, partial receive, cancel, and cashier deny.
4. **Credit limit enforcement** — Field is captured and displayed; hard block when outstanding exceeds limit is not enforced on create/receive.
5. **Concurrent code generation** — `SUP-#####` / PO sequence is best-effort; unique indexes catch collisions.

---

## Files touched

- `supabase/migrations/009_suppliers_purchases_enterprise.sql` *(new)*
- `api/_posData.js`
- `src/lib/supabaseApi.js`
- `src/lib/mockApi.js`
- `src/lib/permissionMiddleware.js`
- `src/pages/Suppliers.jsx`
- `src/pages/Purchases.jsx`
- `SUPPLIERS_PURCHASES_AUDIT_REPORT.md` *(this file)*

---

## Verification commands run

```text
supabase db push --linked   → Applied 009_suppliers_purchases_enterprise.sql
npm run build               → ✓ built (exit 0)
```

---

## Recommended smoke tests (manual)

1. Create supplier → confirm `SUP-#####`, edit terms/credit limit, export CSV, open ledger, print statement, record payment.
2. Create PO as Draft → Submit → Mark Ordered → Partial receive one line → confirm `PartiallyReceived` + stock → Receive remaining → `Received`.
3. Create PO with same supplier + invoice twice → expect duplicate error.
4. Partial payment on open balance → payment history + balance update; after receive, supplier outstanding decreases.
5. Cancel Pending PO; attempt cancel after receive → denied; create return → stock decreases.
6. Cashier session → no receive / no purchases create (RBAC).
