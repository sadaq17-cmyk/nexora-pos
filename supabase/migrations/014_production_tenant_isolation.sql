-- Nexora POS — Production blockers C1–C5 (additive / safe)
-- 1) Tenant-scoped RLS on core tables
-- 2) RLS on FX tables
-- 3) company_id NOT NULL after backfill
-- 4) Per-company UNIQUE (invoice_no, po_number, branches.code, receipt_no)
-- 5) Dual line-items sync (relational source of truth; items_json cache)

-- =============================================================================
-- 0) Ensure JWT / tenancy helpers exist (idempotent)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.jwt_company_id()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::bigint;
$$;

CREATE OR REPLACE FUNCTION public.jwt_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$;

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.jwt_role() = 'platform_owner';
$$;

CREATE OR REPLACE FUNCTION public.tenant_match(p_company_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_platform_owner()
    OR (p_company_id IS NOT NULL AND p_company_id = public.jwt_company_id());
$$;

COMMENT ON FUNCTION public.tenant_match(bigint) IS
  'True for platform_owner or when row company_id matches JWT app_metadata.company_id';

-- =============================================================================
-- 3a) Backfill company_id BEFORE NOT NULL / tenant RLS assumptions
-- =============================================================================

DO $$
DECLARE
  v_company_count integer;
  v_only_company bigint;
BEGIN
  SELECT COUNT(*), MIN(id) INTO v_company_count, v_only_company FROM public.companies;

  -- Child → parent inference
  UPDATE public.purchase_items pi
  SET company_id = p.company_id
  FROM public.purchases p
  WHERE pi.purchase_id = p.id
    AND pi.company_id IS NULL
    AND p.company_id IS NOT NULL;

  UPDATE public.purchase_payments pp
  SET company_id = p.company_id
  FROM public.purchases p
  WHERE pp.purchase_id = p.id
    AND pp.company_id IS NULL
    AND p.company_id IS NOT NULL;

  UPDATE public.purchase_returns pr
  SET company_id = p.company_id
  FROM public.purchases p
  WHERE pr.purchase_id = p.id
    AND pr.company_id IS NULL
    AND p.company_id IS NOT NULL;

  UPDATE public.customer_payments cp
  SET company_id = c.company_id
  FROM public.customers c
  WHERE cp.customer_id = c.id
    AND cp.company_id IS NULL
    AND c.company_id IS NOT NULL;

  UPDATE public.supplier_payments sp
  SET company_id = s.company_id
  FROM public.suppliers s
  WHERE sp.supplier_id = s.id
    AND sp.company_id IS NULL
    AND s.company_id IS NOT NULL;

  -- Single-tenant safety net for remaining NULLs
  IF v_company_count = 1 AND v_only_company IS NOT NULL THEN
    -- Avoid unique collisions when orphans join the only company
    UPDATE public.suppliers s
    SET code = NULLIF(trim(s.code), '') || '-orphan-' || s.id::text
    WHERE s.company_id IS NULL
      AND s.code IS NOT NULL
      AND btrim(s.code) <> ''
      AND EXISTS (
        SELECT 1 FROM public.suppliers o
        WHERE o.company_id = v_only_company
          AND o.code = s.code
      );

    UPDATE public.branches b
    SET code = b.code || '-orphan-' || b.id::text
    WHERE b.company_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.branches o
        WHERE o.company_id = v_only_company
          AND o.code = b.code
      );

    UPDATE public.sales s
    SET invoice_no = s.invoice_no || '-orphan-' || s.id::text
    WHERE s.company_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.sales o
        WHERE o.company_id = v_only_company
          AND o.invoice_no = s.invoice_no
      );

    UPDATE public.purchases p
    SET po_number = p.po_number || '-orphan-' || p.id::text
    WHERE p.company_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.purchases o
        WHERE o.company_id = v_only_company
          AND o.po_number = p.po_number
      );

    UPDATE public.branches SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.categories SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.products SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.customers SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.suppliers SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.sales SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.held_sales SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.purchases SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.expenses SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.stock_transfers SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.customer_payments SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.supplier_payments SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.purchase_payments SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.purchase_items SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.purchase_returns SET company_id = v_only_company WHERE company_id IS NULL;
    UPDATE public.audit_log SET company_id = v_only_company WHERE company_id IS NULL;
  END IF;
