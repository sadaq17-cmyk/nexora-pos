-- 018_warehouse_stock_ledger.sql
-- Additive only (schema freeze). Per-warehouse balances for Inventory transfers / stock ops.
-- products.stock remains company-level total; API keeps it in sync with SUM(warehouse_stock.qty).

CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  id            bigserial PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  warehouse_id  bigint NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id    bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty           numeric(18, 4) NOT NULL DEFAULT 0,
  batch_number  text,
  expiry_date   date,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_stock_qty_nonneg CHECK (qty >= 0),
  CONSTRAINT warehouse_stock_company_wh_product_uid UNIQUE (company_id, warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS warehouse_stock_company_product_idx
  ON public.warehouse_stock (company_id, product_id);

CREATE INDEX IF NOT EXISTS warehouse_stock_warehouse_idx
  ON public.warehouse_stock (warehouse_id);

ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_stock_tenant ON public.warehouse_stock;
CREATE POLICY warehouse_stock_tenant ON public.warehouse_stock
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_stock TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.warehouse_stock_id_seq TO authenticated, service_role;

-- Backfill: attribute current product stock to each company's primary (lowest id) warehouse.
INSERT INTO public.warehouse_stock (company_id, warehouse_id, product_id, qty, expiry_date, updated_at)
SELECT
  p.company_id,
  w.id AS warehouse_id,
  p.id AS product_id,
  GREATEST(COALESCE(p.stock, 0), 0)::numeric AS qty,
  p.expiry_date,
  now()
FROM public.products p
INNER JOIN LATERAL (
  SELECT wh.id
  FROM public.warehouses wh
  WHERE wh.company_id = p.company_id
    AND COALESCE(wh.active, true) = true
  ORDER BY wh.id ASC
  LIMIT 1
) w ON true
WHERE p.company_id IS NOT NULL
  AND p.deleted_at IS NULL
  AND COALESCE(p.stock, 0) > 0
ON CONFLICT (company_id, warehouse_id, product_id) DO UPDATE
  SET qty = EXCLUDED.qty,
      expiry_date = COALESCE(EXCLUDED.expiry_date, public.warehouse_stock.expiry_date),
      updated_at = now();
