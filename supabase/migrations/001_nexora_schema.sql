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
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'cashier')),
  active      boolean NOT NULL DEFAULT true,
  branch_id   bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id          BIGSERIAL PRIMARY KEY,
  name        text NOT NULL UNIQUE,
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
  name        text NOT NULL UNIQUE,
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

-- Profiles: users can read staff profiles; update own row; owners/admins manage all
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_owner_or_admin() OR id = auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_owner_or_admin() OR id = auth.uid())
  WITH CHECK (public.is_owner_or_admin() OR id = auth.uid());
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');

-- Generic staff read for most tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','categories','products','customers','customer_payments',
    'suppliers','supplier_payments','sales','sale_items','held_sales',
    'purchases','purchase_items','purchase_returns','expense_categories',
    'expenses','stock_transfers','settings','permissions','audit_log','subscription'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff())',
      t || '_select', t
    );
  END LOOP;
END $$;

-- Owner/admin full write (except subscription delete restricted below)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','categories','products','customers','customer_payments',
    'suppliers','supplier_payments','sales','sale_items','held_sales',
    'purchases','purchase_items','purchase_returns','expense_categories',
    'expenses','stock_transfers','settings','permissions','audit_log'
  ]
  LOOP
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
  END LOOP;
END $$;

-- Cashier write: sales, sale_items, held_sales, customers, customer_payments, product stock adjust (update)
CREATE POLICY sales_insert_cashier ON public.sales FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'cashier');
CREATE POLICY sales_update_cashier ON public.sales FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'cashier')
  WITH CHECK (public.current_user_role() = 'cashier');

CREATE POLICY sale_items_insert_cashier ON public.sale_items FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'cashier');

CREATE POLICY held_sales_insert_cashier ON public.held_sales FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'cashier');
CREATE POLICY held_sales_delete_cashier ON public.held_sales FOR DELETE TO authenticated
  USING (public.current_user_role() = 'cashier');

CREATE POLICY customers_insert_cashier ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'cashier');
CREATE POLICY customers_update_cashier ON public.customers FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'cashier')
  WITH CHECK (public.current_user_role() = 'cashier');

CREATE POLICY customer_payments_insert_cashier ON public.customer_payments FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'cashier');

CREATE POLICY products_update_cashier ON public.products FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'cashier')
  WITH CHECK (public.current_user_role() = 'cashier');

CREATE POLICY audit_log_insert_cashier ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'cashier');

-- Subscription: owner/admin can insert/update; only owner can delete
CREATE POLICY subscription_insert ON public.subscription FOR INSERT TO authenticated
  WITH CHECK (public.is_owner_or_admin());
CREATE POLICY subscription_update ON public.subscription FOR UPDATE TO authenticated
  USING (public.is_owner_or_admin())
  WITH CHECK (public.is_owner_or_admin());
CREATE POLICY subscription_delete ON public.subscription FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Seed data (reference data — profiles seeded after auth users exist)
-- ---------------------------------------------------------------------------

INSERT INTO public.branches (id, name, code, address, active) VALUES
  (1, 'Westlands HQ', 'WES', 'Waiyaki Way, Nairobi', true),
  (2, 'CBD Branch', 'CBD', 'Moi Avenue, Nairobi', true)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.branches', 'id'), (SELECT MAX(id) FROM public.branches));

INSERT INTO public.categories (id, name, color) VALUES
  (1, 'Groceries', '#2563EB'),
  (2, 'Dairy', '#38BDF8'),
  (3, 'Bakery', '#F59E0B'),
  (4, 'Beverages', '#8B5CF6')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.categories', 'id'), (SELECT MAX(id) FROM public.categories));

-- Products are not seeded in production. Tenants create their own catalog.
-- Legacy demo barcodes (8901030001–8901030006 / Sugar, Rice, etc.) are filtered
-- by the API and removed by migration 006_remove_demo_products.sql.

INSERT INTO public.customers (id, name, phone, email, points, visits, spent, credit_limit, balance) VALUES
  (1, 'Ahmed Ali', '+254 712 345 678', 'ahmed.ali@email.com', 245, 18, 24500, 50000, 0),
  (2, 'Fatima Hassan', '+254 723 456 789', 'fatima.h@email.com', 182, 12, 18200, 20000, 0),
  (3, 'Mohamed Noor', '+254 733 567 890', 'm.noor@email.com', 317, 25, 31750, 0, 0)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.customers', 'id'), (SELECT MAX(id) FROM public.customers));