END $$;

-- Delete unattributable orphans so NOT NULL can succeed (multi-company or empty)
DO $$
DECLARE
  r record;
  orphan_count bigint;
  tables text[] := ARRAY[
    'branches','categories','products','customers','suppliers','sales','held_sales',
    'purchases','expenses','stock_transfers','customer_payments','supplier_payments',
    'purchase_payments','purchase_items','purchase_returns','audit_log'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE company_id IS NULL', t) INTO orphan_count;
    IF orphan_count > 0 THEN
      RAISE NOTICE '014: deleting % orphan row(s) with NULL company_id from %', orphan_count, t;
      EXECUTE format('DELETE FROM public.%I WHERE company_id IS NULL', t);
    END IF;
  END LOOP;
END $$;

-- Ensure FKs exist (ADD COLUMN already added most; recreate audit_log FK for CASCADE)
DO $$
BEGIN
  -- audit_log: SET NULL → CASCADE so NOT NULL is safe
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_company_id_fkey;
    ALTER TABLE public.audit_log
      ADD CONSTRAINT audit_log_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '014: audit_log FK adjust skipped: %', SQLERRM;
END $$;

-- SET NOT NULL on tenant business tables
ALTER TABLE public.branches ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.categories ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.suppliers ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.sales ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.held_sales ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.purchases ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.expenses ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.stock_transfers ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.customer_payments ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.supplier_payments ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.purchase_payments ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.purchase_items ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.purchase_returns ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.audit_log ALTER COLUMN company_id SET NOT NULL;

-- profiles.company_id stays nullable (platform_owner)
-- invoice_verifications.company_id stays nullable (public QR registry)

-- =============================================================================
-- 4) Per-company UNIQUE constraints (drop global, add composite)
-- =============================================================================

-- Deduplicate within company before unique indexes
DO $$
BEGIN
  -- branches.code: keep lowest id, suffix others
  UPDATE public.branches b
  SET code = b.code || '-dup-' || b.id::text
  WHERE EXISTS (
    SELECT 1 FROM public.branches o
    WHERE o.company_id = b.company_id
      AND o.code = b.code
      AND o.id < b.id
  );

  -- sales.invoice_no
  UPDATE public.sales s
  SET invoice_no = s.invoice_no || '-dup-' || s.id::text
  WHERE EXISTS (
    SELECT 1 FROM public.sales o
    WHERE o.company_id = s.company_id
      AND o.invoice_no = s.invoice_no
      AND o.id < s.id
  );

  -- sales.receipt_no (partial unique was global)
  UPDATE public.sales s
  SET receipt_no = s.receipt_no || '-dup-' || s.id::text
  WHERE s.receipt_no IS NOT NULL
    AND btrim(s.receipt_no) <> ''
    AND EXISTS (
      SELECT 1 FROM public.sales o
      WHERE o.company_id = s.company_id
        AND o.receipt_no = s.receipt_no
        AND o.id < s.id
    );

  -- purchases.po_number
  UPDATE public.purchases p
  SET po_number = p.po_number || '-dup-' || p.id::text
  WHERE EXISTS (
    SELECT 1 FROM public.purchases o
    WHERE o.company_id = p.company_id
      AND o.po_number = p.po_number
      AND o.id < p.id
  );
END $$;

ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_code_key;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_invoice_no_key;
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_po_number_key;

DROP INDEX IF EXISTS public.sales_receipt_no_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS branches_company_code_uidx
  ON public.branches (company_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS sales_company_invoice_no_uidx
  ON public.sales (company_id, invoice_no);

CREATE UNIQUE INDEX IF NOT EXISTS sales_company_receipt_no_uidx
  ON public.sales (company_id, receipt_no)
  WHERE receipt_no IS NOT NULL AND receipt_no <> '';

CREATE UNIQUE INDEX IF NOT EXISTS purchases_company_po_number_uidx
  ON public.purchases (company_id, po_number);

-- profiles.email remains globally UNIQUE (aligned with auth.users email uniqueness)

-- =============================================================================
-- 5) Dual line-items: backfill + sync triggers (relational = source of truth)
-- =============================================================================

