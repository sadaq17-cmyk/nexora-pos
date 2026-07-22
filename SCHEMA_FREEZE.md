# Nexora POS — Schema Freeze

**Status:** FROZEN (production approved)  
**Freeze date:** 2026-07-22  
**Approved via:** `PRODUCTION_DATABASE_APPROVAL.md` (gates 1–5 PASS after migration `014`)  
**Baseline migration:** `014_production_tenant_isolation.sql` (chain `001`–`014`)

---

## Rules

1. **Additive only** after this freeze:
   - New tables, columns (`ADD COLUMN IF NOT EXISTS`), indexes, and policies are allowed.
   - Prefer `DROP POLICY IF EXISTS` + `CREATE POLICY` over silent policy edits.
2. **Forbidden without explicit exception review:**
   - Renaming / dropping tables or columns used by production API
   - Changing `company_id` nullability or FK delete actions on tenant tables
   - Replacing tenant RLS predicates with role-only (`is_staff()`) policies
   - Re-introducing global UNIQUE on tenant document numbers (`invoice_no`, `po_number`, `branches.code`)
   - Dropping line-item sync triggers (`trg_sale_items_sync_json`, `trg_purchase_items_sync_json`) without a replacement that keeps `items_json` consistent with `sale_items` / `purchase_items`
3. **Source of truth for sale/purchase lines:** relational `sale_items` / `purchase_items`. `items_json` is a denormalized cache maintained by DB triggers.
4. **Service-role API** remains the primary app write path; RLS is defense-in-depth for authenticated clients.

---

## How to change the schema after freeze

1. Open an additive migration `015_…sql` (or later).
2. Document why it is additive-safe in the migration header.
3. `npx supabase db push --linked` and update approval notes if security/integrity posture changes.
4. Non-additive work requires a written exception and a new approval re-run.
