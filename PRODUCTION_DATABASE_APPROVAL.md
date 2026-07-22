# Nexora POS — Production Database Approval

**Date:** 2026-07-22 (re-run after `014_production_tenant_isolation.sql`)  
**Scope:** Re-verification of migrations `001` → `014` against the five freeze gates  
**Remote:** `supabase migration list --linked` — local = remote for `001`–`014`  
**Method:** Migration SQL + live remote policy/constraint queries after `npx supabase db push --linked`

---

## Executive verdict

# **APPROVED TO FREEZE** / Production Approved

Critical multi-tenant isolation and integrity blockers **C1–C5** are fixed and applied on the linked remote. Schema freeze rules: **additive-only** thereafter (see `SCHEMA_FREEZE.md`).

**Freeze recommendation:** **Freeze schema.** Non-additive changes require an explicit exception.

---

## Checklist — five verifications

| # | Gate | Result | Evidence |
|---|------|--------|----------|
| 1 | Schema production-ready for multi-tenant SaaS (10k+ companies) | **PASS** | `company_id NOT NULL` on core tenant tables; per-company UNIQUEs on `invoice_no` / `po_number` / `branches.code` / `receipt_no`; dual line storage synced (relational source of truth + `items_json` cache triggers). Legacy globals (`subscription`, `settings`, `permissions`, `expense_categories`) remain non-tenant by design (P1 deprecation — not a freeze blocker). |
| 2 | RLS correctly isolates every company on every tenant table | **PASS** | Core tables use `tenant_match(company_id)` (= `is_platform_owner() OR company_id = jwt_company_id()`). `sale_items` scoped via parent `sales`. `profiles` scoped by company / self / platform owner. FX tables enabled + tenant policies. |
| 3 | No possibility of tenant data leakage (authenticated client) | **PASS** (with known intentional exceptions) | Blind `is_staff()` removed from tenant business tables. `company_currencies` / `currency_rate_history` now RLS-protected. Remaining: `invoice_verifications_public_select` (`USING (true)`) is intentional public QR verify; legacy global tables have no tenant key (not company data). Service-role API path unchanged (bypasses RLS). |
| 4 | Migrations complete (local coherent; remote if available) | **PASS** | Local + remote: `001`–`014` aligned. `014` applied successfully via `db push --linked`. |
| 5 | Indexes exist for performance (critical list paths) | **PASS** | Prior `013` composites retained; `014` adds uniqueness indexes that also serve lookup by company + document number. |

---

## Critical failures — status after 014

| ID | Former issue | Status |
|----|--------------|--------|
| C1 | Tenant-blind RLS on core tables | **FIXED** — `tenant_match(company_id)` policies |
| C2 | Missing RLS on FX tables | **FIXED** — ENABLE RLS + tenant policies |
| C3 | Nullable `company_id` orphans | **FIXED** — backfill / orphan delete + `SET NOT NULL` |
| C4 | Global UNIQUE on invoice/PO/branch | **FIXED** — composite `(company_id, …)` uniques |
| C5 | Dual line-items drift | **FIXED** — backfill + triggers; app write path syncs lines |

### Live validation (post-push)

- Policies on `products`, `sales`, `customers`, `suppliers`, `purchases`, `purchase_items`, `expenses`, `audit_log`, `purchase_payments`, `branches`, `held_sales`, etc.: `tenant_match(company_id)`
- `sale_items_*`: `EXISTS (sales … company_id = jwt_company_id())`
- `company_currencies` / `currency_rate_history`: RLS on + `tenant_match`
- `company_id` `attnotnull = true` on all listed tenant business tables
- Unique indexes: `branches_company_code_uidx`, `sales_company_invoice_no_uidx`, `sales_company_receipt_no_uidx`, `purchases_company_po_number_uidx`
- Triggers: `trg_sale_items_sync_json`, `trg_purchase_items_sync_json`

---

## Migration completeness status

| Check | Status |
|-------|--------|
| Local files `001`–`014` present and sequential | **Complete** |
| Linked remote match | **Yes** — `001`–`014` |
| P0 freeze blockers C1–C5 present in chain | **Yes** — `014_production_tenant_isolation.sql` |

---

## Explicit freeze recommendation

**APPROVED TO FREEZE.**

Freeze date and rules: see [`SCHEMA_FREEZE.md`](./SCHEMA_FREEZE.md).

Residual non-blockers (out of scope for this pass):

- Legacy global `settings` / `permissions` / `subscription` / `expense_categories` (deprecate toward `company_*` later)
- `profiles.email` remains globally UNIQUE (aligned with Auth)
- Public invoice verification registry remains world-readable by product design

---

## App changes (minimal)

- `api/_posData.js`: sale fallback writes `items_json`; `purchases.update` replaces `purchase_items` when lines change (relational = source of truth; DB trigger refreshes JSON cache)
- `npm run build` — green

---

## Confirmation

This approval pass **did**:

- Apply `014_production_tenant_isolation.sql` via `npx supabase db push --linked`
- Re-query remote policies / nullability / uniques / triggers
- Update this file and `SCHEMA_FREEZE.md`

**Cross-reference:** Prior P0 findings in `DATABASE_ARCHITECTURE_REPORT.md` addressed by migration `014`.
