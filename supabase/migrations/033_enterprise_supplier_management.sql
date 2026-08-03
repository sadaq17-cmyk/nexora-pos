-- 033: Enterprise Supplier Management — purchase requests + AP helpers

CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  warehouse_id bigint,
  supplier_id bigint REFERENCES public.suppliers(id) ON DELETE SET NULL,
  request_no text NOT NULL,
  status text NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Submitted', 'Converted', 'Cancelled', 'Rejected')),
  notes text,
  required_date date,
  purchase_id bigint REFERENCES public.purchases(id) ON DELETE SET NULL,
  requested_by uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, request_no)
);

CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_id bigint NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  product_id bigint REFERENCES public.products(id) ON DELETE SET NULL,
  description text,
  qty numeric(14,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  estimated_cost numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_company_status
  ON public.purchase_requests (company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_request
  ON public.purchase_request_items (request_id);

-- AP helpers on purchases (derived also in API if columns already exist)
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_status text;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS delivery_lead_days integer NOT NULL DEFAULT 7;

CREATE INDEX IF NOT EXISTS idx_purchases_company_due
  ON public.purchases (company_id, due_date)
  WHERE balance > 0;

-- Allow procurement_officer in profiles.role check when present
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check CHECK (role IN (
      'platform_owner','owner','super_admin','admin','branch_manager',
      'sales_manager','inventory_manager','accountant','sales','cashier',
      'procurement_officer'
    ));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tenant_match') THEN
    DROP POLICY IF EXISTS purchase_requests_tenant ON public.purchase_requests;
    CREATE POLICY purchase_requests_tenant ON public.purchase_requests
      FOR ALL TO authenticated
      USING (public.tenant_match(company_id))
      WITH CHECK (public.tenant_match(company_id));

    DROP POLICY IF EXISTS purchase_request_items_tenant ON public.purchase_request_items;
    CREATE POLICY purchase_request_items_tenant ON public.purchase_request_items
      FOR ALL TO authenticated
      USING (public.tenant_match(company_id))
      WITH CHECK (public.tenant_match(company_id));
  END IF;
END $$;
