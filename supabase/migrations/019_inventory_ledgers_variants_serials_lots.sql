-- 019_inventory_ledgers_variants_serials_lots.sql
-- Additive only (SCHEMA_FREEZE). Enterprise ledgers:
--   product_variant_skus  — Variant SKU ledger
--   product_serials       — Serial number ledger
--   stock_lots            — FIFO/FEFO quantity lots
--   stock_lot_allocations — audit of lot consumption
-- Does not rename/drop existing tables. products.stock / warehouse_stock remain.

-- ---------------------------------------------------------------------------
-- Variant SKU ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_variant_skus (
  id            bigserial PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id    bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name          text NOT NULL,
  sku           text,
  barcode       text,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  price         numeric(12, 2),
  cost          numeric(12, 4) NOT NULL DEFAULT 0,
  stock         numeric(18, 4) NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variant_skus_stock_nonneg CHECK (stock >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_variant_skus_company_sku_uid
  ON public.product_variant_skus (company_id, sku)
  WHERE sku IS NOT NULL AND length(trim(sku)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS product_variant_skus_company_barcode_uid
  ON public.product_variant_skus (company_id, barcode)
  WHERE barcode IS NOT NULL AND length(trim(barcode)) > 0;

CREATE INDEX IF NOT EXISTS product_variant_skus_company_product_idx
  ON public.product_variant_skus (company_id, product_id);

-- ---------------------------------------------------------------------------
-- Stock lots (FIFO / FEFO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_lots (
  id                  bigserial PRIMARY KEY,
  company_id          bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id          bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id          bigint REFERENCES public.product_variant_skus(id) ON DELETE SET NULL,
  warehouse_id        bigint REFERENCES public.warehouses(id) ON DELETE SET NULL,
  batch_number        text,
  qty_received        numeric(18, 4) NOT NULL DEFAULT 0,
  qty_remaining       numeric(18, 4) NOT NULL DEFAULT 0,
  unit_cost           numeric(12, 4) NOT NULL DEFAULT 0,
  received_at         timestamptz NOT NULL DEFAULT now(),
  manufacturing_date  date,
  expiry_date         date,
  reference_type      text,
  reference_id        bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_lots_qty_received_nonneg CHECK (qty_received >= 0),
  CONSTRAINT stock_lots_qty_remaining_nonneg CHECK (qty_remaining >= 0),
  CONSTRAINT stock_lots_qty_remaining_lte_received CHECK (qty_remaining <= qty_received)
);

CREATE INDEX IF NOT EXISTS stock_lots_fifo_idx
  ON public.stock_lots (company_id, product_id, received_at ASC, id ASC)
  WHERE qty_remaining > 0;

CREATE INDEX IF NOT EXISTS stock_lots_fefo_idx
  ON public.stock_lots (company_id, product_id, expiry_date ASC NULLS LAST, received_at ASC, id ASC)
  WHERE qty_remaining > 0;

CREATE INDEX IF NOT EXISTS stock_lots_warehouse_idx
  ON public.stock_lots (company_id, warehouse_id, product_id)
  WHERE qty_remaining > 0;

-- ---------------------------------------------------------------------------
-- Serial number ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_serials (
  id             bigserial PRIMARY KEY,
  company_id     bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id     bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id     bigint REFERENCES public.product_variant_skus(id) ON DELETE SET NULL,
  warehouse_id   bigint REFERENCES public.warehouses(id) ON DELETE SET NULL,
  lot_id         bigint REFERENCES public.stock_lots(id) ON DELETE SET NULL,
  serial_number  text NOT NULL,
  status         text NOT NULL DEFAULT 'available',
  received_at    timestamptz NOT NULL DEFAULT now(),
  sold_at        timestamptz,
  sale_id        bigint,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_serials_status_check
    CHECK (status IN ('available', 'reserved', 'sold', 'damaged', 'returned')),
  CONSTRAINT product_serials_company_serial_uid UNIQUE (company_id, serial_number)
);

CREATE INDEX IF NOT EXISTS product_serials_company_product_status_idx
  ON public.product_serials (company_id, product_id, status);

CREATE INDEX IF NOT EXISTS product_serials_lot_idx
  ON public.product_serials (lot_id)
  WHERE lot_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Lot allocations (consumption audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_lot_allocations (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lot_id          bigint NOT NULL REFERENCES public.stock_lots(id) ON DELETE CASCADE,
  product_id      bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id      bigint REFERENCES public.product_variant_skus(id) ON DELETE SET NULL,
  qty             numeric(18, 4) NOT NULL,
  unit_cost       numeric(12, 4) NOT NULL DEFAULT 0,
  reference_type  text,
  reference_id    bigint,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_lot_allocations_qty_pos CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS stock_lot_allocations_company_ref_idx
  ON public.stock_lot_allocations (company_id, reference_type, reference_id);

CREATE INDEX IF NOT EXISTS stock_lot_allocations_lot_idx
  ON public.stock_lot_allocations (lot_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_variant_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lot_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_variant_skus_tenant ON public.product_variant_skus;
CREATE POLICY product_variant_skus_tenant ON public.product_variant_skus
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS stock_lots_tenant ON public.stock_lots;
CREATE POLICY stock_lots_tenant ON public.stock_lots
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS product_serials_tenant ON public.product_serials;
CREATE POLICY product_serials_tenant ON public.product_serials
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS stock_lot_allocations_tenant ON public.stock_lot_allocations;
CREATE POLICY stock_lot_allocations_tenant ON public.stock_lot_allocations
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variant_skus TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_lots TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_serials TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_lot_allocations TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.product_variant_skus_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stock_lots_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.product_serials_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stock_lot_allocations_id_seq TO authenticated, service_role;

COMMENT ON TABLE public.product_variant_skus IS 'Variant SKU ledger (size/color/etc). Additive; products.variants jsonb remains a denormalized cache.';
COMMENT ON TABLE public.stock_lots IS 'Quantity lots for FIFO (received_at) / FEFO (expiry_date) auto-pick.';
COMMENT ON TABLE public.product_serials IS 'Serial number ledger with availability status.';
COMMENT ON TABLE public.stock_lot_allocations IS 'Audit of lot quantities consumed by sales/stock-out.';

-- Backfill open lots from current product stock into primary warehouse (one lot per product).
INSERT INTO public.stock_lots (
  company_id, product_id, warehouse_id, batch_number,
  qty_received, qty_remaining, unit_cost, received_at, expiry_date, reference_type
)
SELECT
  p.company_id,
  p.id,
  w.id,
  'OPENING',
  GREATEST(COALESCE(p.stock, 0), 0)::numeric,
  GREATEST(COALESCE(p.stock, 0), 0)::numeric,
  COALESCE(p.avg_cost, p.cost, 0),
  COALESCE(p.created_at, now()),
  p.expiry_date,
  'opening_balance'
FROM public.products p
INNER JOIN LATERAL (
  SELECT wh.id
  FROM public.warehouses wh
  WHERE wh.company_id = p.company_id
  ORDER BY wh.id ASC
  LIMIT 1
) w ON true
WHERE p.company_id IS NOT NULL
  AND p.deleted_at IS NULL
  AND COALESCE(p.stock, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_lots sl
    WHERE sl.company_id = p.company_id AND sl.product_id = p.id AND sl.qty_remaining > 0
  );

-- Backfill variant rows from products.variants jsonb (best-effort).
INSERT INTO public.product_variant_skus (
  company_id, product_id, name, sku, barcode, attributes, price, cost, stock, active
)
SELECT
  p.company_id,
  p.id,
  COALESCE(NULLIF(trim(v->>'name'), ''), NULLIF(trim(v->>'label'), ''), 'Variant'),
  NULLIF(trim(v->>'sku'), ''),
  NULLIF(trim(v->>'barcode'), ''),
  CASE WHEN jsonb_typeof(v->'attributes') = 'object' THEN v->'attributes' ELSE COALESCE(v - 'name' - 'label' - 'sku' - 'barcode' - 'price' - 'cost' - 'stock', '{}'::jsonb) END,
  NULLIF(v->>'price', '')::numeric,
  COALESCE(NULLIF(v->>'cost', '')::numeric, p.cost, 0),
  COALESCE(NULLIF(v->>'stock', '')::numeric, 0),
  true
FROM public.products p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(p.variants) = 'array' THEN p.variants ELSE '[]'::jsonb END
) AS v
WHERE p.company_id IS NOT NULL
  AND p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.product_variant_skus pvs
    WHERE pvs.company_id = p.company_id
      AND pvs.product_id = p.id
      AND pvs.name = COALESCE(NULLIF(trim(v->>'name'), ''), NULLIF(trim(v->>'label'), ''), 'Variant')
  );
