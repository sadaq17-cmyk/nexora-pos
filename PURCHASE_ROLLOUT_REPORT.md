# Nexora POS — Purchase Workflow Production Rollout Report

**Date:** 2026-07-20 (migrations applied via Supabase CLI)  
**Production URL:** https://www.nexorapospro.com  
**Supabase project:** `ohrpezhlnjwiilojdqbo` (linked)

---

## Verdict

### PASS — migrations 006 + 007 applied; health.probe green

Pending migrations were applied to the **linked Supabase Cloud** project with Supabase CLI (`supabase db push --linked`). Schema columns required for Purchase workflow exist. Live `health.probe` returned **all checks TRUE**, including `products_sku_tax_rate` and `suppliers_tax_notes`. Purchase production deploy may proceed.

---

## Commands used

1. `supabase projects list` — confirmed linked project `ohrpezhlnjwiilojdqbo` (ACTIVE_HEALTHY)
2. `supabase migration list --linked` — initially all local versions had empty remote history
3. `supabase db push --linked --yes` — first attempt failed on `001` (policy `profiles_select` already exists)
4. `supabase migration repair --linked --status applied 001 002 003 004 005 --yes` — marked pre-existing schema migrations as applied
5. `supabase db push --linked --yes` — applied `006_remove_demo_products.sql` and `007_purchase_workflow_fields.sql`
6. `supabase migration list --linked` — 001–007 local/remote in sync
7. `supabase db query --linked` — verified `products.sku`, `products.tax_rate`, `suppliers.tax_number`, `suppliers.notes`
8. `POST https://www.nexorapospro.com/api/pos` `{"action":"health.probe"}` with Origin header

No local Docker Supabase was started or used.

---

## Migration status

| Item | Status |
|------|--------|
| `001`–`005` | **REPAIRED as applied** (schema already present; history was empty) |
| `006_remove_demo_products.sql` | **APPLIED** |
| `007_purchase_workflow_fields.sql` | **APPLIED** |
| Columns `sku`, `tax_rate`, `tax_number`, `notes` | **PRESENT** |
| Notices on 007 | `suppliers.email` / `suppliers.address` already existed (skipped) |
| Permission / DDL errors after repair | **None** |

### First push error (resolved via repair)

```
ERROR: policy "profiles_select" for table "profiles" already exists (SQLSTATE 42710)
```

Cause: remote schema already had 001 objects, but `supabase_migrations.schema_migrations` did not list 001–005. Repair + re-push fixed this. No database permission (GRANT/RLS) failures during 006/007 apply.

---

## Schema verification

`information_schema` on linked remote:

| table | column |
|-------|--------|
| products | sku |
| products | tax_rate |
| suppliers | notes |
| suppliers | tax_number |

---

## Live health.probe (post-migration)

`POST https://www.nexorapospro.com/api/pos` `{"action":"health.probe"}` → **success: true**

Key checks:

| Check | Result |
|-------|--------|
| Core tables (29+) | **ok: true** |
| `pos_create_sale` | **ok: true** (`code: 22023`, `missing: false`) |
| `products_sku_tax_rate` | **ok: true** |
| `suppliers_tax_notes` | **ok: true** |

All checks TRUE. No permission errors reported by the probe.

---

## Deployment status

| Step | Result |
|------|--------|
| Apply 006/007 | **PASS** |
| health.probe | **PASS** (all checks TRUE) |
| `npx vercel --prod --yes` | **PASS** — `dpl_GXt8LJz9AicSi5gBVuk4fafdSUh7` READY |
| Production alias | https://www.nexorapospro.com |
| Deployment URL | https://nexora-3g6l7gtdk-nexoraposapp.vercel.app |
| Inspect | https://vercel.com/nexoraposapp/nexora-pos/GXt8LJz9AicSi5gBVuk4fafdSUh7 |

---

## Remaining (optional follow-up)

1. Authenticated Purchase E2E (supplier → product → inventory → reports) when prod credentials available.
2. No further DDL required for Purchase 007 fields.

