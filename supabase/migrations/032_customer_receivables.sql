-- 032: Customer Credit Invoice / Accounts Receivable
-- Relational AR: invoices, line items, payment allocations, credit notes, credit policy.

CREATE TABLE IF NOT EXISTS public.customer_invoices (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  sale_id bigint REFERENCES public.sales(id) ON DELETE SET NULL,
  branch_id bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  invoice_no text NOT NULL,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  payment_type text NOT NULL DEFAULT 'credit'
    CHECK (payment_type IN ('cash', 'credit', 'mixed')),
  cash_amount numeric(14,2) NOT NULL DEFAULT 0,
  credit_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'overdue', 'void')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS public.customer_invoice_items (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id bigint NOT NULL REFERENCES public.customer_invoices(id) ON DELETE CASCADE,
  product_id bigint REFERENCES public.products(id) ON DELETE SET NULL,
  description text NOT NULL,
  qty numeric(14,3) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS invoice_id bigint REFERENCES public.customer_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receipt_no text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS reference text;

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.customer_payment_allocations (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_id bigint NOT NULL REFERENCES public.customer_payments(id) ON DELETE CASCADE,
  invoice_id bigint NOT NULL REFERENCES public.customer_invoices(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_credit_notes (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_id bigint REFERENCES public.customer_invoices(id) ON DELETE SET NULL,
  credit_note_no text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, credit_note_no)
);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS opening_balance numeric(14,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customer_invoices_company_customer
  ON public.customer_invoices (company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_company_status
  ON public.customer_invoices (company_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_due_date
  ON public.customer_invoices (company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_customer_invoice_items_invoice
  ON public.customer_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_customer_payment_alloc_payment
  ON public.customer_payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_customer_payment_alloc_invoice
  ON public.customer_payment_allocations (invoice_id);
CREATE INDEX IF NOT EXISTS idx_customer_credit_notes_customer
  ON public.customer_credit_notes (company_id, customer_id);

ALTER TABLE public.customer_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credit_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tenant_match') THEN
    DROP POLICY IF EXISTS customer_invoices_tenant ON public.customer_invoices;
    CREATE POLICY customer_invoices_tenant ON public.customer_invoices
      FOR ALL TO authenticated
      USING (public.tenant_match(company_id))
      WITH CHECK (public.tenant_match(company_id));

    DROP POLICY IF EXISTS customer_invoice_items_tenant ON public.customer_invoice_items;
    CREATE POLICY customer_invoice_items_tenant ON public.customer_invoice_items
      FOR ALL TO authenticated
      USING (public.tenant_match(company_id))
      WITH CHECK (public.tenant_match(company_id));

    DROP POLICY IF EXISTS customer_payment_allocations_tenant ON public.customer_payment_allocations;
    CREATE POLICY customer_payment_allocations_tenant ON public.customer_payment_allocations
      FOR ALL TO authenticated
      USING (public.tenant_match(company_id))
      WITH CHECK (public.tenant_match(company_id));

    DROP POLICY IF EXISTS customer_credit_notes_tenant ON public.customer_credit_notes;
    CREATE POLICY customer_credit_notes_tenant ON public.customer_credit_notes
      FOR ALL TO authenticated
      USING (public.tenant_match(company_id))
      WITH CHECK (public.tenant_match(company_id));
  END IF;
END $$;
