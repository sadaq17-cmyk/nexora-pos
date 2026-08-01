/**
 * Server-side multi-currency helpers (no src/ imports).
 * Keep in sync with src/lib/currency.js catalog.
 */

export const DEFAULT_CURRENCY_CODE = "KES";
export const DEFAULT_COUNTRY_CODE = "KE";

export const CATALOG = Object.freeze([
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", locale: "en-KE", decimals: 2 },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh", locale: "en-UG", decimals: 0 },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", locale: "sw-TZ", decimals: 0 },
  { code: "RWF", name: "Rwandan Franc", symbol: "FRw", locale: "rw-RW", decimals: 0 },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br", locale: "am-ET", decimals: 2 },
  { code: "SOS", name: "Somali Shilling", symbol: "Sh.So", locale: "so-SO", decimals: 2 },
  { code: "SSP", name: "South Sudanese Pound", symbol: "£", locale: "en-SS", decimals: 2 },
  { code: "BIF", name: "Burundian Franc", symbol: "FBu", locale: "fr-BI", decimals: 0 },
  { code: "ZAR", name: "South African Rand", symbol: "R", locale: "en-ZA", decimals: 2 },
  { code: "CDF", name: "Congolese Franc", symbol: "FC", locale: "fr-CD", decimals: 2 },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", locale: "en-NG", decimals: 2 },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "GH₵", locale: "en-GH", decimals: 2 },
  { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK", locale: "en-ZM", decimals: 2 },
  { code: "BWP", name: "Botswana Pula", symbol: "P", locale: "en-BW", decimals: 2 },
  { code: "NAD", name: "Namibian Dollar", symbol: "N$", locale: "en-NA", decimals: 2 },
  { code: "MWK", name: "Malawian Kwacha", symbol: "MK", locale: "en-MW", decimals: 2 },
  { code: "MZN", name: "Mozambican Metical", symbol: "MT", locale: "pt-MZ", decimals: 2 },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£", locale: "ar-EG", decimals: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", locale: "en-AE", decimals: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", locale: "ar-SA", decimals: 2 },
  { code: "QAR", name: "Qatari Riyal", symbol: "ر.ق", locale: "ar-QA", decimals: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US", decimals: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", locale: "en-IE", decimals: 2 },
]);

export const COUNTRIES = Object.freeze([
  { code: "KE", name: "Kenya", currency: "KES", locale: "en-KE" },
  { code: "UG", name: "Uganda", currency: "UGX", locale: "en-UG" },
  { code: "TZ", name: "Tanzania", currency: "TZS", locale: "sw-TZ" },
  { code: "RW", name: "Rwanda", currency: "RWF", locale: "rw-RW" },
  { code: "ET", name: "Ethiopia", currency: "ETB", locale: "am-ET" },
  { code: "SO", name: "Somalia", currency: "SOS", locale: "so-SO" },
  { code: "SS", name: "South Sudan", currency: "SSP", locale: "en-SS" },
  { code: "BI", name: "Burundi", currency: "BIF", locale: "fr-BI" },
  { code: "ZA", name: "South Africa", currency: "ZAR", locale: "en-ZA" },
  { code: "CD", name: "DR Congo", currency: "CDF", locale: "fr-CD" },
  { code: "NG", name: "Nigeria", currency: "NGN", locale: "en-NG" },
  { code: "GH", name: "Ghana", currency: "GHS", locale: "en-GH" },
  { code: "ZM", name: "Zambia", currency: "ZMW", locale: "en-ZM" },
  { code: "BW", name: "Botswana", currency: "BWP", locale: "en-BW" },
  { code: "NA", name: "Namibia", currency: "NAD", locale: "en-NA" },
  { code: "MW", name: "Malawi", currency: "MWK", locale: "en-MW" },
  { code: "MZ", name: "Mozambique", currency: "MZN", locale: "pt-MZ" },
  { code: "EG", name: "Egypt", currency: "EGP", locale: "ar-EG" },
  { code: "AE", name: "UAE", currency: "AED", locale: "en-AE" },
  { code: "SA", name: "Saudi Arabia", currency: "SAR", locale: "ar-SA" },
  { code: "QA", name: "Qatar", currency: "QAR", locale: "ar-QA" },
  { code: "US", name: "USA", currency: "USD", locale: "en-US" },
  { code: "GB", name: "United Kingdom", currency: "GBP", locale: "en-GB" },
  { code: "EU", name: "Europe", currency: "EUR", locale: "en-IE" },
]);

const catalogMap = new Map(CATALOG.map((c) => [c.code, c]));
const countryMap = new Map(COUNTRIES.map((c) => [c.code, c]));
const countryByName = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));

export function normalizeCode(code, fallback = DEFAULT_CURRENCY_CODE) {
  const normalized = String(code || "").trim().toUpperCase();
  return catalogMap.has(normalized) ? normalized : normalized || fallback;
}

export function catalogEntry(code) {
  const key = normalizeCode(code);
  return catalogMap.get(key) || { code: key, name: key, symbol: key, locale: "en-US", decimals: 2 };
}

export function getCountry(codeOrName = DEFAULT_COUNTRY_CODE) {
  const raw = String(codeOrName || "").trim();
  if (!raw) return countryMap.get(DEFAULT_COUNTRY_CODE);
  return countryMap.get(raw.toUpperCase()) || countryByName.get(raw.toLowerCase()) || countryMap.get(DEFAULT_COUNTRY_CODE);
}

export function resolveMoneyProfile({ country, country_code, currency, currency_code, currency_symbol, locale } = {}) {
  const countryRow = getCountry(country_code || country || DEFAULT_COUNTRY_CODE);
  const code = normalizeCode(currency_code || currency || countryRow.currency);
  const catalog = catalogEntry(code);
  return {
    country: countryRow.name,
    country_code: countryRow.code,
    currency_code: catalog.code,
    currency: catalog.code,
    currency_symbol: currency_symbol || catalog.symbol,
    locale: locale || catalog.locale || countryRow.locale,
    decimals: catalog.decimals,
  };
}

export function toNumber(value, fallback = 0) {
  const n = typeof value === "string" && value.trim() === "" ? fallback : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function roundMoney(value, decimals = 2) {
  const d = Math.max(0, Math.min(6, Number(decimals) || 2));
  const f = 10 ** d;
  const n = toNumber(value);
  return Math.round((n + Number.EPSILON) * f) / f;
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

export function computeFxGainLoss({
  invoiceAmount,
  invoiceRateToBase = 1,
  paymentAmount,
  paymentRateToBase = 1,
} = {}) {
  return roundMoney(convertToBase(invoiceAmount, invoiceRateToBase) - convertToBase(paymentAmount, paymentRateToBase));
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
