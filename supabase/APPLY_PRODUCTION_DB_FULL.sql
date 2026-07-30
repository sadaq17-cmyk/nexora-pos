-- Nexora POS Enterprise — FULL production database bootstrap
-- Safe to re-run. Paste into Supabase SQL Editor if CLI/Management API apply is unavailable.
-- Project ref: ohrpezhlnjwiilojdqbo
-- Covers: 001 core tables + helpers, 003 invoice_verifications, 004 multi-tenant plane, 005 patches.
-- Generated: 2026-07-20T12:22:12.513Z


-- ===== 001 CORE (tables + helpers + enable RLS) =====
-- Nexora POS Enterprise — initial schema, RLS, helpers, and seed data
-- Prefer BIGSERIAL/INTEGER ids to minimize UI breakage (profiles use auth UUID).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.branches (
  id          BIGSERIAL PRIMARY KEY,
  name        text NOT NULL,
  code        text NOT NULL UNIQUE,
  address     text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  role        text NOT NULL CHECK (role IN (
    'platform_owner','owner','super_admin','admin','branch_manager',
    'sales_manager','inventory_manager','accountant','sales','cashier'
  )),
  active      boolean NOT NULL DEFAULT true,
  branch_id   bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id          BIGSERIAL PRIMARY KEY,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#2563EB',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id            BIGSERIAL PRIMARY KEY,
  name          text NOT NULL,
  barcode       text,
  category_id   bigint REFERENCES public.categories(id) ON DELETE SET NULL,
  price         numeric(12,2) NOT NULL DEFAULT 0,
  cost          numeric(12,2) NOT NULL DEFAULT 0,
  stock         integer NOT NULL DEFAULT 0,
  reorder_level integer NOT NULL DEFAULT 0,
  unit          text NOT NULL DEFAULT 'pcs',
  active        boolean NOT NULL DEFAULT true,
  branch_id     bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_barcode_idx ON public.products (barcode);
CREATE INDEX IF NOT EXISTS products_branch_idx ON public.products (branch_id);

CREATE TABLE IF NOT EXISTS public.customers (
  id            BIGSERIAL PRIMARY KEY,
  name          text NOT NULL,
  phone         text,
  email         text,
  points        integer NOT NULL DEFAULT 0,
  visits        integer NOT NULL DEFAULT 0,
  spent         numeric(12,2) NOT NULL DEFAULT 0,
  credit_limit  numeric(12,2) NOT NULL DEFAULT 0,
  balance       numeric(12,2) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_payments (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount        numeric(12,2) NOT NULL,
  method        text NOT NULL DEFAULT 'Cash',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id              BIGSERIAL PRIMARY KEY,
  name            text NOT NULL,
  contact_person  text,
  phone           text,
  category        text,
  status          text NOT NULL DEFAULT 'Active',
  order_count     integer NOT NULL DEFAULT 0,
  total_ordered   numeric(12,2) NOT NULL DEFAULT 0,
  balance         numeric(12,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id            BIGSERIAL PRIMARY KEY,
  supplier_id   bigint NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  amount        numeric(12,2) NOT NULL,
  method        text NOT NULL DEFAULT 'Cash',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales (
  id              BIGSERIAL PRIMARY KEY,
  invoice_no      text NOT NULL UNIQUE,
  customer_id     bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  subtotal        numeric(12,2) NOT NULL DEFAULT 0,
  discount        numeric(12,2) NOT NULL DEFAULT 0,
  vat             numeric(12,2) NOT NULL DEFAULT 0,
  total           numeric(12,2) NOT NULL DEFAULT 0,
  payment_method  text NOT NULL DEFAULT 'Cash',
  branch_id       bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  returned        numeric(12,2) NOT NULL DEFAULT 0,
  return_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_created_at_idx ON public.sales (created_at DESC);

CREATE TABLE IF NOT EXISTS public.sale_items (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     bigint NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id  bigint REFERENCES public.products(id) ON DELETE SET NULL,
  name        text,
  qty         integer NOT NULL DEFAULT 1,
  price       numeric(12,2) NOT NULL DEFAULT 0,
  cost        numeric(12,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.held_sales (
  id          BIGSERIAL PRIMARY KEY,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  held_at     timestamptz NOT NULL DEFAULT now(),
  user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  branch_id   bigint REFERENCES public.branches(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.purchases (
  id            BIGSERIAL PRIMARY KEY,
  po_number     text NOT NULL UNIQUE,
  supplier_id   bigint REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_no    text,
  total         numeric(12,2) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'Pending',
  item_count    integer NOT NULL DEFAULT 0,
  branch_id     bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id            BIGSERIAL PRIMARY KEY,
  purchase_id   bigint NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id    bigint REFERENCES public.products(id) ON DELETE SET NULL,
  qty           integer NOT NULL DEFAULT 1,
  cost          numeric(12,2) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id            BIGSERIAL PRIMARY KEY,
  purchase_id   bigint REFERENCES public.purchases(id) ON DELETE SET NULL,
  product_id    bigint REFERENCES public.products(id) ON DELETE SET NULL,
  qty           integer NOT NULL DEFAULT 1,
  cost          numeric(12,2) NOT NULL DEFAULT 0,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id          BIGSERIAL PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id              BIGSERIAL PRIMARY KEY,
  name            text NOT NULL,
  category        text NOT NULL,
  expense_date    date NOT NULL DEFAULT CURRENT_DATE,
  amount          numeric(12,2) NOT NULL DEFAULT 0,
  receipt_path    text,
  branch_id       bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id                BIGSERIAL PRIMARY KEY,
  product_id        bigint REFERENCES public.products(id) ON DELETE SET NULL,
  from_branch_id    bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  to_branch_id      bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  qty               integer NOT NULL DEFAULT 0,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settings (
  key   text PRIMARY KEY,
  value text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id        BIGSERIAL PRIMARY KEY,
  role      text NOT NULL CHECK (role IN ('owner', 'admin', 'cashier')),
  module    text NOT NULL,
  action    text NOT NULL,
  allowed   boolean NOT NULL DEFAULT false,
  UNIQUE (role, module, action)
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     uuid,
  user_name   text,
  action      text NOT NULL,
  module      text NOT NULL,
  details     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  plan                text NOT NULL DEFAULT 'Enterprise',
  status              text NOT NULL DEFAULT 'active',
  billing_cycle       text NOT NULL DEFAULT 'monthly',
  renews_at           date,
  branches_allowed    integer NOT NULL DEFAULT 10,
  users_allowed       integer NOT NULL DEFAULT 100,
  currencies_allowed  jsonb NOT NULL DEFAULT '["KES","USD","EUR"]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Helpers (after tables so SQL bodies resolve)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND active = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = true
      AND role IN ('owner', 'admin', 'cashier')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() IN ('owner', 'admin');
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.held_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription ENABLE ROW LEVEL SECURITY;

-- ===== 003 INVOICE VERIFICATIONS =====
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

-- ===== 004 PRODUCTION DATA PLANE =====
-- Nexora POS Enterprise — multi-tenant production data plane
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

-- ===========================================================================
-- 006 remove demo products + 007 purchase workflow fields
-- ===========================================================================
-- Deactivate legacy demo/seed catalog products in production databases.
-- Rows are retained when referenced by historical sales/purchases; the API
-- also excludes these barcodes/names from products.getAll / getByBarcode.

UPDATE public.products
SET active = false
WHERE barcode IN (
  '8901030001', '8901030002', '8901030003', '8901030004', '8901030005', '8901030006',
  '8901030001001', '8901030002008', '8901030003005', '8901030004002'
)
OR (
  name IN ('Sugar 2kg', 'Rice 5kg', 'Cooking Oil 2L', 'Milk 500ml', 'Bread 400g', 'Soft Drinks 500ml')
  AND (
    barcode IS NULL
    OR barcode IN (
      '8901030001', '8901030002', '8901030003', '8901030004', '8901030005', '8901030006',
      '8901030001001', '8901030002008', '8901030003005', '8901030004002'
    )
  )
);


-- Purchase workflow fields (Odoo/ERPNext-style supplier + product create-from-PO)
-- Safe to re-run: all changes use IF NOT EXISTS.

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(8,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS products_sku_idx ON public.products (sku);

COMMENT ON COLUMN public.suppliers.tax_number IS 'Supplier VAT / tax registration number';
COMMENT ON COLUMN public.suppliers.notes IS 'Internal notes; categories belong to products, not suppliers';
COMMENT ON COLUMN public.products.sku IS 'Stock-keeping unit; auto-generated when blank on create';
COMMENT ON COLUMN public.products.tax_rate IS 'Default tax percent for the product';


-- Enterprise Purchase & Supplier Accounting
-- - Supplier opening debit/credit + outstanding formula
-- - Purchase statuses include Approved
-- - Ledger only books Approved/Received (not Draft/Pending)
-- - Atomic approve RPC: invoice + stock + avg cost + AP + movements in one transaction

-- ---------------------------------------------------------------------------
-- 1. Supplier opening debit / credit
-- ---------------------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS opening_debit numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric(12,2) NOT NULL DEFAULT 0;

UPDATE public.suppliers
SET opening_debit = COALESCE(opening_balance, 0)
WHERE COALESCE(opening_debit, 0) = 0
  AND COALESCE(opening_balance, 0) <> 0;

COMMENT ON COLUMN public.suppliers.opening_debit IS
  'Opening AP debit (amount owed to supplier at onboarding)';
COMMENT ON COLUMN public.suppliers.opening_credit IS
  'Opening AP credit (prepayment / credit with supplier at onboarding)';

-- Outstanding = Opening Debit - Opening Credit + Purchases - Payments - Credit Notes
-- (ledger debit/credit rows already encode purchases vs payments/returns)

-- ---------------------------------------------------------------------------
-- 2. Purchase status: add Approved; track inventory posting
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS inventory_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accounting_posted_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN (
    'Draft', 'Pending', 'Ordered', 'Approved',
    'PartiallyReceived', 'Received', 'Cancelled', 'Rejected'
  ));

-- Legacy "Ordered" rows are treated as Approved for AP/stock purposes.
UPDATE public.purchases
SET status = 'Approved'
WHERE status = 'Ordered';

-- ---------------------------------------------------------------------------
-- 3. Ledger view: only Approved / Received / PartiallyReceived book AP
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.supplier_ledger_v AS
SELECT
  s.company_id,
  s.id AS supplier_id,
  s.code AS supplier_code,
  s.name AS supplier_name,
  e.entry_date,
  e.entry_type,
  e.reference,
  e.description,
  e.debit,
  e.credit,
  e.source_table,
  e.source_id,
  e.branch_id
FROM public.suppliers s
JOIN LATERAL (
  SELECT
    COALESCE(p.approved_at, p.ordered_at, p.created_at) AS entry_date,
    'purchase'::text AS entry_type,
    COALESCE(p.invoice_no, p.po_number, '#' || p.id::text) AS reference,
    ('Purchase ' || COALESCE(p.po_number, '#' || p.id::text) || ' (' || p.status || ')') AS description,
    COALESCE(p.total, 0)::numeric(12,2) AS debit,
    0::numeric(12,2) AS credit,
    p.branch_id,
    'purchases'::text AS source_table,
    p.id AS source_id
  FROM public.purchases p
  WHERE p.supplier_id = s.id
    AND p.status IN ('Approved', 'Ordered', 'Received', 'PartiallyReceived')

  UNION ALL

  SELECT
    sp.created_at,
    'payment'::text,
    COALESCE(sp.reference, sp.method, 'Payment'),
    ('Payment via ' || COALESCE(sp.method, 'Cash')),
    0::numeric(12,2),
    COALESCE(sp.amount, 0)::numeric(12,2),
    sp.branch_id,
    'supplier_payments'::text,
    sp.id
  FROM public.supplier_payments sp
  WHERE sp.supplier_id = s.id

  UNION ALL

  SELECT
    pp.created_at,
    'payment'::text,
    COALESCE(pp.reference, pp.method, 'PO payment'),
    ('PO payment via ' || COALESCE(pp.method, 'Cash')),
    0::numeric(12,2),
    COALESCE(pp.amount, 0)::numeric(12,2),
    pp.branch_id,
    'purchase_payments'::text,
    pp.id
  FROM public.purchase_payments pp
  WHERE pp.supplier_id = s.id

  UNION ALL

  SELECT
    pr.created_at,
    'purchase_return'::text,
    COALESCE(p2.po_number, p2.invoice_no, '#' || pr.purchase_id::text),
    ('Purchase return / credit note' || CASE WHEN pr.reason IS NOT NULL AND btrim(pr.reason) <> '' THEN ' â€” ' || pr.reason ELSE '' END),
    0::numeric(12,2),
    (COALESCE(pr.qty, 0) * COALESCE(pr.cost, 0))::numeric(12,2),
    COALESCE(pr.branch_id, p2.branch_id),
    'purchase_returns'::text,
    pr.id
  FROM public.purchase_returns pr
  JOIN public.purchases p2 ON p2.id = pr.purchase_id
  WHERE COALESCE(pr.supplier_id, p2.supplier_id) = s.id

  UNION ALL

  SELECT
    la.created_at,
    la.entry_type,
    la.reference,
    la.description,
    la.debit,
    la.credit,
    la.branch_id,
    'supplier_ledger_adjustments'::text,
    la.id
  FROM public.supplier_ledger_adjustments la
  WHERE la.supplier_id = s.id
) e ON true;

COMMENT ON VIEW public.supplier_ledger_v IS
  'AP subledger: purchases book only after Approval (Approved/Received). Payments and credit notes credit AP.';

GRANT SELECT ON public.supplier_ledger_v TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Atomic approve: invoice + stock + avg cost + supplier AP + movements
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_approve_purchase(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_id bigint := NULLIF(payload->>'purchase_id','')::bigint;
  v_company_id bigint := COALESCE((payload->>'company_id')::bigint, public.jwt_company_id());
  v_user_id uuid := NULLIF(payload->>'user_id','')::uuid;
  v_user_name text := COALESCE(payload->>'user_name', '');
  v_warehouse_id bigint := NULLIF(payload->>'warehouse_id','')::bigint;
  v_po public.purchases%ROWTYPE;
  v_item record;
  v_product public.products%ROWTYPE;
  v_qty numeric(12,3);
  v_unit_cost numeric(12,2);
  v_prev_stock numeric(12,3);
  v_prev_avg numeric(12,2);
  v_next_stock numeric(12,3);
  v_next_avg numeric(12,2);
  v_stocked_value numeric(12,2) := 0;
  v_stocked_qty numeric(12,3) := 0;
  v_invoice text;
  v_opening_debit numeric(12,2);
  v_opening_credit numeric(12,2);
  v_debit_sum numeric(12,2);
  v_credit_sum numeric(12,2);
  v_purchase_total numeric(12,2);
  v_paid_total numeric(12,2);
  v_order_count integer;
BEGIN
  IF v_purchase_id IS NULL THEN
    RAISE EXCEPTION 'purchase_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_po
  FROM public.purchases
  WHERE id = v_purchase_id
    AND (v_company_id IS NULL OR company_id = v_company_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_po.status IN ('Approved', 'Received', 'PartiallyReceived') THEN
    RETURN jsonb_build_object('success', true, 'id', v_po.id, 'status', v_po.status, 'already_approved', true);
  END IF;

  IF v_po.status IN ('Cancelled', 'Rejected') THEN
    RAISE EXCEPTION 'Cancelled or rejected purchases cannot be approved' USING ERRCODE = '22023';
  END IF;

  IF v_po.status NOT IN ('Draft', 'Pending', 'Ordered') THEN
    RAISE EXCEPTION 'Purchase status % cannot be approved', v_po.status USING ERRCODE = '22023';
  END IF;

  v_invoice := COALESCE(NULLIF(btrim(v_po.invoice_no), ''), v_po.po_number, 'PI-' || v_po.id::text);

  -- Mark approved + purchase invoice identity first (still inside transaction).
  UPDATE public.purchases
  SET
    status = 'Approved',
    invoice_no = v_invoice,
    approved_at = COALESCE(approved_at, now()),
    approved_by = COALESCE(approved_by, v_user_id),
    ordered_at = COALESCE(ordered_at, now()),
    warehouse_id = COALESCE(v_warehouse_id, warehouse_id),
    accounting_posted_at = COALESCE(accounting_posted_at, now()),
    inventory_posted_at = COALESCE(inventory_posted_at, now()),
    received_at = COALESCE(received_at, now()),
    updated_at = now()
  WHERE id = v_po.id;

  -- Apply full ordered qty to inventory / costing when not yet posted.
  IF v_po.inventory_posted_at IS NULL THEN
    FOR v_item IN
      SELECT
        COALESCE(pi.product_id, (ji->>'product_id')::bigint) AS product_id,
        COALESCE(pi.qty_ordered, pi.qty, (ji->>'qty_ordered')::numeric, (ji->>'qty')::numeric, 0) AS qty_ordered,
        COALESCE(pi.qty_received, (ji->>'qty_received')::numeric, 0) AS qty_received,
        COALESCE(pi.cost, (ji->>'cost')::numeric, 0) AS cost,
        COALESCE(pi.batch_no, ji->>'batch_no') AS batch_no,
        COALESCE(pi.expiry_date::text, ji->>'expiry_date') AS expiry_date,
        COALESCE(pi.mfg_date::text, ji->>'mfg_date') AS mfg_date,
        COALESCE(pi.id, NULL) AS line_id
      FROM public.purchases p
      LEFT JOIN public.purchase_items pi ON pi.purchase_id = p.id
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(p.items_json, '[]'::jsonb)) AS ji ON pi.id IS NULL
      WHERE p.id = v_po.id
        AND COALESCE(pi.product_id, (ji->>'product_id')::bigint) IS NOT NULL
    LOOP
      v_qty := GREATEST(0, COALESCE(v_item.qty_ordered, 0) - COALESCE(v_item.qty_received, 0));
      IF v_qty <= 0 THEN
        CONTINUE;
      END IF;
      v_unit_cost := COALESCE(v_item.cost, 0);

      SELECT * INTO v_product
      FROM public.products
      WHERE id = v_item.product_id
        AND (v_company_id IS NULL OR company_id = v_company_id)
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found for purchase line', v_item.product_id USING ERRCODE = 'P0002';
      END IF;

      v_prev_stock := COALESCE(v_product.stock, 0);
      v_prev_avg := COALESCE(v_product.avg_cost, v_product.cost, v_unit_cost);
      v_next_stock := v_prev_stock + v_qty;
      IF v_prev_stock <= 0 THEN
        v_next_avg := v_unit_cost;
      ELSE
        v_next_avg := (v_prev_stock * v_prev_avg + v_qty * v_unit_cost) / NULLIF(v_next_stock, 0);
      END IF;

      UPDATE public.products
      SET
        stock = v_next_stock,
        cost = v_unit_cost,
        last_cost = v_unit_cost,
        avg_cost = v_next_avg
      WHERE id = v_product.id;

      IF v_item.line_id IS NOT NULL THEN
        UPDATE public.purchase_items
        SET qty_received = COALESCE(qty_ordered, qty, v_qty)
        WHERE id = v_item.line_id;
      END IF;

      INSERT INTO public.stock_movements (
        company_id, product_id, type, qty, note, user_id, user_name, created_at
      ) VALUES (
        v_po.company_id,
        v_product.id,
        'in',
        v_qty,
        'Purchase approve ' || COALESCE(v_po.po_number, v_po.id::text),
        v_user_id,
        v_user_name,
        now()
      );

      v_stocked_qty := v_stocked_qty + v_qty;
      v_stocked_value := v_stocked_value + (v_qty * v_unit_cost);
    END LOOP;

    -- Keep items_json qty_received in sync when present.
    UPDATE public.purchases p
    SET items_json = COALESCE((
      SELECT jsonb_agg(
        jsonb_set(
          COALESCE(elem, '{}'::jsonb),
          '{qty_received}',
          to_jsonb(COALESCE((elem->>'qty_ordered')::numeric, (elem->>'qty')::numeric, 0))
        )
      )
      FROM jsonb_array_elements(COALESCE(p.items_json, '[]'::jsonb)) elem
    ), p.items_json)
    WHERE p.id = v_po.id
      AND p.items_json IS NOT NULL
      AND jsonb_typeof(p.items_json) = 'array';
  END IF;

  -- Recompute supplier AP from ledger + opening debit/credit.
  IF v_po.supplier_id IS NOT NULL THEN
    SELECT
      COALESCE(s.opening_debit, s.opening_balance, 0),
      COALESCE(s.opening_credit, 0)
    INTO v_opening_debit, v_opening_credit
    FROM public.suppliers s
    WHERE s.id = v_po.supplier_id
    FOR UPDATE;

    SELECT
      COALESCE(SUM(e.debit), 0),
      COALESCE(SUM(e.credit), 0),
      COALESCE(SUM(CASE WHEN e.entry_type = 'purchase' THEN e.debit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_type = 'payment' THEN e.credit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_type = 'purchase' THEN 1 ELSE 0 END), 0)
    INTO v_debit_sum, v_credit_sum, v_purchase_total, v_paid_total, v_order_count
    FROM public.supplier_ledger_v e
    WHERE e.supplier_id = v_po.supplier_id;

    UPDATE public.suppliers
    SET
      balance = (v_opening_debit - v_opening_credit) + v_debit_sum - v_credit_sum,
      total_ordered = v_purchase_total,
      total_paid = v_paid_total,
      order_count = v_order_count,
      last_purchase_at = now(),
      opening_balance = v_opening_debit - v_opening_credit
    WHERE id = v_po.supplier_id;
  END IF;

  -- Best-effort journal (non-fatal if table missing).
  BEGIN
    IF v_stocked_value > 0 THEN
      INSERT INTO public.journal_entries (company_id, account, debit, credit, ref_type, ref_id, memo, created_by)
      VALUES
        (v_po.company_id, 'Inventory', v_stocked_value, 0, 'purchase_approve', v_po.id, 'Approve ' || COALESCE(v_po.po_number, v_po.id::text), v_user_id),
        (v_po.company_id, 'Accounts Payable', 0, v_stocked_value, 'purchase_approve', v_po.id, 'Approve ' || COALESCE(v_po.po_number, v_po.id::text), v_user_id);
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  INSERT INTO public.audit_log (user_id, user_name, action, module, details, company_id)
  VALUES (
    v_user_id,
    v_user_name,
    'approve_purchase',
    'purchases',
    jsonb_build_object(
      'id', v_po.id,
      'po_number', v_po.po_number,
      'invoice_no', v_invoice,
      'qty', v_stocked_qty,
      'stock_value', v_stocked_value
    )::text,
    v_po.company_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_po.id,
    'status', 'Approved',
    'invoice_no', v_invoice,
    'qty_received', v_stocked_qty,
    'stock_value', v_stocked_value
  );
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_approve_purchase(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_approve_purchase(jsonb) TO authenticated, service_role;

