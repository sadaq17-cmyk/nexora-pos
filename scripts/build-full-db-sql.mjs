/**
 * Build idempotent APPLY_PRODUCTION_DB_FULL.sql from migrations 001/003/004 + patches.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const m001 = readFileSync(join(root, "supabase/migrations/001_nexora_schema.sql"), "utf8");
const m003 = readFileSync(join(root, "supabase/migrations/003_invoice_verifications.sql"), "utf8");
const m004 = readFileSync(join(root, "supabase/migrations/004_production_data_plane.sql"), "utf8");

let core = m001;
const seedIdx = core.indexOf("-- Seed data");
if (seedIdx !== -1) core = core.slice(0, seedIdx);

const enableLine = "ALTER TABLE public.subscription ENABLE ROW LEVEL SECURITY;";
const enableEnd = core.indexOf(enableLine);
if (enableEnd !== -1) {
  core = core.slice(0, enableEnd + enableLine.length) + "\n";
}

core = core.replace(
  /CREATE TABLE IF NOT EXISTS public\.categories \(\s*id\s+BIGSERIAL PRIMARY KEY,\s*name\s+text NOT NULL UNIQUE,/m,
  `CREATE TABLE IF NOT EXISTS public.categories (
  id          BIGSERIAL PRIMARY KEY,
  name        text NOT NULL,`
);

core = core.replace(
  /CREATE TABLE IF NOT EXISTS public\.expense_categories \(\s*id\s+BIGSERIAL PRIMARY KEY,\s*name\s+text NOT NULL UNIQUE,/m,
  `CREATE TABLE IF NOT EXISTS public.expense_categories (
  id          BIGSERIAL PRIMARY KEY,
  name        text NOT NULL,`
);

core = core.replace(
  /role\s+text NOT NULL CHECK \(role IN \('owner', 'admin', 'cashier'\)\),/,
  `role        text NOT NULL CHECK (role IN (
    'platform_owner','owner','super_admin','admin','branch_manager',
    'sales_manager','inventory_manager','accountant','sales','cashier'
  )),`
);

const extras = `
-- ===========================================================================
-- 005 patches: supplier contact fields, indexes, safe RLS, grants
-- ===========================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS suppliers_company_id_idx ON public.suppliers (company_id);
CREATE INDEX IF NOT EXISTS suppliers_name_idx ON public.suppliers (name);
CREATE INDEX IF NOT EXISTS products_company_id_idx ON public.products (company_id);
CREATE INDEX IF NOT EXISTS categories_company_id_idx ON public.categories (company_id);
CREATE INDEX IF NOT EXISTS customers_company_id_idx ON public.customers (company_id);
CREATE INDEX IF NOT EXISTS sales_company_id_idx ON public.sales (company_id);
CREATE INDEX IF NOT EXISTS purchases_company_id_idx ON public.purchases (company_id);
CREATE INDEX IF NOT EXISTS expenses_company_id_idx ON public.expenses (company_id);

DO $$
BEGIN
  ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.expense_categories DROP CONSTRAINT IF EXISTS expense_categories_name_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'branches','categories','products','customers','customer_payments',
    'suppliers','supplier_payments','sales','sale_items','held_sales',
    'purchases','purchase_items','purchase_returns','expense_categories',
    'expenses','stock_transfers','settings','permissions','audit_log','subscription'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_staff', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_staff', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_staff', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff())',
      t || '_select', t
    );
    IF t <> 'subscription' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_owner_or_admin())',
        t || '_insert_staff', t
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_owner_or_admin()) WITH CHECK (public.is_owner_or_admin())',
        t || '_update_staff', t
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_owner_or_admin())',
        t || '_delete_staff', t
      );
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_owner_or_admin() OR id = auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_owner_or_admin() OR id = auth.uid())
  WITH CHECK (public.is_owner_or_admin() OR id = auth.uid());
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
`;

const header = `-- Nexora POS Enterprise — FULL production database bootstrap
-- Safe to re-run. Paste into Supabase SQL Editor if CLI/Management API apply is unavailable.
-- Project ref: ohrpezhlnjwiilojdqbo
-- Covers: 001 core tables + helpers, 003 invoice_verifications, 004 multi-tenant plane, 005 patches.
-- Generated: ${new Date().toISOString()}

`;

const out =
  header +
  "\n-- ===== 001 CORE (tables + helpers + enable RLS) =====\n" +
  core +
  "\n-- ===== 003 INVOICE VERIFICATIONS =====\n" +
  m003 +
  "\n-- ===== 004 PRODUCTION DATA PLANE =====\n" +
  m004 +
  extras;

writeFileSync(join(root, "supabase/APPLY_PRODUCTION_DB_FULL.sql"), out, "utf8");
writeFileSync(join(root, "supabase/migrations/005_ensure_full_production_schema.sql"), out, "utf8");
console.log("bytes=", Buffer.byteLength(out));
console.log("lines=", out.split(/\n/).length);
