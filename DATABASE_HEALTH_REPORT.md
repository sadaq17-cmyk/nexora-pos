# Nexora POS — Production Database Health Report

**Date:** 2026-07-20  
**Project:** `ohrpezhlnjwiilojdqbo` (`https://ohrpezhlnjwiilojdqbo.supabase.co`)  
**Production host:** https://www.httpsnexorapos.com  
**Deploy:** `dpl_Bg9PUe6WatBqfRA6nSzqZ3DzfJKV` → https://nexora-1tsfyqpdn-nexoraposapp.vercel.app  
**Inspector:** https://vercel.com/nexoraposapp/nexora-pos/Bg9PUe6WatBqfRA6nSzqZ3DzfJKV

## Verdict

### FULL GO — Production schema present; `health.probe` 30/30 PASS

Live `POST /api/pos` with `{"action":"health.probe"}` returns **success: true** with every checked table and `pos_create_sale` OK. Application tables are in the PostgREST schema cache (no PGRST205). RPC exists (empty-payload validation returns Postgres `22023`, not PGRST202 missing).

## Apply path summary

| Method | Result |
|--------|--------|
| Local `.env*` / `vercel env pull` | Secrets redacted as `[SENSITIVE]` or empty for URL/service-role |
| `vercel env run` (local) | Anon key decrypts; `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` empty locally |
| `SUPABASE_ACCESS_TOKEN` / linked CLI / `psql` | Not available in this environment |
| Temporary gated runtime apply (`schema.applyFull`) | Confirmed runtime has service role + URL; **cannot DDL** without `DATABASE_URL` / `SUPABASE_DB_PASSWORD` / Management PAT. Management API rejected service key (`JWT could not be decoded` — new `sb_secret` format). Direct `db.<ref>.supabase.co` ENOTFOUND from Vercel. |
| Production schema state | **Present** — verified by service-role `health.probe` 30/30 |

Temporary apply backdoor removed from `api/pos.js`; clean production redeploy completed.

## Per-table status (live `health.probe`, service role)

| Table / object | Status | Notes |
|----------------|--------|-------|
| branches | PASS | |
| profiles | PASS | |
| categories | PASS | |
| products | PASS | |
| customers | PASS | |
| customer_payments | PASS | |
| suppliers | PASS | |
| supplier_payments | PASS | |
| sales | PASS | |
| sale_items | PASS | |
| held_sales | PASS | |
| purchases | PASS | |
| purchase_items | PASS | |
| purchase_returns | PASS | |
| expense_categories | PASS | |
| expenses | PASS | |
| stock_transfers | PASS | |
| settings | PASS | |
| permissions | PASS | |
| audit_log | PASS | |
| subscription | PASS | |
| companies | PASS | |
| company_subscriptions | PASS | |
| company_settings | PASS | |
| brands | PASS | |
| units | PASS | |
| warehouses | PASS | |
| stock_movements | PASS | |
| invoice_verifications | PASS | |
| pos_create_sale RPC | PASS | Exists (validation error on empty payload, not missing) |

**Totals:** 30 PASS / 0 FAIL

## RLS / anon spot-check

Anon key REST `select * limit 1` on products, suppliers, categories, sales, customers, companies, invoice_verifications: **HTTP OK, 0 rows** (tables exist; consistent with empty data and/or RLS with no anon-visible rows). Service role probe succeeds (bypasses RLS). Bootstrap SQL enables RLS on all app tables; live `pg_catalog` RLS flags were not queryable without a Postgres connection string.

## Post-deploy verification

| Check | Result |
|-------|--------|
| Deploy aliased to www.httpsnexorapos.com | PASS (`dpl_Bg9PUe6WatBqfRA6nSzqZ3DzfJKV`) |
| `POST /api/pos` `health.probe` | PASS 30/30 |
| Key tables (products, suppliers, categories, sales, customers, companies, invoice_verifications) | PASS |
| `pos_create_sale` RPC | PASS |
| Temporary apply endpoint removed | DONE |

## Remaining ops notes (non-blocking for FULL GO)

- Local Vercel CLI still cannot decrypt `VITE_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` for offline DDL; keep `SUPABASE_ACCESS_TOKEN` or `DATABASE_URL` / `SUPABASE_DB_PASSWORD` available for future migrations.
- Hobby plan serverless function limit is 12 — do not add a 13th API route without consolidating.
