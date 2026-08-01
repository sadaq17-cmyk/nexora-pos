# Purchase Management Module — Delivery Report

**Date:** 2026-07-22  
**Workspace:** `C:\Users\sadam\Downloads\nexora-pos-final\nexora-pos`  
**Schema posture:** FROZEN (`SCHEMA_FREEZE.md`) — additive migration `016` only  

---

## Verdict

Enterprise Purchase Management is upgraded on the existing Nexora purchases schema and UI. Status enums stay honest: **Ordered ≈ Approved**; **Rejected** added via additive constraint update. Supplier deep-links (`/purchases?supplier_id=&action=create`) preserved.

| Gate | Result |
|------|--------|
| `npm run build` | **PASS** |
| Migration `016` `supabase db push --linked` | **PASS** (applied) |
| Vercel production deploy | **PASS** — https://www.nexorapospro.com (alias); inspect https://vercel.com/nexoraposapp/nexora-pos/AHg9iET4jnje6J2RmEGRhz7c7Prn |
| Git commit | **Not requested** — skipped |

---

## What shipped

### 1. Purchase Dashboard
- KPIs: Total Purchases, Pending POs, Received Orders, Outstanding Supplier Balances, Purchase Value Today
- Monthly purchase value chart (`recharts` BarChart)
- API: `purchases.getDashboard`

### 2. Purchase Orders
- Create / Edit (Draft / Pending / Ordered)
- Draft → Submit for Approval (`Pending`)
- Approve (`Ordered`) / Reject (`Rejected` + reason)
- Cancel / Duplicate / Print / Export PDF / Email (`mailto:`)
- Excel + CSV export on Orders tab
- Branch + warehouse on PO
- Invoice fields: supplier invoice #, invoice date, due date, header discount, shipping, other charges, line VAT/discount, grand total

### 3. Goods Receiving (GRN)
- Full + partial receive (existing path)
- Back orders shown (ordered − received)
- Damaged qty noted (`qty_damaged`) — **not stocked**
- Batch / Serial / Expiry / Mfg / line notes on `purchase_items` (additive columns)
- Stock ↑, `last_cost`, moving `avg_cost`, stock movements

### 4. Payments
- Cash / Bank / M-Pesa / Card / Cheque / Credit
- Partial / full against outstanding
- Payment history + receipt print
- Reuses `purchases.addPayment` (+ supplier ledger mirror when booked)

### 5. Purchase Returns
- Qty / reason → inventory out + supplier credit
- Credit note amount returned from API
- Journal: Dr AP / Cr Inventory

### 6. Accounting (pragmatic)
- Additive `journal_entries` table (minimal AP lines)
- Auto-post on receive / pay / return
- Also mirrored in `audit_log` with debit/credit metadata JSON
- Purchases → **Accounting** tab
- **Not** a full ERP GL chart of accounts

### 7. Reports
- Outstanding, By Supplier, By Branch, Payments, Returns, VAT/Tax
- CSV export per report section
- API: `purchases.getReports`

### 8. Audit Trail
- Detail drawer **Audit** tab via `purchases.getAudit`
- Actions: create / approve / reject / receive / pay / return / cancel / journal_post

### 9. Permissions (existing RBAC)
| UI / API action | Permission |
|-----------------|------------|
| Create / Duplicate | `purchases.create` |
| Edit / Submit / Approve PO / Reject / Cancel / Pay | `purchases.edit` |
| Receive (GRN) | `purchases.approve` |
| Return | `returns.create` |
| View / Dashboard / Reports | `purchases.view` |

**Note:** PO approval and GRN share the historical mapping — receive continues to use `purchases.approve`; PO Approve uses `purchases.edit` (unchanged from prior module).

### 10. Multi-branch
- `branch_id` + `warehouse_id` on create/edit; warehouse stamped on receive when provided

---

## Schema changes (additive)

**File:** `supabase/migrations/016_purchase_management_enterprise.sql`

| Change | Type |
|--------|------|
| `purchases.invoice_date`, `subtotal`, `tax_total`, `discount_total`, `shipping`, `other_charges` | New columns |
| `purchases.warehouse_id`, `created_by`, `approved_by/at`, `rejected_at`, `rejection_reason`, `payment_due_date` | New columns |
| Status check includes **`Rejected`** | Additive constraint replace |
| `purchase_items.batch_no`, `serial_no`, `expiry_date`, `mfg_date`, `qty_damaged`, `line_notes` | New columns |
| `products.last_cost`, `products.avg_cost` | New columns |
| `journal_entries` (+ tenant RLS via `tenant_match`) | New table |

No renames, drops, or non-additive RLS rewrites on existing tables.

---

## Files changed

| Path | Role |
|------|------|
| `supabase/migrations/016_purchase_management_enterprise.sql` | Additive migration |
| `api/_posData.js` | Dashboard/reports/audit/journal/duplicate; receive avg-cost + GRN meta; AP journals; Rejected status |
| `src/lib/supabaseApi.js` | Client methods |
| `src/lib/mockApi.js` | Mock parity |
| `src/lib/permissionMiddleware.js` | Permission map for new actions |
| `src/pages/Purchases.jsx` | Enterprise module UI |
| `PURCHASE_MANAGEMENT_MODULE_REPORT.md` | This report |

---

## Honest PARTIAL / limitations

| Area | Status |
|------|--------|
| Full serial-number ledger / unique serial tracking | **PARTIAL** — free-text `serial_no` on line; no serial inventory table |
| Batch/lot stock buckets | **PARTIAL** — stored on line + movement note; warehouse stock lots not redesigned |
| Damaged/expired stock quarantine location | **PARTIAL** — qty/notes only; damaged not stocked |
| Separate RBAC for “approve PO” vs “receive” | **PARTIAL** — existing matrix: receive = `approve`, PO approve = `edit` |
| Full double-entry GL / COA / period close | **PARTIAL** — lightweight `journal_entries` + audit metadata only |
| Split purchase payments (multi-method one click) | **PARTIAL** — supplier module has split pay; PO pay is single-method (Credit supported) |
| Email PO | **PARTIAL** — `mailto:` / print-friendly (no SMTP server) |

---

## How to verify

1. Login Owner/Admin → **Purchases**
2. Dashboard KPIs + monthly chart load
3. New PO with invoice date, shipping, branch/warehouse → Draft → Submit → Approve
4. Reject a Pending PO with reason → status Rejected
5. Duplicate a PO → new Draft
6. Receive partial with batch/expiry/damaged → back order remains; stock + avg_cost update
7. Pay partial/full → receipt print; Accounting tab shows journal lines
8. Return received line → credit note + inventory down
9. Reports: Outstanding / Supplier / Branch / VAT / Payments / Returns
10. Export PDF / Excel / CSV
11. From Suppliers profile → Create Purchase Order deep-link still opens create modal
12. Cashier without purchases permissions denied

---

## Status mapping

DB statuses:  
`Draft | Pending | Ordered | PartiallyReceived | Received | Cancelled | Rejected`

UI: **Approved / Ordered** ↔ `Ordered` only.
