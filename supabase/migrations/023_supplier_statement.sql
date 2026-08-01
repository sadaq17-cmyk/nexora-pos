-- Enterprise Supplier Statement: branch scoping + Debit/Credit Notes + Manual Adjustments
-- Additive-only (SCHEMA_FREEZE-safe): new nullable columns, new table, view replaced (no drops of existing columns).
-- Safe to re-run: IF NOT EXISTS / DROP IF EXISTS / CREATE OR REPLACE patterns throughout.

-- ---------------------------------------------------------------------------
-- 1. Branch scoping on existing AP-affecting tables (nullable; backfilled from linked PO)
-- ---------------------------------------------------------------------------
ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS branch_id bigint REFERENCES public.branches(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_payments
  ADD COLUMN IF NOT EXISTS branch_id bigint REFERENCES public.branches(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS branch_id bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id bigint REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- Backfill branch_id / supplier_id from the linked purchase order where available
UPDATE public.supplier_payments sp
SET branch_id = p.branch_id
FROM public.purchases p
WHERE sp.purchase_id = p.id AND sp.branch_id IS NULL;

UPDATE public.purchase_payments pp
SET branch_id = p.branch_id
FROM public.purchases p
WHERE pp.purchase_id = p.id AND pp.branch_id IS NULL;

UPDATE public.purchase_returns pr
SET branch_id = COALESCE(pr.branch_id, p.branch_id),
    supplier_id = COALESCE(pr.supplier_id, p.supplier_id)
FROM public.purchases p
WHERE pr.purchase_id = p.id
  AND (pr.branch_id IS NULL OR pr.supplier_id IS NULL);

CREATE INDEX IF NOT EXISTS supplier_payments_branch_idx ON public.supplier_payments (branch_id);
CREATE INDEX IF NOT EXISTS purchase_payments_branch_idx ON public.purchase_payments (branch_id);
CREATE INDEX IF NOT EXISTS purchase_returns_branch_idx ON public.purchase_returns (branch_id);
CREATE INDEX IF NOT EXISTS purchase_returns_supplier_idx ON public.purchase_returns (supplier_id);

-- ---------------------------------------------------------------------------
-- 2. Supplier ledger adjustments: Debit Notes, Credit Notes, Manual Adjustments
--    (single generic AP-subledger table — one row = one statement line)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_ledger_adjustments (
  id            BIGSERIAL PRIMARY KEY,
  company_id    bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id   bigint NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  branch_id     bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  entry_type    text NOT NULL CHECK (entry_type IN ('debit_note', 'credit_note', 'adjustment')),
  entry_date    date NOT NULL DEFAULT CURRENT_DATE,
  reference     text,
  description   text,
  debit         numeric(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit        numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  notes         text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_ledger_adjustments_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);

CREATE INDEX IF NOT EXISTS supplier_ledger_adjustments_supplier_idx
  ON public.supplier_ledger_adjustments (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_ledger_adjustments_company_idx
  ON public.supplier_ledger_adjustments (company_id);
CREATE INDEX IF NOT EXISTS supplier_ledger_adjustments_branch_idx
  ON public.supplier_ledger_adjustments (branch_id);
CREATE INDEX IF NOT EXISTS supplier_ledger_adjustments_date_idx
  ON public.supplier_ledger_adjustments (entry_date);

COMMENT ON TABLE public.supplier_ledger_adjustments IS
  'AP subledger manual entries: Debit Notes, Credit Notes, Manual Adjustments (migration 023)';

ALTER TABLE public.supplier_ledger_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_ledger_adjustments_select ON public.supplier_ledger_adjustments;
DROP POLICY IF EXISTS supplier_ledger_adjustments_insert_staff ON public.supplier_ledger_adjustments;
DROP POLICY IF EXISTS supplier_ledger_adjustments_update_staff ON public.supplier_ledger_adjustments;
DROP POLICY IF EXISTS supplier_ledger_adjustments_delete_staff ON public.supplier_ledger_adjustments;

CREATE POLICY supplier_ledger_adjustments_select ON public.supplier_ledger_adjustments
  FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY supplier_ledger_adjustments_insert_staff ON public.supplier_ledger_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_owner_or_admin());

CREATE POLICY supplier_ledger_adjustments_update_staff ON public.supplier_ledger_adjustments
  FOR UPDATE TO authenticated
  USING (public.is_owner_or_admin())
  WITH CHECK (public.is_owner_or_admin());

CREATE POLICY supplier_ledger_adjustments_delete_staff ON public.supplier_ledger_adjustments
  FOR DELETE TO authenticated
  USING (public.is_owner_or_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_ledger_adjustments TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.supplier_ledger_adjustments_id_seq TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Rebuild supplier ledger view: purchases + payments + returns + adjustments
--    (adds purchase_returns + supplier_ledger_adjustments + branch_id vs. migration 009)
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
    p.created_at AS entry_date,
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
    AND p.status IS DISTINCT FROM 'Cancelled'
    AND p.status IS DISTINCT FROM 'Draft'

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
    ('Purchase return' || CASE WHEN pr.reason IS NOT NULL AND btrim(pr.reason) <> '' THEN ' — ' || pr.reason ELSE '' END),
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
  'Derived supplier AP subledger: purchases (debit), payments/returns/credit notes (credit), debit notes/adjustments (either) — migration 023';

GRANT SELECT ON public.supplier_ledger_v TO authenticated, service_role;
