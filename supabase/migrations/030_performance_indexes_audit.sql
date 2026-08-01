-- Performance indexes identified in production stability audit (2026-07-31).
-- Safe / idempotent.

CREATE INDEX IF NOT EXISTS idx_supplier_payments_company_created
  ON public.supplier_payments (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_company_supplier
  ON public.supplier_payments (company_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_customer_payments_company_created
  ON public.customer_payments (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer
  ON public.customer_payments (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
  ON public.purchase_items (purchase_id);

CREATE INDEX IF NOT EXISTS idx_sales_company_branch_created
  ON public.sales (company_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_held_sales_company_held
  ON public.held_sales (company_id, held_at DESC);

CREATE INDEX IF NOT EXISTS idx_warehouses_company
  ON public.warehouses (company_id);

CREATE INDEX IF NOT EXISTS idx_brands_company
  ON public.brands (company_id);

CREATE INDEX IF NOT EXISTS idx_units_company
  ON public.units (company_id);
