/**
 * Receipt number + QR payload helpers for POS receipts.
 * Barcode always encodes the receipt number exactly (CODE128).
 */

const PUBLIC_ORIGIN = "https://www.httpsnexorapos.com";

export function formatReceiptNumber(saleId, createdAt = new Date()) {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt || Date.now());
  const year = Number.isFinite(date.getFullYear()) ? date.getFullYear() : new Date().getFullYear();
  const seq = String(Math.max(1, Number(saleId) || 1)).padStart(7, "0");
  return `NX-${year}-${seq}`;
}

export function resolveReceiptNumber(sale = {}) {
  const existing = String(sale.receipt_no || "").trim();
  if (existing) return existing;
  const invoice = String(sale.invoice_no || "").trim();
  if (/^NX-\d{4}-\d+$/i.test(invoice)) return invoice.toUpperCase();
  return formatReceiptNumber(sale.id, sale.created_at);
}

export function invoicePublicOrigin() {
  if (typeof window === "undefined") return PUBLIC_ORIGIN;
  const origin = String(window.location?.origin || "").replace(/\/$/, "");
  // Use the active site origin so QR scans open this environment's verify page.
  // Production deployments resolve to https://www.httpsnexorapos.com/...
  return origin || PUBLIC_ORIGIN;
}

export function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Online → absolute invoice verification URL.
 * Offline → encode receipt number so scanners still capture a useful value.
 */
export function buildInvoiceQrPayload({ invoiceId, receiptNo, online = isBrowserOnline() } = {}) {
  const receipt = String(receiptNo || "").trim();
  const id = String(invoiceId || receipt || "").trim();
  if (!online) return receipt || id;
  if (!id) return receipt;
  return `${invoicePublicOrigin()}/invoice/${encodeURIComponent(id)}`;
}

export function deriveInvoiceStatus(sale) {
  if (!sale) return "Cancelled";
  const explicit = String(sale.status || "").toLowerCase();
  if (explicit === "cancelled" || explicit === "canceled") return "Cancelled";
  if (explicit === "refunded") return "Refunded";
  const returned = Number(sale.returned || sale.refunds || 0);
  const total = Number(sale.total || 0);
  if (returned > 0 && total > 0 && returned >= total - 0.009) return "Refunded";
  if (returned > 0) return "Refunded";
  if (sale.cancelled === true || sale.active === false) return "Cancelled";
  return "Valid";
}