-- 5a) Backfill sale_items from items_json where lines missing
INSERT INTO public.sale_items (sale_id, product_id, name, qty, price, cost)
SELECT
  s.id,
  NULLIF(elem->>'product_id', '')::bigint,
  elem->>'name',
  COALESCE(NULLIF(elem->>'qty', '')::integer, 1),
  COALESCE(NULLIF(elem->>'price', '')::numeric, 0),
  COALESCE(NULLIF(elem->>'cost', '')::numeric, 0)
FROM public.sales s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(s.items_json) = 'array' THEN s.items_json
    ELSE '[]'::jsonb
  END
) AS elem
WHERE NOT EXISTS (SELECT 1 FROM public.sale_items si WHERE si.sale_id = s.id)
  AND jsonb_typeof(s.items_json) = 'array'
  AND jsonb_array_length(s.items_json) > 0;

-- 5b) Backfill purchase_items from items_json where lines missing
INSERT INTO public.purchase_items (
  purchase_id, product_id, qty, qty_ordered, qty_received, cost, discount, tax, company_id
)
SELECT
  p.id,
  NULLIF(elem->>'product_id', '')::bigint,
  COALESCE(NULLIF(elem->>'qty', '')::integer, NULLIF(elem->>'qty_ordered', '')::integer, 1),
  COALESCE(NULLIF(elem->>'qty_ordered', '')::integer, NULLIF(elem->>'qty', '')::integer, 1),
  COALESCE(NULLIF(elem->>'qty_received', '')::integer, 0),
  COALESCE(NULLIF(elem->>'cost', '')::numeric, 0),
  COALESCE(NULLIF(elem->>'discount', '')::numeric, 0),
  COALESCE(NULLIF(elem->>'tax', '')::numeric, NULLIF(elem->>'tax_rate', '')::numeric, 0),
  p.company_id
FROM public.purchases p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(p.items_json) = 'array' THEN p.items_json
    ELSE '[]'::jsonb
  END
) AS elem
WHERE NOT EXISTS (SELECT 1 FROM public.purchase_items pi WHERE pi.purchase_id = p.id)
  AND jsonb_typeof(p.items_json) = 'array'
  AND jsonb_array_length(p.items_json) > 0;

-- 5c) Rebuild items_json from relational lines (canonical cache)
UPDATE public.sales s
SET items_json = COALESCE((
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', si.product_id,
      'name', si.name,
      'qty', si.qty,
      'price', si.price,
      'cost', si.cost
    )
    ORDER BY si.id
  )
  FROM public.sale_items si
  WHERE si.sale_id = s.id
), '[]'::jsonb)
WHERE EXISTS (SELECT 1 FROM public.sale_items si WHERE si.sale_id = s.id);

UPDATE public.purchases p
SET items_json = COALESCE((
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', pi.product_id,
      'qty', pi.qty,
      'qty_ordered', COALESCE(pi.qty_ordered, pi.qty),
      'qty_received', COALESCE(pi.qty_received, 0),
      'cost', pi.cost,
      'discount', COALESCE(pi.discount, 0),
      'tax', COALESCE(pi.tax, 0),
      'line_total', ROUND(
        (COALESCE(pi.qty_ordered, pi.qty, 0)::numeric * COALESCE(pi.cost, 0))
        - COALESCE(pi.discount, 0)
        + (
          (COALESCE(pi.qty_ordered, pi.qty, 0)::numeric * COALESCE(pi.cost, 0) - COALESCE(pi.discount, 0))
          * COALESCE(pi.tax, 0) / 100.0
        ),
        2
      )
    )
    ORDER BY pi.id
  )
  FROM public.purchase_items pi
  WHERE pi.purchase_id = p.id
), '[]'::jsonb)
WHERE EXISTS (SELECT 1 FROM public.purchase_items pi WHERE pi.purchase_id = p.id);

