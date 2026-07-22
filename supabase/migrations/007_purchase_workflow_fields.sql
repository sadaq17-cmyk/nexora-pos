-- Purchase workflow fields (Odoo/ERPNext-style supplier + product create-from-PO)
-- Safe to re-run: all changes use IF NOT EXISTS.

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(8,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS products_sku_idx ON public.products (sku);

COMMENT ON COLUMN public.suppliers.tax_number IS 'Supplier VAT / tax registration number';
COMMENT ON COLUMN public.suppliers.notes IS 'Internal notes; categories belong to products, not suppliers';
COMMENT ON COLUMN public.products.sku IS 'Stock-keeping unit; auto-generated when blank on create';
COMMENT ON COLUMN public.products.tax_rate IS 'Default tax percent for the product';
