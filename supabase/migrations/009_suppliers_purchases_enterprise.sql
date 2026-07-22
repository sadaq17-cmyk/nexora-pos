-- Enterprise Suppliers + Purchases (ERP-grade fields, partial receive/pay, RLS)
-- Safe to re-run: IF NOT EXISTS / DROP IF EXISTS patterns throughout.

-- ---------------------------------------------------------------------------
-- Suppliers profile & aggregates
-- ---------------------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_purchase_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_payment_at timestamptz;

-- Backfill supplier codes per company (or globally when company_id is null)
DO $$
DECLARE
  r RECORD;
  seq int;
  cid bigint;
BEGIN
  FOR cid IN
    SELECT DISTINCT company_id FROM public.suppliers
    UNION
    SELECT NULL::bigint
    WHERE EXISTS (SELECT 1 FROM public.suppliers WHERE company_id IS NULL)
  LOOP
    seq := 0;
    FOR r IN
      SELECT id FROM public.suppliers
      WHERE (company_id IS NOT DISTINCT FROM cid)
        AND (code IS NULL OR btrim(code) = '')
      ORDER BY id
    LOOP
      seq := seq + 1;
      UPDATE public.suppliers
      SET code = 'SUP-' || lpad(seq::text, 5, '0')
      WHERE id = r.id;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_company_code_uidx
  ON public.suppliers (company_id, code)
  WHERE code IS NOT NULL AND btrim(code) <> '';

CREATE INDEX IF NOT EXISTS suppliers_code_idx ON public.suppliers (code);
CREATE INDEX IF NOT EXISTS suppliers_status_idx ON public.suppliers (status);
CREATE INDEX IF NOT EXISTS suppliers_balance_idx ON public.suppliers (balance);

COMMENT ON COLUMN public.suppliers.code IS 'Auto supplier code, unique per company (SUP-#####)';
COMMENT ON COLUMN public.suppliers.payment_terms IS 'e.g. Net 30, COD, Net 15';
COMMENT ON COLUMN public.suppliers.credit_limit IS 'Maximum outstanding balance allowed';
COMMENT ON COLUMN public.suppliers.total_paid IS 'Lifetime of payments recorded against supplier';

-- ---------------------------------------------------------------------------
-- Purchases: payment tracking, notes, attachment, duplicate prevention
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS client_reference text,
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Align existing rows: balance = total - amount_paid
UPDATE public.purchases
SET balance = GREATEST(0, COALESCE(total, 0) - COALESCE(amount_paid, 0))
WHERE balance IS NULL
   OR balance = 0 AND COALESCE(amount_paid, 0) = 0 AND COALESCE(total, 0) > 0;

-- Normalize legacy/unknown statuses before tightening the check
UPDATE public.purchases
SET status = 'Pending'
WHERE status IS NULL
   OR btrim(status) = ''
   OR status NOT IN (
     'Draft', 'Pending', 'Ordered', 'PartiallyReceived', 'Received', 'Cancelled'
   );

DO $$
BEGIN
  ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN (
    'Draft', 'Pending', 'Ordered', 'PartiallyReceived', 'Received', 'Cancelled'
  ));

-- Deduplicate invoice_no / client_reference before unique indexes (keep lowest id)
UPDATE public.purchases p
SET invoice_no = NULL
WHERE p.invoice_no IS NOT NULL
  AND btrim(p.invoice_no) <> ''
  AND p.status IS DISTINCT FROM 'Cancelled'
  AND EXISTS (
    SELECT 1 FROM public.purchases o
    WHERE o.id < p.id
      AND o.company_id IS NOT DISTINCT FROM p.company_id
      AND o.supplier_id IS NOT DISTINCT FROM p.supplier_id
      AND o.invoice_no = p.invoice_no
      AND o.status IS DISTINCT FROM 'Cancelled'
  );