INSERT INTO public.suppliers (id, name, contact_person, phone, category, status, order_count, total_ordered, balance) VALUES
  (1, 'Coca-Cola Kenya', 'James Mwangi', '+254 700 111 222', 'Beverages', 'Active', 1, 62000, 0),
  (2, 'Brookside Dairy', 'Grace Wanjiru', '+254 700 222 333', 'Dairy', 'Active', 1, 18500, 0),
  (3, 'Bidco Africa', 'Peter Otieno', '+254 700 333 444', 'Groceries', 'Active', 1, 45000, 4400)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.suppliers', 'id'), (SELECT MAX(id) FROM public.suppliers));

INSERT INTO public.expense_categories (id, name) VALUES
  (1, 'Rent'), (2, 'Utilities'), (3, 'Payroll'), (4, 'Logistics'),
  (5, 'Maintenance'), (6, 'Marketing'), (7, 'Other')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.expense_categories', 'id'), (SELECT MAX(id) FROM public.expense_categories));

INSERT INTO public.expenses (id, name, category, expense_date, amount) VALUES
  (1, 'Shop Rent', 'Rent', '2026-07-01', 45000),
  (2, 'Electricity Bill', 'Utilities', '2026-07-03', 8200),
  (3, 'Staff Salaries', 'Payroll', '2026-07-05', 120000)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.expenses', 'id'), (SELECT MAX(id) FROM public.expenses));

INSERT INTO public.purchases (id, po_number, supplier_id, invoice_no, total, status, item_count, branch_id, created_at) VALUES
  (1, 'PO-1042', 3, 'INV-5521', 45000, 'Received', 3, 1, '2026-07-10'),
  (2, 'PO-1041', 2, NULL, 18500, 'Pending', 2, 1, '2026-07-09'),
  (3, 'PO-1040', 1, NULL, 62000, 'Ordered', 5, 1, '2026-07-07')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.purchases', 'id'), (SELECT MAX(id) FROM public.purchases));

INSERT INTO public.settings (key, value) VALUES
  ('store_name', 'Nexora POS Enterprise'),
  ('store_phone', '+254 700 555 123'),
  ('store_address', 'Waiyaki Way, Nairobi'),
  ('currency', 'KES'),
  ('currency_symbol', 'Ksh'),
  ('vat_rate', '16'),
  ('tax_pin', 'P051234567X'),
  ('payment_cash', 'true'),
  ('payment_card', 'true'),
  ('payment_mobile', 'true'),
  ('payment_split', 'true'),
  ('firebase_sync_enabled', 'false'),
  ('receipt_header', 'Thank you for shopping with Nexora POS Enterprise!'),
  ('receipt_footer', 'Goods sold in good condition are exchangeable within 7 days with receipt.'),
  ('barcode_prefix', '89'),
  ('barcode_format', 'EAN-13'),
  ('printer_name', ''),
  ('auto_backup_enabled', 'false'),
  ('auto_backup_interval_hours', '24'),
  ('theme', 'light'),
  ('default_branch_id', '1'),
  ('enable_multi_branch', 'true'),
  ('enable_multi_currency', 'true')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.subscription (id, plan, status, billing_cycle, renews_at, branches_allowed, users_allowed, currencies_allowed)
VALUES (1, 'Enterprise', 'active', 'monthly', '2026-08-01', 10, 100, '["KES","USD","EUR"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Default permissions for owner / admin / cashier
DO $$
DECLARE
  modules text[] := ARRAY[
    'dashboard','pos','products','categories','inventory','purchases','sales',
    'customers','suppliers','expenses','reports','users','roles','settings','subscription'
  ];
  actions text[] := ARRAY['view','create','edit','delete'];
  m text;
  a text;
  cashier_modules text[] := ARRAY['dashboard','pos','sales','customers','products','inventory'];
BEGIN
  -- owner + admin: all true
  FOREACH m IN ARRAY modules LOOP
    FOREACH a IN ARRAY actions LOOP
      INSERT INTO public.permissions (role, module, action, allowed)
      VALUES ('owner', m, a, true)
      ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;
      INSERT INTO public.permissions (role, module, action, allowed)
      VALUES ('admin', m, a, true)
      ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;
    END LOOP;
  END LOOP;

  -- cashier: limited
  FOREACH m IN ARRAY modules LOOP
    FOREACH a IN ARRAY actions LOOP
      INSERT INTO public.permissions (role, module, action, allowed)
      VALUES (
        'cashier', m, a,
        (m = ANY (cashier_modules) AND (
          a IN ('view', 'create') OR (m = 'inventory' AND a = 'edit')
        ))
      )
      ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;
    END LOOP;
  END LOOP;
END $$;
