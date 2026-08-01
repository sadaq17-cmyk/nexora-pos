-- Enterprise fix: Purchase invoices must book the supplier liability immediately
-- (not only on receipt), Rejected POs must never count as AP debits, and every
-- product must be able to store a Minimum Selling Price alongside Cost/Selling/
-- Wholesale price. Additive-only, safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Rebuild supplier ledger view: exclude Rejected POs from AP debits too
--    (previously only Draft/Cancelled were excluded, so a Rejected PO could
--    still inflate the outstanding balance).
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
    AND p.status NOT IN ('Cancelled', 'Draft', 'Rejected')

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
  'Derived supplier AP subledger: purchases (debit; Draft/Cancelled/Rejected excluded), payments/returns/credit notes (credit), debit notes/adjustments (either) — migration 025';

GRANT SELECT ON public.supplier_ledger_v TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Products: Minimum Selling Price (Cost Price / Selling Price / Wholesale
--    Price already exist as cost / price / wholesale_price respectively).
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS min_selling_price numeric(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.products.min_selling_price IS
  'Optional floor price — the lowest a cashier/discount may sell this product for (0 = no floor)';
