/**
 * Known demo/seed catalog fixtures. Production must never surface these —
 * only real products created by tenants should appear in pickers and POS.
 */

export const DEMO_PRODUCT_BARCODES = Object.freeze([
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

export const DEMO_PRODUCT_NAMES = Object.freeze([
  "Sugar 2kg",
  "Rice 5kg",
  "Cooking Oil 2L",
  "Milk 500ml",
  "Bread 400g",
  "Soft Drinks 500ml",
]);

const barcodeSet = new Set(DEMO_PRODUCT_BARCODES.map((code) => String(code).trim()));
const nameSet = new Set(DEMO_PRODUCT_NAMES.map((name) => name.toLowerCase()));

export function isDemoProduct(product) {
  if (!product || typeof product !== "object") return false;
  const barcode = String(product.barcode || "").trim();
  if (barcode && barcodeSet.has(barcode)) return true;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.some((variant) => barcodeSet.has(String(variant?.barcode || "").trim()))) return true;
  // Seed names only when barcode is empty or also a known demo barcode.
  const name = String(product.name || "").trim().toLowerCase();
  if (nameSet.has(name) && (!barcode || barcodeSet.has(barcode))) return true;
  return false;
}

export function excludeDemoProducts(products) {
  return (Array.isArray(products) ? products : []).filter((product) => !isDemoProduct(product));
}

export function productSku(product) {
  if (!product) return "";
  if (product.sku) return String(product.sku);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const withSku = variants.find((variant) => variant?.sku);
  return withSku?.sku ? String(withSku.sku) : "";
}

export function productSearchText(product) {
  const sku = productSku(product);
  const variantSkus = (Array.isArray(product?.variants) ? product.variants : [])
    .map((variant) => variant?.sku || "")
    .join(" ");
  const variantBarcodes = (Array.isArray(product?.variants) ? product.variants : [])
    .map((variant) => variant?.barcode || "")
    .join(" ");
  return [
    product?.name,
    sku,
    product?.barcode,
    product?.category,
    variantSkus,
    variantBarcodes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isOutOfStock(product) {
  return Number(product?.stock) <= 0;
}

export function isLowStock(product) {
  if (isOutOfStock(product)) return false;
  const reorder = Number(product?.reorder_level);
  const threshold = Number.isFinite(reorder) ? reorder : 5;
  return Number(product?.stock) <= threshold;
}
