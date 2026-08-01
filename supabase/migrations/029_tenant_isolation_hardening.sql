-- 029: Tenant isolation hardening
-- - supplier_ledger_adjustments must use tenant_match (not global is_staff)
-- - Ensure expense_categories can be company-scoped when column exists

-- ---------------------------------------------------------------------------
-- 1) supplier_ledger_adjustments: replace staff-wide policies with tenant_match
-- ---------------------------------------------------------------------------
ALTER TABLE public.supplier_ledger_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_ledger_adjustments_select ON public.supplier_ledger_adjustments;
DROP POLICY IF EXISTS supplier_ledger_adjustments_insert_staff ON public.supplier_ledger_adjustments;
DROP POLICY IF EXISTS supplier_ledger_adjustments_update_staff ON public.supplier_ledger_adjustments;
DROP POLICY IF EXISTS supplier_ledger_adjustments_delete_staff ON public.supplier_ledger_adjustments;

CREATE POLICY supplier_ledger_adjustments_select ON public.supplier_ledger_adjustments
  FOR SELECT TO authenticated
  USING (public.tenant_match(company_id));

CREATE POLICY supplier_ledger_adjustments_insert_staff ON public.supplier_ledger_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (public.tenant_match(company_id) AND public.is_owner_or_admin());

CREATE POLICY supplier_ledger_adjustments_update_staff ON public.supplier_ledger_adjustments
  FOR UPDATE TO authenticated
  USING (public.tenant_match(company_id) AND public.is_owner_or_admin())
  WITH CHECK (public.tenant_match(company_id) AND public.is_owner_or_admin());

CREATE POLICY supplier_ledger_adjustments_delete_staff ON public.supplier_ledger_adjustments
  FOR DELETE TO authenticated
  USING (public.tenant_match(company_id) AND public.is_owner_or_admin());

-- ---------------------------------------------------------------------------
-- 2) expense_categories: add company_id when missing + tenant RLS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'expense_categories'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expense_categories' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE public.expense_categories
      ADD COLUMN company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;
    -- Attribute legacy global categories to company 1 only (Super Owner), never broadcast.
    UPDATE public.expense_categories SET company_id = 1 WHERE company_id IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expense_categories' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS expense_categories_select ON public.expense_categories;
    DROP POLICY IF EXISTS expense_categories_insert_staff ON public.expense_categories;
    DROP POLICY IF EXISTS expense_categories_update_staff ON public.expense_categories;
    DROP POLICY IF EXISTS expense_categories_delete_staff ON public.expense_categories;
    DROP POLICY IF EXISTS expense_categories_all_staff ON public.expense_categories;

    CREATE POLICY expense_categories_select ON public.expense_categories
      FOR SELECT TO authenticated
      USING (company_id IS NULL OR public.tenant_match(company_id));

    CREATE POLICY expense_categories_insert_staff ON public.expense_categories
      FOR INSERT TO authenticated
      WITH CHECK (public.tenant_match(company_id) AND public.is_staff());

    CREATE POLICY expense_categories_update_staff ON public.expense_categories
      FOR UPDATE TO authenticated
      USING (public.tenant_match(company_id) AND public.is_owner_or_admin())
      WITH CHECK (public.tenant_match(company_id) AND public.is_owner_or_admin());

    CREATE POLICY expense_categories_delete_staff ON public.expense_categories
      FOR DELETE TO authenticated
      USING (public.tenant_match(company_id) AND public.is_owner_or_admin());
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Lock down legacy global public.settings from authenticated clients
--    (service role /api/pos must never fall back to this table for tenants)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'settings'
  ) THEN
    ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS settings_select_authenticated ON public.settings;
    DROP POLICY IF EXISTS settings_all_authenticated ON public.settings;
    DROP POLICY IF EXISTS settings_select ON public.settings;
    DROP POLICY IF EXISTS settings_write ON public.settings;
    -- No authenticated policies: only service_role can read/write legacy settings.
  END IF;
END $$;
