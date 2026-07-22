-- Purchase due dates from supplier payment terms (ERP AP workflow)
-- Flow: Supplier (terms) → Purchase → due_date auto → Receive → Payment → balances update

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS payment_terms text;

CREATE INDEX IF NOT EXISTS purchases_due_date_idx ON public.purchases (due_date);

COMMENT ON COLUMN public.purchases.due_date IS 'Payment due date auto-calculated from supplier payment terms (e.g. Net 30)';
COMMENT ON COLUMN public.purchases.payment_terms IS 'Snapshot of supplier terms at PO creation';

-- Backfill due_date for open purchases from supplier terms when missing
UPDATE public.purchases p
SET
  payment_terms = COALESCE(p.payment_terms, s.payment_terms),
  due_date = COALESCE(
    p.due_date,
    (
      CASE
        WHEN COALESCE(p.payment_terms, s.payment_terms) IS NULL THEN (p.created_at::date)
        WHEN lower(COALESCE(p.payment_terms, s.payment_terms)) ~ 'cod|cash' THEN (p.created_at::date)
        WHEN COALESCE(p.payment_terms, s.payment_terms) ~* 'net\s*(\d+)' THEN
          (p.created_at::date + ((regexp_match(lower(COALESCE(p.payment_terms, s.payment_terms)), 'net\s*(\d+)'))[1])::int)
        WHEN COALESCE(p.payment_terms, s.payment_terms) ~* '(\d+)\s*days?' THEN
          (p.created_at::date + ((regexp_match(lower(COALESCE(p.payment_terms, s.payment_terms)), '(\d+)\s*days?'))[1])::int)
        ELSE (p.created_at::date)
      END
    )
  )
FROM public.suppliers s
WHERE s.id = p.supplier_id
  AND p.due_date IS NULL
  AND p.status IS DISTINCT FROM 'Cancelled';
