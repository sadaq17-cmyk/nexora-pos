# Enterprise Purchase & Supplier Accounting — Readiness Report

**Date:** 2026-07-26  
**Scope:** Approval-gated purchase posting + supplier AP fields (Opening Debit/Credit, Outstanding, Ledger, Statement)  
**Decision:** **FINAL GO** (automated modules)

---

## Final decision: FINAL GO

All automated suites completed with **zero failures**. Purchase inventory and supplier AP update only after **Approval**. Pending/Draft create does not touch stock or outstanding balance.

---

## Balance formula

```
Outstanding = Opening Debit − Opening Credit + Purchases − Payments − Credit Notes
```

Implemented in:

- `recomputeSupplierBalance` (`api/_posData.js`) — ledger debit/credit sums + opening debit/credit
- `recomputeSupplierBalanceMock` (`src/lib/mockApi.js`)
- Atomic RPC `pos_approve_purchase` (migration `026`)
- Supplier UI / statement / ledger surfaces

---

## Purchase workflow (on Approve only)

1. Create purchase invoice identity (`invoice_no`)
2. Increase product stock
3. Update inventory / stock movements
4. Update product cost / last cost
5. Recalculate average cost
6. Increase supplier outstanding
7. Supplier ledger entry (via `supplier_ledger_v` / statement)
8. Inventory transaction (`stock_movements`)
9. Dashboard / reports read updated balances

**Nothing posts before Approval.** Statuses: Draft → Pending Approval → Approved → Received → Cancelled. Only Approved/Received (and legacy Ordered / PartiallyReceived) update stock and AP.

Atomic path: `pos_approve_purchase(jsonb)` RPC (single DB transaction + rollback). JS fallback orchestrates receive + rollback of approval stamps on failure.

---

## Key artifacts

| Artifact | Purpose |
|----------|---------|
| `supabase/migrations/026_enterprise_purchase_supplier_accounting.sql` | Columns, status check, ledger view, approve RPC |
| `api/_posData.js` | `purchases.approve`, posted-status gates, supplier accounting map |
| `src/lib/mockApi.js` | Offline/demo parity |
| `src/lib/supabaseApi.js` | `purchases.approve` client + cache invalidation |
| `src/pages/Purchases.jsx` | Approve CTA, status labels, receive-after-approve |
| `src/pages/Suppliers.jsx` | Opening Debit/Credit, outstanding KPIs |
| `scripts/purchase-approve-e2e-test.mjs` | Pending isolation + approve posting + payment formula |
| `scripts/purchase-receive-e2e-test.mjs` | Approve then GRN; no double stock |

---

## Passed tests (zero errors)

| Suite | Result |
|-------|--------|
| `purchase-receive-guard-test` | **PASS** |
| `purchase-approve-e2e-test` | **PASS** |
| `purchase-receive-e2e-test` | **PASS** |
| `auth-logic-test` | **19/19 PASS** |
| `receipt-codes-test` | **PASS** |
| `owner-email-flow-test` | **10/10 PASS** |
| `payment-terms-test` | **PASS** |
| `saas-checks` | **PASS** |
| `feature-smoke` | **94 PASS · 0 FAIL** |
| `enterprise-qa-static` | **29/29 PASS** |
| `runtime-api-smoke` | **PASS** |
| `verify-rls` (static) | **PASS** |
| `production-verification` | **18 PASS · 0 FAIL · 8 SKIP** |
| `npm run build` | **PASS** |

---

## Ops note (production DB)

Apply migration **026** (or `supabase/APPLY_PRODUCTION_DB_FULL.sql` section) so `opening_debit` / `opening_credit`, `Approved` status, updated `supplier_ledger_v`, and `pos_approve_purchase` exist on the live database. Until then, the API falls back to the JS approve orchestration (still approval-gated).

---

### **FINAL GO**

Automated purchase + supplier accounting modules are green. Live production UI deploy is optional follow-up after migration 026 is applied on Supabase.