UPDATE public.purchases p
SET client_reference = NULL
WHERE p.client_reference IS NOT NULL
  AND btrim(p.client_reference) <> ''
  AND p.status IS DISTINCT FROM 'Cancelled'
  AND EXISTS (
    SELECT 1 FROM public.purchases o
    WHERE o.id < p.id
      AND o.company_id IS NOT DISTINCT FROM p.company_id
      AND o.client_reference = p.client_reference
      AND o.status IS DISTINCT FROM 'Cancelled'
  );

-- Prevent duplicate supplier invoice numbers within a company (ignore blanks / cancelled)
CREATE UNIQUE INDEX IF NOT EXISTS purchases_company_supplier_invoice_uidx
  ON public.purchases (company_id, supplier_id, invoice_no)
  WHERE invoice_no IS NOT NULL
    AND btrim(invoice_no) <> ''
    AND status IS DISTINCT FROM 'Cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS purchases_company_client_ref_uidx
  ON public.purchases (company_id, client_reference)
  WHERE client_reference IS NOT NULL
    AND btrim(client_reference) <> ''
    AND status IS DISTINCT FROM 'Cancelled';
CREATE INDEX IF NOT EXISTS purchases_status_idx ON public.purchases (status);
CREATE INDEX IF NOT EXISTS purchases_supplier_id_idx ON public.purchases (supplier_id);
CREATE INDEX IF NOT EXISTS purchases_created_at_idx ON public.purchases (created_at DESC);

COMMENT ON COLUMN public.purchases.amount_paid IS 'Sum of purchase_payments against this PO';
COMMENT ON COLUMN public.purchases.balance IS 'Outstanding = total - amount_paid';
COMMENT ON COLUMN public.purchases.attachment_url IS 'Invoice PDF/image data URL or storage URL';
COMMENT ON COLUMN public.purchases.client_reference IS 'Idempotency / client-side duplicate key';