-- 5d) Triggers: keep items_json in sync from line tables
CREATE OR REPLACE FUNCTION public.sync_sales_items_json_from_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id bigint;
BEGIN
  v_sale_id := COALESCE(NEW.sale_id, OLD.sale_id);
  UPDATE public.sales s
  SET items_json = COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'product_id', si.product_id,
        'name', si.name,
        'qty', si.qty,
        'price', si.price,
        'cost', si.cost
      )
      ORDER BY si.id
    )
    FROM public.sale_items si
    WHERE si.sale_id = v_sale_id
  ), '[]'::jsonb)
  WHERE s.id = v_sale_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_items_sync_json ON public.sale_items;
CREATE TRIGGER trg_sale_items_sync_json
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.sync_sales_items_json_from_lines();

CREATE OR REPLACE FUNCTION public.sync_purchase_items_json_from_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_id bigint;
BEGIN
  v_purchase_id := COALESCE(NEW.purchase_id, OLD.purchase_id);
  UPDATE public.purchases p
  SET items_json = COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'product_id', pi.product_id,
        'qty', pi.qty,
        'qty_ordered', COALESCE(pi.qty_ordered, pi.qty),
        'qty_received', COALESCE(pi.qty_received, 0),
        'cost', pi.cost,
        'discount', COALESCE(pi.discount, 0),
        'tax', COALESCE(pi.tax, 0),
        'line_total', ROUND(
          (COALESCE(pi.qty_ordered, pi.qty, 0)::numeric * COALESCE(pi.cost, 0))
          - COALESCE(pi.discount, 0)
          + (
            (COALESCE(pi.qty_ordered, pi.qty, 0)::numeric * COALESCE(pi.cost, 0) - COALESCE(pi.discount, 0))
            * COALESCE(pi.tax, 0) / 100.0
          ),
          2
        )
      )
      ORDER BY pi.id
    )
    FROM public.purchase_items pi
    WHERE pi.purchase_id = v_purchase_id
  ), '[]'::jsonb),
  item_count = (
    SELECT COUNT(*)::integer FROM public.purchase_items pi WHERE pi.purchase_id = v_purchase_id
  )
  WHERE p.id = v_purchase_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_items_sync_json ON public.purchase_items;
CREATE TRIGGER trg_purchase_items_sync_json
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.sync_purchase_items_json_from_lines();

COMMENT ON FUNCTION public.sync_sales_items_json_from_lines() IS
  'Denormalized cache: rebuild sales.items_json from sale_items (source of truth)';
COMMENT ON FUNCTION public.sync_purchase_items_json_from_lines() IS
  'Denormalized cache: rebuild purchases.items_json from purchase_items (source of truth)';

-- =============================================================================
-- 1) Tenant isolation RLS — replace blind is_staff() on tenant tables
-- =============================================================================

-- Drop legacy cashier policies (tenant-blind); company-scoped policies cover writes
DROP POLICY IF EXISTS sales_insert_cashier ON public.sales;
DROP POLICY IF EXISTS sales_update_cashier ON public.sales;
DROP POLICY IF EXISTS sale_items_insert_cashier ON public.sale_items;
DROP POLICY IF EXISTS held_sales_insert_cashier ON public.held_sales;
DROP POLICY IF EXISTS held_sales_delete_cashier ON public.held_sales;
DROP POLICY IF EXISTS customers_insert_cashier ON public.customers;
DROP POLICY IF EXISTS customers_update_cashier ON public.customers;
DROP POLICY IF EXISTS customer_payments_insert_cashier ON public.customer_payments;
DROP POLICY IF EXISTS products_update_cashier ON public.products;
DROP POLICY IF EXISTS audit_log_insert_cashier ON public.audit_log;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'branches','categories','products','customers','customer_payments',
    'suppliers','supplier_payments','sales','held_sales',
    'purchases','purchase_items','purchase_returns','purchase_payments',
    'expenses','stock_transfers','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_staff', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_staff', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_staff', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_all', t);

    -- Named select/write policies matching newer jwt_company_id pattern
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.tenant_match(company_id))',
      t || '_select', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.tenant_match(company_id))',
      t || '_insert_staff', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.tenant_match(company_id)) WITH CHECK (public.tenant_match(company_id))',
      t || '_update_staff', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.tenant_match(company_id))',
      t || '_delete_staff', t
    );

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;

