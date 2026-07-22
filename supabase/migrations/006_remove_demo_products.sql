-- Deactivate legacy demo/seed catalog products in production databases.
-- Rows are retained when referenced by historical sales/purchases; the API
-- also excludes these barcodes/names from products.getAll / getByBarcode.

UPDATE public.products
SET active = false
WHERE barcode IN (
  '8901030001', '8901030002', '8901030003', '8901030004', '8901030005', '8901030006',
  '8901030001001', '8901030002008', '8901030003005', '8901030004002'
)
OR (
  name IN ('Sugar 2kg', 'Rice 5kg', 'Cooking Oil 2L', 'Milk 500ml', 'Bread 400g', 'Soft Drinks 500ml')
  AND (
    barcode IS NULL
    OR barcode IN (
      '8901030001', '8901030002', '8901030003', '8901030004', '8901030005', '8901030006',
      '8901030001001', '8901030002008', '8901030003005', '8901030004002'
    )
  )
);
