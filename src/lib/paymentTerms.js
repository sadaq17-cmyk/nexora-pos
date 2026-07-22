/**
 * Payment terms helpers (shared client + mirrored in api/_posData.js).
 * Examples: "Net 30", "30 Days", "COD", "Net 15"
 */

export const PAYMENT_TERMS_OPTIONS = Object.freeze([
  "COD",
  "Net 7",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
  "30 Days",
]);

/** Parse days from a payment-terms string. COD / empty → 0. */
export function paymentTermsToDays(terms) {
  if (terms == null || terms === "") return 0;
  const t = String(terms).trim().toLowerCase();
  if (!t || t === "cod" || t === "cash" || t === "cash on delivery") return 0;
  const net = t.match(/net\s*(\d+)/i);
  if (net) return Math.max(0, parseInt(net[1], 10) || 0);
  const days = t.match(/(\d+)\s*days?/i);
  if (days) return Math.max(0, parseInt(days[1], 10) || 0);
  const bare = t.match(/^(\d+)$/);
  if (bare) return Math.max(0, parseInt(bare[1], 10) || 0);
  return 0;
}

/**
 * @param {string|null|undefined} terms
 * @param {Date|string|number} [fromDate]
 * @returns {string|null} ISO date YYYY-MM-DD (UTC date portion) or null
 */
export function computeDueDate(terms, fromDate = new Date()) {
  const days = paymentTermsToDays(terms);
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (Number.isNaN(base.getTime())) return null;
  const due = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  due.setUTCDate(due.getUTCDate() + days);
  return due.toISOString().slice(0, 10);
}

export function formatDueDate(value) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}
