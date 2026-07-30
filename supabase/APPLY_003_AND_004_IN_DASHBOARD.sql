-- Public invoice verification registry (QR landing page).
-- Only rows stored here can be verified; fake IDs return not found.

CREATE TABLE IF NOT EXISTS public.invoice_verifications (
  id              bigserial PRIMARY KEY,
  receipt_no      text NOT NULL UNIQUE,
  invoice_id      text NOT NULL,
  company_name    text NOT NULL DEFAULT '',
  branch_name     text NOT NULL DEFAULT '',
  customer_name   text NOT NULL DEFAULT 'Walk-in',
  payment_method  text NOT NULL DEFAULT '',
  currency_code   text NOT NULL DEFAULT 'KES',
  currency_symbol text NOT NULL DEFAULT '',
  total           numeric(12,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'Valid'
                  CHECK (status IN ('Valid', 'Cancelled', 'Refunded')),
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  sale_date       timestamptz NOT NULL DEFAULT now(),
  company_id      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_verifications_invoice_id_idx
  ON public.invoice_verifications (invoice_id);

ALTER TABLE public.invoice_verifications ENABLE ROW LEVEL SECURITY;

-- Public read of verification rows only (no write for anon).
DROP POLICY IF EXISTS invoice_verifications_public_select ON public.invoice_verifications;
CREATE POLICY invoice_verifications_public_select
  ON public.invoice_verifications
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Ensure API roles can use the table once created
GRANT SELECT ON public.invoice_verifications TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_verifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_verifications_id_seq TO service_role;

-- NOTE: Until this migration is applied in the Supabase SQL Editor, production
-- /api/invoice-public falls back to a private Storage bucket `invoice_verifications`.
-- Nexora POS Enterprise â€” multi-tenant production data plane
-- Adds companies, company_id scoping, catalog extras, and sale RPC.
-- Safe to re-run (IF NOT EXISTS / additive alters).

-- ---------------------------------------------------------------------------
-- Companies + subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.companies (
  id              BIGSERIAL PRIMARY KEY,
  name            text NOT NULL,
  code            text NOT NULL UNIQUE,
  business_type   text NOT NULL DEFAULT 'Retail',
  country         text NOT NULL DEFAULT 'International',
  currency        text NOT NULL DEFAULT 'KES',
  email           text,
  phone           text,
  address         text,
  logo            text,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'pending_verification', 'suspended', 'cancelled')),
  owner_user_id   uuid,
  plan_code       text NOT NULL DEFAULT 'enterprise',
  trial_ends_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_subscriptions (
  id              BIGSERIAL PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_code       text NOT NULL DEFAULT 'enterprise',
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'inactive')),
  starts_at       timestamptz NOT NULL DEFAULT now(),
  trial_ends_at   timestamptz,
  expires_at      timestamptz,
  limits          jsonb NOT NULL DEFAULT '{"users":100,"branches":10}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE TABLE IF NOT EXISTS public.company_settings (
  company_id      bigint PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  permission_matrix jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brands (
  id          BIGSERIAL PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.units (
  id            BIGSERIAL PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  abbreviation  text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.warehouses (
  id          BIGSERIAL PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id   bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  name        text NOT NULL,
  code        text,
  address     text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id            BIGSERIAL PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id    bigint REFERENCES public.products(id) ON DELETE SET NULL,
  warehouse_id  bigint REFERENCES public.warehouses(id) ON DELETE SET NULL,
  type          text NOT NULL,
  qty           integer NOT NULL DEFAULT 0,
  note          text,
  user_id       uuid,
  user_name     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Additive columns on existing tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS image_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon text DEFAULT 'layers',
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS image_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand_id bigint REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_id bigint REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS track_batches boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_expiry_days integer;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS receipt_no text,
  ADD COLUMN IF NOT EXISTS client_reference text,
  ADD COLUMN IF NOT EXISTS cashier_name text,
  ADD COLUMN IF NOT EXISTS cashier_username text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS currency_code text DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS currency_symbol text DEFAULT 'Ksh',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'Valid',
  ADD COLUMN IF NOT EXISTS cash_tendered numeric(12,2),
  ADD COLUMN IF NOT EXISTS change_due numeric(12,2),
  ADD COLUMN IF NOT EXISTS card_brand text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS split_payments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS items_json jsonb DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS sales_company_client_reference_uidx
  ON public.sales (company_id, client_reference)
  WHERE client_reference IS NOT NULL AND client_reference <> '';

CREATE UNIQUE INDEX IF NOT EXISTS sales_receipt_no_uidx
  ON public.sales (receipt_no)
  WHERE receipt_no IS NOT NULL AND receipt_no <> '';

ALTER TABLE public.held_sales
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS items_json jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

-- Expand profiles.role for app RBAC (drop narrow check if present)
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS profile_photo text DEFAULT '';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN (
    'platform_owner','owner','super_admin','admin','branch_manager',
    'sales_manager','inventory_manager','accountant','sales','cashier'
  ));

-- ---------------------------------------------------------------------------
-- Seed default company + attach orphaned rows
-- ---------------------------------------------------------------------------

INSERT INTO public.companies (id, name, code, currency, status, plan_code, email)
VALUES (1, 'Nexora POS Enterprise', 'NEXORA001', 'KES', 'active', 'enterprise', 'support@httpsnexorapos.com')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.companies', 'id'), GREATEST((SELECT MAX(id) FROM public.companies), 1));

INSERT INTO public.company_subscriptions (company_id, plan_code, status, limits)
VALUES (1, 'enterprise', 'active', '{"users":100,"branches":10}'::jsonb)
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO public.company_settings (company_id, settings)
VALUES (
  1,
  jsonb_build_object(
    'store_name', 'Nexora POS Enterprise',
    'store_phone', '+254 700 555 123',
    'store_address', 'Waiyaki Way, Nairobi',
    'currency', 'KES',
    'currency_symbol', 'Ksh',
    'vat_rate', '16',
    'payment_cash', 'true',
    'payment_card', 'true',
    'payment_mobile', 'true',
    'payment_mpesa', 'true',
    'default_branch_id', '1'
  )
)
ON CONFLICT (company_id) DO NOTHING;

UPDATE public.branches SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.categories SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.products SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.customers SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.suppliers SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.sales SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.held_sales SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.purchases SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.expenses SET company_id = 1 WHERE company_id IS NULL;
UPDATE public.stock_transfers SET company_id = 1 WHERE company_id IS NULL;

INSERT INTO public.brands (company_id, name) VALUES (1, 'Generic')
ON CONFLICT (company_id, name) DO NOTHING;
INSERT INTO public.units (company_id, name, abbreviation) VALUES
  (1, 'Piece', 'pcs'), (1, 'Kilogram', 'kg'), (1, 'Litre', 'L')
ON CONFLICT (company_id, name) DO NOTHING;
INSERT INTO public.warehouses (company_id, branch_id, name, code)
SELECT 1, b.id, b.name || ' Store', b.code
FROM public.branches b
WHERE b.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.warehouses w WHERE w.company_id = 1 AND w.branch_id = b.id
  );

-- ---------------------------------------------------------------------------
-- Helpers: JWT app_metadata claims
-- ---------------------------------------------------------------------------

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

CREATE OR REPLACE FUNCTION public.is_company_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner()
    OR (
      public.jwt_company_id() IS NOT NULL
      AND public.jwt_role() IN (
        'owner','super_admin','admin','branch_manager','sales_manager',
        'inventory_manager','accountant','sales','cashier'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_company_manager()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_platform_owner()
    OR public.jwt_role() IN ('owner','super_admin','admin','branch_manager');
$$;

-- Back-compat aliases used by 001 policies
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_company_staff();
$$;

CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner()
    OR public.jwt_role() IN ('owner','super_admin','admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND active = true
        AND role IN ('owner','super_admin','admin')
    );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(public.jwt_role(), ''),
    (SELECT role FROM public.profiles WHERE id = auth.uid() AND active = true LIMIT 1),
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- Atomic POS sale
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pos_create_sale(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id bigint := COALESCE((payload->>'company_id')::bigint, public.jwt_company_id());
  v_user_id uuid := COALESCE((payload->>'user_id')::uuid, auth.uid());
  v_branch_id bigint := NULLIF(payload->>'branch_id','')::bigint;
  v_client_ref text := NULLIF(trim(payload->>'client_reference'), '');
  v_existing public.sales%ROWTYPE;
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_qty integer;
  v_sale_id bigint;
  v_receipt text;
  v_total numeric(12,2);
  v_created timestamptz := now();
  v_items jsonb := COALESCE(payload->'items', '[]'::jsonb);
BEGIN
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'sale requires items' USING ERRCODE = '22023';
  END IF;

  IF v_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.sales
    WHERE company_id = v_company_id AND client_reference = v_client_ref
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'id', v_existing.id,
        'invoice_no', v_existing.invoice_no,
        'receipt_no', COALESCE(v_existing.receipt_no, v_existing.invoice_no),
        'duplicate', true,
        'sale', to_jsonb(v_existing)
      );
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := COALESCE((v_item->>'qty')::integer, 0);
    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item->>'product_id')::bigint
      AND company_id = v_company_id
    FOR UPDATE;
    IF NOT FOUND OR v_qty <= 0 OR v_product.stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for %', COALESCE(v_item->>'name', 'item')
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_total := COALESCE((payload->>'total')::numeric, 0);

  INSERT INTO public.sales (
    invoice_no, receipt_no, client_reference, customer_id, user_id,
    subtotal, discount, vat, total, payment_method, branch_id, company_id,
    cashier_name, cashier_username, branch_name, currency_code, currency_symbol,
    status, cash_tendered, change_due, card_brand, payment_reference,
    split_payments, vat_rate, vat_enabled, items_json, created_at
  ) VALUES (
    'PENDING', 'PENDING', v_client_ref,
    NULLIF(payload->>'customer_id','')::bigint,
    v_user_id,
    COALESCE((payload->>'subtotal')::numeric, 0),
    COALESCE((payload->>'discount')::numeric, 0),
    COALESCE((payload->>'vat')::numeric, 0),
    v_total,
    COALESCE(payload->>'payment_method', 'CASH'),
    v_branch_id,
    v_company_id,
    payload->>'cashier_name',
    payload->>'cashier_username',
    payload->>'branch_name',
    COALESCE(payload->>'currency_code', 'KES'),
    COALESCE(payload->>'currency_symbol', 'Ksh'),
    COALESCE(payload->>'status', 'Valid'),
    NULLIF(payload->>'cash_tendered','')::numeric,
    NULLIF(payload->>'change_due','')::numeric,
    payload->>'card_brand',
    payload->>'payment_reference',
    COALESCE(payload->'split_payments', '[]'::jsonb),
    COALESCE((payload->>'vat_rate')::numeric, 0),
    COALESCE((payload->>'vat_enabled')::boolean, false),
    v_items,
    v_created
  )
  RETURNING id INTO v_sale_id;

  v_receipt := 'NX-' || to_char(v_created, 'YYYY') || '-' || lpad(v_sale_id::text, 7, '0');
  UPDATE public.sales
  SET invoice_no = v_receipt, receipt_no = v_receipt
  WHERE id = v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;
    UPDATE public.products
    SET stock = stock - v_qty
    WHERE id = (v_item->>'product_id')::bigint
      AND company_id = v_company_id;

    INSERT INTO public.sale_items (sale_id, product_id, name, qty, price, cost)
    VALUES (
      v_sale_id,
      (v_item->>'product_id')::bigint,
      v_item->>'name',
      v_qty,
      COALESCE((v_item->>'price')::numeric, 0),
      COALESCE((v_item->>'cost')::numeric, 0)
    );

    INSERT INTO public.stock_movements (company_id, product_id, type, qty, note, user_id, user_name)
    VALUES (
      v_company_id,
      (v_item->>'product_id')::bigint,
      'out',
      v_qty,
      'POS sale ' || v_receipt,
      v_user_id,
      payload->>'cashier_name'
    );
  END LOOP;

  IF NULLIF(payload->>'customer_id','') IS NOT NULL THEN
    UPDATE public.customers
    SET
      points = points + floor(v_total / 100),
      visits = visits + 1,
      spent = spent + v_total,
      balance = CASE
        WHEN upper(COALESCE(payload->>'payment_method','')) = 'CREDIT'
        THEN balance + v_total ELSE balance END
    WHERE id = (payload->>'customer_id')::bigint
      AND company_id = v_company_id;
  END IF;

  INSERT INTO public.audit_log (user_id, user_name, action, module, details, company_id)
  VALUES (
    v_user_id,
    payload->>'cashier_name',
    'create_sale',
    'sales',
    jsonb_build_object('invoice_no', v_receipt, 'total', v_total)::text,
    v_company_id
  );

  RETURN (
    SELECT jsonb_build_object(
      'success', true,
      'id', s.id,
      'invoice_no', s.invoice_no,
      'receipt_no', s.receipt_no,
      'sale', to_jsonb(s) || jsonb_build_object('items', s.items_json)
    )
    FROM public.sales s WHERE s.id = v_sale_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_create_sale(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_create_sale(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS enable new tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select ON public.companies;
CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated
  USING (public.is_platform_owner() OR id = public.jwt_company_id());

DROP POLICY IF EXISTS companies_write ON public.companies;
CREATE POLICY companies_write ON public.companies FOR ALL TO authenticated
  USING (public.is_platform_owner() OR (id = public.jwt_company_id() AND public.is_company_manager()))
  WITH CHECK (public.is_platform_owner() OR (id = public.jwt_company_id() AND public.is_company_manager()));

DROP POLICY IF EXISTS company_subscriptions_all ON public.company_subscriptions;
CREATE POLICY company_subscriptions_all ON public.company_subscriptions FOR ALL TO authenticated
  USING (public.is_platform_owner() OR company_id = public.jwt_company_id())
  WITH CHECK (public.is_platform_owner() OR company_id = public.jwt_company_id());

DROP POLICY IF EXISTS company_settings_all ON public.company_settings;
CREATE POLICY company_settings_all ON public.company_settings FOR ALL TO authenticated
  USING (public.is_platform_owner() OR company_id = public.jwt_company_id())
  WITH CHECK (public.is_platform_owner() OR company_id = public.jwt_company_id());

DROP POLICY IF EXISTS brands_all ON public.brands;
CREATE POLICY brands_all ON public.brands FOR ALL TO authenticated
  USING (public.is_platform_owner() OR company_id = public.jwt_company_id())
  WITH CHECK (public.is_platform_owner() OR company_id = public.jwt_company_id());

DROP POLICY IF EXISTS units_all ON public.units;
CREATE POLICY units_all ON public.units FOR ALL TO authenticated
  USING (public.is_platform_owner() OR company_id = public.jwt_company_id())
  WITH CHECK (public.is_platform_owner() OR company_id = public.jwt_company_id());

DROP POLICY IF EXISTS warehouses_all ON public.warehouses;
CREATE POLICY warehouses_all ON public.warehouses FOR ALL TO authenticated
  USING (public.is_platform_owner() OR company_id = public.jwt_company_id())
  WITH CHECK (public.is_platform_owner() OR company_id = public.jwt_company_id());

DROP POLICY IF EXISTS stock_movements_all ON public.stock_movements;
CREATE POLICY stock_movements_all ON public.stock_movements FOR ALL TO authenticated
  USING (public.is_platform_owner() OR company_id = public.jwt_company_id())
  WITH CHECK (public.is_platform_owner() OR company_id = public.jwt_company_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_subscriptions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_settings TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.units TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