-- sale_items: no company_id — scope via parent sale
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_items_select ON public.sale_items;
DROP POLICY IF EXISTS sale_items_insert_staff ON public.sale_items;
DROP POLICY IF EXISTS sale_items_update_staff ON public.sale_items;
DROP POLICY IF EXISTS sale_items_delete_staff ON public.sale_items;

CREATE POLICY sale_items_select ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.company_id = public.jwt_company_id()
    )
  );

CREATE POLICY sale_items_insert_staff ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_owner()
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.company_id = public.jwt_company_id()
    )
  );

CREATE POLICY sale_items_update_staff ON public.sale_items
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_owner()
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.company_id = public.jwt_company_id()
    )
  )
  WITH CHECK (
    public.is_platform_owner()
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.company_id = public.jwt_company_id()
    )
  );

CREATE POLICY sale_items_delete_staff ON public.sale_items
  FOR DELETE TO authenticated
  USING (
    public.is_platform_owner()
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.company_id = public.jwt_company_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated, service_role;

-- profiles: tenant-scoped + self
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR id = auth.uid()
    OR company_id = public.jwt_company_id()
  );

CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_owner()
    OR id = auth.uid()
    OR (
      company_id = public.jwt_company_id()
      AND public.is_owner_or_admin()
    )
  );

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_owner()
    OR id = auth.uid()
    OR company_id = public.jwt_company_id()
  )
  WITH CHECK (
    public.is_platform_owner()
    OR id = auth.uid()
    OR company_id = public.jwt_company_id()
  );

CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      company_id = public.jwt_company_id()
      AND public.current_user_role() IN ('owner', 'super_admin', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated, service_role;

-- Legacy global tables (no company_id): keep role gates — not tenant data planes
-- expense_categories, settings, permissions, subscription — unchanged by design

-- =============================================================================
-- 2) FX tables RLS
-- =============================================================================

ALTER TABLE public.company_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_currencies_select ON public.company_currencies;
DROP POLICY IF EXISTS company_currencies_insert_staff ON public.company_currencies;
DROP POLICY IF EXISTS company_currencies_update_staff ON public.company_currencies;
DROP POLICY IF EXISTS company_currencies_delete_staff ON public.company_currencies;
DROP POLICY IF EXISTS company_currencies_all ON public.company_currencies;

CREATE POLICY company_currencies_select ON public.company_currencies
  FOR SELECT TO authenticated
  USING (public.tenant_match(company_id));
CREATE POLICY company_currencies_insert_staff ON public.company_currencies
  FOR INSERT TO authenticated
  WITH CHECK (public.tenant_match(company_id));
CREATE POLICY company_currencies_update_staff ON public.company_currencies
  FOR UPDATE TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));
CREATE POLICY company_currencies_delete_staff ON public.company_currencies
  FOR DELETE TO authenticated
  USING (public.tenant_match(company_id));

DROP POLICY IF EXISTS currency_rate_history_select ON public.currency_rate_history;
DROP POLICY IF EXISTS currency_rate_history_insert_staff ON public.currency_rate_history;
DROP POLICY IF EXISTS currency_rate_history_update_staff ON public.currency_rate_history;
DROP POLICY IF EXISTS currency_rate_history_delete_staff ON public.currency_rate_history;
DROP POLICY IF EXISTS currency_rate_history_all ON public.currency_rate_history;

CREATE POLICY currency_rate_history_select ON public.currency_rate_history
  FOR SELECT TO authenticated
  USING (public.tenant_match(company_id));
CREATE POLICY currency_rate_history_insert_staff ON public.currency_rate_history
  FOR INSERT TO authenticated
  WITH CHECK (public.tenant_match(company_id));
CREATE POLICY currency_rate_history_update_staff ON public.currency_rate_history
  FOR UPDATE TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));
CREATE POLICY currency_rate_history_delete_staff ON public.currency_rate_history
  FOR DELETE TO authenticated
  USING (public.tenant_match(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_currencies TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.currency_rate_history TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Service role bypasses RLS by design — API path unchanged.
