-- 016_purchase_management_enterprise.sql
-- Additive-only (SCHEMA_FREEZE.md): invoice/GRN fields, avg cost, Rejected status, journal_entries.
-- Safe to re-run: IF NOT EXISTS / DROP IF EXISTS patterns throughout.

-- ---------------------------------------------------------------------------
-- Purchases: invoice totals, warehouse, approval/rejection metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS subtotal numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warehouse_id bigint REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS payment_due_date date;

-- Keep payment_due_date in sync with due_date when blank
UPDATE public.purchases
SET payment_due_date = due_date
WHERE payment_due_date IS NULL AND due_date IS NOT NULL;

COMMENT ON COLUMN public.purchases.invoice_date IS 'Supplier invoice date (AP)';
COMMENT ON COLUMN public.purchases.subtotal IS 'Lines subtotal before header discount/shipping/charges';
COMMENT ON COLUMN public.purchases.tax_total IS 'Sum of line tax amounts';
COMMENT ON COLUMN public.purchases.discount_total IS 'Header-level discount amount';
COMMENT ON COLUMN public.purchases.shipping IS 'Freight / shipping charges';
COMMENT ON COLUMN public.purchases.other_charges IS 'Misc charges added to grand total';
COMMENT ON COLUMN public.purchases.warehouse_id IS 'Receiving warehouse for the PO';
COMMENT ON COLUMN public.purchases.rejection_reason IS 'Set when status=Rejected';

-- Allow Rejected as a first-class status (Approve/Reject workflow)
UPDATE public.purchases
SET status = 'Cancelled'
WHERE status IS NOT NULL
  AND btrim(status) <> ''
  AND status NOT IN (
    'Draft', 'Pending', 'Ordered', 'PartiallyReceived', 'Received', 'Cancelled', 'Rejected'
  );

DO $$
BEGIN
  ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_status_check
  CHECK (status IN (
    'Draft', 'Pending', 'Ordered', 'PartiallyReceived', 'Received', 'Cancelled', 'Rejected'
  ));

CREATE INDEX IF NOT EXISTS purchases_warehouse_id_idx ON public.purchases (warehouse_id);
CREATE INDEX IF NOT EXISTS purchases_invoice_date_idx ON public.purchases (invoice_date);
CREATE INDEX IF NOT EXISTS purchases_company_status_created_idx
  ON public.purchases (company_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Purchase line GRN metadata (batch / serial / expiry / damaged notes)
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS batch_no text,
  ADD COLUMN IF NOT EXISTS serial_no text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS mfg_date date,
  ADD COLUMN IF NOT EXISTS qty_damaged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_notes text;

COMMENT ON COLUMN public.purchase_items.batch_no IS 'Optional batch / lot captured at GRN';
COMMENT ON COLUMN public.purchase_items.serial_no IS 'Optional serial(s) captured at GRN (text, not full serial ledger)';
COMMENT ON COLUMN public.purchase_items.expiry_date IS 'Expiry date captured at GRN';
COMMENT ON COLUMN public.purchase_items.mfg_date IS 'Manufacture date captured at GRN';
COMMENT ON COLUMN public.purchase_items.qty_damaged IS 'Damaged qty noted at receive (not stocked)';
COMMENT ON COLUMN public.purchase_items.line_notes IS 'GRN / damage / expiry notes';

-- ---------------------------------------------------------------------------
-- Products: last cost + moving average cost
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS avg_cost numeric(12,2);

COMMENT ON COLUMN public.products.last_cost IS 'Last purchase unit cost from GRN';
COMMENT ON COLUMN public.products.avg_cost IS 'Moving average unit cost from receives';

UPDATE public.products
SET last_cost = cost
WHERE last_cost IS NULL AND cost IS NOT NULL;

UPDATE public.products
SET avg_cost = cost
WHERE avg_cost IS NULL AND cost IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Minimal journal entries (pragmatic AP accounting under schema freeze)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id          BIGSERIAL PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account     text NOT NULL,
  debit       numeric(12,2) NOT NULL DEFAULT 0,
  credit      numeric(12,2) NOT NULL DEFAULT 0,
  ref_type    text NOT NULL,
  ref_id      bigint,
  memo        text,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_amount_check CHECK (debit >= 0 AND credit >= 0)
);

CREATE INDEX IF NOT EXISTS journal_entries_company_created_idx
  ON public.journal_entries (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS journal_entries_ref_idx
  ON public.journal_entries (company_id, ref_type, ref_id);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_entries_select ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_insert_staff ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_update_staff ON public.journal_entries;
DROP POLICY IF EXISTS journal_entries_delete_staff ON public.journal_entries;

CREATE POLICY journal_entries_select ON public.journal_entries
  FOR SELECT TO authenticated
  USING (public.tenant_match(company_id));

CREATE POLICY journal_entries_insert_staff ON public.journal_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.tenant_match(company_id));

CREATE POLICY journal_entries_update_staff ON public.journal_entries
  FOR UPDATE TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

CREATE POLICY journal_entries_delete_staff ON public.journal_entries
  FOR DELETE TO authenticated
  USING (public.tenant_match(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.journal_entries_id_seq TO authenticated, service_role;

COMMENT ON TABLE public.journal_entries IS
  'Lightweight AP journal lines posted from purchases receive/pay/return (not a full ERP GL)';
