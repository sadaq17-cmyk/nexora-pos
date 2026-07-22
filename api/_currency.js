/**
 * Server-side multi-currency helpers (no src/ imports).
 */

export const CATALOG = Object.freeze([
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", decimals: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", decimals: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", decimals: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", decimals: 2 },
  { code: "SOS", name: "Somali Shilling", symbol: "Sh.So", decimals: 2 },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br", decimals: 2 },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", decimals: 0 },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh", decimals: 0 },
  { code: "RWF", name: "Rwandan Franc", symbol: "FRw", decimals: 0 },
  { code: "CDF", name: "Congolese Franc", symbol: "FC", decimals: 2 },
]);

const catalogMap = new Map(CATALOG.map((c) => [c.code, c]));

export function normalizeCode(code, fallback = "KES") {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized || fallback;
}

export function catalogEntry(code) {
  const key = normalizeCode(code);
  return catalogMap.get(key) || { code: key, name: key, symbol: key, decimals: 2 };
}

export function toNumber(value, fallback = 0) {
  const n = typeof value === "string" && value.trim() === "" ? fallback : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Convert amount in `fromCode` to base using rate_to_base of that currency. */
export function convertToBase(amount, rateToBase) {
  const a = toNumber(amount);
  const rate = toNumber(rateToBase, 1);
  if (rate <= 0) return a;
  return roundMoney(a * rate);
}

/** Convert base amount into a target currency using that currency's rate_to_base. */
export function convertFromBase(baseAmount, rateToBase) {
  const a = toNumber(baseAmount);
  const rate = toNumber(rateToBase, 1);
  if (rate <= 0) return a;
  return roundMoney(a / rate);
}

export function roundMoney(value, decimals = 2) {
  const d = Math.max(0, Math.min(6, Number(decimals) || 2));
  const f = 10 ** d;
  return Math.round((toNumber(value) + Number.EPSILON) * f) / f;
}

/**
 * Gain/Loss when invoice is in invoiceCurrency but payment is in paymentCurrency,
 * both converted via rates-to-base. Positive = gain (paid less base than invoice).
 */
export function computeFxGainLoss({
  invoiceAmount,
  invoiceRateToBase,
  paymentAmount,
  paymentRateToBase,
}) {
  const invoiceBase = convertToBase(invoiceAmount, invoiceRateToBase);
  const paymentBase = convertToBase(paymentAmount, paymentRateToBase);
  return roundMoney(invoiceBase - paymentBase);
}

export function buildFxPaymentFields(params = {}, baseCode = "KES") {
  const paymentCurrency = normalizeCode(params.payment_currency || params.currency_code || baseCode, baseCode);
  const originalAmount = toNumber(params.original_amount ?? params.amount);
  const rate = toNumber(params.exchange_rate, paymentCurrency === baseCode ? 1 : NaN);
  const exchangeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const baseAmount = params.base_amount != null
    ? toNumber(params.base_amount)
    : convertToBase(originalAmount, exchangeRate);
  const convertedAmount = params.converted_amount != null
    ? toNumber(params.converted_amount)
    : baseAmount;
  const fxGainLoss = params.fx_gain_loss != null ? toNumber(params.fx_gain_loss) : 0;
  const paymentDate = params.payment_date || new Date().toISOString().slice(0, 10);
  return {
    payment_currency: paymentCurrency,
    exchange_rate: exchangeRate,
    original_amount: originalAmount,
    base_amount: roundMoney(baseAmount),
    converted_amount: roundMoney(convertedAmount),
    fx_gain_loss: roundMoney(fxGainLoss),
    payment_date: paymentDate,
    invoice_currency: params.invoice_currency
      ? normalizeCode(params.invoice_currency, baseCode)
      : null,
  };
}