-- ---------------------------------------------------------------------------
-- Purchase line items: ordered vs received + tax/discount
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS qty_ordered integer,
  ADD COLUMN IF NOT EXISTS qty_received integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax numeric(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.purchase_items
SET qty_ordered = qty
WHERE qty_ordered IS NULL;

ALTER TABLE public.purchase_items
  ALTER COLUMN qty_ordered SET DEFAULT 1;

COMMENT ON COLUMN public.purchase_items.qty_ordered IS 'Quantity ordered on the PO line';
COMMENT ON COLUMN public.purchase_items.qty_received IS 'Cumulative quantity received into stock';

-- ---------------------------------------------------------------------------
-- Purchase payments (partial payment history per PO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_payments (
  id            BIGSERIAL PRIMARY KEY,
  purchase_id   bigint NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  supplier_id   bigint REFERENCES public.suppliers(id) ON DELETE SET NULL,
  company_id    bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  method        text NOT NULL DEFAULT 'Cash',
  reference     text,
  notes         text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_payments_purchase_id_idx
  ON public.purchase_payments (purchase_id);
CREATE INDEX IF NOT EXISTS purchase_payments_company_id_idx
  ON public.purchase_payments (company_id);
CREATE INDEX IF NOT EXISTS purchase_payments_supplier_id_idx
  ON public.purchase_payments (supplier_id);

-- Ensure purchase_returns has company_id for scoping
ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS purchase_id bigint REFERENCES public.purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS notes text;

-- ---------------------------------------------------------------------------
-- Supplier ledger view (purchases + supplier payments + purchase payments)
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
  e.source_id
FROM public.suppliers s
JOIN LATERAL (
  SELECT
    p.created_at AS entry_date,
    'purchase'::text AS entry_type,
    COALESCE(p.po_number, p.invoice_no, p.id::text) AS reference,
    ('Purchase ' || COALESCE(p.po_number, '#' || p.id::text) || ' (' || p.status || ')') AS description,
    COALESCE(p.total, 0)::numeric(12,2) AS debit,
    0::numeric(12,2) AS credit,
    'purchases'::text AS source_table,
    p.id AS source_id
  FROM public.purchases p
  WHERE p.supplier_id = s.id
    AND p.status IS DISTINCT FROM 'Cancelled'
    AND p.status IS DISTINCT FROM 'Draft'

  UNION ALL

  SELECT
    sp.created_at,
    'supplier_payment'::text,
    COALESCE(sp.method, 'Payment'),
    ('Supplier payment via ' || COALESCE(sp.method, 'Cash')),
    0::numeric(12,2),
    COALESCE(sp.amount, 0)::numeric(12,2),
    'supplier_payments'::text,
    sp.id
  FROM public.supplier_payments sp
  WHERE sp.supplier_id = s.id

  UNION ALL

  SELECT
    pp.created_at,
    'purchase_payment'::text,
    COALESCE(pp.reference, pp.method, 'PO payment'),
    ('PO payment via ' || COALESCE(pp.method, 'Cash')),
    0::numeric(12,2),
    COALESCE(pp.amount, 0)::numeric(12,2),
    'purchase_payments'::text,
    pp.id
  FROM public.purchase_payments pp
  WHERE pp.supplier_id = s.id
) e ON true;

COMMENT ON VIEW public.supplier_ledger_v IS
  'Derived supplier ledger: purchases (debit) and payments (credit)';

GRANT SELECT ON public.supplier_ledger_v TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RBAC seed: suppliers + purchases enterprise actions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'permissions'
  ) THEN
    INSERT INTO public.permissions (role, module, action, allowed)
    VALUES
      ('owner', 'suppliers', 'view', true),
      ('owner', 'suppliers', 'create', true),
      ('owner', 'suppliers', 'edit', true),
      ('owner', 'suppliers', 'delete', true),
      ('owner', 'suppliers', 'export', true),
      ('owner', 'suppliers', 'print', true),
      ('admin', 'suppliers', 'view', true),
      ('admin', 'suppliers', 'create', true),
      ('admin', 'suppliers', 'edit', true),
      ('admin', 'suppliers', 'delete', true),
      ('admin', 'suppliers', 'export', true),
      ('admin', 'suppliers', 'print', true),
      ('cashier', 'suppliers', 'view', false),
      ('cashier', 'suppliers', 'create', false),
      ('cashier', 'suppliers', 'edit', false),
      ('cashier', 'suppliers', 'delete', false),
      ('owner', 'purchases', 'view', true),
      ('owner', 'purchases', 'create', true),
      ('owner', 'purchases', 'edit', true),
      ('owner', 'purchases', 'delete', true),
      ('owner', 'purchases', 'approve', true),
      ('admin', 'purchases', 'view', true),
      ('admin', 'purchases', 'create', true),
      ('admin', 'purchases', 'edit', true),
      ('admin', 'purchases', 'delete', true),
      ('admin', 'purchases', 'approve', true),
      ('cashier', 'purchases', 'view', false),
      ('cashier', 'purchases', 'create', false),
      ('cashier', 'purchases', 'edit', false),
      ('cashier', 'purchases', 'approve', false)
    ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS for purchase_payments (+ refresh grants)
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_payments_select ON public.purchase_payments;
DROP POLICY IF EXISTS purchase_payments_insert_staff ON public.purchase_payments;
DROP POLICY IF EXISTS purchase_payments_update_staff ON public.purchase_payments;
DROP POLICY IF EXISTS purchase_payments_delete_staff ON public.purchase_payments;

CREATE POLICY purchase_payments_select ON public.purchase_payments
  FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY purchase_payments_insert_staff ON public.purchase_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_owner_or_admin());

CREATE POLICY purchase_payments_update_staff ON public.purchase_payments
  FOR UPDATE TO authenticated
  USING (public.is_owner_or_admin())
  WITH CHECK (public.is_owner_or_admin());

CREATE POLICY purchase_payments_delete_staff ON public.purchase_payments
  FOR DELETE TO authenticated
  USING (public.is_owner_or_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_payments TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_payments_id_seq TO authenticated, service_role;

-- Probe columns for schema health
COMMENT ON TABLE public.purchase_payments IS 'Partial / full payments against purchase orders';
