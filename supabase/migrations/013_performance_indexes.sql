-- 013_performance_indexes.sql
-- Additive indexes for frequently filtered / searched POS list and report paths.
-- Safe to re-run (IF NOT EXISTS).

-- Products: barcode/sku lookup, catalog browse, low-stock scans
CREATE INDEX IF NOT EXISTS products_company_id_idx ON public.products (company_id);
CREATE INDEX IF NOT EXISTS products_company_name_idx ON public.products (company_id, name);
CREATE INDEX IF NOT EXISTS products_company_sku_idx ON public.products (company_id, sku);
CREATE INDEX IF NOT EXISTS products_company_barcode_idx ON public.products (company_id, barcode);
CREATE INDEX IF NOT EXISTS products_company_stock_idx ON public.products (company_id, stock);

-- Customers: search + company scope
CREATE INDEX IF NOT EXISTS customers_company_id_idx ON public.customers (company_id);
CREATE INDEX IF NOT EXISTS customers_company_name_idx ON public.customers (company_id, name);
CREATE INDEX IF NOT EXISTS customers_company_phone_idx ON public.customers (company_id, phone);

-- Suppliers: list filters, payment terms / status
CREATE INDEX IF NOT EXISTS suppliers_company_id_idx ON public.suppliers (company_id);
CREATE INDEX IF NOT EXISTS suppliers_company_name_idx ON public.suppliers (company_id, name);
CREATE INDEX IF NOT EXISTS suppliers_company_status_idx ON public.suppliers (company_id, status);
CREATE INDEX IF NOT EXISTS suppliers_company_code_idx ON public.suppliers (company_id, code);

-- Purchases: status boards, due dates, supplier history
CREATE INDEX IF NOT EXISTS purchases_company_id_idx ON public.purchases (company_id);
CREATE INDEX IF NOT EXISTS purchases_company_status_idx ON public.purchases (company_id, status);
CREATE INDEX IF NOT EXISTS purchases_company_created_at_idx ON public.purchases (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchases_company_due_date_idx ON public.purchases (company_id, due_date);
CREATE INDEX IF NOT EXISTS purchases_supplier_id_idx ON public.purchases (supplier_id);

-- Sales: dashboard / reports date windows
CREATE INDEX IF NOT EXISTS sales_company_created_at_idx ON public.sales (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_company_customer_idx ON public.sales (company_id, customer_id);

-- Sale items: batch fetch by sale_id
CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product_id_idx ON public.sale_items (product_id);

-- Expenses: report date filters
CREATE INDEX IF NOT EXISTS expenses_company_id_idx ON public.expenses (company_id);
CREATE INDEX IF NOT EXISTS expenses_company_date_idx ON public.expenses (company_id, expense_date DESC);

-- Audit log: module filters + recent activity
CREATE INDEX IF NOT EXISTS audit_log_company_created_at_idx ON public.audit_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_company_module_idx ON public.audit_log (company_id, module, created_at DESC);

-- Categories / branches lookups
CREATE INDEX IF NOT EXISTS categories_company_id_idx ON public.categories (company_id);
CREATE INDEX IF NOT EXISTS branches_company_id_idx ON public.branches (company_id);

-- Stock movements recent feed
CREATE INDEX IF NOT EXISTS stock_movements_company_created_at_idx
  ON public.stock_movements (company_id, created_at DESC);
