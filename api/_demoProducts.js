/**
 * Seeded demo catalog barcodes/names from the original schema fixture.
 * Production APIs must not return these — only tenant-created products.
 */

const DEMO_PRODUCT_BARCODES = new Set([
  "8901030001",
  "8901030002",
  "8901030003",
  "8901030004",
  "8901030005",
  "8901030006",
  "8901030001001",
  "8901030002008",
  "8901030003005",
  "8901030004002",
  "89010300061",
  "89010300062",
  "89010300063",
]);

const DEMO_PRODUCT_NAMES = new Set([
  "sugar 2kg",
  "rice 5kg",
  "cooking oil 2l",
  "milk 500ml",
  "bread 400g",
  "soft drinks 500ml",
]);

export function isDemoProduct(product) {
  if (!product || typeof product !== "object") return false;
  const barcode = String(product.barcode || "").trim();
  if (barcode && DEMO_PRODUCT_BARCODES.has(barcode)) return true;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.some((variant) => DEMO_PRODUCT_BARCODES.has(String(variant?.barcode || "").trim()))) {
    return true;
  }
  const name = String(product.name || "").trim().toLowerCase();
  if (DEMO_PRODUCT_NAMES.has(name) && (!barcode || DEMO_PRODUCT_BARCODES.has(barcode))) return true;
  return false;
}

export function excludeDemoProducts(products) {
  return (Array.isArray(products) ? products : []).filter((product) => !isDemoProduct(product));
}

export function productSku(row) {
  if (row?.sku) return String(row.sku);
  const variants = Array.isArray(row?.variants) ? row.variants : [];
  const withSku = variants.find((variant) => variant?.sku);
  return withSku?.sku ? String(withSku.sku) : "";
}
