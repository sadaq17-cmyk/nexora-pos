-- 017_inventory_management_enterprise.sql
-- Additive-only (SCHEMA_FREEZE.md). Extends products / stock_movements / stock_transfers
-- for enterprise inventory: soft-delete, pricing, overstock, batch/expiry on movements,
-- warehouse fields on transfers. No lot ledger redesign.

-- ---------------------------------------------------------------------------
-- Products: soft archive/delete + pricing + stock thresholds + expiry preference
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS wholesale_price numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_percent numeric(8, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_stock integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS stock_preference text NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.products.archived_at IS 'When set, product is archived (hidden from POS catalog by default)';
COMMENT ON COLUMN public.products.deleted_at IS 'Soft-delete timestamp; hard delete avoided when movements/sales exist';
COMMENT ON COLUMN public.products.wholesale_price IS 'Optional wholesale / B2B price';
COMMENT ON COLUMN public.products.discount_percent IS 'Default discount percent on sell price';
COMMENT ON COLUMN public.products.tax_inclusive IS 'When true, selling price includes tax';
COMMENT ON COLUMN public.products.max_stock IS 'Overstock alert threshold; 0 disables';
COMMENT ON COLUMN public.products.expiry_date IS 'Product-level expiry (PARTIAL lot tracking without lot ledger)';
COMMENT ON COLUMN public.products.stock_preference IS 'Receive/sales preference hint: none | fifo | fefo (no lot ledger enforcement)';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_preference_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_stock_preference_check
      CHECK (stock_preference IN ('none', 'fifo', 'fefo'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS products_company_deleted_at_idx
  ON public.products (company_id, deleted_at);

CREATE INDEX IF NOT EXISTS products_company_archived_at_idx
  ON public.products (company_id, archived_at);

CREATE INDEX IF NOT EXISTS products_company_expiry_date_idx
  ON public.products (company_id, expiry_date)
  WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_company_max_stock_idx
  ON public.products (company_id, max_stock)
  WHERE max_stock > 0;

-- ---------------------------------------------------------------------------
-- Stock movements: batch / expiry / variant / reference (additive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS variant_id bigint,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id bigint;

COMMENT ON COLUMN public.stock_movements.batch_number IS 'Optional batch/lot text captured on movement';
COMMENT ON COLUMN public.stock_movements.expiry_date IS 'Optional expiry captured on movement (not a full lot balance)';
COMMENT ON COLUMN public.stock_movements.reference_type IS 'Optional source: purchase | sale | transfer | count | adjust';
COMMENT ON COLUMN public.stock_movements.reference_id IS 'Optional source row id';

CREATE INDEX IF NOT EXISTS stock_movements_company_product_idx
  ON public.stock_movements (company_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stock_movements_company_type_idx
  ON public.stock_movements (company_id, type, created_at DESC);

-- ---------------------------------------------------------------------------
-- Stock transfers: warehouse endpoints + status metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS from_warehouse_id bigint REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_warehouse_id bigint REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date;

CREATE INDEX IF NOT EXISTS stock_transfers_company_created_at_idx
  ON public.stock_transfers (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Physical stock counts (minimal additive tables — not a lot ledger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id           BIGSERIAL PRIMARY KEY,
  company_id   bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  warehouse_id bigint REFERENCES public.warehouses(id) ON DELETE SET NULL,
  branch_id    bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'draft',
  notes        text,
  counted_at   timestamptz,
  posted_at    timestamptz,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_counts_status_check CHECK (status IN ('draft', 'posted', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id           BIGSERIAL PRIMARY KEY,
  count_id     bigint NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id   bigint REFERENCES public.products(id) ON DELETE SET NULL,
  system_qty   integer NOT NULL DEFAULT 0,
  counted_qty  integer NOT NULL DEFAULT 0,
  note         text
);

CREATE INDEX IF NOT EXISTS stock_counts_company_created_at_idx
  ON public.stock_counts (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stock_count_lines_count_id_idx
  ON public.stock_count_lines (count_id);

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_counts_tenant ON public.stock_counts;
CREATE POLICY stock_counts_tenant ON public.stock_counts FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS stock_count_lines_tenant ON public.stock_count_lines;
CREATE POLICY stock_count_lines_tenant ON public.stock_count_lines FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stock_counts sc
      WHERE sc.id = stock_count_lines.count_id
        AND public.tenant_match(sc.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stock_counts sc
      WHERE sc.id = stock_count_lines.count_id
        AND public.tenant_match(sc.company_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_counts TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_count_lines TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stock_counts_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stock_count_lines_id_seq TO authenticated, service_role;
